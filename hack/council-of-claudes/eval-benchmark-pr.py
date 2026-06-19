#!/usr/bin/env python3
"""Side-by-side review comparison for the Council of Claudes benchmark.

Given an upstream projectcalico/calico PR number, render a markdown doc that
puts the ORIGINAL human review comments next to the Council's comments on the
reproduced duplicate PR (created by gen-benchmark-pr.sh, head branch
coc-sample-<N>-head), so you can eyeball how similar/different they are.

Usage:  ./eval-benchmark-pr.py <upstream-PR-number>
Writes: comparison-<N>.md

Calls `gh` (authenticated) for all network access, so no Python TLS setup needed.
"""
import sys, json, subprocess

UP = "projectcalico/calico"
FORK = "tigera/calico-oss-test"
EMOJI = {"correctness": "🔎", "maintainability": "🧪", "security": "🛡️"}


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


def gh_json(*args):
    return _gh(list(args)).strip()


def clean(body, limit=200):
    """One-line, table-safe, truncated comment body."""
    b = " ".join((body or "").split())
    b = b.replace("|", "\\|")
    return (b[:limit] + "…") if len(b) > limit else b


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: eval-benchmark-pr.py <upstream-PR-number>")
    n = sys.argv[1]

    title = gh_json("api", f"repos/{UP}/pulls/{n}", "--jq", ".title")

    # --- Original: human top-level inline review comments ---
    human = []  # {login, path, line, body}
    for c in gh_lines(f"repos/{UP}/pulls/{n}/comments?per_page=100"):
        if c.get("user", {}).get("type") == "User" and c.get("in_reply_to_id") is None:
            human.append({
                "login": c["user"]["login"], "path": c.get("path", "?"),
                "line": c.get("line") or c.get("original_line") or 0, "body": c.get("body", ""),
            })

    # --- Duplicate PR (Council) ---
    dup = gh_json("pr", "list", "--repo", FORK, "--head", f"coc-sample-{n}-head",
                  "--state", "all", "--json", "number", "--jq", ".[0].number // empty")
    council_inline, council_summaries = [], []
    if dup:
        for c in gh_lines(f"repos/{FORK}/pulls/{dup}/comments?per_page=100"):
            body = c.get("body", "")
            if "council-of-claudes:inline:" in body:
                key = body.split("council-of-claudes:inline:")[1].split(" ")[0].strip("-> \n")
                council_inline.append({
                    "persona": key, "path": c.get("path", "?"),
                    "line": c.get("line") or c.get("original_line") or 0,
                    "body": body.split("<!--")[0].strip(),
                })
        for r in gh_lines(f"repos/{FORK}/pulls/{dup}/reviews?per_page=100"):
            body = r.get("body", "")
            if "council-of-claudes:" in body and "inline:" not in body.split("council-of-claudes:")[1][:8]:
                key = body.split("council-of-claudes:")[1].split(" ")[0].strip("-> \n")
                council_summaries.append({"persona": key, "body": body.split("<!--")[0].strip()})

    # --- Render ---
    files = sorted(set([h["path"] for h in human] + [c["path"] for c in council_inline]))
    out = []
    out.append(f"# Review comparison — [{UP}#{n}](https://github.com/{UP}/pull/{n})")
    out.append(f"\n**{title.strip()}**\n")
    dup_txt = f"[duplicate PR #{dup}](https://github.com/{FORK}/pull/{dup})" if dup else "_(no duplicate PR found yet — run `gen-benchmark-pr.sh "+n+"` first)_"
    out.append(f"- 👤 Human (original): **{len(human)}** top-level inline comments")
    out.append(f"- 🤖 Council (duplicate): **{len(council_inline)}** inline + **{len(council_summaries)}** persona summaries — {dup_txt}\n")

    out.append("## Inline comments by file\n")
    out.append("| File | 👤 Human (original) | 🤖 Council (duplicate) |")
    out.append("|---|---|---|")
    for f in files:
        h_cell = "<br>".join(f"`L{h['line']}` (@{h['login']}) {clean(h['body'])}"
                             for h in sorted([x for x in human if x["path"] == f], key=lambda x: x["line"])) or "—"
        c_cell = "<br>".join(f"`L{c['line']}` {EMOJI.get(c['persona'],'🤖')} {clean(c['body'].split('—',1)[-1].strip())}"
                             for c in sorted([x for x in council_inline if x["path"] == f], key=lambda x: x["line"])) or "—"
        out.append(f"| `{f}` | {h_cell} | {c_cell} |")

    if council_summaries:
        out.append("\n## Council persona summaries (whole-PR)\n")
        for s in council_summaries:
            verdict = next((l for l in s["body"].splitlines() if l.strip() and not l.startswith("#") and not l.startswith(">")), "")
            out.append(f"- {EMOJI.get(s['persona'],'🤖')} **{s['persona']}**: {clean(verdict, 240)}")

    path = f"comparison-{n}.md"
    with open(path, "w") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"Wrote {path}  ({len(human)} human, {len(council_inline)} Council inline, {len(council_summaries)} summaries)")


if __name__ == "__main__":
    main()
