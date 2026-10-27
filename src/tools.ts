// The code tools: what a language server knows about the repo, as read-only tools, served as `code`. TypeScript 7's server and Pyright start on first use for the languages the repo
// has, stay for the session, and stop with it. Every tool answers in text the model can act on; a
// server that stops or takes too long is reported, never thrown.
import {readFileSync} from 'node:fs';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {z} from 'zod';
import {type CallHierarchyItem, type DocumentSymbol, type IncomingCall, kindName, LanguageServer, type Location, type OutgoingCall, type Position, type Range, type SymbolInformation, toPath} from './lsp.js';
import {changedLines, isFile, isRepo, languagesIn, listFiles, mentioning, overview, realPath, realWithin, within} from './repo.js';
import {type Language, languageOf, serverSpec} from './servers.js';

/** Errors say so in their first word as well as in the flag: Cortex Code drops the flag. */
const ERROR_PREFIX = 'ERROR: ';
type Result = {text: string; error: boolean};
export type Tool = {name: string; description: string; shape: Record<string, z.ZodType>; run: (args: Record<string, unknown>) => Promise<Result>};

const ok = (text: string): Result => ({text, error: false});
const fail = (text: string): Result => ({text: ERROR_PREFIX + text, error: true});

/** Bad arguments, or nothing found: said back to the model. */
class InputError extends Error {}

/** A symbol as the tools name it: its file relative to the repo with / separators, 1-based lines, and
 *  its containers in `qualified` (Class.method). */
type CodeSymbol = {name: string; qualified: string; kind: string; path: string; line: number; endLine: number; uri: string; position: Position};

const WITH_MEMBERS = new Set([2, 3, 5, 10, 11, 23]); // module, namespace, class, enum, interface, struct: their children are symbols too
const MAX_LINES = 150;
const MAX_CALLERS = 80;
const SETTLE_MS = 30_000; // the longest a starting server is waited for before it answers as it can

