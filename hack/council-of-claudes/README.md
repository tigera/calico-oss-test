# Council of Claudes — benchmark tooling

Utilities for benchmarking the **Council of Claudes** automated multi-agent PR review system
(`.github/workflows/council_of_claudes.yml`) against real Project Calico pull requests.

The idea: take a real upstream PR that humans reviewed, reproduce **the exact code state the human
reviewers first saw**, open it as a PR in this fork so the Council reviews it, then compare the
Council's feedback to the original human review.

**Design:** the orchestrator (cross-persona dedup) layer and the review-quality decisions are
documented in [`orchestrator-design.md`](./orchestrator-design.md).

## Tools

### `gen-benchmark-pr.sh <upstream-PR-number>`
Reproduces a `projectcalico/calico` PR as a duplicate PR in `tigera/calico-oss-test`, which triggers
the Council workflow.

```sh
./hack/council-of-claudes/gen-benchmark-pr.sh 12345
DRY_RUN=1 ./hack/council-of-claudes/gen-benchmark-pr.sh 12345   # build & verify locally; no push / no PR
```

How it works — the mode is chosen automatically:
- **If the PR has human review comments** → reproduces the **as-first-reviewed** state: finds the
  **earliest human review comment** and the commit it was written against (`original_commit_id`) —
  the first state humans reviewed, *before* the author addressed feedback (so the issues they
  flagged are still present). For the human-vs-Council comparison.
- **If the PR has no human review comments** → reproduces the **full PR diff** (`base...head`) so the
  Council can still review it — e.g. PRs picked for live human evaluation. There's no original review
  to anchor to or compare against.
- Resolves the merge-base and the diff via the GitHub **compare API**, which works even when the
  PR was force-pushed and that commit is now dangling/unfetchable by `git`.
- Opens the duplicate as `coc-sample-<N>-base` → `coc-sample-<N>-head`, so the PR diff equals
  exactly the as-reviewed diff. The current Council workflow is overlaid onto the base branch (and
  stale upstream CI stripped) so the duplicate PR triggers the Council. Idempotent: re-running
  updates an existing sample PR.
- Synthetic reproduction commits are intentionally unsigned (throwaway benchmark artifacts).

### `eval-benchmark-pr.py <upstream-PR-number>`
Writes `comparison-<N>.md`: a side-by-side of the **original human** review comments vs. the
**Council's** comments on the reproduced duplicate PR, grouped by file, plus the persona summaries.

```sh
./hack/council-of-claudes/eval-benchmark-pr.py 12345
```

> Future direction: evolve this into a scoring tool that compares successive Council versions on the
> same benchmark PR (regression / accuracy tracking), not just human-vs-Council.

## Requirements
- `gh` CLI, authenticated (`gh auth status`)
- `git`, `python3`
- Network access to `github.com`
- A git **remote pointing at the fork** (`tigera/calico-oss-test`) — it need not be named `origin`;
  `gen-benchmark-pr.sh` resolves whichever remote targets the fork and pushes/overlays via it.

## Notes
- The **reproduction modes** (as-first-reviewed vs. full-diff) are described under
  `gen-benchmark-pr.sh` above.
- These reproduce PRs against this **fork** (`calico-oss-test`), never upstream.

## Tests
Unit tests for the Council review logic live next to the script:
`.github/workflows/scripts/council_of_claudes.test.js`. Run them with:
```sh
node --test .github/workflows/scripts/*.test.js
```
Zero dependencies (Node's built-in `node:test` runner, Node 20+). CI runs them on PRs that touch
`.github/workflows/scripts/**` via `.github/workflows/council-tests.yml`.

## Upstream vs. calico-oss-test only
The Council has two kinds of artifact. Be deliberate about the boundary when cherry-picking.

**Product → cherry-picked upstream to `projectcalico/calico`** (it runs live and reviews real PRs):
- `.github/workflows/council_of_claudes.yml` (the review workflow)
- `.github/workflows/scripts/council_of_claudes.js` (orchestration + dedup logic)
- `.github/workflows/scripts/personas/*.md`, `.github/workflows/scripts/orchestrator.md` (agent prompts)

**Dev / test / benchmark scaffolding → stays in `calico-oss-test` only** (never cherry-picked):
- `hack/council-of-claudes/**` (this dir: `gen-benchmark-pr.sh`, `eval-benchmark-pr.py`, design docs, README)
- `.github/workflows/scripts/council_of_claudes.test.js` (unit tests)
- `.github/workflows/council-tests.yml` (test CI)

Keep these in separate commits from product changes so a product cherry-pick naturally leaves the
scaffolding behind.

### Sync practices (keeping the round-trip conflict-free)
Council changes start here → are cherry-picked upstream → then flow back when `calico-oss-test` pulls
from upstream. To keep that low-conflict:
- **Sync from upstream frequently** — small, frequent merges converge cleanly; large divergence is
  where conflicts pile up.
- **Use *merge*, not *rebase*, for the upstream sync** — rebasing would replay Council commits that
  upstream already has (via cherry-pick) → empty/conflicting picks; a merge lets identical content
  converge with no conflict.
- **Keep cherry-picks content-identical** (don't tweak the code during the upstream PR) so the
  returning copy converges with the local one.
- **Don't re-edit an already-upstreamed product file independently here** — once it's upstream, let
  it come from upstream; make the next change a fresh branch → upstream cycle.

The scaffolding above has no upstream counterpart, so it never conflicts with an upstream sync.
