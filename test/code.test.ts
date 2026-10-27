// The code tools against the real language servers rule ships: a small TypeScript project, a small
// Python one, a git repo with uncommitted changes, and this repo itself. And the pieces on their own.
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {readOnlyIds} from '../src/agent/backend.js';
import {toolCall} from '../src/agent/codex.js';
import {importsIn, resolveImport} from '../src/code/repo.js';
import {languageOf, packagesIn, pyrightCommand, typescriptCommand} from '../src/code/servers.js';
import {CODE_TOOL_NAMES, CodeIntel, codeTools} from '../src/code/tools.js';
import {tick} from './helpers.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const ROOT = join(import.meta.dirname, '..');

const opened: ReturnType<typeof codeTools>[] = [];
/** The tools for a repo, as `run(name, args)`; their servers stop when the file's tests are done. */
function open(root: string) {
	const t = codeTools(root);
	opened.push(t);
	return (name: string, args: Record<string, unknown> = {}) => t.tools.find(x => x.name === name)!.run(args);
}
afterAll(async () => {
	await Promise.all(opened.map(t => t.close()));
});

describe('the code tools on a TypeScript project', () => {
	const run = open(join(FIXTURES, 'code-ts'));

	it('outlines a file, finds a symbol, and lists every use', async () => {
		expect((await run('file_symbols', {path: 'src/greet.ts'})).text).toBe('src/greet.ts: 2 symbols\n  1-3  function greet\n  5-7  function shout');
		expect((await run('find_symbol', {name: 'greet'})).text).toBe('1 definition of greet:\n  src/greet.ts:1  function greet  export function greet(name: string): string {');
		const refs = await run('references', {name: 'greet'});
		expect(refs.error).toBe(false);
		expect(refs.text).toContain('greet (function, src/greet.ts:1) is used in 2 places:');
		expect(refs.text).toContain('src/main.ts\n     4  console.log(greet(\'world\'));');
	});

	it('follows callers to a depth, and callees in and out of the repo', async () => {
		const callers = (await run('callers', {name: 'greet'})).text;
		expect(callers).toContain('  shout  src/greet.ts:5  (line 6)\n    run  src/main.ts:3  (line 5)');
		expect(callers).toContain('\n  run  src/main.ts:3  (line 4)');
		const callees = (await run('callees', {name: 'shout'})).text;
		expect(callees).toContain('  greet  src/greet.ts:1  (line 6)');
		expect(callees).toContain('from the standard library: toUpperCase');
	});

	it('finds the definition of a name on a line', async () => {
		expect((await run('definition', {path: 'src/main.ts', line: 4, name: 'greet'})).text).toBe('greet is defined at src/greet.ts:1  export function greet(name: string): string {');
	});

	it('maps the repo without a language server', async () => {
		const map = (await run('repo_overview')).text;
		expect(map).toContain('code-ts: 4 files; JSON 2, TypeScript 2');
		expect(map).toContain('Most depended on (imported by N files)\n  src/greet.ts    1');
		expect(map).toContain('imported by nothing: src/main.ts');
	});

	it('says what is wrong as an ERROR the model can act on', async () => {
		expect(await run('find_symbol', {name: 'nothing'})).toEqual({text: 'ERROR: no symbol named "nothing" in the repo', error: true});
		expect((await run('file_symbols', {path: '../code-py/pkg/greet.py'})).text).toBe('ERROR: ../code-py/pkg/greet.py is outside the repo');
		expect((await run('definition', {path: 'src/main.ts', line: 4, name: 'shout'})).text).toBe('ERROR: "shout" is not on line 4 of src/main.ts: console.log(greet(\'world\'));');
		expect((await run('callers', {name: 'greet', path: 'src/missing.ts'})).text).toBe('ERROR: no file src/missing.ts');
	});
});

describe('the code tools on a Python project', () => {
	const run = open(join(FIXTURES, 'code-py'));

	it('answers from Pyright: outline, references, callers, callees, definition', async () => {
		expect((await run('file_symbols', {path: 'pkg/greet.py'})).text).toBe('pkg/greet.py: 2 symbols\n  1-2  function greet\n  5-6  function shout');
		expect((await run('references', {name: 'greet'})).text).toContain('pkg/main.py\n     1  from pkg.greet import greet, shout\n     5  print(greet("world"))');
		expect((await run('callers', {name: 'greet', depth: 1})).text).toContain('  shout  pkg/greet.py:5  (line 6)\n  run  pkg/main.py:4  (line 5)');
		expect((await run('callees', {name: 'shout'})).text).toBe('shout (pkg/greet.py:5) calls:\n  greet  pkg/greet.py:1  (line 6)\n  from the standard library: upper');
		expect((await run('definition', {path: 'pkg/main.py', line: 5, name: 'greet'})).text).toBe('greet is defined at pkg/greet.py:1  def greet(name: str) -> str:');
	});
});

