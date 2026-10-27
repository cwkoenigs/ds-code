// A stand-in for Anthropic's Messages API (streamed), so the real Claude Code can play a whole turn
// with no account and no network: the first request gets one tool call back, the next a short reply.
// Point Claude Code at it with ANTHROPIC_BASE_URL and a fake ANTHROPIC_API_KEY.
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

export type FakeAnthropic = {url: string; requests: () => number; close: () => void};

export async function fakeAnthropic(call: {name: string; input: Record<string, unknown>}): Promise<FakeAnthropic> {
	let requests = 0;
	const server = createServer((req, res) => {
		req.resume();
		req.on('end', () => {
			if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
				res.writeHead(404, {'content-type': 'application/json'}).end('{"type":"error","error":{"type":"not_found_error","message":"not here"}}');
				return;
			}
			const first = requests++ === 0;
			const usage = {input_tokens: 10, output_tokens: 5};
			const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`;
			res.writeHead(200, {'content-type': 'text/event-stream'});
			res.write(event('message_start', {message: {id: `msg_${requests}`, type: 'message', role: 'assistant', model: 'stand-in', content: [], stop_reason: null, stop_sequence: null, usage}}));
			res.write(
				event('content_block_start', {index: 0, content_block: first ? {type: 'tool_use', id: 'toolu_1', name: call.name, input: {}} : {type: 'text', text: ''}}),
			);
			res.write(event('content_block_delta', {index: 0, delta: first ? {type: 'input_json_delta', partial_json: JSON.stringify(call.input)} : {type: 'text_delta', text: 'Done.'}}));
			res.write(event('content_block_stop', {index: 0}));
			res.write(event('message_delta', {delta: {stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null}, usage}));
			res.write(event('message_stop', {}));
			res.end();
		});
	});
	await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
	return {url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests: () => requests, close: () => server.close()};
}
