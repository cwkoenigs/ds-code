# AGENTS.md

<!-- ds:local adopted 2026-10-26 -->
The code tools as one MCP server for any agent, answered by the language servers ds-code ships, for the team on Mac and Windows

- Test: `npm test`
- Lint: `npm run typecheck`
- Before changing anything, read `.ds/manifest.toml`: it says which standards are in force here.
- The team's knowledge base is served by `ds-next mcp` (canon_list, canon_read, code_search, code_get, code_add) for any agent that can reach it.
- `ds-code mcp` serves the eight `code` tools (definitions, references, callers, callees, file outlines, a repo overview, change impact); this repo's Codex and Claude Code configs start it as `code`.

## Directory map

`ARCHITECTURE.md` is the map: how a call flows, the rules the code keeps, every file and what it
holds, and where to make a given change. Read it before changing code. In short:

- `src/` the server: `cli.ts` (the command), `mcp.ts` (the MCP server), `tools.ts` (the eight tools),
  `lsp.ts` (the language-server client), `servers.ts` (which server, started how), `repo.ts` (files,
  imports, git).
- `test/` vitest, and `test/fixtures/` the two small projects the tools are tested on.

## Setup

Node 22.22 or newer (the team runs 26): `npm install` (builds), then `npm link` for the `ds-code`
command. The language servers (TypeScript's and Pyright) come with `npm install`; there is nothing
else to install.

## Required checks

Both must pass before a change is done:

- `npm run typecheck` (the source and the tests)
- `npm test`

CI (`.github/workflows/test.yml`) runs both on macOS and Windows, on Node 22.22 and 26, for every pull
request.

## Keep the record

Every change, by a person or an agent:

- adds a line to `CHANGELOG.md` under Unreleased, with the pull request number;
- updates `ARCHITECTURE.md` when a file is added, moved or deleted, or a call flows differently
  (`npm test` fails until the file map matches);
- records a decision with options weighed in `DECISIONS.md` as the next `local-NNN` (`/so-changes`
  writes it);
- sends a pattern worth reusing in other repos to the canon with `/so-capture`.

## Code tools

`code` answers from the language servers, and is quicker and surer than text search: `repo_overview`
to learn a repo, `file_symbols` before reading a file, `find_symbol` and `definition` for where
something is defined, `references` and `callers` before changing or removing anything, `change_impact`
before finishing a change. `ds` (from `ds-next mcp`) answers from the canon.

## Files requiring extra care

- `src/tools.ts`: every tool there is marked read-only, so a client runs it without asking. A tool
  must only read: never write, never run anything the repo carries (its `python`, its git config's
  textconv), never read outside the repo but a library and the canon's `index.json` (`src/graph.ts`: at
  `DS_CANON` or beside the team's repos, never at a path the repo names).
- `package-lock.json`: regenerate with npm, never by hand.

## Standards

Standards that apply here, each pending until the owner adopts or declines it in `.ds/manifest.toml` (`/status` in ds-next): [[adr-000]], [[adr-001]], [[architecture]], [[change-cadence]], [[cicd]], [[code-review]], [[compliance-rubric]], [[decision-logs]], [[error-handling]], [[gotcha-approvals]], [[gotcha-green-means-ran]], [[gotcha-proving-claims]], [[gotcha-terminal-ui]], [[gotcha-tool-arguments]], [[gotcha-verify-process]], [[lifecycle]], [[llm-agents]], [[normative-language]], [[operating-principles]], [[repo-naming]], [[review-cadence]], [[security]], [[templates]], [[terminal-design]], [[testing]].

## Skills

From skills-os:

- `/so-build-feature-interview`: Turn a feature request on an existing app into a reviewed, phased implementation plan with a decision log and external review gates.
- `/so-bug-review-interview`: Turn a bug report into a reproduced, root-caused, phased fix plan with a decision log and external review gates.
- `/so-capture`: Capture problems, discoveries, decisions and gotchas from a coding session into structured draft records, then flush them to the team knowledge repo as a GitLab MR for review before publication.
- `/so-changes`: Record decisions (ADRs), log shipped changes (changelog), draft stakeholder communications, and capture cross-project insights.
