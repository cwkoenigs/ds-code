import difflib
import json
import sys
from pathlib import Path

W = sys.argv[1]
py, ts = json.loads(Path(f"{W}/out_py.json").read_text()), json.loads(Path(f"{W}/out_ts.json").read_text())
sc = json.loads(Path(f"{W}/scenarios.json").read_text())
TOML = "manifest is not valid TOML: "
bad = 0
known = 0


def expected(a, b):
    """The two differences the README names, and nothing else: ds-next quotes an unknown id's message
    (Python's KeyError), and a different parser words a TOML error."""
    if isinstance(a, dict) and isinstance(b, dict) and a.keys() == b.keys():
        if a.get("tool") == b.get("tool") == "canon_read" and a.get("error") == b.get("error") is True:
            t = b.get("text", "")
            return t.startswith("ERROR: ") and a.get("text") == f'ERROR: "{t[len("ERROR: "):]}"'
        worded = lambda d: {**d, "errors": [TOML if e.startswith(TOML) else e for e in d.get("errors", [])]}
        return "errors" in a and worded(a) == worded(b)
    return False


def show(label, a, b, whole=None):
    """A difference: counted as known when it is one of the two the README names, else as bad."""
    global bad, known
    if whole is not None and expected(*whole):
        known += 1
        label += " (expected)"
    else:
        bad += 1
    a, b = (a if isinstance(a, str) else json.dumps(a, indent=1, ensure_ascii=False)), (b if isinstance(b, str) else json.dumps(b, indent=1, ensure_ascii=False))
    d = list(difflib.unified_diff(a.splitlines(), b.splitlines(), "python", "ts", lineterm="", n=1))
    print(f"--- {label}"); print("\n".join(d[:14]) + ("\n..." if len(d) > 14 else ""))


if len(py["steps"]) != len(ts["steps"]):
    show("steps", f"{len(py['steps'])} steps", f"{len(ts['steps'])} steps")
for i, (p, t) in enumerate(zip(py["steps"], ts["steps"])):
    if p != t:
        show(f"step {i} {p['tool']} {json.dumps(sc['steps'][i]['args'])[:80]} (error py={p['error']} ts={t['error']})", p["text"], t["text"], (p, t))
for sec in ("files", "captures"):
    for k in sorted(set(py[sec]) | set(ts[sec])):
        if py[sec].get(k) != ts[sec].get(k):
            show(f"{sec}: {k}", py[sec].get(k, "<missing>"), ts[sec].get(k, "<missing>"))
for sec in ("reconcile", "adopt"):
    for k in sorted(set(py[sec]) | set(ts[sec])):
        if py[sec].get(k) != ts[sec].get(k):
            show(f"{sec}: {k}", py[sec].get(k, "<missing>"), ts[sec].get(k, "<missing>"), (py[sec].get(k), ts[sec].get(k)))
if py["pointers"] != ts["pointers"]: show("pointers", py["pointers"], ts["pointers"])
if py["usage"] != ts["usage"]: show("usage.jsonl", "\n".join(py["usage"]), "\n".join(ts["usage"]))
print(f"\n{bad} unexpected differences, {known} expected (see README); {len(py['steps'])} steps, {len(py['files'])} project files, {len(py['reconcile'])} reconcile cases, {len(py['adopt'])} adoptions compared")
sys.exit(1 if bad else 0)