describe("a Python project's own virtual environment", () => {
	const dir = mkdtempSync(join(tmpdir(), 'code-venv-'));
	cpSync(join(FIXTURES, 'code-py'), dir, {recursive: true});
	const site = process.platform === 'win32' ? join(dir, '.venv', 'Lib', 'site-packages') : join(dir, '.venv', 'lib', 'python3.12', 'site-packages');
	mkdirSync(join(site, 'extra'), {recursive: true});
	writeFileSync(join(site, 'extra', '__init__.py'), 'VALUE = 1\n');
	mkdirSync(join(dir, 'libs', 'local'), {recursive: true}); // an editable install, as uv writes one
	writeFileSync(join(site, '_local.pth'), `# editable\n${join(dir, 'libs', 'local')}\nimport os; os.system('exit 1')\n${join(dir, 'missing')}\n`);
	writeFileSync(join(dir, 'pkg', 'uses_extra.py'), 'from extra import VALUE\n\nprint(VALUE)\n');
	// A repo can carry its own interpreter; running it would run the repo's code from a tool that only reads.
	const ran = join(dir, 'ran');
	mkdirSync(join(dir, '.venv', 'bin'), {recursive: true});
	writeFileSync(join(dir, '.venv', 'bin', 'python'), `#!/bin/sh\ntouch '${ran}'\n`, {mode: 0o755});
	const run = open(dir);

	it('gives Pyright its packages and the folders its .pth files add, not their import lines', () => {
		expect(packagesIn(dir)).toEqual([site, join(dir, 'libs', 'local')]);
	});

	it.skipIf(process.platform === 'win32')('resolves imports from it, and never runs its python', async () => {
		// Ask until Pyright answers about the whole project: by then it has run any interpreter it was given.
		for (let i = 0; i < 100 && !(await run('find_symbol', {name: 'greet'})).text.includes('pkg/greet.py:1'); i++) await tick(100);
		expect((await run('definition', {path: 'pkg/uses_extra.py', line: 3, name: 'VALUE'})).text).toContain('extra');
		expect(existsSync(ran)).toBe(false);
	});
});

describe('change_impact in a git repo', () => {
	const dir = mkdtempSync(join(tmpdir(), 'code-impact-'));
	cpSync(join(FIXTURES, 'code-ts'), dir, {recursive: true});
	const env = {...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example'};
	const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, env, stdio: 'pipe'});
	git('init', '-q');
	git('add', '-A');
	git('commit', '-q', '-m', 'base');
	const run = open(dir);

	it('says when nothing has changed', async () => {
		expect((await run('change_impact')).text).toBe('No uncommitted changes: the working tree matches HEAD and nothing is untracked.');
	});

	it('names each changed symbol, where it is used, and the files that depend on the change', async () => {
		const greet = join(dir, 'src', 'greet.ts');
		writeFileSync(greet, readFileSync(greet, 'utf8').replace('return `hello ${name}`;', 'return `hi ${name}`;'));
		writeFileSync(join(dir, 'src', 'extra.ts'), 'export const EXTRA = 1;\n');
		const report = (await run('change_impact')).text;
		expect(report).toContain('2 files differ from HEAD: 1 changed, 1 new, 0 deleted');
		expect(report).toContain('src/extra.ts  new  (1 symbol, none used elsewhere)');
		expect(report).toContain('src/greet.ts  lines 2\n  function greet (1-3)  used in src/greet.ts:6; src/main.ts:4');
		expect(report).toContain('Use the changed symbols but are not changed themselves: src/main.ts');
	});

	it("says a symbol's uses are unknown when the server could not say, never that there are none", async () => {
		const code = new CodeIntel(dir);
		code.references = async () => {
			throw new Error('the TypeScript language server took longer than 60s to answer textDocument/references');
		};
		try {
			const report = await code.impact();
			expect(report).toContain('src/greet.ts  lines 2\n  function greet (1-3)  uses unknown (the TypeScript language server took longer than 60s to answer textDocument/references)');
			expect(report).toContain('src/extra.ts  new  (1 symbol, not all uses known:)\n  variable EXTRA (1)  uses unknown (');
			expect(report).not.toContain('used nowhere else');
		} finally {
			await code.close();
		}
	});

	it('is an error outside a git repo', async () => {
		const plain = mkdtempSync(join(tmpdir(), 'code-plain-'));
		cpSync(join(FIXTURES, 'code-ts'), plain, {recursive: true});
		expect((await open(plain)('change_impact')).text).toBe(`ERROR: ${plain} is not a git repository`);
	});
});

