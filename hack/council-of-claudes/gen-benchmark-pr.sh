#!/usr/bin/env bash
# Reproduce a projectcalico/calico PR's *as-first-reviewed-by-a-human* state as a
# fresh PR in tigera/calico-oss-test, so the Council of Claudes workflow reviews
# exactly the diff the human reviewers first saw (before the author addressed
# feedback).
#
# Usage (run from anywhere in the repo):
#   ./hack/council-of-claudes/gen-benchmark-pr.sh <upstream-PR-number>
#   DRY_RUN=1 ./hack/council-of-claudes/gen-benchmark-pr.sh <n>   # build & verify locally; no push / no PR
#
# Method: the earliest *human* review comment pins the commit it was written
# against (original_commit_id). We reproduce base...thatCommit as a single
# commit between two fresh branches (coc-sample-N-base and coc-sample-N-head),
# so the duplicate PR's diff equals exactly the as-reviewed diff. The synthetic
# commit is intentionally unsigned (it's a throwaway benchmark artifact).
#
# Requires: gh (authenticated), git, a clean working tree.
set -euo pipefail

# Operate from the repo root regardless of where this is invoked from — the steps
# below use repo-relative git pathspecs (.github/workflows/...).
cd "$(git rev-parse --show-toplevel)"

UP=https://github.com/projectcalico/calico.git
UPREPO=projectcalico/calico
FORK=tigera/calico-oss-test
N="${1:?usage: gen-benchmark-pr.sh <upstream-PR-number>}"
DRY="${DRY_RUN:-0}"

# Require a clean working tree (we switch branches).
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: working tree not clean — commit/stash first." >&2; exit 1
fi
START_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Looking up upstream PR #$N ..."
title=$(gh api "repos/$UPREPO/pulls/$N" --jq '.title')
author=$(gh api "repos/$UPREPO/pulls/$N" --jq '.user.login')
base=$(gh api "repos/$UPREPO/pulls/$N" --jq '.base.sha')
# Earliest human-reviewed commit + human comment count. NOTE: `gh api --paginate
# --jq` runs the jq PER PAGE, so an aggregate like sort_by(...)|.[0] yields one
# result *per page* (multi-line) on PRs with >100 comments. Stream each matching
# comment to a line, capture once, then aggregate in the shell (capturing first
# also keeps gh out of a `| head` pipe, which can SIGPIPE under pipefail).
humanComments=$(gh api "repos/$UPREPO/pulls/$N/comments?per_page=100" --paginate \
  --jq '.[] | select(.user.type=="User" and .in_reply_to_id==null) | [.created_at, .original_commit_id] | @tsv')
head=$(printf '%s\n' "$humanComments" | sort | head -1 | cut -f2)
humans=$(printf '%s\n' "$humanComments" | grep -c . || true)
if [ -z "$head" ] || [ "$head" = "null" ]; then
  echo "ERROR: no human review comment found for #$N — cannot reproduce an as-reviewed state." >&2; exit 1
fi
echo "  title : $title"
echo "  author: @$author   human top-level review comments: $humans"
echo "  base  : ${base:0:12}"
echo "  head  : ${head:0:12}  (earliest human-reviewed commit)"

baseBr="coc-sample-$N-base"
headBr="coc-sample-$N-head"

# Resolve the fork point (merge-base) and the as-reviewed diff via the GitHub
# compare API rather than local git. This works even when the PR was force-pushed
# and the earliest-reviewed commit is now DANGLING (unfetchable by `git fetch
# <sha>`) — the server still has it. base...head (three-dot) gives the diff
# relative to the merge-base, i.e. exactly the original PR's diff.
echo "Resolving merge-base + as-reviewed diff via the compare API ..."
fork=$(gh api "repos/$UPREPO/compare/$base...$head" --jq '.merge_base_commit.sha')
if [ -z "$fork" ] || [ "$fork" = "null" ]; then
  echo "ERROR: could not resolve the merge-base for $base...$head." >&2; exit 1
fi
echo "  fork  : ${fork:0:12}  (merge-base from compare API — the duplicate PR's base)"