/** At most MAX_LINES lines, saying how many were left out. */
const cut = (lines: string[]): string[] => (lines.length <= MAX_LINES ? lines : [...lines.slice(0, MAX_LINES), `… and ${lines.length - MAX_LINES} more lines`]);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export class CodeIntel {
	private servers = new Map<Language, Promise<LanguageServer>>();
	private texts = new Map<string, string[]>(); // a file's lines, kept for one tool call

	constructor(readonly root: string) {
		this.realRoot = realPath(root);
	}

	/** The server for a language, started on first use and started again if it stopped. Calls that
	 *  arrive together share one start: a second server would never be stopped. */
	async server(lang: Language): Promise<LanguageServer> {
		const known = this.servers.get(lang);
		if (known) {
			const running = await known.catch(() => undefined);
			if (running?.alive) return running;
			if (this.servers.get(lang) !== known) return this.server(lang); // another call restarted it meanwhile
		}
		const starting = (async () => {
			const s = new LanguageServer(serverSpec(lang, this.root), this.root);
			try {
				await s.initialized;
				// The TypeScript server learns the project from its first open file: give it one of the repo's.
				const anchor = listFiles(this.root).find(f => languageOf(f) === lang && !f.endsWith('.d.ts'));
				if (anchor) {
					s.openFile(join(this.root, anchor));
					// Until Pyright has found the repo's files, it answers from the open ones: no symbol, or too few
					// uses. The anchor is the one open file, and Pyright checks only open files, so its first
					// diagnostics are the anchor's, which come once it has found the rest.
					if (s.spec.settlesOnDiagnostics) await s.diagnosed(SETTLE_MS);
				}
				return s;
			} catch (err) {
				void s.stop(); // a start that failed anywhere leaves no server running
				throw err;
			}
		})();
		this.servers.set(lang, starting);
		starting.catch(() => this.servers.get(lang) === starting && this.servers.delete(lang));
		return starting;
	}

	async close(): Promise<void> {
		const all = [...this.servers.values()];
		this.servers.clear();
		await Promise.all(all.map(p => p.then(s => s.stop(), () => undefined)));
	}

	/** Run one tool: its text, or what went wrong as an ERROR the model can act on. */
	async run(fn: () => Promise<string>): Promise<Result> {
		this.texts.clear();
		try {
			return ok(await fn());
		} catch (err) {
			return fail((err as Error).message);
		}
	}

	// ── files and positions ──────────────────────────────────────────────────

	/** An absolute path inside the repo from what the model passed. */
	abs(path: string): string {
		if (!path) throw new InputError('pass path: a file in the repo');
		const p = resolve(this.root, path);
		if (!within(this.root, p)) throw new InputError(`${path} is outside the repo`);
		if (!isFile(p)) throw new InputError(`no file ${path}`);
		if (!realWithin(this.root, p)) throw new InputError(`${path} is a link to a file outside the repo`);
		return p;
	}

	/** The repo's root and a location as the filesystem has them, links followed and letters cased as on
	 *  disk: a server may report /private/var for /var, or another case on macOS and Windows. */
	private readonly realRoot: string;

	/** A path or file URI as the tools show it: relative to the repo with / separators, or absolute outside it. */
	rel(uriOrPath: string): string {
		const p = uriOrPath.startsWith('file:') ? toPath(uriOrPath) : uriOrPath;
		if (within(this.root, p)) return relative(this.root, p).split(sep).join('/');
		const r = realPath(p);
		return within(this.realRoot, r) ? relative(this.realRoot, r).split(sep).join('/') : p;
	}

	/** Where a location outside the repo's own code comes from; undefined for the repo's code. Judged by
	 *  where the file really is: a link in the repo to a file outside it is outside, and a library is a
	 *  file under a library's own folder, never one whose name says so (src/typeshed-leak.ts). */
	external(uri: string): string | undefined {
		const r = realPath(toPath(uri));
		if (within(this.realRoot, r)) {
			const at = relative(this.realRoot, r); // in the repo, only its own folders say what a file is
			return /(^|[\\/])node_modules[\\/]/.test(at) ? 'node_modules' : /(^|[\\/])(site|dist)-packages[\\/]/.test(at) ? 'site-packages' : undefined;
		}
		if (/[\\/]typeshed[^\\/]*[\\/]|[\\/]lib\.[\w.]*\.d\.ts$/.test(r)) return 'the standard library'; // Pyright's stubs; TypeScript's lib.*.d.ts
		if (/[\\/]node_modules[\\/]/.test(r)) return 'node_modules';
		if (/[\\/](site|dist)-packages[\\/]/.test(r)) return 'site-packages';
		return 'outside the repo';
	}

	/** Line n (1-based) of a file as written, or undefined past its end. Nothing from a file outside the
	 *  repo but a library: a tool that never asks reads no further (canon gotcha-approvals). */
	raw(path: string, n: number): string | undefined {
		const abs = isAbsolute(path) ? path : join(this.root, path);
		let lines = this.texts.get(abs);
		if (!lines) {
			try {
				lines = this.external(abs) === 'outside the repo' ? [] : readFileSync(abs, 'utf8').split('\n');
			} catch {
				lines = [];
			}
			this.texts.set(abs, lines);
		}
		return lines[n - 1]?.replace(/\r$/, '');
	}

	/** Whether a location is somewhere the tools may show: the repo, or a library. */
	private shown(uri: string): boolean {
		return this.external(uri) !== 'outside the repo';
	}

	/** Line n of a file, trimmed and cut, for a listing. */
	text(path: string, n: number): string {
		const t = (this.raw(path, n) ?? '').trim();
		return t.length > 100 ? t.slice(0, 99) + '…' : t;
	}

	// ── symbols ──────────────────────────────────────────────────────────────

	private symbol(name: string, kind: number, uri: string, range: Range, selection: Range, container: string[]): CodeSymbol {
		return {name, qualified: [...container, name].join('.'), kind: kindName(kind), path: this.rel(uri), line: range.start.line + 1, endLine: range.end.line + 1, uri, position: selection.start};
	}

	private flatten(list: (DocumentSymbol | SymbolInformation)[], uri: string, container: string[]): CodeSymbol[] {
		const out: CodeSymbol[] = [];
		for (const s of list) {
			if ('location' in s) {
				out.push(this.symbol(s.name, s.kind, s.location.uri, s.location.range, s.location.range, s.containerName ? [s.containerName] : []));
				continue;
			}
			const sym = this.symbol(s.name, s.kind, uri, s.range, s.selectionRange, container);
			const line = this.raw(toPath(uri), sym.line) ?? '';
			if (/^\s*import\b/.test(line)) continue; // TypeScript lists imported names as variables
			if (sym.kind === 'class' && /^\s*(?:export\s+)?(?:declare\s+)?type\s/.test(line)) sym.kind = 'type'; // and type aliases as classes
			out.push(sym);
			if (s.children?.length && WITH_MEMBERS.has(s.kind)) out.push(...this.flatten(s.children, uri, [...container, s.name]));
		}
		return out;
	}

	/** The symbols a file defines: functions, classes and their members, variables, types. Not what a
	 *  function defines inside itself, and not what the file imports. */
	async symbols(abs: string): Promise<CodeSymbol[]> {
		const lang = languageOf(abs);
		if (!lang) throw new InputError(`${this.rel(abs)} is not TypeScript, JavaScript or Python`);
		if (!this.shown(abs)) throw new InputError(`${this.rel(abs)} is a link to a file outside the repo`);
		const s = await this.server(lang);
		const uri = s.openFile(abs);
		const res = await s.request<DocumentSymbol[] | SymbolInformation[] | null>('textDocument/documentSymbol', {textDocument: {uri}});
		return this.flatten(res ?? [], uri, []);
	}

	/** Definitions of a name: in one file when path is given, else across the repo. With nothing found,
	 *  the names the servers thought similar. */
	async locate(name: string, path?: string): Promise<{found: CodeSymbol[]; similar: string[]}> {
		const matches = (list: CodeSymbol[]) => list.filter(s => s.name === name || s.qualified === name || s.qualified.endsWith('.' + name));
		if (path) {
			const found = matches(await this.symbols(this.abs(path)));
			if (found.length) return {found, similar: []};
		}
		const langs = path ? [languageOf(path)].filter((l): l is Language => l !== undefined) : languagesIn(listFiles(this.root));
		const all: CodeSymbol[] = [];
		for (const lang of langs) {
			const s = await this.server(lang);
			const res = await s.request<SymbolInformation[] | null>('workspace/symbol', {query: name.split('.').pop() ?? name});
			all.push(...this.flatten(res ?? [], '', []).filter(sym => this.shown(sym.uri))); // a tsconfig or a link can bring in files outside
		}
		const seen = new Set<string>();
		const found = matches(all).filter(s => !seen.has(`${s.path}:${s.line}:${s.qualified}`) && seen.add(`${s.path}:${s.line}:${s.qualified}`));
		return {found, similar: found.length ? [] : [...new Set(all.map(s => s.qualified))].slice(0, 8)};
	}

	/** The one definition a name means, or how to narrow it. */
	async one(name: string, path?: string): Promise<CodeSymbol> {
		if (!name) throw new InputError('pass name: the symbol to look up');
		const {found, similar} = await this.locate(name, path);
		if (!found.length) throw new InputError(`no symbol named ${JSON.stringify(name)}${path ? ` in ${path}` : ' in the repo'}${similar.length ? `. Similar: ${similar.join(', ')}` : ''}`);
		if (new Set(found.map(s => s.path)).size === 1) return found[0]!; // overloads, or a name reused in one file: the first
		throw new InputError(`${JSON.stringify(name)} is defined in several files; pass path to pick one:\n${found.map(s => `  ${s.path}:${s.line}  ${s.kind} ${s.qualified}`).join('\n')}`);
	}

	private async serverFor(sym: CodeSymbol): Promise<LanguageServer> {
		const s = await this.server(languageOf(sym.path)!);
		s.openFile(toPath(sym.uri));
		return s;
	}

	/** TypeScript's server searches only the projects it has loaded, a tsconfig's files and the files
	 *  opened. Opening the repo's other files that mention the name loads them too, so uses in tests or
	 *  scripts outside every tsconfig are found. Pyright reads every file under the root already. */
	private openMentions(s: LanguageServer, sym: CodeSymbol): void {
		if (languageOf(sym.path) !== 'typescript') return;
		for (const f of mentioning(this.root, sym.name)) {
			const abs = join(this.root, f);
			if (languageOf(f) === 'typescript' && !f.endsWith('.d.ts') && isFile(abs) && realWithin(this.root, abs)) s.openFile(abs);
		}
	}

	async references(sym: CodeSymbol): Promise<Location[]> {
		const s = await this.serverFor(sym);
		this.openMentions(s, sym);
		const refs = (await s.request<Location[] | null>('textDocument/references', {textDocument: {uri: sym.uri}, position: sym.position, context: {includeDeclaration: false}})) ?? [];
		return refs.filter(l => this.shown(l.uri));
	}

	/** Locations by file, each line with its text. */
	listing(locs: Location[]): string[] {
		const byFile = new Map<string, Set<number>>();
		for (const l of locs) {
			const p = this.rel(l.uri);
			(byFile.get(p) ?? byFile.set(p, new Set()).get(p)!).add(l.range.start.line + 1);
		}
		const lines: string[] = [];
		for (const [p, ns] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
			lines.push(p);
			for (const n of [...ns].sort((a, b) => a - b)) lines.push(`  ${String(n).padStart(4)}  ${this.text(p, n)}`);
		}
		return lines;
	}

	private async hierarchy(sym: CodeSymbol): Promise<[LanguageServer, CallHierarchyItem]> {
		const s = await this.serverFor(sym);
		const items = await s.request<CallHierarchyItem[] | null>('textDocument/prepareCallHierarchy', {textDocument: {uri: sym.uri}, position: sym.position});
		if (!items?.length) throw new InputError(`${sym.qualified} is a ${sym.kind}, not something that is called`);
		return [s, items[0]!];
	}

	/** Who calls a symbol, and who calls them, to `depth`: each line calls the one it is indented under. */
	async callers(sym: CodeSymbol, depth: number): Promise<string[]> {
		const [s, item] = await this.hierarchy(sym);
		this.openMentions(s, sym);
		const lines: string[] = [];
		const seen = new Set<string>();
		let hidden = 0; // callers in files outside the repo: counted, never named
		const walk = async (from: CallHierarchyItem, level: number) => {
			if (level > depth) return;
			const calls = (await s.request<IncomingCall[] | null>('callHierarchy/incomingCalls', {item: from})) ?? [];
			for (const c of calls) {
				if (lines.length >= MAX_CALLERS) return;
				const at = [...new Set(c.fromRanges.map(r => r.start.line + 1))].sort((a, b) => a - b);
				const where = this.external(c.from.uri);
				if (where === 'outside the repo') {
					hidden++;
					continue;
				}
				lines.push(`${'  '.repeat(level)}${c.from.name}  ${where ? `(${where}) ` : ''}${this.rel(c.from.uri)}:${c.from.selectionRange.start.line + 1}  (line${at.length > 1 ? 's' : ''} ${at.join(', ')})`);
				const key = `${c.from.uri}:${c.from.selectionRange.start.line}:${c.from.name}`;
				if (seen.has(key)) continue; // its callers are already listed above
				seen.add(key);
				if (!where) await walk(c.from, level + 1);
			}
		};
		await walk(item, 1);
		return hidden ? [...lines, `and ${plural(hidden, 'caller')} in files outside the repo, not shown`] : lines;
	}

	/** What a symbol calls: in the repo, and grouped by origin outside it. */
	async callees(sym: CodeSymbol): Promise<{inside: string[]; outside: Map<string, Set<string>>; hidden: number}> {
		const [s, item] = await this.hierarchy(sym);
		const calls = (await s.request<OutgoingCall[] | null>('callHierarchy/outgoingCalls', {item})) ?? []; // null: it calls nothing
		const inside: string[] = [];
		const outside = new Map<string, Set<string>>();
		let hidden = 0; // calls into files outside the repo: counted, never named
		for (const c of calls) {
			const where = this.external(c.to.uri);
			if (where === 'outside the repo') {
				hidden++;
				continue;
			}
			if (where) {
				(outside.get(where) ?? outside.set(where, new Set()).get(where)!).add(c.to.name);
				continue;
			}
			const at = [...new Set(c.fromRanges.map(r => r.start.line + 1))].sort((a, b) => a - b);
			inside.push(`${c.to.name}  ${this.rel(c.to.uri)}:${c.to.selectionRange.start.line + 1}  (line${at.length > 1 ? 's' : ''} ${at.join(', ')})`);
		}
		return {inside, outside, hidden};
	}

	/** Where the name on a line of a file is defined. */
	async definition(path: string, line: number, name: string): Promise<Location[]> {
		const abs = this.abs(path);
		if (!name) throw new InputError('pass name: the name on that line to look up');
		if (!Number.isInteger(line) || line < 1) throw new InputError('pass line: a line number, counting from 1');
		const text = this.raw(abs, line);
		if (text === undefined) throw new InputError(`${this.rel(abs)} has no line ${line}`);
		const col = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).exec(text)?.index;
		if (col === undefined) throw new InputError(`${JSON.stringify(name)} is not on line ${line} of ${this.rel(abs)}: ${text.trim()}`);
		const lang = languageOf(abs);
		if (!lang) throw new InputError(`${this.rel(abs)} is not TypeScript, JavaScript or Python`);
		const s = await this.server(lang);
		const uri = s.openFile(abs);
		const res = await s.request<Location | Location[] | {targetUri: string; targetSelectionRange: Range}[] | null>('textDocument/definition', {textDocument: {uri}, position: {line: line - 1, character: col}});
		const list = res === null ? [] : Array.isArray(res) ? res : [res];
		return list.map(l => ('targetUri' in l ? {uri: l.targetUri, range: l.targetSelectionRange} : l));
	}

	/** The uncommitted changes, symbol by symbol, with everything that uses each. */
	async impact(): Promise<string> {
		if (!isRepo(this.root)) throw new InputError(`${this.root} is not a git repository`);
		const changes = changedLines(this.root);
		if (!changes) throw new InputError('git diff failed: no commit yet, or git is not installed');
		if (!changes.size) return 'No uncommitted changes: the working tree matches HEAD and nothing is untracked.';
		const counts = {changed: 0, new: 0, deleted: 0};
		const lines: string[] = [];
		const notCode: string[] = [];
		const dependents = new Set<string>();
		for (const [file, change] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
			if (change === 'deleted') {
				counts.deleted++;
				lines.push(`${file}  deleted`);
				continue;
			}
			counts[change === 'new' ? 'new' : 'changed']++;
			if (!languageOf(file)) {
				notCode.push(file);
				continue;
			}
			let syms: CodeSymbol[];
			try {
				syms = await this.symbols(join(this.root, file));
			} catch (err) {
				lines.push(`${file}  (symbols unavailable: ${(err as Error).message})`);
				continue;
			}
			/** Where a symbol is used, by file, noting the files that depend on the change without being changed;
			 *  or why the server could not say, which is not the same as nowhere. */
			const usesOf = async (sym: CodeSymbol): Promise<string[] | Error> => {
				let refs: Location[];
				try {
					refs = await this.references(sym);
				} catch (err) {
					return err as Error;
				}
				const byFile = new Map<string, Set<number>>();
				for (const r of refs) {
					const p = this.rel(r.uri);
					(byFile.get(p) ?? byFile.set(p, new Set()).get(p)!).add(r.range.start.line + 1);
					if (!changes.has(p)) dependents.add(p);
				}
				return [...byFile].sort(([a], [b]) => a.localeCompare(b)).map(([p, ns]) => `${p}:${[...ns].sort((a, b) => a - b).join(',')}`);
			};
			const describe = (sym: CodeSymbol, used: string[] | Error) =>
				`  ${sym.kind} ${sym.qualified} (${sym.endLine > sym.line ? `${sym.line}-${sym.endLine}` : sym.line})  ${
					used instanceof Error
						? `uses unknown (${used.message})`
						: used.length
							? 'used in ' + used.slice(0, 8).join('; ') + (used.length > 8 ? `; and ${used.length - 8} more files` : '')
							: 'used nowhere else'
				}`;
			if (change === 'new') {
				// A new file's own uses of its symbols say nothing; what matters is whether other files use them.
				const elsewhere: string[] = [];
				let unknown = false;
				for (const sym of syms.slice(0, 30)) {
					const used = await usesOf(sym);
					if (used instanceof Error) unknown = true;
					const other = used instanceof Error ? used : used.filter(u => !u.startsWith(file + ':'));
					if (other instanceof Error || other.length) elsewhere.push(describe(sym, other));
				}
				const said = unknown ? ', not all uses known:' : elsewhere.length ? ', used elsewhere:' : ', none used elsewhere';
				lines.push(`${file}  new  (${plural(syms.length, 'symbol')}${syms.length ? said : ''})`, ...elsewhere);
				continue;
			}
			lines.push(`${file}  lines ${change.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`);
			const hit = syms.filter(s => change.some(([a, b]) => s.line <= b && s.endLine >= a));
			const leaves = hit.filter(s => !hit.some(o => o !== s && o.qualified.startsWith(s.qualified + '.'))); // the innermost of nested hits
			if (!leaves.length) {
				lines.push('  (no symbol touched: imports, comments or top-level statements)');
				continue;
			}
			for (const sym of leaves.slice(0, 30)) lines.push(describe(sym, await usesOf(sym)));
			if (leaves.length > 30) lines.push(`  and ${leaves.length - 30} more symbols`);
		}
		const head = `${plural(changes.size, 'file')} differ from HEAD: ${counts.changed} changed, ${counts.new} new, ${counts.deleted} deleted`;
		if (notCode.length) lines.push('', `Not code: ${notCode.join(', ')}`);
		if (dependents.size) lines.push('', `Use the changed symbols but are not changed themselves: ${[...dependents].sort().join(', ')}`);
		return cut([head, '', ...lines]).join('\n');
	}
}

