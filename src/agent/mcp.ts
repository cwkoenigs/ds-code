// `rule mcp`: ds-next's tools, rule_spec and the code tools as one stdio MCP server, for an agent run on
// its own (Codex, Cortex Code, Claude Code) rather than through `rule agent`. Each tool says whether
// it only reads; the agent decides what to ask about, by its own rules.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {codeTools} from '../code/tools.js';
import {runTool} from '../ds/tools.js';
import {dsToolsFor, ruleSpecTool, SERVER} from './backend.js';

/** The writes that only add: a new project (an existing folder is refused) and a new draft (never one
 *  that exists). The others change what is there: block_add and code_add replace a block's files on
 *  an update, adopt_repo edits AGENTS.md and moves an existing pre-push hook aside. */
const ADDITIVE = new Set(['scaffold_project', 'capture']);

export function mcpServer(cwd: string, connection?: string): McpServer {
	const server = new McpServer({name: SERVER, version: '0.1.0'});
	const code = codeTools(cwd);
	for (const t of [...dsToolsFor(cwd, connection).tools, ruleSpecTool, ...code.tools]) {
		const annotations = {readOnlyHint: t.readOnly, destructiveHint: !t.readOnly && !ADDITIVE.has(t.name)};
		server.registerTool(t.name, {description: t.description, inputSchema: t.shape, annotations}, async (args: Record<string, unknown>) => {
			const r = await runTool(t, args);
			return {content: [{type: 'text' as const, text: r.text}], isError: r.error};
		});
	}
	server.server.onclose = () => void code.close(); // the agent hung up: stop the language servers too
	return server;
}

/** Serve on stdin and stdout until the agent closes the connection. */
export async function serveMcp(cwd: string, connection?: string): Promise<void> {
	await mcpServer(cwd, connection).connect(new StdioServerTransport());
}
