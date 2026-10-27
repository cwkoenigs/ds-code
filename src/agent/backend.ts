// Which agent runs the turns, and one session with it. Claude Code (@anthropic-ai/claude-agent-sdk),
// Cortex Code (@snowflake/cortex-agent-sdk, Snowflake's fork of the same SDK), or Codex (the codex
// CLI's app-server, in codex.ts). Chosen as ds-next chooses: --agent, then DS_AGENT, then
// `agent = "..."` in ~/.ds/config.toml, then whichever CLI is on PATH: Cortex, Claude, Codex.
// Nothing outside this file and codex.ts knows which agent is running.
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, join} from 'node:path';
import {z} from 'zod';
import {CODE_SERVER, codeTools} from '../code/tools.js';
import {Canon, Skills} from '../ds/kb.js';
import {type DsTool, runTool, systemPrompt as dsPrompt, tools as dsTools} from '../ds/tools.js';
import * as spec from '../spec.js';
import {type AgentEvent, normalize} from './events.js';

export type Backend = 'claude' | 'cortex' | 'codex';
export const BACKENDS: readonly Backend[] = ['cortex', 'claude', 'codex'];
export const LABELS: Record<Backend, string> = {claude: 'Claude Code', cortex: 'Cortex Code', codex: 'Codex'};
export const CONFIG = join(homedir(), '.ds', 'config.toml');

const isBackend = (v: unknown): v is Backend => BACKENDS.includes(v as Backend);

function onPath(cmd: string): boolean {
	const exts = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';') : [''];
	return (process.env['PATH'] ?? '').split(delimiter).some(dir => dir && exts.some(ext => existsSync(join(dir, cmd + ext))));
}

