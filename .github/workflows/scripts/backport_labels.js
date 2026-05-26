// Backport-labels gate logic, invoked from backport_labels.yml via
// actions/github-script. See that workflow's header comment for the
// full trust model and architecture.

module.exports = async ({ github, context, core }) => {
  // Step 1: Sync backport labels
  const { owner, repo } = context.repo;
  const headSha = context.payload.workflow_run?.head_sha;

  if (!headSha) {
    core.setFailed('workflow_run payload missing head_sha.');
    return;
  }

  async function withRetry(fn, label) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const transient = (e.status >= 500 && e.status < 600) ||
                          e.status === 429 ||
                          (e.status === 403 && /rate limit|secondary/i.test(e.message || ''));
        if (!transient || attempt === maxAttempts) throw e;
        core.info(`Transient error on ${label} (status=${e.status}); retrying in 2s.`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error(`unreachable: withRetry exited loop without returning (${label})`);
  }

  // Direct lookup by commit SHA. Works for both same-repo and fork PRs;
  // pulls.list with head=OWNER:BRANCH filter only works for fork PRs.
  const prsResp = await withRetry(() => github.rest.repos.listPullRequestsAssociatedWithCommit({
    owner, repo, commit_sha: headSha,
  }), 'listPullRequestsAssociatedWithCommit');
  // Filter to PRs whose head is exactly this SHA (drops PRs that merely
  // contain it as an ancestor) and that are still open. Implicit SHA-drift
  // guard: if the PR was force-pushed since Stage 1 fired, its head.sha
  // moved and this find() returns undefined.
  const pr = prsResp.data.find(p => p.state === 'open' && p.head.sha === headSha);
  if (!pr) {
    core.info(`No open PR with head SHA ${headSha}; nothing to do.`);
    return;
  }

  // "Live" release branch = head commit within the last ~6 months (180 days).
  const branchRe = /^release-v\d+\.\d+$/;
  const backportRe = /^backport\/release-v\d+\.\d+$/;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);
  // GraphQL refPrefix must end in '/', so we narrow with the query
  // parameter (substring match on ref name) and rely on branchRe below
  // to reject ref names like release-v3.30-cherry-pick-9.
  const refsQuery = `query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      refs(refPrefix: "refs/heads/", query: "release-v", first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          name
          target { ... on Commit { committedDate } }
        }
      }
    }
  }`;

  const liveBranches = [];
  let refsCursor = null;
  do {
    const data = await withRetry(() => github.graphql(refsQuery, {
      owner, repo, cursor: refsCursor,
    }), 'graphql:releaseRefs');
    for (const n of data.repository.refs.nodes) {
      if (!branchRe.test(n.name)) continue;
      if (new Date(n.target.committedDate) >= cutoff) {
        liveBranches.push(n.name);
      }
    }
    const pi = data.repository.refs.pageInfo;
    refsCursor = pi.hasNextPage ? pi.endCursor : null;
  } while (refsCursor);
  const expectedLabels = liveBranches.map(b => `backport/${b}`).sort();

  // createLabel is idempotent (422 = already exists / concurrent run).
  // Non-422 failures are warnings; the gate still runs.
  const repoLabels = await github.paginate(github.rest.issues.listLabelsForRepo, {
    owner, repo,
  });
  const existing = new Set(repoLabels.map(l => l.name));
  const missing = expectedLabels.filter(name => !existing.has(name));
  for (const name of missing) {
    try {
      await withRetry(() => github.rest.issues.createLabel({
        owner, repo, name,
        color: '0e8a16',
        description: 'Cherry-pick this PR to the matching release branch.',
      }), `createLabel(${name})`);
      core.info(`Created label: ${name}`);
    } catch (e) {
      if (e.status !== 422) {
        core.warning(`Failed to create label ${name}: ${e.message}`);
      }
    }
  }

  core.info(`Processing PR #${pr.number} (${pr.html_url})`);

  // Step 2: Fetch current PR labels
  const prLabelsResp = await withRetry(() => github.rest.issues.listLabelsOnIssue({
    owner, repo, issue_number: pr.number,
  }), 'listLabelsOnIssue');
  const prLabels = prLabelsResp.data.map(l => l.name);

  // Step 3: Evaluate gate
  const hasNoBackport = prLabels.includes('skip-releases-backport');
  const hasBackport = prLabels.some(n => backportRe.test(n));
  const gatePassed = hasNoBackport || hasBackport;

  // Log the gate state to the action log. The PR author reaches it by
  // clicking "Details" on the validate-backport-labels check. Plain text
  // only; GitHub does not render markdown in action logs.
  core.info('=== Backport Labels Gate ===');
  core.info(`PR:                    #${pr.number} (${pr.html_url})`);
  core.info(`Head SHA:              ${pr.head.sha}`);
  core.info(`PR labels:             ${prLabels.length === 0 ? '(none)' : prLabels.join(', ')}`);
  core.info(`Live backport labels:  ${expectedLabels.join(', ')}`);
  core.info(`Gate:                  ${gatePassed ? 'PASSED' : 'FAILED'}`);
  if (!gatePassed) {
    core.info(`Action needed:         add skip-releases-backport or one of: ${expectedLabels.join(', ')}`);
  }
  core.info('============================');

  // Job summary so the gate result and labels show up directly on the
  // workflow run page (markdown renders here, unlike step logs).
  await core.summary
    .addHeading('Backport Labels Gate', 2)
    .addRaw(`**Result:** ${gatePassed ? 'PASSED' : 'FAILED'}`)
    .addHeading('PR labels', 3)
    .addList(prLabels.length === 0 ? ['(none)'] : prLabels)
    .addHeading('Live backport labels', 3)
    .addList(expectedLabels)
    .addRaw(
      gatePassed
        ? ''
        : '\n_Add `skip-releases-backport` or one of the live backport labels above to pass the gate._'
    )
    .write();

  // Step 4: One-time info comment listing the live backport labels.
  // Posted exactly once per PR; we do NOT update it on label changes (the
  // commit status is the source of truth for the live state).
  try {
    const infoMarker = '<!-- backport-label-bot:info -->';
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: pr.number,
    });
    const alreadyPosted = comments.some(c =>
      c.user && c.user.login === 'github-actions[bot]' &&
      c.body && c.body.startsWith(infoMarker)
    );
    if (!alreadyPosted) {
      const labelLines = expectedLabels.map(n => `  - **\`${n}\`**`).join('\n');
      const body = `${infoMarker}
### Backport labels for this PR

This PR is gated by the \`validate-backport-labels\` check. To satisfy it, add one of:

- **\`skip-releases-backport\`** if no backport is needed
- One of the live release backport labels:
${labelLines}

_This comment is posted once when the PR opens. The current gate state lives on the \`validate-backport-labels\` check below, not here._
`;
      await withRetry(() => github.rest.issues.createComment({
        owner, repo, issue_number: pr.number, body,
      }), 'createComment');
      core.info('Posted one-time info comment.');
    }
  } catch (e) {
    core.warning(`Could not post info comment: ${e.message}`);
  }

  // Step 5: Post commit status for branch protection
  // Branch protection's merge widget reads commit statuses, not check_runs,
  // so we post a status here. Status description is capped at 140 chars by
  // GitHub; the target_url points at this run's log for full detail.
  const description = gatePassed
    ? 'Backport decision recorded.'
    : 'Backport decision missing. See details for the live label list.';
  await withRetry(() => github.rest.repos.createCommitStatus({
    owner, repo,
    sha: pr.head.sha,
    state: gatePassed ? 'success' : 'failure',
    context: 'validate-backport-labels',
    description,
    target_url: `${process.env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  }), 'createCommitStatus');

  core.info(`PR #${pr.number}: live branches=${expectedLabels.length}, gate ${gatePassed ? 'passed' : 'failed'}.`);
};
