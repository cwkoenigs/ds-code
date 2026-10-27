# What changes in rule agent and ds-next: approvals and hooks

**For:** everyone who runs `rule agent` or ds-next. **When:** once cwkoenigs/rule-cli#5 and
cwkoenigs/ds-next#6 merge.

**What changes**

- **Claude Code sessions run no hooks.** Hooks in your `~/.claude` settings and in a repo's
  `.claude/settings.json` no longer run inside `rule agent` or ds-next. Hooks your IT department
  manages still run.
- **Settings no longer skip the approval.** An `allow` rule in your Claude settings, or a
  "don't ask again" you saved in Claude Code, used to let commands and edits run without the
  dialog. Now they ask. Reads inside the project still don't ask. "Always" for the rest of a
  session still works.
- **Cortex Code asks about a repo's hooks first.** If a repo's `.cortex/` or `.claude/` settings
  define hooks, you'll see every hook's command and approve it before the session starts. Answer
  no and nothing starts.

**Why:** an adversarial review found that a cloned repo could run commands on your machine as soon
as you started a session in it, through hooks in its own settings files, with nothing asked. We
confirmed it with Claude Code and Cortex Code. Saved allow rules also let commands skip the
dialog that both tools promise.

**What you need to do:** nothing, in most cases.

- If you rely on your own Claude hooks (a formatter, a notification), they won't run in these two
  tools. Use Claude Code directly for that work, or tell us what you need.
- If a repo you trust uses Cortex hooks, check the commands and answer `y`. You're asked once per
  run.

**Also in rule-cli#5:**

- The approval dialog now shows the whole command.
- The code tools no longer run a repo's own `.venv` Python.

**Questions:** comment on either pull request.