/** The agent named in ~/.ds/config.toml (`ds-next setup --agent` writes it), if any. */
export function configured(): Backend | undefined {
	try {
		const m = /^\s*agent\s*=\s*["'](\w+)["']/m.exec(readFileSync(CONFIG, 'utf8'));
		return isBackend(m?.[1]) ? m[1] : undefined;
	} catch {
		return undefined;
	}
}

export function chooseBackend(flag?: string): Backend {
	for (const v of [flag, process.env['DS_AGENT']]) {
		const x = v?.trim().toLowerCase();
		if (isBackend(x)) return x;
	}
	return configured() ?? BACKENDS.find(b => onPath(b)) ?? 'cortex';
}

// ── the session ──────────────────────────────────────────────────────────────

export type Answer = 'yes' | 'always' | 'no';
/** Ask the person about one tool call. `name` is the tool's id (mcp__ds__x for in-process tools). */
export type Ask = (name: string, input: Record<string, unknown>) => Promise<Answer>;

export type SessionOptions = {
	backend: Backend;
	cwd: string;
	ask: Ask;
	onEvent: (e: AgentEvent) => void;
	/** Called once when the agent process ends, for whatever reason. */
	onClose: () => void;
	model?: string;
	connection?: string;
	effort?: string;
	resume?: string;
};

export interface AgentSession {
	send(text: string): void;
	interrupt(): Promise<void>;
	setModel(model?: string): Promise<void>;
	close(): void;
}

export class AgentUnavailable extends Error {}

/** The terminal's own tools, served in process as two MCP servers: `ds`, ds-next's tools (src/ds/tools.ts)
 *  and rule_spec; and `code`, the language servers' answers (src/code/tools.ts). Reading never asks. */
export const SERVER = 'ds';
export const READ_ONLY = new Set([`mcp__${SERVER}__rule_spec`]);

/** Every tool id that never asks: rule_spec, ds-next's read-only tools, and every code tool. */
export function readOnlyIds(tools: DsTool[], code: DsTool[] = []): Set<string> {
	return new Set([...READ_ONLY, ...tools.filter(t => t.readOnly).map(t => `mcp__${SERVER}__${t.name}`), ...code.map(t => `mcp__${CODE_SERVER}__${t.name}`)]);
}

const SECTIONS = ['summary', 'principles', 'colour', 'glyphs', 'grid', 'motion', 'mascot', 'codeMap', 'screens', 'knownGaps'] as const;

export function ruleSpec(section?: string): string {
	const all = spec.asJson() as Record<string, unknown>;
	if (!section || section === 'all') return JSON.stringify(all, null, 1);
	if (!(section in all)) return `ERROR: no section ${JSON.stringify(section)}; one of ${SECTIONS.join(', ')}, or all`;
	return JSON.stringify(all[section], null, 1);
}

/** ds-next's system prompt, then one line for rule_spec. Without a canon on this machine, a short
 *  prompt that says so, so the agent can tell the person what to set up. */
export function systemPrompt(cwd: string, canon?: Canon, skills?: Skills): string {
	const rule = 'This terminal is drawn in Rule, the ds-next terminal design system; rule_spec reads its spec.';
	if (canon && skills) return `${dsPrompt(cwd, canon, skills)}\n\n${rule}`;
	return `You are ds, the front door to the team's knowledge system, running in a terminal.

The canon was not found on this machine (set DS_CANON or clone it to ~/Developer/canon), so the \`ds\` tools that read it will say so. Tell the person if they ask about standards, scaffolds or accepted code.
- Be brief. This is a terminal.

${rule} The working directory is ${cwd}.`;
}

/** Cortex asks about in-process tools as kind "MCP" with a resource string whose first line names the tool. */
function toolId(name: string, input: Record<string, unknown>): string {
	return name === 'MCP' ? String(input['resource'] ?? '').split('\n')[0]!.trim() || name : name;
}

type Sdk = {
	query: (p: {prompt: AsyncIterable<unknown>; options: Record<string, unknown>}) => AsyncGenerator<unknown> & {
		interrupt(): Promise<void>;
		setModel(model?: string): Promise<void>;
	};
	tool: (...a: any[]) => unknown;
	createSdkMcpServer: (o: {name: string; version?: string; tools: unknown[]}) => unknown;
};

export async function load(backend: Exclude<Backend, 'codex'>): Promise<Sdk> {
	try {
		return (backend === 'claude' ? await import('@anthropic-ai/claude-agent-sdk') : await import('@snowflake/cortex-agent-sdk/code')) as unknown as Sdk;
	} catch (err) {
		const need = backend === 'cortex' ? 'Node 22.22 or newer and @snowflake/cortex-agent-sdk' : '@anthropic-ai/claude-agent-sdk';
		throw new AgentUnavailable(`${LABELS[backend]} SDK did not load (${(err as Error).message.split('\n')[0]}). It needs ${need}; run npm install.`);
	}
}

/** A queue the SDK reads the conversation from: each send() is the next user message. */
function inbox() {
	const queue: unknown[] = [];
	let wake: (() => void) | undefined;
	let done = false;
	return {
		push(text: string) {
			queue.push({
				type: 'user',
				message: {role: 'user', content: [{type: 'text', text}]},
				parent_tool_use_id: null,
				session_id: '',
				uuid: randomUUID(),
			});
			wake?.();
		},
		end() {
			done = true;
			wake?.();
		},
		async *messages() {
			while (true) {
				while (queue.length) yield queue.shift();
				if (done) return;
				await new Promise<void>(r => (wake = r));
				wake = undefined;
			}
		},
	};
}

/** The SDK's canUseTool: reading the terminal's own tools never asks; everything else asks the
 *  person, and "don't ask again" lasts for the session. */
export function permissionGate(ask: Ask, readOnly: Set<string> = READ_ONLY) {
	const always = new Set<string>();
	return async (name: string, input: Record<string, unknown>) => {
		const id = toolId(name, input);
		let answer: Answer = 'yes';
		if (!readOnly.has(id) && !always.has(id)) answer = await ask(id, input);
		if (answer === 'always') always.add(id);
		return answer === 'no'
			? {behavior: 'deny' as const, message: 'The person declined this and will say what to do instead.', interrupt: true}
			: {behavior: 'allow' as const, updatedInput: input};
	};
}

/** rule_spec, served beside ds-next's tools. */
export const ruleSpecTool: DsTool = {
	name: 'rule_spec',
	description: 'Read the Rule terminal design system spec this terminal is drawn in. Pass a section, or omit it for everything.',
	shape: {section: z.string().optional().describe(`one of ${SECTIONS.join(', ')}; omit for all`)},
	readOnly: true,
	run: args => {
		const text = ruleSpec(typeof args['section'] === 'string' ? args['section'] : undefined);
		return {text, error: text.startsWith('ERROR: ')};
	},
};

/** An in-process MCP server, built with the loaded SDK's own helpers, serving the tools given. */
export function inProcessServer(sdk: Sdk, name: string, tools: DsTool[]): unknown {
	return sdk.createSdkMcpServer({
		name,
		version: '0.1.0',
		tools: tools.map(t =>
			sdk.tool(t.name, t.description, t.shape, async (args: Record<string, unknown>) => {
				const r = await runTool(t, args);
				return {content: [{type: 'text', text: r.text}], isError: r.error};
			}),
		),
	});
}

/** The `ds` server: the tools given, and rule_spec. */
export const dsServer = (sdk: Sdk, tools: DsTool[] = []): unknown => inProcessServer(sdk, SERVER, [...tools, ruleSpecTool]);

/** Cortex's SDK hangs, silently, when its CLI is missing (0.0.2 and 0.0.3 record the spawn error and never
 *  report it), so look first, the way the SDK will: CORTEX_CODE_CLI_PATH, else `cortex` on PATH. */
export function cortexCli(): string | undefined {
	const set = process.env['CORTEX_CODE_CLI_PATH'];
	if (set) return existsSync(set) ? set : undefined;
	return onPath('cortex') ? 'cortex' : undefined;
}

/** ds-next's tools for a working directory, and the canon and skills they read, if found. The canon and
 *  skills are read on first use, so a machine without them still gets the tools, which say so. */
export function dsToolsFor(cwd: string, connection?: string): {tools: DsTool[]; canon?: Canon; skills?: Skills} {
	let canon: Canon | undefined;
	let skills: Skills | undefined;
	const ctx = {cwd, connection, canon: () => (canon ??= new Canon()), skills: () => (skills ??= new Skills())};
	try {
		ctx.canon();
		ctx.skills();
	} catch {
		// reported by the prompt and by each tool that needs them
	}
	return {tools: dsTools(ctx), canon, skills};
}

/** What every session gets, whichever agent runs it: ds-next's tools (rule_spec is added where they're
 *  served), the code tools and how to stop their servers, the tools that never ask, and the system prompt. */
export function sessionParts(cwd: string, connection?: string) {
	const {tools, canon, skills} = dsToolsFor(cwd, connection);
	const code = codeTools(cwd);
	return {tools, code: code.tools, closeCode: code.close, readOnly: readOnlyIds(tools, code.tools), prompt: systemPrompt(cwd, canon, skills)};
}

export async function openSession(o: SessionOptions): Promise<AgentSession> {
	if (o.backend === 'codex') return (await import('./codex.js')).openCodexSession(o);
	if (o.backend === 'cortex' && !cortexCli()) {
		const where = process.env['CORTEX_CODE_CLI_PATH'] ? `CORTEX_CODE_CLI_PATH (${process.env['CORTEX_CODE_CLI_PATH']}) does not exist` : 'cortex is not on your PATH';
		throw new AgentUnavailable(`Cortex Code CLI not found: ${where}. Install it, or run with --agent claude or --agent codex.`);
	}
	const sdk = await load(o.backend);
	const {tools, code, closeCode, readOnly, prompt} = sessionParts(o.cwd, o.connection);
	const canUseTool = permissionGate(o.ask, readOnly);
	const abortController = new AbortController();
	const common = {cwd: o.cwd, mcpServers: {[SERVER]: dsServer(sdk, tools), [CODE_SERVER]: inProcessServer(sdk, CODE_SERVER, code)}, canUseTool, model: o.model, effort: o.effort, resume: o.resume, abortController};
	const options =
		o.backend === 'claude'
			? {
					...common,
					strictMcpConfig: true, // the terminal's own servers only
					systemPrompt: {type: 'preset', preset: 'claude_code', append: prompt},
					settingSources: ['user', 'project'], // the repo's CLAUDE.md and the user's settings, as a normal session has
					// No hooks: a cloned repo's .claude/settings.json could otherwise run a command as the session
					// starts, with nothing asked (Claude Code asks first, in its trust dialog). This tier outranks
					// project settings and is not policy, so no IT-managed tier drops it; managed hooks still run.
					settings: {disableAllHooks: true},
					permissionMode: 'default', // approvals come to the dialog, not to auto mode
				}
			: {
					...common,
					// No allowedTools: Cortex treats that list as exclusive. Read-only tools are allowed in canUseTool.
					appendSystemPrompt: prompt,
					connection: o.connection,
					onlyExplicitMcpServers: true, // skip the user's mcp.json, or `ds` tools appear twice
				};

	const box = inbox();
	const q = sdk.query({prompt: box.messages(), options});
	void (async () => {
		try {
			for await (const m of q) for (const e of normalize(m)) o.onEvent(e);
		} catch (err) {
			if (!abortController.signal.aborted) o.onEvent({kind: 'error', message: (err as Error).message.split('\n')[0] ?? String(err)});
		} finally {
			void closeCode(); // the language servers, if any tool started one
			o.onClose();
		}
	})();

	return {
		send: text => box.push(text),
		interrupt: () => q.interrupt(),
		setModel: model => q.setModel(model),
		close: () => {
			box.end();
			abortController.abort();
		},
	};
}
