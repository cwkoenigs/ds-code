// `rule mcp`: ds-next's tools and rule_spec as a stdio MCP server, for an agent run on its own (Codex,
// Cortex Code, Claude Code) rather than through `rule agent`. Each tool says whether it only reads;
// the agent decides what to ask about, by its own rules.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {runTool} from '../ds/tools.js';
import {dsToolsFor, ruleSpecTool, SERVER} from './backend.js';

export function mcpServer(cwd: string, connection?: string): McpServer {
	const server = new McpServer({name: SERVER, version: '0.1.0'});
	for (const t of [...dsToolsFor(cwd, connection).tools, ruleSpecTool]) {
		// The writes add files (a project, a block, a draft); none deletes or overwrites.
		server.registerTool(t.name, {description: t.description, inputSchema: t.shape, annotations: {readOnlyHint: t.readOnly, destructiveHint: false}}, async (args: Record<string, unknown>) => {
			const r = await runTool(t, args);
			return {content: [{type: 'text' as const, text: r.text}], isError: r.error};
		});
	}
	return server;
}

/** Serve on stdin and stdout until the agent closes the connection. */
export async function serveMcp(cwd: string, connection?: string): Promise<void> {
	await mcpServer(cwd, connection).connect(new StdioServerTransport());
}
