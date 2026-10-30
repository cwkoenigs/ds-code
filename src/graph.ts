// The cross-repo graph (canon adr-002): what this repo provides to other repositories and who uses it,
// read from the canon's index.json, which canon's pipeline compiles from every registered repo. This is
// the one read outside the repo besides a library, and it is a fixed one: DS_CANON, else the canon beside
// the team's other repos (~/Developer, ~/code, ~/.ds). A path the repo itself names (its manifest's
// `canon = ...`) is never followed: a tool that never asks reads nothing a repo points it at.
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

type Edge = {from: string; to: string; what: string; declared?: boolean; mentioned?: boolean; count?: number; where?: string[]};
type Repo = {name: string; provides?: Record<string, string[]>};
export type Graph = {generated?: string; repos?: Repo[]; edges?: Edge[]};

/** The `repos` section of the canon's index.json, or undefined when no canon is installed here or its
 *  pipeline has not written the section yet. */
export function canonGraph(env: NodeJS.ProcessEnv = process.env): Graph | undefined {
	const roots = env.DS_CANON ? [env.DS_CANON] : ['Developer', 'code', '.ds'].map(d => join(homedir(), d, 'canon'));
	for (const root of roots) {
		const index = join(root, 'index.json');
		if (!existsSync(index)) continue;
		try {
			const section = (JSON.parse(readFileSync(index, 'utf8')) as {repos?: unknown}).repos;
			return section && typeof section === 'object' && !Array.isArray(section) ? (section as Graph) : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** The repo's name as its manifest's `[repo] name` says, or undefined when there is no manifest. */
export function repoName(root: string): string | undefined {
	let text: string;
	try {
		text = readFileSync(join(root, '.ds', 'manifest.toml'), 'utf8');
	} catch {
		return undefined;
	}
	return /^\[repo\][^[]*?^name\s*=\s*"([^"\n]+)"/ms.exec(text)?.[1];
}

/** What canon's build_repos.py scans for: the entry less `[optional parts]` and a trailing `*`. */
export const literal = (entry: string): string => entry.replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().replace(/\*$/, '').trimEnd();

const escape = (s: string): string => s.replace(/[.+?^${}()|\\]/g, '\\$&');
/** A path entry matches a changed file exactly, or as a glob where `*` stands for one path segment. */
const pathMatches = (entry: string, path: string): boolean => new RegExp(`^${entry.split('*').map(escape).join('[^/]*')}$`).test(path);

export type Changed = {paths: string[]; symbols: string[]; text: string};

/** The lines change_impact adds: the contracts this repo provides (its manifest's `[provides]`) that the
 *  change touches by name, and who uses each. Touched means a changed file is a provided path, a changed
 *  symbol's name is a word of a provided entry (`setup` in `ds-next setup`), or the changed text holds the
 *  entry as other repos write it. Nothing without a canon here, or without a manifest. */
export function crossRepo(root: string, changed: Changed, graph = canonGraph()): string[] {
	if (!graph) return [];
	const name = repoName(root);
	if (!name) return [];
	const me = graph.repos?.find(r => r.name === name);
	if (!me) return [`Across repos: ${name} is not in the canon's registry (canon/repos/${name}.toml); the graph does not know it`];
	const when = `canon graph compiled ${graph.generated ?? '?'}`;
	const provided = Object.values(me.provides ?? {}).flat();
	if (!provided.length) return [`Across repos: the ${when} lists nothing under [provides] for ${name}; declare its contracts in .ds/manifest.toml and the pipeline picks them up`];
	const words = new Set(changed.symbols.map(s => s.split('.').pop()!).filter(w => w.length >= 4));
	const touched = provided.filter(entry => {
		const lit = literal(entry);
		if (lit.length < 4) return false;
		if (changed.paths.some(p => pathMatches(lit, p))) return true;
		if (changed.text.includes(lit)) return true;
		return lit.split(/[^\w-]+/).some(w => words.has(w));
	});
	if (!touched.length) return [`Across repos: none of the ${provided.length} contracts ${name} provides is touched by name (${when})`];
	const edges = graph.edges ?? [];
	return [
		`Across repos (${when}): the change touches what other repositories use`,
		...touched.map(entry => {
			const users = edges.filter(e => e.to === name && e.what === entry);
			const by = users.map(e => `${e.from} (${(e.where ?? []).slice(0, 3).join(', ')}${(e.count ?? 0) > 3 ? ', …' : ''})`).join('; ');
			return `  ${entry}  ${users.length ? `used by ${by}` : 'used by nobody the graph knows'}`;
		}),
	];
}
