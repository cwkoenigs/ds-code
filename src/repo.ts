// What the code tools know about a repo without a language server: its files, its import graph, its
// entry points, and which lines the uncommitted changes touch.
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {basename, join, posix, sep} from 'node:path';
import {type Language, languageOf} from './servers.js';

/** Whether `inner` is `outer` or a path inside it. */
export const within = (outer: string, inner: string): boolean => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'coverage', '.next', 'out', 'target']);

/** git's stdout for a command in root, or undefined when it fails (not a repo, no commits, no git). */
export function git(root: string, ...args: string[]): string | undefined {
	try {
		const r = spawnSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20});
		return r.status === 0 ? r.stdout : undefined;
	} catch {
		return undefined;
	}
}

const isFile = (p: string): boolean => {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
};

const real = (p: string): string | undefined => {
	try {
		return realpathSync.native(p);
	} catch {
		return undefined;
	}
};

/** p as the filesystem has it, links followed and letters cased as on disk; p itself when it does not exist. */
export const realPath = (p: string): string => real(p) ?? p;

/** Whether p, followed through every symbolic link, is still inside root: a link in the repo can
 *  point anywhere, and a tool that never asks must not read through it. */
export function realWithin(root: string, p: string): boolean {
	const r = real(root);
	const q = real(p);
	return r !== undefined && q !== undefined && within(r, q);
}

/** Every file in the repo, relative to root with / separators: git's list (tracked, and untracked but
 *  not ignored), or a walk that skips the usual dependency and build directories. A link that leads
 *  out of the repo is left out; the walk never follows links. */
export function listFiles(root: string): string[] {
	const out = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard');
	if (out !== undefined) return [...new Set(out.split('\0').filter(f => f && isFile(join(root, f)) && realWithin(root, join(root, f))))].sort();
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const e of readdirSync(join(root, dir), {withFileTypes: true})) {
			if (SKIP.has(e.name)) continue;
			const rel = dir ? `${dir}/${e.name}` : e.name;
			if (e.isDirectory()) walk(rel);
			else if (e.isFile()) files.push(rel);
		}
	};
	walk('');
	return files.sort();
}

/** The languages the repo has files in. */
export const languagesIn = (files: string[]): Language[] => [...new Set(files.map(languageOf).filter((l): l is Language => l !== undefined))];

// ── imports ──────────────────────────────────────────────────────────────────

// import x from 'y' · import {a, b} from 'y' (over several lines) · export * from 'y' · import 'y' · require('y') · import('y')
const TS_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'";]*?\sfrom\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
// from a.b import c · from . import x · import a.b, c
const PY_IMPORT = /^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import\b|import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*))/gm;

