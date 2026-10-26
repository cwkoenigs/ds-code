// Codex as rule agent's third agent: the codex CLI's app-server, JSON-RPC over stdin and stdout, the
// protocol OpenAI's editor extensions use. Unlike the TypeScript SDK (`codex exec`), it asks before a
// command runs or a file changes, and it calls tools the client serves, so ds-next's tools run here in
// process as they do for the other agents. The app-server is marked experimental, and dynamic tools
// with it, so @openai/codex is pinned and the tests run the real binary.
import {type ChildProcess, spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import {z} from 'zod';
import {CODE_SERVER, isCodeTool} from '../code/tools.js';
import {type DsTool, runTool} from '../ds/tools.js';
import {type AgentSession, AgentUnavailable, permissionGate, ruleSpecTool, SERVER, sessionParts, type SessionOptions} from './backend.js';
import type {AgentEvent} from './events.js';

type Json = null | boolean | number | string | Json[] | {[k: string]: Json};
type Obj = Record<string, unknown>;
type Message = {id?: number | string; method?: string; params?: Obj; result?: unknown; error?: {code?: number; message?: string}};

/** How to start the app-server: CODEX_CLI_PATH if set, else the pinned @openai/codex's own launcher. */
export function codexCommand(): {command: string; args: string[]} {
	const set = process.env['CODEX_CLI_PATH'];
	if (set) return {command: set, args: ['app-server']};
	try {
		return {command: process.execPath, args: [createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js'), 'app-server']};
	} catch {
		throw new AgentUnavailable('Codex did not load: @openai/codex is missing; run npm install.');
	}
}

/** One JSON-RPC connection: requests out with promised replies, notifications and server requests in. */
export class AppServer {
	private next = 1;
	private waiting = new Map<number, {resolve: (v: unknown) => void; reject: (e: Error) => void}>();

	constructor(
		private child: ChildProcess,
		private onNotification: (method: string, params: Obj) => void,
		private onRequest: (method: string, params: Obj) => Promise<unknown>,
	) {
		createInterface({input: child.stdout!}).on('line', line => this.receive(line));
	}

	request<T = Obj>(method: string, params: Obj): Promise<T> {
		const id = this.next++;
		return new Promise<T>((resolve, reject) => {
			this.waiting.set(id, {resolve: v => resolve(v as T), reject});
			this.write({id, method, params});
		});
	}

	notify(method: string, params?: Obj): void {
		this.write(params ? {method, params} : {method});
	}

	/** Fail every request still waiting: the process is gone. */
	drop(why: string): void {
		for (const w of this.waiting.values()) w.reject(new Error(why));
		this.waiting.clear();
	}

	private write(m: Message): void {
		if (this.child.stdin?.writable) this.child.stdin.write(JSON.stringify(m) + '\n');
	}

	private receive(line: string): void {
		let m: Message;
		try {
			m = JSON.parse(line) as Message;
		} catch {
			return; // not protocol: ignore
		}
		if (m.method === undefined && typeof m.id === 'number') {
			const w = this.waiting.get(m.id);
			if (!w) return;
			this.waiting.delete(m.id);
			if (m.error) w.reject(new Error(m.error.message ?? 'Codex refused the request'));
			else w.resolve(m.result);
			return;
		}
		if (m.method === undefined) return;
		if (m.id === undefined) return this.onNotification(m.method, m.params ?? {});
		const id = m.id;
		this.onRequest(m.method, m.params ?? {}).then(
			result => this.write({id, result}),
			(err: Error) => this.write({id, error: {code: -32603, message: err.message}}),
		);
	}
}

/** A ds tool as a Codex dynamic tool: its arguments as JSON Schema. */
export function dynamicTool(t: DsTool): Json {
	const {$schema: _, ...schema} = z.toJSONSchema(z.object(t.shape)) as Obj;
	return {type: 'function', name: t.name, description: t.description, inputSchema: schema as Json};
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Codex runs a command through a login shell; `/bin/bash -lc 'npm test'` reads as `npm test`. */
export function shellCommand(cmd: string): string {
	const m = /^(?:\S*\/)?(?:bash|zsh|sh)\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(cmd.trim());
	if (!m) return cmd;
	return m[1] === "'" ? m[2]!.replace(/'\\''/g, "'") : m[2]!.replace(/\\(["\\$`])/g, '$1');
}

/** The text of an MCP result's content list. */
const contentText = (content: unknown): string =>
	Array.isArray(content) ? content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as Obj)['text']) : '')).filter(Boolean).join('\n') : '';

/** A file change as rule reads tool calls: Edit (or Write for a new file), its path, its diff. */
function fileChange(changes: unknown): {name: string; input: Obj} {
	const list = Array.isArray(changes) ? (changes as Obj[]) : [];
	const first = list[0] ?? {};
	const kind = (first['kind'] as Obj | undefined)?.['type'];
	const diff = list.map(c => str(c['diff'])).join('\n');
	const added = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1));
	const removed = diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).map(l => l.slice(1));
	return {
		name: kind === 'add' ? 'Write' : 'Edit',
		input: {file_path: str(first['path']), ...(list.length > 1 ? {description: `${list.length} files`} : {}), new_string: added.join('\n'), old_string: removed.join('\n'), content: added.join('\n')},
	};
}

/** Dynamic tools are one flat list to Codex; rule names each by the server it belongs to. */
const serverOf = (tool: string): string => (isCodeTool(tool) ? CODE_SERVER : SERVER);

/** A Codex thread item as the tool call rule shows: its name and input. Undefined for items that aren't tools. */
export function toolCall(item: Obj): {name: string; input: Obj} | undefined {
	switch (item['type']) {
		case 'commandExecution':
			return {name: 'Bash', input: {command: shellCommand(str(item['command']))}};
		case 'fileChange':
			return fileChange(item['changes']);
		case 'mcpToolCall':
			return {name: `mcp__${str(item['server'])}__${str(item['tool'])}`, input: (item['arguments'] as Obj) ?? {}};
		case 'dynamicToolCall':
			return {name: `mcp__${serverOf(str(item['tool']))}__${str(item['tool'])}`, input: (item['arguments'] as Obj) ?? {}};
		case 'webSearch':
			return {name: 'WebSearch', input: {query: str(item['query'])}};
		default:
			return undefined;
	}
}

/** A finished tool item's output and whether it failed. */
export function toolOutput(item: Obj): {text: string; isError: boolean} {
	switch (item['type']) {
		case 'commandExecution': {
			const code = item['exitCode'];
			const failed = item['status'] === 'failed' || item['status'] === 'declined' || (typeof code === 'number' && code !== 0);
			const out = str(item['aggregatedOutput']).trim();
			return {text: out || (item['status'] === 'declined' ? 'declined' : `exit ${code ?? '?'}`), isError: failed};
		}
		case 'fileChange': {
			const changes = Array.isArray(item['changes']) ? (item['changes'] as Obj[]) : [];
			return {text: changes.map(c => str(c['path'])).join('\n') || 'no files', isError: item['status'] === 'failed' || item['status'] === 'declined'};
		}
		case 'mcpToolCall': {
			const error = (item['error'] as Obj | null)?.['message'];
			return error ? {text: str(error), isError: true} : {text: contentText((item['result'] as Obj | null)?.['content']), isError: false};
		}
		case 'dynamicToolCall':
			return {text: contentText(item['contentItems']), isError: item['success'] === false};
		default:
			return {text: '', isError: false};
	}
}

export async function openCodexSession(o: SessionOptions): Promise<AgentSession> {
	const {command, args} = codexCommand();
	const {tools, code, closeCode, readOnly, prompt} = sessionParts(o.cwd, o.connection);
	const served = [...tools, ruleSpecTool, ...code];
	const byName = new Map(served.map(t => [t.name, t]));
	const gate = permissionGate(o.ask, readOnly);

	let child: ChildProcess;
	try {
		child = spawn(command, args, {cwd: o.cwd, stdio: ['pipe', 'pipe', 'pipe']});
	} catch (err) {
		throw new AgentUnavailable(`Codex did not start: ${(err as Error).message}`);
	}
	let stderr = '';
	child.stderr!.on('data', d => (stderr = (stderr + String(d)).slice(-2000)));

	let threadId = '';
	let turnId = '';
	let model = o.model;
	let turnStarted = Date.now();
	let tokens: number | undefined;
	let lastError = '';
	let closed = false;
	const items = new Map<string, Obj>(); // tool items by id, for the approval that follows them
	const emit = (e: AgentEvent) => o.onEvent(e);

	const onNotification = (method: string, p: Obj) => {
		switch (method) {
			case 'turn/started':
				turnId = str((p['turn'] as Obj)?.['id']) || turnId;
				return;
			case 'item/started': {
				const item = p['item'] as Obj;
				const call = toolCall(item);
				if (!call) return;
				items.set(str(item['id']), item);
				emit({kind: 'tool', id: str(item['id']), name: call.name, input: call.input});
				return;
			}
			case 'item/completed': {
				const item = p['item'] as Obj;
				if (item['type'] === 'agentMessage') {
					if (str(item['text']).trim()) emit({kind: 'text', text: str(item['text'])});
					return;
				}
				if (item['type'] === 'reasoning') {
					const summary = (item['summary'] as string[] | undefined) ?? [];
					const text = (summary.length ? summary : ((item['content'] as string[] | undefined) ?? [])).join('\n');
					if (text.trim()) emit({kind: 'thinking', text});
					return;
				}
				if (!toolCall(item)) return;
				const out = toolOutput(item);
				items.delete(str(item['id']));
				emit({kind: 'toolResult', id: str(item['id']), text: out.text, isError: out.isError});
				return;
			}
			case 'thread/tokenUsage/updated':
				tokens = ((p['tokenUsage'] as Obj)?.['last'] as Obj | undefined)?.['totalTokens'] as number | undefined;
				return;
			case 'error':
				if (!p['willRetry']) lastError = str((p['error'] as Obj)?.['message']);
				return;
			case 'turn/completed': {
				const turn = (p['turn'] as Obj) ?? {};
				const status = str(turn['status']);
				const error = str((turn['error'] as Obj | null)?.['message']) || lastError;
				const durationMs = typeof turn['durationMs'] === 'number' ? (turn['durationMs'] as number) : Date.now() - turnStarted;
				emit({kind: 'result', ok: status === 'completed', durationMs, tokens, errors: status === 'completed' ? [] : [status === 'interrupted' ? 'interrupted' : error || status]});
				turnId = '';
				lastError = '';
				tokens = undefined;
				return;
			}
		}
	};

	/** Ask the person, through the same gate as the other agents ("always" lasts the session). */
	const allowed = async (name: string, input: Obj) => (await gate(name, input)).behavior === 'allow';

	const onRequest = async (method: string, p: Obj): Promise<unknown> => {
		switch (method) {
			case 'item/commandExecution/requestApproval': {
				const ok = await allowed('Bash', {command: shellCommand(str(p['command']) || str((items.get(str(p['itemId'])) ?? {})['command'])), description: str(p['reason'])});
				return {decision: ok ? 'accept' : 'cancel'}; // cancel: a "no" ends the turn, as with the other agents
			}
			case 'item/fileChange/requestApproval': {
				const call = fileChange((items.get(str(p['itemId'])) ?? {})['changes']);
				const ok = await allowed(call.name, {...call.input, ...(p['reason'] ? {description: str(p['reason'])} : {})});
				return {decision: ok ? 'accept' : 'cancel'};
			}
			case 'item/tool/call': {
				const t = byName.get(str(p['tool']));
				if (!t) return {success: false, contentItems: [{type: 'inputText', text: `ERROR: no tool ${str(p['tool'])}`}]};
				const input = (p['arguments'] as Obj) ?? {};
				if (!(await allowed(`mcp__${serverOf(t.name)}__${t.name}`, input))) {
					void interrupt(); // a "no" ends the turn, as with the other agents
					return {success: false, contentItems: [{type: 'inputText', text: 'The person declined this and will say what to do instead.'}]};
				}
				const r = await runTool(t, input);
				return {success: !r.error, contentItems: [{type: 'inputText', text: r.text}]};
			}
			case 'mcpServer/elicitation/request':
				return {action: 'decline', content: null, _meta: null}; // no server rule starts asks anything
			default:
				throw new Error(`rule does not handle ${method}`);
		}
	};

	const rpc = new AppServer(child, onNotification, onRequest);
	const gone = new Promise<never>((_, reject) => {
		child.on('error', err => reject(new AgentUnavailable(`Codex did not start: ${err.message}`)));
		child.on('exit', code => reject(new AgentUnavailable(`Codex stopped (exit ${code ?? '?'}): ${stderr.trim().split('\n').pop() ?? ''}`)));
	});
	gone.catch(() => undefined);
	child.on('exit', () => {
		rpc.drop('Codex stopped');
		if (!closed && turnId) emit({kind: 'error', message: `Codex stopped: ${stderr.trim().split('\n').pop() ?? 'no reason given'}`});
		closed = true;
		void closeCode(); // the language servers, if any tool started one
		o.onClose();
	});

	// A `ds` server in the repo's or the user's Codex config (`rule mcp`) would serve the same tools
	// twice, so it is defined here switched off: valid whether or not one exists, which a bare
	// "enabled = false" is not.
	const mcpServers = {[SERVER]: {command: 'rule', args: ['mcp'], enabled: false}};
	const thread = {
		cwd: o.cwd,
		model: o.model ?? null,
		approvalPolicy: 'untrusted', // ask before anything that isn't a known read
		sandbox: 'workspace-write',
		developerInstructions: prompt,
		dynamicTools: served.map(dynamicTool),
		config: {mcp_servers: mcpServers},
	};
	try {
		await Promise.race([rpc.request('initialize', {clientInfo: {name: 'rule', title: 'rule', version: '0.1.0'}, capabilities: {experimentalApi: true, requestAttestation: false}}), gone]);
		rpc.notify('initialized');
		const started = await Promise.race([o.resume ? rpc.request('thread/resume', {...thread, threadId: o.resume}) : rpc.request('thread/start', thread), gone]);
		const t = (started['thread'] as Obj) ?? {};
		threadId = str(t['id']);
		emit({kind: 'init', model: str(started['model']) || str(t['model']), sessionId: threadId});
	} catch (err) {
		child.kill();
		throw err instanceof AgentUnavailable ? err : new AgentUnavailable(`Codex refused to start a session: ${(err as Error).message}`);
	}

	async function interrupt(): Promise<void> {
		if (threadId && turnId) await rpc.request('turn/interrupt', {threadId, turnId}).catch(() => undefined);
	}

	return {
		send(text) {
			turnStarted = Date.now();
			rpc
				.request('turn/start', {threadId, input: [{type: 'text', text, text_elements: []}], ...(model ? {model} : {}), ...(o.effort ? {effort: o.effort} : {})})
				.then(r => (turnId = str((r['turn'] as Obj)?.['id']) || turnId))
				.catch((err: Error) => emit({kind: 'error', message: err.message}));
		},
		interrupt,
		async setModel(m) {
			model = m;
		},
		close() {
			closed = true;
			child.kill();
		},
	};
}
