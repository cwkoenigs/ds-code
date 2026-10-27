#!/usr/bin/env node
// ds-code: the code tools as a stdio MCP server, for any agent (ds-next, Codex, Claude Code, Cortex
// Code) working in the current directory.
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {resolve} from 'node:path';
import {mcpServer, VERSION} from './mcp.js';

const HELP = `ds-code: what a language server knows about the repo, as read-only MCP tools.

  ds-code mcp [DIR]   serve the code tools on stdin and stdout, for the repo at DIR (default: here)
  ds-code -v          the version

An agent starts it itself; README.md says how for ds-next, Codex, Claude Code and Cortex Code.`;

const [cmd, dir] = process.argv.slice(2);
if (cmd === 'mcp') {
	// stdout carries the protocol from here on; nothing else may print to it.
	await mcpServer(resolve(dir ?? '.')).connect(new StdioServerTransport());
} else if (cmd === '-v' || cmd === '--version') {
	console.log(VERSION);
} else {
	console.log(HELP);
	process.exitCode = cmd === undefined || cmd === '-h' || cmd === '--help' ? 0 : 2;
}
