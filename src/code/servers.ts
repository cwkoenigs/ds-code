// The two language servers rule ships, found in its own node_modules: TypeScript 7's native server
// for TypeScript and JavaScript, Pyright's for Python. Both are Microsoft's, installed from npm along
// with rule, and work offline: nothing is downloaded, nothing is reported anywhere.
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, extname, join} from 'node:path';
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

export const LANGUAGES: Record<Language, string> = {typescript: 'TypeScript and JavaScript', python: 'Python'};

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

/** The project's own virtual environment, if it has one where uv and venv put it, so Pyright resolves
 *  the packages installed there. */
export function pythonIn(root: string): string | undefined {
	const bin = process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python');
	return ['.venv', 'venv'].map(v => join(root, v, bin)).find(existsSync);
}

export function serverSpec(language: Language, root: string): ServerSpec {
	if (language === 'typescript') return {name: 'the TypeScript language server', ...typescriptCommand(), languageId: languageIdOf};
	const python = pythonIn(root);
	// Diagnostics only for open files: the tools never read them, and checking the whole tree costs time.
	const analysis = {autoSearchPaths: true, useLibraryCodeForTypes: true, diagnosticMode: 'openFilesOnly'};
	return {
		name: 'Pyright',
		...pyrightCommand(),
		languageId: languageIdOf,
		settings: section => (section === 'python' ? {...(python ? {pythonPath: python} : {}), analysis} : section === 'python.analysis' ? analysis : {}),
	};
}
