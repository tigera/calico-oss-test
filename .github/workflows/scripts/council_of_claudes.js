// Council of Claudes — fan out a PR's diff to persona-based review agents on
// the kagent cluster (agents.tigera.ai) and post each persona's feedback back
// to the PR as a distinct review. Invoked from council_of_claudes.yml via
// actions/github-script.
//
// Each persona is gated on its own *_AGENT_URL / *_AGENT_TOKEN env vars
// (sourced from repo secrets). Any persona whose vars are unset is skipped
// with a warning, so the workflow is usable with only one persona configured.
//
// Agent call contract (verified against tigera/agents-menagerie):
//   POST <url>  with Bearer <token>, JSON-RPC 2.0 method "message/send".
//   Input  -> params.message.parts[0].text
//   Output <- result.artifacts[0].parts[0].text  (markdown)

const PERSONAS = [
  { key: 'correctness',     title: 'Correctness',             urlEnv: 'CORRECTNESS_AGENT_URL',     tokenEnv: 'CORRECTNESS_AGENT_TOKEN' },
  { key: 'maintainability', title: 'Maintainability & Tests', urlEnv: 'MAINTAINABILITY_AGENT_URL', tokenEnv: 'MAINTAINABILITY_AGENT_TOKEN' },
  { key: 'security',        title: 'Security',                urlEnv: 'SECURITY_AGENT_URL',        tokenEnv: 'SECURITY_AGENT_TOKEN' },
];

// Cap the diff we send to keep within model context. Large-PR handling is out
// of scope for the hackathon; oversized diffs are truncated with a note.
const MAX_DIFF_BYTES = 100 * 1024;

// Sanitize agent-controlled text before logging so it cannot inject
// ::workflow-command:: strings into the Actions log (matches the guard in
// cherry_pick_candidate.js).
const safe = s => String(s ?? '').replace(/::/g, ':​:');

// Strip a single markdown fence that wraps the *entire* response, while
// leaving any inner code/suggestion fences intact.
function stripOuterFence(text) {
  const t = (text || '').trim();
  const m = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : t).trim();
}

// Call one persona agent. Returns its markdown review text, or null on failure.
// Up to 3 attempts with 5s/10s backoff (mirrors cherry_pick_candidate.js).
async function callAgent({ core, title, url, token, messageText, msgId }) {
  const payload = {
    jsonrpc: '2.0',
    id: msgId,
    method: 'message/send',
    params: {
      message: {
        messageId: msgId,
        role: 'user',
        parts: [{ kind: 'text', text: messageText }],
      },
      configuration: { acceptedOutputModes: ['application/json', 'text/plain'] },
    },
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
      if (r.ok) {
        const response = await r.json();
        const raw = response.result?.artifacts?.[0]?.parts?.[0]?.text
          ?? response.result?.parts?.[0]?.text
          ?? '';
        return stripOuterFence(raw);
      }
      core.info(`  ${title}: attempt ${attempt} failed (http=${r.status})`);
    } catch (e) {
      core.info(`  ${title}: attempt ${attempt} failed (${e.message})`);
    }
    if (attempt < 3) await new Promise(res => setTimeout(res, attempt * 5000));
  }
  return null;
}

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const pr = context.payload.pull_request;
  if (!pr) {
    core.warning('No pull_request in payload, skipping');
    return;
  }
  const pull_number = pr.number;

  // 1. Determine which personas are actually configured.
  const active = PERSONAS
    .map(p => ({ ...p, url: process.env[p.urlEnv], token: process.env[p.tokenEnv] }))
    .filter(p => {
      if (p.url && p.token) return true;
      core.warning(`${p.title}: ${p.urlEnv}/${p.tokenEnv} not set, skipping persona`);
      return false;
    });
  if (active.length === 0) {
    core.warning('No persona agents configured, nothing to do');
    return;
  }

  // 2. Fetch the unified diff inline (size-guarded).
  const diffResp = await github.rest.pulls.get({
    owner, repo, pull_number, mediaType: { format: 'diff' },
  });
  let diff = diffResp.data;
  let truncated = false;
  if (Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES) {
    diff = diff.slice(0, MAX_DIFF_BYTES);
    truncated = true;
    core.warning(`diff exceeds ${MAX_DIFF_BYTES} bytes, truncated (large-PR handling out of scope)`);
  }

  const messageText =
    `PR #${pull_number}: ${pr.title}\n\n` +
    `Description:\n${pr.body || '(none)'}\n\n` +
    (truncated ? '(NOTE: the diff below was truncated for size.)\n\n' : '') +
    `Unified diff:\n${diff}`;

  // 3. Fan out to all configured personas in parallel; isolate failures.
  core.info(`Reviewing PR #${pull_number} with ${active.length} persona(s): ${active.map(p => p.title).join(', ')}`);
  const results = await Promise.all(active.map(async p => {
    const msgId = `council-${p.key}-${pull_number}-${process.env.GITHUB_RUN_ID}`;
    const review = await callAgent({ core, title: p.title, url: p.url, token: p.token, messageText, msgId });
    if (!review) {
      core.warning(`${p.title}: agent unreachable after 3 attempts, skipping`);
      return null;
    }
    core.info(`${p.title}: received ${review.length} chars of feedback`);
    return { persona: p, review };
  }));

  // 4. Post one PR review per persona that responded.
  let posted = 0;
  for (const res of results) {
    if (!res) continue;
    const body = `### 🤖 Council of Claudes — ${res.persona.title}\n\n${res.review}`;
    try {
      await github.rest.pulls.createReview({
        owner, repo, pull_number, commit_id: pr.head.sha, event: 'COMMENT', body,
      });
      posted++;
      core.info(`${res.persona.title}: review posted`);
    } catch (e) {
      core.warning(`${res.persona.title}: failed to post review (${safe(e.message)})`);
    }
  }
  core.info(`Done: ${posted}/${active.length} persona review(s) posted to PR #${pull_number}`);
};
