# AGENTS.md

<!-- ds:local adopted 2026-10-26 -->
The ds-next agent terminal in Node, drawn in Rule or Rail, for the team on Mac and Windows

- Test: `npm test`
- Lint: `npm run typecheck`
- Before changing anything, read `.ds/manifest.toml`: it says which standards are in force here.
- The team's knowledge base is served by `ds-next mcp` (canon_list, canon_read, code_search, code_get, code_add) for any agent that can reach it.
- `rule mcp` serves all of ds-next's agent tools, ported here, plus `rule_spec`; this repo's Codex and Claude Code configs start it as `ds`.

## Directory map

`ARCHITECTURE.md` is the map: how a turn flows, the rules the code keeps, every file and what it
holds, and where to make a given change. Read it before changing code. In short:

- `src/` the CLI: `cli.tsx` (commands), `agent/` (`rule agent` and its two looks), `ds/` (ds-next's
  tools, ported), `rail/` (Rail), `components/`, `tour/` and `demo/` (Rule's walkthrough), and the
  row model, tokens and theme at the top.
- `python/` ds-next's code-cutting functions, unchanged. `scripts/` `npm run index`. `test/` vitest,
  and `test/parity/`, the comparison with ds-next's Python.

## Setup

Node 22.22 or newer (the team runs 26): `npm install` (builds), then `npm link` for the `rule` command.
Optional: codebase-memory-mcp and Serena for the code graph and symbol lookups; see `ARCHITECTURE.md`.

## Required checks

Both must pass before a change is done:

- `npm run typecheck`
- `npm test` (with a ds-next checkout at `DS_NEXT` or `~/Developer/ds-next`, the Rail token checks run
  too)

After changing anything in `src/ds/`, also run the parity check with ds-next:
`DS_CANON=~/Developer/canon DS_SKILLS=~/Developer/skills-os sh test/parity/run.sh`.

## Keep the record

Every change, by a person or an agent:

- adds a line to `CHANGELOG.md` under Unreleased, with the pull request number;
- updates `ARCHITECTURE.md` when a file is added, moved or deleted, or a turn flows differently
  (`npm test` fails until the file map matches);
- records a decision with options weighed in `DECISIONS.md` as the next `local-NNN` (`/so-changes`
  writes it);
- sends a pattern worth reusing in other repos to the canon with `/so-capture`.

## Code tools

`ds` (`rule mcp`) answers from the canon: standards, scaffolds, blocks, accepted code. When `graph`
(codebase-memory-mcp) and `lsp` (Serena) are available, use them before text search:
`find_symbol` and `find_referencing_symbols` for definitions and callers, `trace_path` and
`get_architecture` for how parts connect. Run `npm run index` if the graph is stale.

## Files requiring extra care

- `src/rail/tokens.ts`: must equal ds-next's `src/ds_next/ui_style.py`; `test/rail.test.tsx` checks.
- `src/ds/`: a port of ds-next's Python with the same names, arguments and outputs; keep parity.
- `src/agent/backend.ts`: the permission gate. Only reads belong in the allowlist; writes always ask.
- `package-lock.json`: regenerate with npm, never by hand.

<!-- ds:inherited canon 2026-10-26 -->
## Standards

Standards that apply here, each pending until the owner adopts or declines it in `.ds/manifest.toml` (`/status` in ds-next): [[adr-000]], [[adr-001]], [[architecture]], [[change-cadence]], [[cicd]], [[code-review]], [[compliance-rubric]], [[decision-logs]], [[error-handling]], [[gotcha-agent-trust]], [[gotcha-approvals]], [[gotcha-cortex-sdk]], [[gotcha-green-means-ran]], [[gotcha-proving-claims]], [[gotcha-terminal-ui]], [[gotcha-tool-arguments]], [[gotcha-verify-process]], [[lifecycle]], [[llm-agents]], [[normative-language]], [[operating-principles]], [[repo-naming]], [[review-cadence]], [[security]], [[templates]], [[terminal-design]], [[testing]].

## Skills

From skills-os:

- `/so-build-feature-interview`: Turn a feature request on an existing app into a reviewed, phased implementation plan with a decision log and external review gates.
- `/so-bug-review-interview`: Turn a bug report into a reproduced, root-caused, phased fix plan with a decision log and external review gates.
- `/so-capture`: Capture problems, discoveries, decisions and gotchas from a coding session into structured draft records, then flush them to the team knowledge repo as a GitLab MR for review before publication.
- `/so-changes`: Record decisions (ADRs), log shipped changes (changelog), draft stakeholder communications, and capture cross-project insights.
