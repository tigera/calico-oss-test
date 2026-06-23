#!/usr/bin/env python3
"""Compare the Council of Claudes' inline comments across two iterations.

Given two duplicate PRs of the *same* original (e.g. a v1 without the orchestrator
and a v2 with it), report how the Council's inline review comments changed:
which are shared, which are only in one, overall and per persona.

Usage:  ./eval-benchmark-pr.py <prA> <prB>
        (PR numbers in tigera/calico-oss-test, e.g. `eval-benchmark-pr.py 218 238`)
Writes: comparison-<prA>-vs-<prB>.md

Matching is LOCATION-BASED (option A): two comments match iff they share the same
(persona, file, line). Both PRs reproduce the same diff, so line numbers align —
deterministic, no evaluator variance. It will (a) treat two different findings a
persona makes on the same line as "the same", and (b) miss a finding re-anchored a
line or two away. Semantic (LLM) matching is a planned future enhancement.

Caveat: comparing two stochastic runs conflates the real change (e.g. the
orchestrator) with gpt-5 run-to-run variance. For the orchestrator specifically,
its own keep/drop decisions in the v2 Actions log are the cleaner signal.

Calls `gh` (authenticated) for all network access, so no Python TLS setup needed.
"""
import sys, json, subprocess
from collections import Counter

FORK = "tigera/calico-oss-test"
# persona key -> (display label, emoji). Human personas render without an emoji.
PERSONAS = {
    "correctness": ("Correctness", "🔎"),
    "maintainability": ("Maintainability & Tests", "🧪"),
    "security": ("Security", "🛡️"),
    "nelljerram": ("Nell", "🧑‍💻"),
    "caseydavenport": ("Casey", "🧑‍🔧"),
}


def _gh(args):
    """Run gh and return stdout, exiting with a clear error on failure — so a
    failed call (auth expiry, rate limit, bad PR) isn't silently mistaken for an
    empty result and rendered as a misleading "0 comments" comparison."""
    out = subprocess.run(["gh", *args], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"error: `gh {' '.join(args)}` failed (exit {out.returncode}): {out.stderr.strip()}")
    return out.stdout


def gh_lines(path):
    """Run `gh api --paginate --jq '.[] | @json'` and yield parsed objects."""
    for ln in _gh(["api", path, "--paginate", "--jq", ".[] | @json"]).splitlines():
        ln = ln.strip()
        if ln:
            yield json.loads(ln)


def clean(body, limit=160):
    """One-line, table-safe, truncated comment body (markers/images stripped)."""
    b = body or ""
    if "<!--" in b:
        b = b.split("<!--")[0]
    b = " ".join(b.split()).replace("|", "\\|")
    return (b[:limit] + "…") if len(b) > limit else b


def council_inline(pr):
    """Council inline review comments on a fork PR -> [{persona, file, line, body}]."""
    out = []
    for c in gh_lines(f"repos/{FORK}/pulls/{pr}/comments?per_page=100"):
        body = c.get("body", "")
        if "council-of-claudes:inline:" not in body:
            continue
        persona = body.split("council-of-claudes:inline:")[1].split(" ")[0].strip("-> \n")
        out.append({
            "persona": persona, "file": c.get("path", "?"),
            "line": c.get("line") or c.get("original_line") or 0, "body": body,
        })
    return out


def label(persona):
    name, emoji = PERSONAS.get(persona, (persona, "🤖"))
    return f"{emoji} {name}"


def main():
    if len(sys.argv) != 3 or not all(a.isdigit() for a in sys.argv[1:3]):
        sys.exit("usage: eval-benchmark-pr.py <prA> <prB>   (e.g. eval-benchmark-pr.py 218 238)")
    prA, prB = sys.argv[1], sys.argv[2]

    A = council_inline(prA)
    B = council_inline(prB)

    # Location-based key. Counters handle the (rare) case of a persona posting
    # multiple comments on the same line.
    def keys(rows):
        return Counter((r["persona"], r["file"], r["line"]) for r in rows)
    kA, kB = keys(A), keys(B)

    all_personas = sorted({r["persona"] for r in A + B} | set(PERSONAS),
                          key=lambda p: list(PERSONAS).index(p) if p in PERSONAS else 99)

    def tally(ka, kb, persona=None):
        union = set(ka) | set(kb)
        if persona is not None:
            union = {k for k in union if k[0] == persona}
        shared = sum(min(ka[k], kb[k]) for k in union)
        only_a = sum(max(ka[k] - kb[k], 0) for k in union)
        only_b = sum(max(kb[k] - ka[k], 0) for k in union)
        return shared, only_a, only_b

    # --- render ---
    out = []
    out.append(f"# Council comparison — PR #{prA} (A) vs PR #{prB} (B)")
    out.append(f"\n- A: https://github.com/{FORK}/pull/{prA}")
    out.append(f"- B: https://github.com/{FORK}/pull/{prB}")
    out.append("\n_Matching is location-based: same (persona, file, line). See script header for caveats._\n")

    out.append("## Summary (inline comments)\n")
    out.append("| Persona | Total A | Total B | Δ | Shared | Only A | Only B |")
    out.append("|---|--:|--:|--:|--:|--:|--:|")
    sh, oa, ob = tally(kA, kB)
    ta, tb = len(A), len(B)
    out.append(f"| **All** | **{ta}** | **{tb}** | **{tb - ta:+d}** | **{sh}** | **{oa}** | **{ob}** |")
    for p in all_personas:
        pa = sum(1 for r in A if r["persona"] == p)
        pb = sum(1 for r in B if r["persona"] == p)
        if pa == 0 and pb == 0:
            continue
        psh, poa, pob = tally(kA, kB, p)
        out.append(f"| {label(p)} | {pa} | {pb} | {pb - pa:+d} | {psh} | {poa} | {pob} |")

    # Detail: what changed (supports human good/bad labeling of just the delta).
    def detail(rows, ka, kb, header):
        out.append(f"\n## {header}\n")
        items = [r for r in rows if max(ka[(r['persona'], r['file'], r['line'])]
                                        - kb[(r['persona'], r['file'], r['line'])], 0) > 0]
        if not items:
            out.append("_(none)_")
            return
        for r in sorted(items, key=lambda r: (r["persona"], r["file"], r["line"])):
            out.append(f"- {label(r['persona'])} `{r['file']}:{r['line']}` — {clean(r['body'])}")

    detail(A, kA, kB, f"Only in A (#{prA}) — present in A, absent in B")
    detail(B, kB, kA, f"Only in B (#{prB}) — present in B, absent in A")

    path = f"comparison-{prA}-vs-{prB}.md"
    with open(path, "w") as fh:
        fh.write("\n".join(out) + "\n")

    print(f"Wrote {path}")
    print(f"  A #{prA}: {ta} inline | B #{prB}: {tb} inline | Δ {tb - ta:+d}")
    print(f"  shared {sh} | only-A {oa} | only-B {ob}")


if __name__ == "__main__":
    main()
