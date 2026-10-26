#!/usr/bin/env node
// A stand-in for `codex app-server`: the same JSON-RPC, one scripted turn per message. It reasons,
// says something, calls the ds tool canon_list, asks to run `npm test`, then finishes (or stops, if
// the answer was no). Every message it receives is appended to $FAKE_CODEX_LOG as one JSON line.
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';

const log = process.env.FAKE_CODEX_LOG;
const out = m => process.stdout.write(JSON.stringify(m) + '\n');
const note = (method, params) => out({method, params});
let nextId = 1000;
const replies = new Map();
const ask = (method, params) => new Promise(res => { const id = nextId++; replies.set(id, res); out({id, method, params}); });
const threadId = 'thread-1';
let turn = 0;
let live = null; // the turn running, so turn/interrupt can end it

async function play(text) {
	const turnId = `turn-${++turn}`;
	live = {turnId, stopped: false};
	const stop = () => live.stopped;
	note('turn/started', {threadId, turn: {id: turnId, status: 'inProgress', items: []}});
	note('item/completed', {threadId, turnId, item: {type: 'reasoning', id: `r${turn}`, summary: [`The person said: ${text}`], content: []}});
	note('item/completed', {threadId, turnId, item: {type: 'agentMessage', id: `m${turn}`, text: "I'll list the standards, then run the tests."}});
	const dt = {type: 'dynamicToolCall', id: `dt${turn}`, namespace: null, tool: 'canon_list', arguments: {tags: 'python'}, status: 'inProgress', contentItems: null, success: null};
	note('item/started', {threadId, turnId, item: dt});
	const r = await ask('item/tool/call', {threadId, turnId, callId: dt.id, namespace: null, tool: 'canon_list', arguments: {tags: 'python'}});
	note('item/completed', {threadId, turnId, item: {...dt, status: 'completed', contentItems: r.contentItems, success: r.success}});
	if (stop()) return;
	const cmd = {type: 'commandExecution', id: `c${turn}`, command: 'npm test', cwd: '/work', status: 'inProgress', aggregatedOutput: null, exitCode: null};
	note('item/started', {threadId, turnId, item: cmd});
	const a = await ask('item/commandExecution/requestApproval', {kind: 'command', threadId, turnId, itemId: cmd.id, startedAtMs: Date.now(), environmentId: null, command: 'npm test', reason: 'Run the tests'});
	if (a.decision !== 'accept' && a.decision !== 'acceptForSession') {
		note('item/completed', {threadId, turnId, item: {...cmd, status: 'declined'}});
		note('turn/completed', {threadId, turn: {id: turnId, status: 'interrupted', items: [], error: null, durationMs: 900}});
		return;
	}
	note('item/completed', {threadId, turnId, item: {...cmd, status: 'completed', exitCode: 0, aggregatedOutput: '78 passed in 3.1s\nTest Files 9 passed\n'}});
	note('item/completed', {threadId, turnId, item: {type: 'agentMessage', id: `m${turn}b`, text: 'The tests pass.'}});
	note('thread/tokenUsage/updated', {threadId, turnId, tokenUsage: {last: {totalTokens: 45230}, total: {totalTokens: 45230}, modelContextWindow: null}});
	note('turn/completed', {threadId, turn: {id: turnId, status: 'completed', items: [], error: null, durationMs: 15200}});
}

createInterface({input: process.stdin}).on('line', line => {
	const m = JSON.parse(line);
	if (log) appendFileSync(log, line + '\n');
	if (m.method === undefined) {
		replies.get(m.id)?.(m.result ?? {});
		replies.delete(m.id);
		return;
	}
	switch (m.method) {
		case 'initialize':
			return out({id: m.id, result: {userAgent: 'fake-codex', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux'}});
		case 'thread/start':
		case 'thread/resume':
			out({id: m.id, result: {thread: {id: threadId, model: 'gpt-test'}, model: 'gpt-test', modelProvider: 'openai'}});
			return note('thread/started', {thread: {id: threadId}});
		case 'turn/start':
			out({id: m.id, result: {turn: {id: `turn-${turn + 1}`, status: 'inProgress', items: []}}});
			return void play(m.params.input.map(i => i.text).join(' '));
		case 'turn/interrupt':
			if (live) live.stopped = true;
			out({id: m.id, result: {}});
			return note('turn/completed', {threadId, turn: {id: m.params.turnId, status: 'interrupted', items: [], error: null, durationMs: 500}});
		default:
			if (m.id !== undefined) out({id: m.id, error: {code: -32601, message: `fake-codex: no ${m.method}`}});
	}
});
