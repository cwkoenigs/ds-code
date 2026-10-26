// A stand-in for the model API Codex calls (OpenAI's Responses API, streamed), so the real codex
// app-server can play a whole turn with no account: the first request gets one tool call back, the
// next (carrying the tool's output) gets a short reply. Point Codex at it with modelConfig().
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

export type FakeModel = {url: string; outputs: string[]; close: () => void};
type Call = {name: string; arguments: Record<string, unknown>};

const usage = {input_tokens: 100, input_tokens_details: {cached_tokens: 0}, output_tokens: 20, output_tokens_details: {reasoning_tokens: 0}, total_tokens: 120};

export async function fakeModel(call: Call): Promise<FakeModel> {
	const outputs: string[] = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', d => (body += d));
		req.on('end', () => {
			if (!req.url?.endsWith('/responses')) {
				res.writeHead(404).end();
				return;
			}
			const input = ((JSON.parse(body || '{}') as {input?: {type: string; output?: unknown}[]}).input ?? []);
			const done = input.filter(i => i.type === 'function_call_output');
			outputs.push(...done.map(i => (typeof i.output === 'string' ? i.output : JSON.stringify(i.output))));
			const item = done.length
				? {type: 'message', id: 'msg_2', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'Done.', annotations: []}]}
				: {type: 'function_call', id: 'fc_1', call_id: 'call_1', name: call.name, arguments: JSON.stringify(call.arguments), status: 'completed'};
			const id = done.length ? 'resp_2' : 'resp_1';
			res.writeHead(200, {'content-type': 'text/event-stream'});
			for (const e of [
				{type: 'response.created', response: {id, object: 'response', status: 'in_progress', output: []}},
				{type: 'response.output_item.added', output_index: 0, item: {...item, status: 'in_progress'}},
				{type: 'response.output_item.done', output_index: 0, item},
				{type: 'response.completed', response: {id, object: 'response', status: 'completed', output: [item], usage}},
			])
				res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
			res.end();
		});
	});
	await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
	return {url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, outputs, close: () => server.close()};
}

/** A CODEX_HOME config.toml that sends every request to the stand-in. */
export const modelConfig = (url: string): string => `model = "stand-in"\nmodel_provider = "stand-in"\n\n[model_providers.stand-in]\nname = "stand-in"\nbase_url = "${url}"\nwire_api = "responses"\n`;
