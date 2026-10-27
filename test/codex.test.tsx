// Codex as rule agent's third agent, against a stand-in app-server (test/fixtures/fake-codex.mjs) and,
// for the handshake, the real pinned binary. And `rule mcp`, ds-next's tools served over MCP.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {render} from 'ink-testing-library';
import {chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {AgentApp} from '../src/agent/AgentApp.js';
import {type Answer, chooseBackend, LABELS, openSession} from '../src/agent/backend.js';
import {codexCommand, dynamicTool, shellCommand, toolCall, toolOutput} from '../src/agent/codex.js';
import type {AgentEvent} from '../src/agent/events.js';
import {RAIL} from '../src/agent/looks.js';
import {askContent} from '../src/agent/present.js';
import {plain} from '../src/text.js';
import {mcpServer} from '../src/agent/mcp.js';
import {tools as dsTools} from '../src/ds/tools.js';
import {fakeModel, modelConfig} from './fixtures/fake-model.js';
import {ENTER, ready, tick, until} from './helpers.js';

const FAKE = join(import.meta.dirname, 'fixtures', 'fake-codex.mjs');
const KEYS = ['CODEX_CLI_PATH', 'FAKE_CODEX_LOG', 'CODEX_HOME', 'DS_CANON', 'DS_SKILLS'] as const;
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
let logFile = '';

beforeEach(() => {
	chmodSync(FAKE, 0o755);
	const dir = mkdtempSync(join(tmpdir(), 'fake-codex-'));
	logFile = join(dir, 'log.jsonl');
	process.env['CODEX_CLI_PATH'] = FAKE;
	process.env['FAKE_CODEX_LOG'] = logFile;
	// No canon, wherever this runs: a machine set up as AGENTS.md says has one at ~/Developer/canon.
	process.env['DS_CANON'] = join(dir, 'no-canon');
	process.env['DS_SKILLS'] = join(dir, 'no-skills');
});
afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

/** What the stand-in received, by method. */
const received = (method: string) =>
	readFileSync(logFile, 'utf8')
		.trim()
		.split('\n')
		.map(l => JSON.parse(l) as {method?: string; params?: Record<string, any>; result?: Record<string, any>})
		.filter(m => m.method === method || (method === 'reply' && m.method === undefined));

async function session(answer: Answer) {
	const events: AgentEvent[] = [];
	const asked: [string, Record<string, unknown>][] = [];
	let closed = false;
	const s = await openSession({
		backend: 'codex',
		cwd: mkdtempSync(join(tmpdir(), 'codex-cwd-')),
		ask: async (name, input) => {
			asked.push([name, input]);
			return answer;
		},
		onEvent: e => events.push(e),
		onClose: () => (closed = true),
	});
	return {s, events, asked, closed: () => closed};
}

const settle = async (events: AgentEvent[]) => {
	const end = Date.now() + 10_000;
	while (!events.some(e => e.kind === 'result') && Date.now() < end) await tick();
};

describe.skipIf(process.platform === 'win32')('Codex through its app-server', () => {
	it('starts a thread with ds-next tools and asks before a command', async () => {
		const {s, events, asked} = await session('yes');
		s.send('run the tests');
		await settle(events);
		s.close();
		expect(events.map(e => e.kind)).toEqual(['init', 'thinking', 'text', 'tool', 'toolResult', 'tool', 'toolResult', 'text', 'result']);
		expect(events[0]).toEqual({kind: 'init', model: 'gpt-test', sessionId: 'thread-1'});
		expect(events[3]).toMatchObject({kind: 'tool', name: 'mcp__ds__canon_list', input: {tags: 'python'}});
		expect(events[5]).toMatchObject({kind: 'tool', name: 'Bash', input: {command: 'npm test'}});
		expect(events[6]).toMatchObject({kind: 'toolResult', text: '78 passed in 3.1s\nTest Files 9 passed', isError: false});
		expect(events.at(-1)).toEqual({kind: 'result', ok: true, durationMs: 15200, tokens: 45230, errors: []});
		expect(asked).toEqual([['Bash', {command: 'npm test', description: 'Run the tests'}]]); // canon_list only reads: never asks

		const [init] = received('initialize');
		expect(init!.params!['capabilities']).toMatchObject({experimentalApi: true});
		const [thread] = received('thread/start');
		expect(thread!.params).toMatchObject({approvalPolicy: 'untrusted', sandbox: 'workspace-write', config: {mcp_servers: {ds: {enabled: false}}}}); // no second copy of the tools
		expect(thread!.params!['developerInstructions']).toContain('rule_spec');
		const names = (thread!.params!['dynamicTools'] as {name: string}[]).map(t => t.name);
		expect(names).toHaveLength(26);
		expect(names).toEqual(expect.arrayContaining(['canon_read', 'scaffold_project', 'rule_spec']));
		const [turn] = received('turn/start');
		expect(turn!.params!['input']).toEqual([{type: 'text', text: 'run the tests', text_elements: []}]);
		expect(received('reply').map(r => r.result)).toEqual([expect.objectContaining({success: false}), {decision: 'accept'}]); // no canon here: the tool says so
	});

	it('a no cancels the command and ends the turn without a failure', async () => {
		const {s, events} = await session('no');
		s.send('run the tests');
		await settle(events);
		s.close();
		expect(received('reply').at(-1)!.result).toEqual({decision: 'cancel'});
		expect(events.at(-1)).toMatchObject({kind: 'result', ok: false, errors: ['interrupted']});
		expect(events.find(e => e.kind === 'toolResult' && e.id === 'c1')).toMatchObject({isError: true, text: 'declined'});
	});

	it('draws a Codex turn in Rail, tokens in the footer', async () => {
		const a = render(<AgentApp backend="codex" open={openSession} cwd={mkdtempSync(join(tmpdir(), 'codex-cwd-'))} width={80} look={RAIL} />);
		await ready(a, 'New session ──╮');
		expect(a.lastFrame()).toContain('agent        Codex');
		a.stdin.write('run the tests');
		a.stdin.write(ENTER);
		const asking = await until(a.lastFrame, f => f.includes('Allow Bash?'));
		expect(asking).toContain('│ → canon_list {"tags": "python"}'); // ds-next shows an argument it doesn't name as JSON
		expect(asking).toContain('│ → Bash npm test');
		a.stdin.write('y');
		a.stdin.write(ENTER);
		const f = await until(a.lastFrame, f => f.includes('╰ #1'));
		expect(f).toContain('│   ⎿ 78 passed in 3.1s  ┄ 1 more lines · ctrl-o');
		expect(f).toContain('╰ #1 · 2 tool calls · 15.2s · 45.2k tokens');
		a.unmount();
	});
});

describe('Codex, the pieces', () => {
	it('is chosen by --agent codex and named Codex', () => {
		expect(chooseBackend('codex')).toBe('codex');
		expect(LABELS.codex).toBe('Codex');
	});

	it('runs the pinned @openai/codex unless CODEX_CLI_PATH says otherwise', () => {
		delete process.env['CODEX_CLI_PATH'];
		const c = codexCommand();
		expect(c.command).toBe(process.execPath);
		expect(c.args[0]).toMatch(/@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
		expect(c.args[1]).toBe('app-server');
	});

	it('serves each ds tool with its arguments as JSON Schema', () => {
		const t = dsTools({cwd: '/w', canon: () => { throw new Error('no canon'); }, skills: () => { throw new Error('no skills'); }}).find(x => x.name === 'canon_read')!;
		expect(dynamicTool(t)).toMatchObject({type: 'function', name: 'canon_read', inputSchema: {type: 'object', properties: {id: {type: 'string'}}}});
	});

	it('reads Codex items as rule reads tool calls', () => {
		expect(toolCall({type: 'fileChange', changes: [{path: 'src/a.ts', kind: {type: 'update', move_path: null}, diff: '@@\n-old\n+new\n+more'}]})).toEqual({
			name: 'Edit',
			input: {file_path: 'src/a.ts', new_string: 'new\nmore', old_string: 'old', content: 'new\nmore'},
		});
		expect(toolCall({type: 'mcpToolCall', server: 'lsp', tool: 'find_symbol', arguments: {name_path_pattern: 'X'}})).toEqual({name: 'mcp__lsp__find_symbol', input: {name_path_pattern: 'X'}});
		expect(toolCall({type: 'agentMessage', text: 'hi'})).toBeUndefined();
		// A patch over several files, or one that deletes or moves a file, names each in its approval.
		const patch = toolCall({
			type: 'fileChange',
			changes: [
				{path: '/w/safe.txt', kind: {type: 'update', move_path: null}, diff: '@@\n-a\n+b'},
				{path: '/w/sensitive.txt', kind: {type: 'delete', move_path: null}, diff: ''},
				{path: '/w/old.ts', kind: {type: 'update', move_path: '/w/new.ts'}, diff: ''},
			],
		})!;
		const {title, body} = askContent(patch.name, patch.input, '/w', 80);
		expect([title, ...body.slice(0, 3).map(plain)]).toEqual(['Edit files', 'update safe.txt', 'delete sensitive.txt', 'update old.ts → new.ts']);
		expect(toolOutput({type: 'commandExecution', status: 'completed', exitCode: 1, aggregatedOutput: 'boom'})).toEqual({text: 'boom', isError: true});
		expect(toolOutput({type: 'mcpToolCall', error: {message: 'no index'}})).toEqual({text: 'no index', isError: true});
	});

	it('shows the command inside the login shell Codex wraps it in', () => {
		expect(shellCommand("/bin/bash -lc 'npm test'")).toBe('npm test');
		expect(shellCommand(String.raw`/bin/zsh -lc 'echo '\''hi'\'''`)).toBe("echo 'hi'");
		expect(shellCommand(String.raw`bash -c "echo \"x\""`)).toBe('echo "x"');
		expect(shellCommand('npm test')).toBe('npm test');
	});

	it('starts a thread with the real, pinned app-server: no login needed for that', async () => {
		delete process.env['CODEX_CLI_PATH'];
		process.env['CODEX_HOME'] = mkdtempSync(join(tmpdir(), 'codex-home-'));
		const events: AgentEvent[] = [];
		const s = await openSession({backend: 'codex', cwd: mkdtempSync(join(tmpdir(), 'codex-cwd-')), ask: async () => 'no', onEvent: e => events.push(e), onClose: () => {}});
		s.close();
		const init = events.find(e => e.kind === 'init');
		expect(init).toMatchObject({kind: 'init'});
		expect(init && init.kind === 'init' && init.model.length > 0 && init.sessionId.length > 0).toBe(true);
	}, 30_000);
});

describe('rule mcp', () => {
	it('serves ds-next tools and rule_spec, each marked read-only or not', async () => {
		const [server, client] = InMemoryTransport.createLinkedPair();
		await mcpServer('/work').connect(server);
		const c = new Client({name: 'test', version: '0'});
		await c.connect(client);
		const {tools} = await c.listTools();
		expect(tools).toHaveLength(26);
		const hint = (n: string) => tools.find(t => t.name === n)!.annotations?.readOnlyHint;
		expect([hint('canon_read'), hint('rule_spec'), hint('scaffold_project'), hint('capture')]).toEqual([true, true, false, false]);
		const r = await c.callTool({name: 'rule_spec', arguments: {section: 'principles'}});
		expect(r.isError).toBe(false);
		expect((r.content as {text: string}[])[0]!.text).toContain('The grid shows');
		await c.close();
	});
});

/** A turn through the real, pinned app-server, its model calls going to a stand-in that asks for one tool. */
async function realTurn(call: {name: string; arguments: Record<string, unknown>}, answer: Answer, cwd = mkdtempSync(join(tmpdir(), 'codex-cwd-'))) {
	delete process.env['CODEX_CLI_PATH'];
	const model = await fakeModel(call);
	const home = mkdtempSync(join(tmpdir(), 'codex-home-'));
	writeFileSync(join(home, 'config.toml'), modelConfig(model.url));
	process.env['CODEX_HOME'] = home;
	const events: AgentEvent[] = [];
	const asked: string[] = [];
	const s = await openSession({backend: 'codex', cwd, ask: async (name, input) => (asked.push(`${name} ${JSON.stringify(input)}`), answer), onEvent: e => events.push(e), onClose: () => {}});
	s.send('go');
	await settle(events);
	s.close();
	model.close();
	return {events, asked, cwd, outputs: model.outputs};
}

describe('Codex end to end: the real app-server, a stand-in model', () => {
	it('calls a ds tool rule serves, and finishes the turn', async () => {
		const {events, asked, outputs} = await realTurn({name: 'rule_spec', arguments: {section: 'principles'}}, 'yes');
		expect(events.map(e => e.kind)).toEqual(['init', 'tool', 'toolResult', 'text', 'result']);
		expect(events[1]).toMatchObject({name: 'mcp__ds__rule_spec', input: {section: 'principles'}});
		expect(asked).toEqual([]); // rule_spec only reads
		expect(outputs[0]).toContain('The grid shows'); // what the model got back
		expect(events.at(-1)).toMatchObject({kind: 'result', ok: true, tokens: 120});
	}, 60_000);

	it('calls a code tool, which asks the TypeScript language server, without asking the person', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'codex-cwd-'));
		cpSync(join(import.meta.dirname, 'fixtures', 'code-ts'), cwd, {recursive: true});
		const {events, asked, outputs} = await realTurn({name: 'file_symbols', arguments: {path: 'src/greet.ts'}}, 'yes', cwd);
		expect(events.map(e => e.kind)).toEqual(['init', 'tool', 'toolResult', 'text', 'result']);
		expect(events[1]).toMatchObject({name: 'mcp__code__file_symbols', input: {path: 'src/greet.ts'}});
		expect(asked).toEqual([]);
		expect(outputs[0]).toBe('src/greet.ts: 2 symbols\n  1-3  function greet\n  5-7  function shout');
	}, 60_000);

	it.skipIf(process.platform === 'win32')('asks before a command, runs it on a yes', async () => {
		const {events, asked, cwd} = await realTurn({name: 'exec_command', arguments: {cmd: 'touch made-by-codex.txt'}}, 'yes');
		expect(asked).toEqual(['Bash {"command":"touch made-by-codex.txt","description":""}']);
		expect(existsSync(join(cwd, 'made-by-codex.txt'))).toBe(true);
		expect(events.at(-1)).toMatchObject({kind: 'result', ok: true});
	}, 60_000);

	it.skipIf(process.platform === 'win32')('a no stops the command and ends the turn', async () => {
		const {events, cwd} = await realTurn({name: 'exec_command', arguments: {cmd: 'touch made-by-codex.txt'}}, 'no');
		expect(existsSync(join(cwd, 'made-by-codex.txt'))).toBe(false);
		expect(events.find(e => e.kind === 'toolResult')).toMatchObject({isError: true, text: 'declined'});
		expect(events.at(-1)).toMatchObject({kind: 'result', ok: false, errors: ['interrupted']});
	}, 60_000);
});