describe('the code tools never run or read what a repo points them at', () => {
	const env = {...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example'};

	it("change_impact runs no textconv a repo's git config names", async () => {
		const dir = mkdtempSync(join(tmpdir(), 'code-textconv-'));
		cpSync(join(FIXTURES, 'code-ts'), dir, {recursive: true});
		const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, env, stdio: 'pipe'});
		const ran = join(dir, 'ran');
		writeFileSync(join(dir, '.gitattributes'), '*.txt diff=conv\n');
		writeFileSync(join(dir, 'notes.txt'), 'one\n');
		git('init', '-q');
		git('config', 'diff.conv.textconv', `touch '${ran}'; cat`);
		git('add', '-A');
		git('commit', '-q', '-m', 'base');
		writeFileSync(join(dir, 'notes.txt'), 'two\n');
		expect((await open(dir)('change_impact')).text).toContain('Not code: notes.txt');
		expect(existsSync(ran)).toBe(false);
	});

	it.skipIf(process.platform === 'win32')('reads no file through a link that leads out of the repo', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'code-link-'));
		cpSync(join(FIXTURES, 'code-ts'), dir, {recursive: true});
		const secret = join(mkdtempSync(join(tmpdir(), 'code-secret-')), 'private.ts');
		writeFileSync(secret, "export const TOKEN = 'one';\nconst second = 'private line';\n");
		symlinkSync(secret, join(dir, 'src', 'leak.ts'));
		const run = open(dir);
		const asked = await run('definition', {path: 'src/leak.ts', line: 2, name: 'missing'});
		expect(asked.text).toBe('ERROR: src/leak.ts is a link to a file outside the repo');
		expect((await run('find_symbol', {name: 'TOKEN'})).text).not.toContain('leak.ts');
		expect((await run('repo_overview')).text).not.toContain('leak.ts');
	});
});

describe('the code tools on this repo', () => {
	const run = open(ROOT);

	it('finds openSession and its use in the CLI', async () => {
		expect((await run('find_symbol', {name: 'openSession'})).text).toContain('  src/agent/backend.ts:');
		expect((await run('references', {name: 'openSession'})).text).toContain('src/cli.tsx\n');
	}, 60_000);
});

describe('the code tools, the pieces', () => {
	it('never ask, and Codex calls to them come back under `code`', () => {
		const ids = readOnlyIds([], codeTools(ROOT).tools);
		for (const name of CODE_TOOL_NAMES) expect(ids.has(`mcp__code__${name}`)).toBe(true);
		expect(toolCall({type: 'dynamicToolCall', tool: 'references', arguments: {name: 'x'}})).toEqual({name: 'mcp__code__references', input: {name: 'x'}});
		expect(toolCall({type: 'dynamicToolCall', tool: 'canon_list', arguments: {}})).toEqual({name: 'mcp__ds__canon_list', input: {}});
	});

	it('ships both servers with rule', () => {
		expect(existsSync(typescriptCommand().command)).toBe(true);
		expect(existsSync(pyrightCommand().args[0]!)).toBe(true);
		expect(languageOf('a.tsx')).toBe('typescript');
		expect(languageOf('a.py')).toBe('python');
		expect(languageOf('a.md')).toBeUndefined();
	});

	it('reads imports and resolves the ones inside the repo', () => {
		const files = new Set(['src/a.ts', 'src/b/index.ts', 'pkg/__init__.py', 'pkg/util.py', 'pkg/sub/mod.py']);
		expect(importsIn('x.ts', "import {a} from './a.js';\nimport type {T} from\n  './b';\nexport * from './c.js';\nimport 'side';\nconst d = require('./d');\nawait import('./e.js');")).toEqual(['./a.js', './b', './c.js', 'side', './d', './e.js']);
		expect(resolveImport('src/x.ts', './a.js', files, [])).toBe('src/a.ts');
		expect(resolveImport('src/x.ts', './b', files, [])).toBe('src/b/index.ts');
		expect(resolveImport('src/x.ts', 'zod', files, [])).toBeUndefined();
		expect(importsIn('m.py', 'from pkg.util import f\nimport os, pkg.sub.mod\nfrom . import x\nfrom ..up import y')).toEqual(['pkg.util', 'os', 'pkg.sub.mod', '.', '..up']);
		expect(resolveImport('pkg/sub/mod.py', 'pkg.util', files, ['', 'src'])).toBe('pkg/util.py');
		expect(resolveImport('pkg/sub/mod.py', '..util', files, [])).toBe('pkg/util.py');
		expect(resolveImport('pkg/sub/mod.py', 'os', files, [''])).toBeUndefined();
	});
});
