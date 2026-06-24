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
- **If the PR has no human review comments** → reproduces the **full PR diff** (`base..head`) so the
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
