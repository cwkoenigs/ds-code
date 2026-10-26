// Snowflake search for the agent, through `cortex search`: docs, catalog objects and table details,
// read-only. A port of the part of ds-next's codetools.py that remains here; the code graph and Serena
// it also attached are replaced by the code tools in src/code/, which need nothing installed.
import {spawn} from 'node:child_process';
import {pyReprValue, pySlice, which} from './py.js';

export const cortexBin = () => which('cortex');

/** Run a command to the end without blocking: stdout, stderr, exit code, or timedOut. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{stdout: string; stderr: string; code: number | null; timedOut: boolean}> {
	return new Promise(res => {
		const child = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const t = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		child.stdout.on('data', d => (stdout += d));
		child.stderr.on('data', d => (stderr += d));
		child.on('error', err => {
			clearTimeout(t);
			res({stdout, stderr: stderr || err.message, code: null, timedOut});
		});
		child.on('close', code => {
			clearTimeout(t);
			res({stdout, stderr, code, timedOut});
		});
	});
}

/** [text, isError] from `cortex search <kind> <query>`. */
export async function snowflakeSearch(kind: string, query: string, connection?: string, timeout = 60): Promise<[string, boolean]> {
	if (!['docs', 'object', 'table-details'].includes(kind)) return [`kind must be docs, object or table-details, not ${pyReprValue(kind)}`, true];
	const c = cortexBin();
	if (!c) return ['cortex is not installed', true];
	const r = await run(c, ['search', kind, query, ...(connection ? ['--connection', connection] : [])], timeout * 1000);
	if (r.timedOut) return [`cortex search took longer than ${timeout}s`, true];
	if (r.code !== 0) return [pySlice((r.stderr || r.stdout).trim(), 1000), true];
	try {
		const data = JSON.parse(r.stdout) as unknown;
		const results = data && typeof data === 'object' && !Array.isArray(data) && 'results' in data ? (data as {results: unknown}).results : r.stdout;
		return [pySlice(typeof results === 'string' ? results : pyReprValue(results), 12000), false];
	} catch {
		return [pySlice(r.stdout, 12000), false];
	}
}
