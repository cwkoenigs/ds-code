// The code tools as an MCP server named `code`. Every tool only reads, and says so, so a client need
// not ask about any of them.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {createRequire} from 'node:module';
import {codeTools} from './tools.js';

export const VERSION = (createRequire(import.meta.url)('../package.json') as {version: string}).version;

/** The code tools for the repo at `cwd`, as the server `code`. Closing it stops the language servers. */
export function mcpServer(cwd: string): McpServer {
	const server = new McpServer({name: 'code', version: VERSION});
	const code = codeTools(cwd);
	for (const t of code.tools) {
		server.registerTool(t.name, {description: t.description, inputSchema: t.shape, annotations: {readOnlyHint: true, destructiveHint: false}}, async (args: Record<string, unknown>) => {
			const r = await t.run(args);
			return {content: [{type: 'text' as const, text: r.text}], isError: r.error};
		});
	}
	server.server.onclose = () => void code.close();
	return server;
}