/** The module specifiers a file imports, as written. */
export function importsIn(path: string, text: string): string[] {
	const lang = languageOf(path);
	if (lang === 'typescript') return [...text.matchAll(TS_IMPORT)].map(m => m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').filter(Boolean);
	if (lang === 'python') return [...text.matchAll(PY_IMPORT)].flatMap(m => (m[1] ? [m[1]] : (m[2] ?? '').split(',').map(s => s.trim())));
	return [];
}

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** The file a specifier names inside the repo, or undefined for a package or the standard library. */
export function resolveImport(from: string, spec: string, files: Set<string>, pythonRoots: string[]): string | undefined {
	if (languageOf(from) === 'typescript') {
		if (!spec.startsWith('.')) return undefined;
		const base = posix.normalize(posix.join(posix.dirname(from), spec.replace(/[?#].*$/, '')));
		const bare = base.replace(/\.[cm]?[jt]sx?$/, '');
		for (const t of [base, ...TS_EXTS.flatMap(e => [bare + e, posix.join(base, 'index' + e)])]) if (files.has(t)) return t;
		return undefined;
	}
	const dots = /^\.+/.exec(spec)?.[0].length ?? 0;
	let roots = pythonRoots;
	if (dots) {
		let dir = posix.dirname(from);
		for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
		roots = [dir];
	}
	const parts = spec.slice(dots).split('.').filter(Boolean);
	for (const r of roots) {
		const base = posix.join(r, ...parts);
		for (const t of [base + '.py', posix.join(base, '__init__.py')]) if (files.has(t)) return t;
	}
	return undefined;
}

// ── the overview ─────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
	'.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
	'.py': 'Python', '.pyi': 'Python', '.md': 'Markdown', '.json': 'JSON', '.toml': 'TOML', '.yml': 'YAML', '.yaml': 'YAML', '.sh': 'Shell', '.html': 'HTML', '.css': 'CSS', '.sql': 'SQL',
};
const label = (f: string): string => LABELS[posix.extname(f).toLowerCase()] ?? 'other';
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|fixtures?)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*|[^/]*_test)\.py$|(^|\/)conftest\.py$/;

type Graph = {imports: Map<string, Set<string>>; importers: Map<string, Set<string>>; mainGuard: Set<string>};

/** The import graph among the repo's own files. */
export function importGraph(root: string, files: string[]): Graph {
	const set = new Set(files);
	const top = [...new Set(files.map(f => f.split('/')[0]!).filter(d => !d.includes('.')))];
	const pythonRoots = ['', 'src', ...top];
	const imports = new Map<string, Set<string>>();
	const importers = new Map<string, Set<string>>();
	const mainGuard = new Set<string>();
	for (const f of files) {
		if (!languageOf(f)) continue;
		let text: string;
		try {
			text = readFileSync(join(root, f), 'utf8');
		} catch {
			continue;
		}
		if (languageOf(f) === 'python' && /^if __name__ == ['"]__main__['"]/m.test(text)) mainGuard.add(f);
		for (const spec of importsIn(f, text)) {
			const to = resolveImport(f, spec, set, pythonRoots);
			if (!to || to === f) continue;
			(imports.get(f) ?? imports.set(f, new Set()).get(f)!).add(to);
			(importers.get(to) ?? importers.set(to, new Set()).get(to)!).add(f);
		}
	}
	return {imports, importers, mainGuard};
}

/** Entry points the manifests name: package.json's bin and main, pyproject's [project.scripts]. */
export function declaredEntries(root: string, files: Set<string>): string[] {
	const out: string[] = [];
	try {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {bin?: string | Record<string, string>; main?: string};
		const bins = typeof pkg.bin === 'string' ? {[basename(root)]: pkg.bin} : (pkg.bin ?? {});
		for (const [name, p] of Object.entries(bins)) out.push(`${sourceOf(p, files)}  (package.json bin: ${name})`);
		if (pkg.main) out.push(`${sourceOf(pkg.main, files)}  (package.json main)`);
	} catch {
		// no package.json, or not JSON
	}
	try {
		const toml = readFileSync(join(root, 'pyproject.toml'), 'utf8');
		const scripts = /^\[project\.scripts\]\s*\n([\s\S]*?)(?=\n\[|$)/m.exec(toml)?.[1] ?? '';
		for (const m of scripts.matchAll(/^\s*([\w-]+)\s*=\s*["']([\w.]+):(\w+)["']/gm)) {
			const mod = m[2]!.split('.');
			const file = ['', 'src'].map(r => posix.join(r, ...mod) + '.py').find(f => files.has(f)) ?? m[2]!;
			out.push(`${file}  (pyproject script: ${m[1]}, ${m[3]}())`);
		}
	} catch {
		// no pyproject.toml
	}
	return out;
}

/** `dist/cli.js` → `src/cli.tsx` when the source is in the repo and the built file is not. */
function sourceOf(built: string, files: Set<string>): string {
	const p = posix.normalize(built.replace(/^\.\//, ''));
	if (files.has(p)) return p;
	const bare = p.replace(/^(dist|build|lib|out)\//, 'src/').replace(/\.[cm]?js$/, '');
	return TS_EXTS.map(e => bare + e).find(f => files.has(f)) ?? p;
}

/** The repo at a glance, as text: languages, directories, the most depended-on files, entry points. */
export function overview(root: string): string {
	const files = listFiles(root);
	const set = new Set(files);
	const lines: string[] = [];
	const count = <K>(keys: K[]): [K, number][] => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>())].sort((a, b) => b[1] - a[1]);

	const langs = count(files.map(label));
	lines.push(`${basename(root)}: ${files.length} files; ${langs.map(([l, n]) => `${l} ${n}`).join(', ')}`);

	// Directories to two levels deep, deeper files rolled up into them.
	const dirOf = (f: string) => {
		const parts = f.split('/');
		return parts.length === 1 ? '.' : parts.slice(0, Math.min(2, parts.length - 1)).join('/') + '/';
	};
	const dirs = new Map<string, string[]>();
	for (const f of files) (dirs.get(dirOf(f)) ?? dirs.set(dirOf(f), []).get(dirOf(f))!).push(f);
	lines.push('', 'Directories');
	const width = Math.max(...[...dirs.keys()].map(d => d.length));
	for (const [dir, list] of [...dirs].sort(([a], [b]) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b))).slice(0, 40)) {
		const kinds = count(list.map(label)).slice(0, 2).map(([l, n]) => (list.length === n ? l : `${l} ${n}`));
		lines.push(`  ${dir.padEnd(width)}  ${String(list.length).padStart(4)} files  ${kinds.join(', ')}`);
	}
	if (dirs.size > 40) lines.push(`  and ${dirs.size - 40} more directories`);

	const graph = importGraph(root, files);
	const hubs = [...graph.importers].map(([f, by]) => [f, by.size] as [string, number]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
	if (hubs.length) {
		lines.push('', 'Most depended on (imported by N files)');
		for (const [f, n] of hubs) lines.push(`  ${f.padEnd(Math.max(...hubs.map(([h]) => h.length)))}  ${String(n).padStart(3)}`);
	}

	const entries = declaredEntries(root, set);
	for (const f of graph.mainGuard) entries.push(`${f}  (if __name__ == "__main__")`);
	const roots = files.filter(f => languageOf(f) && graph.imports.has(f) && !graph.importers.has(f) && !TEST_PATH.test(f) && !entries.some(e => e.startsWith(f + ' ')));
	if (entries.length || roots.length) lines.push('', 'Entry points');
	for (const e of entries) lines.push(`  ${e}`);
	if (roots.length) lines.push(`  imported by nothing: ${roots.slice(0, 12).join(', ')}${roots.length > 12 ? `, and ${roots.length - 12} more` : ''}`);
	return lines.join('\n');
}

// ── the uncommitted changes ──────────────────────────────────────────────────

export type Changes = Map<string, [number, number][] | 'new' | 'deleted'>;

/** What differs from HEAD, per file under root: the 1-based line ranges changed in the working tree,
 *  or 'new' (added, or untracked and not ignored) or 'deleted'. Undefined when root is not in a git
 *  repository with a commit. */
export function changedLines(root: string): Changes | undefined {
	// No external diff and no textconv: either would run a command git config names, from a tool that never asks.
	const diff = git(root, 'diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-textconv', '--no-prefix', '--relative', 'HEAD');
	if (diff === undefined) return undefined;
	const out: Changes = new Map();
	let file: string | undefined;
	let minus = '';
	for (const line of diff.split('\n')) {
		if (line.startsWith('--- ')) {
			minus = line.slice(4).trim();
			continue;
		}
		if (line.startsWith('+++ ')) {
			const plus = line.slice(4).trim();
			if (plus === '/dev/null') {
				out.set(minus, 'deleted');
				file = undefined;
			} else {
				file = plus;
				out.set(file, minus === '/dev/null' ? 'new' : (out.get(file) ?? []));
			}
			continue;
		}
		const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (!m || !file) continue;
		const ranges = out.get(file);
		if (!Array.isArray(ranges)) continue;
		const start = Number(m[1]);
		const n = m[2] === undefined ? 1 : Number(m[2]);
		ranges.push([Math.max(1, start), Math.max(1, start + Math.max(n, 1) - 1)]); // a pure deletion touches the line it left
	}
	for (const f of (git(root, 'ls-files', '-z', '--others', '--exclude-standard') ?? '').split('\0').filter(Boolean)) if (!out.has(f) && isFile(join(root, f))) out.set(f, 'new');
	return out;
}

/** Whether a repo exists at all at root (for the message when it doesn't). */
export const isRepo = (root: string): boolean => existsSync(join(root, '.git')) || git(root, 'rev-parse', '--git-dir') !== undefined;
