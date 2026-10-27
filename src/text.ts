// A row is one terminal line: a list of spans, each with a colour role. Builders return rows;
// components render them. Keeping rows as data lets tests measure every line without a terminal.
import stringWidth from 'string-width';
import type {Role} from './tokens.js';

export type Span = {
	text: string;
	role?: Role;
	bold?: boolean;
	bg?: Role;
	inverse?: boolean;
};
export type Row = Span[];

/** Text as the terminal would show it, with every control character but tab and newline drawn as a
 *  symbol (ESC as ␛) instead of obeyed. A model's or a tool's text could otherwise style itself:
 *  `ESC[8m` hides what follows, so an approval could show `npm test` for `npm test && curl … | sh`.
 *  Rows never carry escape codes of their own; colour is a role. */
export const visible = (text: string): string =>
	text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, c => (c <= '\u001f' ? String.fromCharCode(0x2400 + c.charCodeAt(0)) : c === '\u007f' ? '␡' : '�'));

/** One span. `s('■', 'accent')`, `s('Bash', undefined, {bold: true})`. */
export function s(text: string, role?: Role, opts: Omit<Span, 'text' | 'role'> = {}): Span {
	return {text: visible(text), role, ...opts};
}

export const bold = (text: string, role?: Role): Span => s(text, role, {bold: true});

/** Accept a row, a span or a plain string wherever content goes. */
export type Content = Row | Span | string;

export function row(...parts: Content[]): Row {
	const out: Row = [];
	for (const p of parts) {
		if (typeof p === 'string') {
			if (p) out.push({text: visible(p)});
		} else if (Array.isArray(p)) {
			out.push(...p);
		} else {
			out.push(p);
		}
	}
	return out;
}

export function width(r: Row): number {
	return r.reduce((n, sp) => n + stringWidth(sp.text), 0);
}

export function plain(r: Row): string {
	return r.map(sp => sp.text).join('');
}

/** Cut a row to `w` cells. */
export function truncate(r: Row, w: number): Row {
	const out: Row = [];
	let left = w;
	for (const sp of r) {
		if (left <= 0) break;
		const sw = stringWidth(sp.text);
		if (sw <= left) {
			out.push(sp);
			left -= sw;
			continue;
		}
		let text = '';
		for (const ch of sp.text) {
			const cw = stringWidth(ch);
			if (cw > left) break;
			text += ch;
			left -= cw;
		}
		if (text) out.push({...sp, text});
		break;
	}
	return out;
}

/** Truncate, then pad with plain spaces to exactly `w` cells. */
export function fit(r: Row, w: number): Row {
	const t = truncate(r, w);
	const gap = w - width(t);
	return gap > 0 ? [...t, {text: ' '.repeat(gap)}] : t;
}

/** Split a row after `w` cells: [what fits, the rest]. */
export function splitAt(r: Row, w: number): [Row, Row] {
	const head = truncate(r, w);
	let taken = head.reduce((n, sp) => n + sp.text.length, 0);
	const tail: Row = [];
	for (const sp of r) {
		if (taken >= sp.text.length) {
			taken -= sp.text.length;
			continue;
		}
		tail.push(taken ? {...sp, text: sp.text.slice(taken)} : sp);
		taken = 0;
	}
	return [head, tail];
}

const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});

/** Where the character `at` falls in ends: an emoji, or a letter with its accents, is one character
 *  however many UTF-16 units it takes, so the cursor never stands inside one. */
export function nextBoundary(text: string, at: number): number {
	for (const {index, segment} of graphemes.segment(text)) if (index + segment.length > at) return index + segment.length;
	return text.length;
}

/** Where the character before `at` starts. */
export function prevBoundary(text: string, at: number): number {
	let start = 0;
	for (const {index} of graphemes.segment(text)) {
		if (index >= at) break;
		start = index;
	}
	return start;
}

/** Every line of `text`, broken every `w` cells and never cut: for a request a person approves, which
 *  must reach them whole (canon gotcha-approvals). Measured as it will be drawn: control characters
 *  as the symbols `visible` makes them (an ESC measures 0, its ␛ 1), a tab as spaces, and an emoji
 *  with its modifiers as one character. Measured raw, 90 ESCs pushed the rest past the frame's edge. */
export function breakLines(text: string, w: number): string[] {
	const cells = Math.max(1, w);
	return visible(text)
		.replace(/\t/g, '    ')
		.split('\n')
		.flatMap(line => {
			const out = [''];
			let used = 0;
			for (const {segment} of graphemes.segment(line)) {
				const cw = stringWidth(segment);
				if (used + cw > cells && used > 0) {
					out.push('');
					used = 0;
				}
				out[out.length - 1] += segment;
				used += cw;
			}
			return out;
		});
}

/** Word-wrap a styled row to `w` cells, keeping each word's style. A span with a background (an
 *  inline code chip) moves as one piece; a piece longer than `w` is cut. */
export function wrapRow(r: Row, w: number): Row[] {
	const tokens = r.flatMap(sp => (sp.bg ? [sp] : sp.text.split(/(\s+)/).filter(Boolean).map(t => ({...sp, text: t}))));
	const out: Row[] = [];
	let line: Row = [];
	let used = 0;
	let gap: Row = []; // the spaces since the last word, dropped at a break
	for (const tok of tokens) {
		if (!tok.bg && /^\s+$/.test(tok.text)) {
			gap.push(tok);
			continue;
		}
		const tw = stringWidth(tok.text);
		const gw = line.length ? width(gap) : 0;
		if (line.length && used + gw + tw > w) {
			out.push(line);
			line = [];
			used = 0;
		} else if (line.length) {
			line.push(...gap);
			used += gw;
		}
		line.push(...(tw > w ? truncate([tok], w) : [tok]));
		used += Math.min(tw, w);
		gap = [];
	}
	if (line.length || !out.length) out.push(line);
	return out;
}

/** Word-wrap plain text to `w` cells. Spacing inside a line is kept (facts sit two spaces apart);
 *  the spaces at a break are dropped. */
export function wrapWords(text: string, w: number): string[] {
	const out: string[] = [];
	let line = '';
	let gap = '';
	for (const tok of text.trim().split(/(\s+)/)) {
		if (!tok) continue;
		if (/^\s+$/.test(tok)) {
			gap = tok.includes('\n') ? '\n' : tok;
			continue;
		}
		if (gap === '\n' || (line && stringWidth(line + gap + tok) > w)) {
			out.push(line);
			line = tok;
		} else line += line ? gap + tok : tok;
		gap = '';
	}
	if (line) out.push(line);
	return out.length ? out : [''];
}
