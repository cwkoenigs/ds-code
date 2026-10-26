// The code graph and Serena as rule agent attaches them, with fake binaries on PATH.
import {chmodSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {GRAPH, LSP, mcpServers, readOnlyIds, serenaMajor} from '../src/ds/codetools.js';

const PATH = process.env['PATH'];
afterEach(() => {
	process.env['PATH'] = PATH;
});

/** A directory on PATH holding `serena` (printing this version) and, if asked, `codebase-memory-mcp`. */
function fakes(serenaVersion: string, graph = true): string {
	const dir = mkdtempSync(join(tmpdir(), 'codetools-'));
	const put = (name: string, out: string) => {
		writeFileSync(join(dir, name), `#!/bin/sh\necho "${out}"\n`);
		chmodSync(join(dir, name), 0o755);
	};
	put('serena', serenaVersion);
	if (graph) put('codebase-memory-mcp', '{}');
	process.env['PATH'] = dir + delimiter + (PATH ?? '');
	return dir;
}

describe.skipIf(process.platform === 'win32')('the code tools rule agent attaches', () => {
	it('asks Serena 2 for one tool per operation, which the read-only list names', () => {
		const dir = fakes('Serena 2.1.0');
		const servers = mcpServers('/work/order-metrics');
		expect(servers[GRAPH]).toEqual({type: 'stdio', command: join(dir, 'codebase-memory-mcp'), args: ['--tool-profile=analysis']});
		expect(servers[LSP]!.args).toEqual(['start-mcp-server', '--context', 'ide', '--project', '/work/order-metrics', '--agent-interface', 'tools', '--enable-web-dashboard', 'false', '--open-web-dashboard', 'false']);
		const ids = readOnlyIds(servers);
		expect(ids.has('mcp__lsp__find_symbol') && ids.has('mcp__graph__trace_path')).toBe(true);
		expect(ids.has('mcp__lsp__replace_symbol_body')).toBe(false); // edits still ask
	});

	it('leaves the flag out for Serena 1, which would refuse it', () => {
		const dir = fakes('Serena 1.7.0', false);
		expect(serenaMajor(join(dir, 'serena'))).toBe(1);
		const servers = mcpServers('/work/order-metrics');
		expect(servers[GRAPH]).toBeUndefined();
		expect(servers[LSP]!.args).not.toContain('--agent-interface');
	});
});
