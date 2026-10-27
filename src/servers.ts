// The two language servers ds-code ships, found in its own node_modules: TypeScript 7's native server
// for TypeScript and JavaScript, Pyright's for Python. Both are Microsoft's, installed from npm along
// with ds-code, and work offline: nothing is downloaded, nothing is reported anywhere.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, extname, join, resolve} from 'node:path';
import type {ServerSpec} from './lsp.js';

export type Language = 'typescript' | 'python';

/** Extension → the server that reads it, and LSP's languageId for it. */
const EXTENSIONS: Record<string, [Language, string]> = {
	'.ts': ['typescript', 'typescript'],
	'.mts': ['typescript', 'typescript'],
	'.cts': ['typescript', 'typescript'],
	'.tsx': ['typescript', 'typescriptreact'],
	'.js': ['typescript', 'javascript'],
	'.mjs': ['typescript', 'javascript'],
	'.cjs': ['typescript', 'javascript'],
	'.jsx': ['typescript', 'javascriptreact'],
	'.py': ['python', 'python'],
	'.pyi': ['python', 'python'],
};


export const languageOf = (path: string): Language | undefined => EXTENSIONS[extname(path).toLowerCase()]?.[0];
export const languageIdOf = (path: string): string => EXTENSIONS[extname(path).toLowerCase()]?.[1] ?? 'plaintext';

const req = createRequire(import.meta.url);
const packageDir = (name: string): string => dirname(req.resolve(`${name}/package.json`));

/** `tsc --lsp --stdio`: TypeScript 7's native binary for this machine, from the platform package the
 *  typescript package depends on; else the typescript package's own launcher, through node. */
export function typescriptCommand(): {command: string; args: string[]} {
	const lsp = ['--lsp', '--stdio'];
	try {
		const exe = join(packageDir(`@typescript/typescript-${process.platform}-${process.arch}`), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');
		if (existsSync(exe)) return {command: exe, args: lsp};
	} catch {
		// not hoisted beside typescript: use the launcher
	}
	return {command: process.execPath, args: [join(packageDir('typescript'), 'bin', 'tsc'), ...lsp]};
}

/** `pyright-langserver --stdio`, through node. */
export function pyrightCommand(): {command: string; args: string[]} {
	return {command: process.execPath, args: [join(packageDir('pyright'), 'langserver.index.js'), '--stdio']};
}

const isDir = (p: string): boolean => {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
};

/** The folders a site-packages' .pth files add (editable installs), read as Python's site module
 *  reads them, without running their `import` lines. */
function pthFolders(site: string): string[] {
	try {
		return readdirSync(site)
			.filter(f => f.endsWith('.pth'))
			.flatMap(f => readFileSync(join(site, f), 'utf8').split(/\r?\n/))
			.map(l => l.trimEnd())
			.filter(l => l && !l.startsWith('#') && !/^import[ \t]/.test(l))
			.map(l => resolve(site, l))
			.filter(isDir);
	} catch {
		return [];
	}
}

/** Where the project's own virtual environment, if it has one where uv and venv put it, installs
 *  packages, so Pyright resolves them. Pyright gets these folders, never the environment's python:
 *  it runs the interpreter it is given, and a repo can carry its own .venv/bin/python, so naming that
 *  would run the repo's code from a tool that only reads. */
export function packagesIn(root: string): string[] {
	for (const v of ['.venv', 'venv']) {
		const lib = join(root, v, process.platform === 'win32' ? 'Lib' : 'lib');
		let sites: string[];
		try {
			sites = process.platform === 'win32' ? [join(lib, 'site-packages')] : readdirSync(lib).filter(d => /^(python|pypy)\d/.test(d)).map(d => join(lib, d, 'site-packages'));
		} catch {
			continue;
		}
		const found = sites.filter(isDir);
		if (found.length) return found.flatMap(site => [site, ...pthFolders(site)]);
	}
	return [];
}

export function serverSpec(language: Language, root: string): ServerSpec {
	if (language === 'typescript') return {name: 'the TypeScript language server', ...typescriptCommand(), languageId: languageIdOf};
	const packages = packagesIn(root);
	// Diagnostics only for open files: the tools never read them, and checking the whole tree costs time.
	const analysis = {autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly', ...(packages.length ? {extraPaths: packages} : {})};
	return {
		name: 'Pyright',
		...pyrightCommand(),
		languageId: languageIdOf,
		settings: section => (section === 'python' ? {analysis} : section === 'python.analysis' ? analysis : {}),
		// Pyright answers from the open files alone until it has found the rest; its first diagnostics
		// for an open file come once it has.
		settlesOnDiagnostics: true,
	};
}
