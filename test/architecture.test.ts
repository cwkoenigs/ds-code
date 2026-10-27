// ARCHITECTURE.md names every file in the code, and names no file that is gone, so the map stays true.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const MAPPED = ['src', 'python', 'scripts', 'test'].filter(d => existsSync(join(import.meta.dirname, '..', d)));
const page = readFileSync(join(ROOT, 'ARCHITECTURE.md'), 'utf8');

function files(dir: string): string[] {
	return readdirSync(join(ROOT, dir)).flatMap(name => {
		const rel = `${dir}/${name}`;
		if (name === '__pycache__' || name.startsWith('.')) return [];
		return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : [rel];
	});
}

describe('ARCHITECTURE.md', () => {
	it('names every file in src, python, scripts and test', () => {
		const missing = MAPPED.flatMap(files).filter(f => !page.includes(`\`${f}\``));
		expect(missing, 'add these to ARCHITECTURE.md').toEqual([]);
	});

	it('names no file that is gone', () => {
		const named = [...page.matchAll(/`((?:src|python|scripts|test)\/[^`\s]+\.[a-z]+)`/g)].map(m => m[1]!);
		expect(named.length).toBeGreaterThanOrEqual(MAPPED.flatMap(files).length); // the pattern finds the map
		expect(named.filter(f => !existsSync(join(ROOT, f))), 'remove or fix these in ARCHITECTURE.md').toEqual([]);
	});
});