// ── the tools ────────────────────────────────────────────────────────────────

const str = (a: Record<string, unknown>, k: string): string => (a[k] === undefined || a[k] === null ? '' : String(a[k]).trim());
const int = (a: Record<string, unknown>, k: string, dflt: number): number => (a[k] === undefined || a[k] === null || a[k] === '' ? dflt : Number(a[k]));
const at = (s: CodeSymbol): string => `${s.path}:${s.line}`;

type Spec = {description: string; shape: Record<string, z.ZodType>; run: (code: CodeIntel, args: Record<string, unknown>) => Promise<string>};

const TOOLS: Record<string, Spec> = {
	find_symbol: {
		description: 'Where a function, class, method, variable or type is defined, by name, anywhere in the repo (TypeScript, JavaScript and Python). Pass path to look in one file; Class.method names a member.',
		shape: {name: z.string().describe('the name, or Class.method'), path: z.string().optional().describe('look in this file only')},
		run: async (code, a) => {
			const name = str(a, 'name');
			if (!name) throw new InputError('pass name: the symbol to find');
			const {found, similar} = await code.locate(name, str(a, 'path') || undefined);
			if (!found.length) throw new InputError(`no symbol named ${JSON.stringify(name)}${str(a, 'path') ? ` in ${str(a, 'path')}` : ' in the repo'}${similar.length ? `. Similar: ${similar.join(', ')}` : ''}`);
			return [`${plural(found.length, 'definition')} of ${name}:`, ...found.map(s => `  ${at(s)}  ${s.kind} ${s.qualified}  ${code.text(s.path, s.line)}`)].join('\n');
		},
	},
	references: {
		description: 'Everywhere a symbol is used across the repo, by file and line, with the line of code. Use it before changing or removing anything.',
		shape: {name: z.string().describe('the symbol, or Class.method'), path: z.string().optional().describe('the file that defines it, when the name is used in several files')},
		run: async (code, a) => {
			const sym = await code.one(str(a, 'name'), str(a, 'path') || undefined);
			const refs = await code.references(sym);
			if (!refs.length) return `${sym.qualified} (${sym.kind}, ${at(sym)}) is used nowhere else that the language server sees.`;
			return cut([`${sym.qualified} (${sym.kind}, ${at(sym)}) is used in ${plural(refs.length, 'place')}:`, ...code.listing(refs)]).join('\n');
		},
	},
	callers: {
		description: 'Who calls a function or method, and who calls those, as a tree to a depth (default 2, at most 4). A function only passed around as a value has no callers; use references then.',
		shape: {name: z.string().describe('the function or method, or Class.method'), path: z.string().optional().describe('the file that defines it'), depth: z.number().int().min(1).max(4).optional().describe('levels of callers; default 2')},
		run: async (code, a) => {
			const depth = Math.min(4, Math.max(1, int(a, 'depth', 2) || 2));
			const sym = await code.one(str(a, 'name'), str(a, 'path') || undefined);
			const tree = await code.callers(sym, depth);
			if (!tree.length) return `Nothing calls ${sym.qualified} (${at(sym)}) that the language server sees. It may be passed as a value, or exported for others.`;
			return [`Callers of ${sym.qualified} (${at(sym)}), ${plural(depth, 'level')}; each line calls the one it is indented under, at the lines in parentheses:`, ...tree, ...(tree.length >= MAX_CALLERS ? ['… stopped at 80 callers'] : [])].join('\n');
		},
	},
	callees: {
		description: 'What a function or method calls, in the repo and outside it (packages, the standard library).',
		shape: {name: z.string().describe('the function or method, or Class.method'), path: z.string().optional().describe('the file that defines it')},
		run: async (code, a) => {
			const sym = await code.one(str(a, 'name'), str(a, 'path') || undefined);
			const r = await code.callees(sym);
			if (!r.inside.length && !r.outside.size && !r.hidden) return `${sym.qualified} (${at(sym)}) calls nothing.`;
			const lines = [`${sym.qualified} (${at(sym)}) calls:`, ...(r.inside.length ? r.inside.map(l => `  ${l}`) : ['  nothing in the repo'])];
			for (const [where, names] of r.outside) lines.push(`  from ${where}: ${[...names].sort().join(', ')}`);
			if (r.hidden) lines.push(`  and ${plural(r.hidden, 'call')} into files outside the repo, not shown`);
			return cut(lines).join('\n');
		},
	},
	file_symbols: {
		description: 'The symbols a file defines, with their lines: functions, classes and their members, variables, types. An outline to read before the file itself.',
		shape: {path: z.string().describe('the file')},
		run: async (code, a) => {
			const abs = code.abs(str(a, 'path'));
			const syms = await code.symbols(abs);
			const rel = code.rel(abs);
			if (!syms.length) return `${rel} defines no symbols.`;
			const span = (s: CodeSymbol) => (s.endLine > s.line ? `${s.line}-${s.endLine}` : `${s.line}`);
			const width = Math.max(...syms.map(s => span(s).length));
			return cut([`${rel}: ${plural(syms.length, 'symbol')}`, ...syms.map(s => `  ${span(s).padEnd(width)}  ${'  '.repeat(s.qualified.split('.').length - 1)}${s.kind} ${s.name}`)]).join('\n');
		},
	},
	definition: {
		description: 'Where the name used at a line of a file is defined, which may be another file or a package. For a name you are looking at in code; find_symbol takes a bare name.',
		shape: {path: z.string().describe('the file'), line: z.number().int().min(1).describe('the line, counting from 1'), name: z.string().describe('the name on that line')},
		run: async (code, a) => {
			const path = str(a, 'path');
			const line = int(a, 'line', 0);
			const name = str(a, 'name');
			const locs = await code.definition(path, line, name);
			if (!locs.length) return `No definition found for ${name} at ${code.rel(code.abs(path))}:${line}. It may be a keyword, a property of an untyped value, or defined by a package without types.`;
			return locs
				.map(l => {
					const where = code.external(l.uri);
					const n = l.range.start.line + 1;
					return `${name} is defined at ${where ? `(${where}) ` : ''}${code.rel(l.uri)}:${n}  ${code.text(toPath(l.uri), n)}`;
				})
				.join('\n');
		},
	},
	repo_overview: {
		description: 'The repo at a glance: languages, directories, the files most depended on, the entry points. Read it before exploring a repo you do not know.',
		shape: {},
		run: async code => overview(code.root),
	},
	change_impact: {
		description: 'What the uncommitted changes touch: each changed symbol and everywhere it is used, and the files that depend on the changes but were not changed. Run it before finishing a change.',
		shape: {},
		run: code => code.impact(),
	},
};

/** The code tools for a repo, and how to stop the servers they started. */
export function codeTools(root: string): {tools: Tool[]; close: () => Promise<void>} {
	const code = new CodeIntel(root);
	const tools = Object.entries(TOOLS).map(([name, t]): Tool => ({name, description: t.description, shape: t.shape, run: args => code.run(() => t.run(code, args ?? {}))}));
	return {tools, close: () => code.close()};
}