diffFile=$(mktemp)
gh api "repos/$UPREPO/compare/$base...$head" -H "Accept: application/vnd.github.diff" > "$diffFile"
if grep -q '^Binary files' "$diffFile"; then
  echo "WARNING: as-reviewed diff includes binary files; the compare API omits binary content, so those won't reproduce." >&2
fi
# We overlay the Council workflow under .github/workflows in the base branch (so
# the duplicate PR triggers the Council and the overlay stays out of the PR diff).
# That requires the as-reviewed diff itself not to touch .github/workflows.
if grep -qE '^diff --git a/\.github/workflows/' "$diffFile"; then
  echo "ERROR: this PR's as-reviewed diff touches .github/workflows — incompatible with the overlay." >&2
  rm -f "$diffFile"; exit 1
fi

echo "Fetching the merge-base commit + the Council workflow from origin/master ..."
git fetch --quiet "$UP" "$fork"
git fetch --quiet origin master

# Base branch: fork point, with ONLY the current Council workflow under .github/workflows
# (strip the old snapshot's stale upstream CI).
git checkout --quiet -B "$baseBr" "$fork"
git rm -rq --ignore-unmatch .github/workflows >/dev/null 2>&1 || true
git checkout origin/master -- .github/workflows/council_of_claudes.yml .github/workflows/scripts/council_of_claudes.js
git add -A .github/workflows
git commit --quiet --no-gpg-sign -m "[sample #$N] base: Council workflow only (strip stale upstream CI)"

# Head branch: base + the as-reviewed diff (from the compare API) as a single commit.
git checkout --quiet -B "$headBr" "$baseBr"
if ! git apply --index --whitespace=nowarn "$diffFile"; then
  echo "ERROR: the as-reviewed diff did not apply cleanly onto the base." >&2
  rm -f "$diffFile"; git checkout --quiet "$START_BRANCH"; git branch -D "$baseBr" "$headBr" >/dev/null 2>&1 || true
  exit 1
fi
rm -f "$diffFile"
git commit --quiet --no-gpg-sign -m "[sample] Reproduce $UPREPO#$N as-first-reviewed state

Mirrors the diff the human reviewers first saw on $UPREPO#$N
('$title' by @$author) for the Council of Claudes benchmark.
base(fork)=$fork  head(as-reviewed)=$head"

echo "Reproduced diff stat (should match the upstream as-reviewed diff):"
git --no-pager diff --stat "$baseBr" "$headBr" | tail -3
echo "  PR diff touches .github/workflows (expect 0): $(git diff --name-only "$baseBr" "$headBr" | grep -c '^\.github/workflows/')"
echo "  Council workflow present in head tree (expect 1): $(git ls-tree -r --name-only "$headBr" | grep -c 'workflows/council_of_claudes.yml')"

if [ "$DRY" = "1" ]; then
  echo "DRY_RUN: skipping push & PR; cleaning up local branches."
  git checkout --quiet "$START_BRANCH"
  git branch -D "$baseBr" "$headBr" >/dev/null
  exit 0
fi

echo "Pushing branches to $FORK ..."
git push -f --quiet origin "$baseBr" "$headBr"
git checkout --quiet "$START_BRANCH"

# Idempotent: if a sample PR already exists for this head, the force-push above
# updated it (and fired a synchronize event → Council re-review). Don't re-create.
existingPR=$(gh pr list --repo "$FORK" --head "$headBr" --state open --json number --jq '.[0].number // empty')
if [ -n "$existingPR" ]; then
  echo "PR #$existingPR already exists for $headBr — updated in place; Council re-review triggered."
  echo "  https://github.com/$FORK/pull/$existingPR"
  echo "Done."
  exit 0
fi

echo "Opening PR ..."
gh pr create --repo "$FORK" --base "$baseBr" --head "$headBr" \
  --title "[sample #$N] $title" \
  --body "Benchmark sample reproducing the **as-first-reviewed** state of [$UPREPO#$N](https://github.com/$UPREPO/pull/$N) (by @$author).

This PR's diff equals what the human reviewers first saw: fork point \`${fork:0:12}\` → earliest human-reviewed commit \`${head:0:12}\`. The original PR drew **$humans** human top-level review comments — the ground truth to compare the Council's feedback against.

🤖 Generated for the Council of Claudes benchmark."
echo "Done."