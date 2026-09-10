// Re-derive the merged PR from a workflow_run head SHA. Stage 2 of a
// workflow_run-driven pick has no PR payload, so it looks the PR up by the
// trigger's head SHA (GitHub-set, trusted) and confirms it merged into the
// expected base branch. Writes step outputs proceed/pr/sha/login to
// $GITHUB_OUTPUT. Reusable by every workflow_run-driven pick/backport flow.
//
// Env:
//   SOURCE_REPO       owner/name the PR lives in.
//   HEAD_SHA          github.event.workflow_run.head_sha.
//   BASE_REF          required base branch (default "master").
//   GH_TOKEN          token for `gh` (set by the caller).
//   RESOLVE_RETRY_MS  retry delay for search-index lag (default 5000).
//   GITHUB_OUTPUT     set by Actions; falls back to stdout for local runs.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const env = process.env;
const SOURCE_REPO = env.SOURCE_REPO || '';
const HEAD_SHA = env.HEAD_SHA || '';
const BASE_REF = env.BASE_REF || 'master';
const RETRY_MS = Number(env.RESOLVE_RETRY_MS ?? 5000);

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function setOutputs(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

function skip(msg) {
  console.log(`::notice::${msg} -- skipping`);
  setOutputs({ proceed: false });
}

// Fork PRs aren't returned by the commits->pulls endpoint, so use the search
// API. Returns the PR number as a string, or "" on miss/error.
function findPr() {
  try {
    return gh([
      'api',
      `search/issues?q=sha:${HEAD_SHA}+repo:${SOURCE_REPO}+is:pr`,
      '--jq', '.items[0].number // empty',
    ]).trim();
  } catch {
    return '';
  }
}

function main() {
  if (!SOURCE_REPO || !HEAD_SHA) {
    skip('SOURCE_REPO or HEAD_SHA unset');
    return;
  }

  let pr = findPr();
  if (!pr) {
    // The search index can lag a few seconds behind a fresh merge; retry once.
    sleepSync(RETRY_MS);
    pr = findPr();
  }
  if (!pr) {
    skip(`no PR found for ${HEAD_SHA}`);
    return;
  }

  let j;
  try {
    j = JSON.parse(gh(['api', `repos/${SOURCE_REPO}/pulls/${pr}`]));
  } catch (e) {
    skip(`could not fetch PR #${pr} (${e.message})`);
    return;
  }

  const merged = j.merged === true;
  const base = j.base && j.base.ref;
  const sha = j.merge_commit_sha;
  const login = (j.user && j.user.login) || '';
  if (!merged || base !== BASE_REF || !sha) {
    skip(`PR #${pr} is not a merged ${BASE_REF} PR`);
    return;
  }

  console.log(`Resolved merged PR #${pr} (merge ${sha})`);
  setOutputs({ proceed: true, pr, sha, login });
}

main();
