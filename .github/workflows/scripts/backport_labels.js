// Backport-labels gate logic, invoked from backport_labels.yml via
// actions/github-script. See that workflow's header comment for the
// full trust model and architecture.

module.exports = async ({ github, context, core }) => {
  // Step 1: Sync backport labels
  const { owner, repo } = context.repo;
  const wr = context.payload.workflow_run;
  const headSha = wr.head_sha;
  const headBranch = wr.head_branch;
  const headRepoOwner = wr.head_repository?.owner?.login;

  if (!headSha || !headBranch || !headRepoOwner) {
    core.setFailed('workflow_run payload missing head_sha, head_branch, or head_repository.owner.login.');
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

  const prs = await withRetry(() => github.rest.pulls.list({
    owner, repo,
    head: `${headRepoOwner}:${headBranch}`,
    state: 'open',
    per_page: 1,
  }), 'pulls.list');
  const pr = prs.data[0];
  if (!pr) {
    core.info(`No open PR for ${headRepoOwner}:${headBranch}; nothing to do.`);
    return;
  }

  if (pr.head.sha !== headSha) {
    core.info(`SHA drift: workflow_run fired for ${headSha} but PR head is now ${pr.head.sha}; skipping.`);
    return;
  }

  // "Live" release branch = head commit within the last ~6 months (180 days).
  const branchRe = /^release-v\d+\.\d+$/;
  const backportRe = /^backport\/release-v\d+\.\d+$/;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);
  const refsQuery = `query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      refs(refPrefix: "refs/heads/release-v", first: 100, after: $cursor) {
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
  // clicking "Details" on the validate-backport-labels check.
  core.info(`Live backport labels: ${expectedLabels.join(', ')}`);
  core.info(`PR labels: ${prLabels.length === 0 ? '(none)' : prLabels.join(', ')}`);
  core.info(`Gate: ${gatePassed ? 'PASSED' : 'FAILED'}`);
  if (!gatePassed) {
    core.info(`Missing decision. Add: skip-releases-backport or one of: ${expectedLabels.join(', ')}`);
  }

  // Step 4: Post check_run for branch protection
  const inline = expectedLabels.map(n => `\`${n}\``).join(', ');
  const conclusion = gatePassed ? 'success' : 'failure';
  const checkTitle = gatePassed
    ? 'Backport decision recorded'
    : 'Backport decision missing';
  const checkSummary = gatePassed
    ? 'PR carries a valid backport decision label.'
    : `Add \`skip-releases-backport\` or one of the live backport labels. Available: ${inline}.`;
  const checkName = 'validate-backport-labels';
  const checkOutput = { title: checkTitle, summary: checkSummary };
  try {
    const existing = await withRetry(() => github.rest.checks.listForRef({
      owner, repo,
      ref: pr.head.sha,
      check_name: checkName,
    }), 'checks.listForRef');
    const latest = existing.data.check_runs[0];
    const result = { status: 'completed', conclusion, output: checkOutput };
    if (latest) {
      await withRetry(() => github.rest.checks.update({
        owner, repo, check_run_id: latest.id, ...result,
      }), 'checks.update');
    } else {
      await withRetry(() => github.rest.checks.create({
        owner, repo, name: checkName, head_sha: pr.head.sha, ...result,
      }), 'checks.create');
    }
  } catch (e) {
    core.error(`Failed to post check_run: ${e.message}`);
  }

  core.info(`PR #${pr.number}: live branches=${expectedLabels.length}, gate ${gatePassed ? 'passed' : 'failed'}.`);
};
