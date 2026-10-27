// A small client for the Language Server Protocol: JSON-RPC over the server's stdin and stdout, each
// message framed by a Content-Length header. Requests get promised replies; the few requests a server
// makes of its client are answered here; of its notifications (diagnostics, logs, progress), only that
// a file's diagnostics have arrived is kept.
// Lines and columns are LSP's: zero-based, columns in UTF-16 units, which JavaScript strings index by.
import {type ChildProcess, spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';

export type Position = {line: number; character: number};
export type Range = {start: Position; end: Position};
export type Location = {uri: string; range: Range};
export type DocumentSymbol = {name: string; kind: number; detail?: string; range: Range; selectionRange: Range; children?: DocumentSymbol[]};
export type SymbolInformation = {name: string; kind: number; location: Location; containerName?: string};
export type CallHierarchyItem = {name: string; kind: number; detail?: string; uri: string; range: Range; selectionRange: Range};
export type IncomingCall = {from: CallHierarchyItem; fromRanges: Range[]};
export type OutgoingCall = {to: CallHierarchyItem; fromRanges: Range[]};

/** LSP's SymbolKind numbers, named. */
const SYMBOL_KINDS: Record<number, string> = {
	1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method', 7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function', 13: 'variable',
	14: 'constant', 15: 'string', 16: 'number', 17: 'boolean', 18: 'array', 19: 'object', 20: 'key', 21: 'null', 22: 'enum member', 23: 'struct', 24: 'event', 25: 'operator', 26: 'type parameter',
};
export const kindName = (kind: number): string => SYMBOL_KINDS[kind] ?? 'symbol';

export type ServerSpec = {
	/** For the message when it stops or won't start. */
	name: string;
	command: string;
	args: string[];
	/** LSP's languageId for a file, by its extension. */
	languageId: (path: string) => string;
	/** The answer to workspace/configuration for a section, when the server asks. */
	settings?: (section: string) => unknown;
	/** The server answers about the whole workspace only once it has published diagnostics for an open
	 *  file; before that, from the open files alone (Pyright). */
	settlesOnDiagnostics?: boolean;
};

type Message = {jsonrpc: '2.0'; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: {code: number; message: string}};

export const toUri = (path: string): string => pathToFileURL(path).href;
export const toPath = (uri: string): string => (uri.startsWith('file:') ? fileURLToPath(uri) : uri);

/** The server process ended, or never started; every waiting request fails with this. */
export class ServerStopped extends Error {}

export class LanguageServer {
	private child: ChildProcess;
	private buf: Buffer = Buffer.alloc(0);
	private next = 1;
	private waiting = new Map<number, {method: string; resolve: (v: unknown) => void; reject: (e: Error) => void}>();
	private open = new Map<string, {version: number; text: string}>();
	private diagnosed_ = false; // the server has published diagnostics for some file
	private onDiagnosed: (() => void)[] = [];
	private stderr = '';
	private stopped: string | undefined;
	/** Resolves once the server has answered `initialize`; rejects if it never does. */
	readonly initialized: Promise<void>;

	constructor(
		readonly spec: ServerSpec,
		readonly root: string,
		private timeoutMs = 60_000,
	) {
		this.child = spawn(spec.command, spec.args, {cwd: root, stdio: ['pipe', 'pipe', 'pipe']});
		this.child.stdout!.on('data', (d: Buffer) => this.receive(d));
		this.child.stderr!.on('data', d => (this.stderr = (this.stderr + String(d)).slice(-2000)));
		const stop = (why: string) => {
			this.stopped = why;
			for (const w of this.waiting.values()) w.reject(new ServerStopped(`${w.method}: ${why}`));
			this.waiting.clear();
			for (const done of this.onDiagnosed.splice(0)) done(); // nothing more is coming
		};
		this.child.on('error', err => stop(`${spec.name} did not start: ${err.message}`));
		this.child.on('exit', code => {
			const last = this.stderr.trim().split('\n').pop();
			stop(`${spec.name} stopped (exit ${code ?? '?'})${last ? ': ' + last : ''}`);
		});
		this.initialized = this.initialize();
	}

	get alive(): boolean {
		return this.stopped === undefined;
	}

	private async initialize(): Promise<void> {
		const rootUri = toUri(this.root);
		await this.request('initialize', {
			processId: process.pid,
			rootUri,
			rootPath: this.root,
			workspaceFolders: [{uri: rootUri, name: 'root'}],
			capabilities: {
				workspace: {configuration: true, workspaceFolders: true, symbol: {}},
				textDocument: {synchronization: {}, documentSymbol: {hierarchicalDocumentSymbolSupport: true}, definition: {}, references: {}, callHierarchy: {}},
				general: {positionEncodings: ['utf-16']},
				window: {workDoneProgress: true},
			},
			initializationOptions: {},
		});
		this.notify('initialized', {});
	}

	request<T = unknown>(method: string, params?: unknown): Promise<T> {
		if (this.stopped) return Promise.reject(new ServerStopped(`${method}: ${this.stopped}`));
		const id = this.next++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (!this.waiting.delete(id)) return;
				reject(new Error(`${this.spec.name} took longer than ${this.timeoutMs / 1000}s to answer ${method}`));
			}, this.timeoutMs);
			this.waiting.set(id, {
				method,
				resolve: v => {
					clearTimeout(timer);
					resolve(v as T);
				},
				reject: e => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.write(params === undefined ? {jsonrpc: '2.0', id, method} : {jsonrpc: '2.0', id, method, params});
		});
	}

	notify(method: string, params?: unknown): void {
		this.write(params === undefined ? {jsonrpc: '2.0', method} : {jsonrpc: '2.0', method, params});
	}

	/** Tell the server a file is open, with its text as it is on disk now, so it answers about that
	 *  text. A file already open is updated if it changed. Returns the file's URI. */
	openFile(path: string): string {
		const uri = toUri(path);
		const text = readFileSync(path, 'utf8');
		const had = this.open.get(uri);
		if (!had) {
			this.open.set(uri, {version: 1, text});
			this.notify('textDocument/didOpen', {textDocument: {uri, languageId: this.spec.languageId(path), version: 1, text}});
		} else if (had.text !== text) {
			had.version++;
			had.text = text;
			this.notify('textDocument/didChange', {textDocument: {uri, version: had.version}, contentChanges: [{text}]});
		}
		return uri;
	}

	/** Resolves once the server has published diagnostics for any file, or after `ms`, or when it
	 *  stops. Any file, not one URI: Pyright spells a Windows URI its own way (file:///c%3A/...). */
	diagnosed(ms = this.timeoutMs): Promise<void> {
		if (this.diagnosed_ || this.stopped) return Promise.resolve();
		return new Promise<void>(resolve => {
			const t = setTimeout(done, ms);
			function done() {
				clearTimeout(t);
				resolve();
			}
			this.onDiagnosed.push(done);
		});
	}

	/** Ask the server to shut down, then end the process. */
	async stop(): Promise<void> {
		if (this.stopped) return;
		await this.request('shutdown').catch(() => undefined);
		this.notify('exit');
		await new Promise<void>(r => {
			const t = setTimeout(() => {
				this.child.kill();
				r();
			}, 2000);
			this.child.once('exit', () => {
				clearTimeout(t);
				r();
			});
		});
	}

	private write(m: Message): void {
		if (this.stopped || !this.child.stdin?.writable) return;
		const body = JSON.stringify(m);
		this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
	}

	private receive(d: Buffer): void {
		this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
		for (;;) {
			const end = this.buf.indexOf('\r\n\r\n');
			if (end < 0) return;
			const m = /Content-Length:\s*(\d+)/i.exec(this.buf.subarray(0, end).toString('latin1'));
			if (!m) {
				this.buf = this.buf.subarray(end + 4); // a header without a length: skip it
				continue;
			}
			const start = end + 4;
			const length = Number(m[1]);
			if (this.buf.length < start + length) return;
			const body = this.buf.subarray(start, start + length).toString('utf8');
			this.buf = this.buf.subarray(start + length);
			try {
				this.handle(JSON.parse(body) as Message);
			} catch {
				// not JSON: nothing to do with it
			}
		}
	}

	private handle(m: Message): void {
		if (m.method === undefined) {
			// a reply
			const w = typeof m.id === 'number' ? this.waiting.get(m.id) : undefined;
			if (!w) return;
			this.waiting.delete(m.id as number);
			if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`));
			else w.resolve(m.result);
			return;
		}
		if (m.id === undefined) {
			// a notification: diagnostics, a log line, progress; only diagnostics' arrival matters
			if (m.method === 'textDocument/publishDiagnostics') this.published();
			return;
		}
		this.write({jsonrpc: '2.0', id: m.id, ...this.answer(m.method, m.params)});
	}

	private published(): void {
		this.diagnosed_ = true;
		for (const done of this.onDiagnosed.splice(0)) done();
	}

	/** The client's side of the protocol: settings when asked, nothing to register, no progress UI. */
	private answer(method: string, params: unknown): {result: unknown} | {error: {code: number; message: string}} {
		switch (method) {
			case 'workspace/configuration': {
				const items = ((params as {items?: {section?: string}[]} | undefined)?.items ?? []) as {section?: string}[];
				return {result: items.map(i => this.spec.settings?.(i.section ?? '') ?? {})};
			}
			case 'workspace/workspaceFolders':
				return {result: [{uri: toUri(this.root), name: 'root'}]};
			case 'client/registerCapability':
			case 'client/unregisterCapability':
			case 'window/workDoneProgress/create':
			case 'workspace/semanticTokens/refresh':
			case 'workspace/inlayHint/refresh':
			case 'workspace/diagnostic/refresh':
			case 'workspace/codeLens/refresh':
				return {result: null};
			case 'window/showMessageRequest':
				return {result: null};
			default:
				return {error: {code: -32601, message: `ds-code does not handle ${method}`}};
		}
	}
}
