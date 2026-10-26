#!/bin/sh
# Parity check: ds-next's Python tools and this port, through the same 229 steps on a real canon.
# Needs: a ds-next checkout with its environment (uv sync there), and the canon and skills-os.
#   DS_CANON=~/Developer/canon DS_SKILLS=~/Developer/skills-os sh test/parity/run.sh
# DS_NEXT is the ds-next checkout; default ~/Developer/ds-next.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${DS_NEXT:-$HOME/Developer/ds-next}"
[ -x "$REPO/.venv/bin/python" ] || { echo "no ds-next environment at $REPO/.venv: set DS_NEXT, or run uv sync there" >&2; exit 2; }
W="$(mktemp -d)"
: "${DS_CANON:?set DS_CANON to the canon checkout}" "${DS_SKILLS:?set DS_SKILLS to the skills-os checkout}"
export GIT_AUTHOR_NAME="Parity" GIT_AUTHOR_EMAIL="parity@example" GIT_COMMITTER_NAME="Parity" GIT_COMMITTER_EMAIL="parity@example"
python3 -I "$HERE/gen_scenarios.py" "$DS_CANON" "$DS_SKILLS" "$W/scenarios.json"
"$REPO/.venv/bin/python" "$HERE/run_py.py" "$W/py" "$DS_CANON" "$DS_SKILLS" "$W/scenarios.json" "$W/out_py.json"
(cd "$HERE/../.." && npx tsx "$HERE/run_ts.mts" "$W/ts" "$DS_CANON" "$DS_SKILLS" "$W/scenarios.json" "$W/out_ts.json")
python3 -I "$HERE/compare.py" "$W"
