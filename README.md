# ds-code

The code tools as one MCP server for any agent: where something is defined, every use of it, who calls
it, what it calls, a file's outline, a repo at a glance, and what an uncommitted change touches.
TypeScript's and Pyright's language servers answer, so the answers are the compiler's, not a text
search's. ds-next, Codex, Claude Code and Cortex Code all start the same server; there is one
implementation, in Node, because both language servers are Node programs.

It was rule-cli, the ds-next agent terminal in Node, until 2026-10-27: the terminal went back to
ds-next, and the code tools, which only rule-cli had, stayed here on their own (local-019 in
[`DECISIONS.md`](DECISIONS.md)).

## Install

Needs Node 22.22 or newer (the team runs 26). The commands are the same on Mac and Windows.

```sh
git clone https://github.com/cwkoenigs/ds-code.git ~/Developer/ds-code
cd ~/Developer/ds-code
npm install        # installs and builds; the language servers come with it
npm link           # puts `ds-code` on your PATH
```

To update: `git pull`, then `npm ci`, which installs exactly what `package-lock.json` says and never
changes it. npm 11 may warn that esbuild and fsevents have install scripts it hasn't run; both belong
to the test tools, so there is nothing to approve.

## Use it from an agent

An agent starts `ds-code mcp` itself, in the repo it works in (or `ds-code mcp DIR` for another). Name
the server `code`. On Windows, `npm link` makes `ds-code` a `.cmd`, which an agent starts through
`cmd /c ds-code mcp`.

```sh
codex mcp add code -- ds-code mcp          # Codex, everywhere
claude mcp add code -- ds-code mcp         # Claude Code, everywhere
```

- **Codex** also reads a repo's `.codex/config.toml` once you trust the project; this repo's starts it.
- **Claude Code** also reads a repo's `.mcp.json` and asks once before starting it; this repo's starts it.
- **Cortex Code** reads its own `mcp.json`: add `"code": {"command": "ds-code", "args": ["mcp"]}` under
  `mcpServers`.
- **ds-next** attaches outside MCP servers to every session in `codetools.mcp_servers()`; `code` goes
  there, with its tools in `read_only_ids()` so they never ask.

## The tools

| Tool | Answers |
|---|---|
| `repo_overview` | Languages, directories, the files most imported, entry points |
| `file_symbols` | A file's outline, with lines |
| `find_symbol` | Where a name is defined; `Class.method` for a member |
| `definition` | Where the name on a given line is defined |
| `references` | Every use of a symbol, with the line of code |
| `callers` | Who calls a function, and who calls them, to a depth |
| `callees` | What a function calls, in the repo and outside it |
| `change_impact` | The uncommitted changes, symbol by symbol, and the files that depend on them without being changed |

Every tool only reads, and says so, so no agent asks before running one. A server starts on the first
call that needs it (under a second here, a few seconds on a large repo) and stops when the agent
hangs up.

**Trying them.** You ask in words; the agent picks the tool:

| Ask | Tool |
|---|---|
| "give me an overview of this repo" | `repo_overview` |
| "outline src/tools.ts" | `file_symbols` |
| "where is CodeIntel defined?" | `find_symbol` |
| "where is codeTools used?" | `references` |
| "who calls changedLines?" | `callers` |
| "what would my uncommitted changes break?" | `change_impact` |

**What each server sees.** TypeScript's follows the nearest `tsconfig.json`, so a repo's uses of a
symbol in files outside its `include` are not found: tests are the usual case. Put them in
`tsconfig.json` (and compile from a `tsconfig.build.json`), as this repo does. Pyright reads the
packages in the repo's `.venv` or `venv` when there is one, and never runs its `python`.

**With the canon.** The canon's `code_search`, `code_get` and `code_add` (from `ds-next mcp`) answer
"has the team already written this?", across repos; these tools answer "what is in this repo, and what
does my change touch?". An agent uses the first before writing code and these before changing it.

**Why these and not Serena or a code graph.** ds-next attached [Serena](https://github.com/oraios/serena)
and [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) for the same job. Serena is a
middleman to the same TypeScript server (and GPL-3.0, and it reports its use to its maker on every
start); codebase-memory-mcp keeps a whole-repo map, but its npm and PyPI packages download the real
binary from GitHub, around a registry mirror. These tools talk to the servers directly. `DECISIONS.md`
local-010 weighs the options.

## At work

- **Everything installs from npm,** so a registry mirror such as Nexus is all ds-code needs: TypeScript's
  server and Pyright come with `npm ci`. Nothing is downloaded from anywhere else.
- **Nothing leaves the machine.** The servers run as child processes and make no network request. What
  leaves is what the agent sends its model, as with any coding agent.

## Checks

```sh
npm test           # 25 tests: the tools against the real servers on a small TypeScript project, a small
                   # Python one, a git repo with changes and this repo (its tests included); the MCP
                   # server; that nothing the repo carries runs and nothing outside it is read; and that
                   # ARCHITECTURE.md names every file
npm run typecheck  # the source and the tests
```

## What's where

- [`ARCHITECTURE.md`](ARCHITECTURE.md): how a call flows, the rules the code keeps, every file.
- [`DECISIONS.md`](DECISIONS.md): the decisions so far, including rule-cli's, and the options weighed.
- [`CHANGELOG.md`](CHANGELOG.md): what changed, by pull request.
- [`AGENTS.md`](AGENTS.md): what any agent working here reads first.
