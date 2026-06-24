// Unit tests for council_of_claudes.js — run with: node --test
// Zero dependencies (Node's built-in test runner + assert). calico-oss-test only:
// this guards the Council logic during development here; it is NOT cherry-picked
// upstream (see hack/council-of-claudes/README.md "Upstream vs. calico-oss-test only").
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const coc = require(path.join(__dirname, 'council_of_claudes.js'));
const { annotateDiff, parseFindings, parseClusters, applyClusters, stripOuterFence } = coc;

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------
test('stripOuterFence: strips a whole-response markdown fence, keeps inner fences', () => {
  assert.equal(stripOuterFence('```markdown\nhello\n```'), 'hello');
  assert.equal(stripOuterFence('plain text'), 'plain text');
  const inner = 'before\n```go\ncode\n```\nafter';
  assert.equal(stripOuterFence(inner), inner); // not wrapped as a single outer fence
});

test('annotateDiff: numbers new-side lines, builds anchor set, ignores deletes/metadata', () => {
  const diff = [
    'diff --git a/foo.go b/foo.go', '--- a/foo.go', '+++ b/foo.go',
    '@@ -10,2 +10,2 @@', ' ctx', '-gone', '+added', '',
  ].join('\n');
  const { annotated, anchors } = annotateDiff(diff);
  const f = anchors.get('foo.go');
  assert.ok(f.has(10) && f.has(11), 'context + added lines anchorable');
  assert.equal(f.size, 2, 'exactly the two new-side lines'); // deleted line not anchored
  assert.ok(annotated.includes('[L10]') && annotated.includes('[L11]'));
  assert.ok(!annotated.includes('[L12]'), 'trailing blank split element not annotated');
});

test('parseFindings: splits summary from coc-finding anchored findings', () => {
  const text = 'Verdict line.\nmore summary\n\n'
    + '<!-- coc-finding file="a.go" line="5" -->\nFix A.\n\n'
    + '<!-- coc-finding file="b.go" line="9" -->\nFix B.';
  const { summary, findings } = parseFindings(text);
  assert.match(summary, /Verdict line/);
  assert.equal(findings.length, 2);
  assert.deepEqual({ f: findings[0].file, l: findings[0].line }, { f: 'a.go', l: 5 });
  assert.match(findings[0].body, /Fix A\./);
  assert.equal(findings[1].line, 9);
});

test('parseFindings: no markers -> all summary, no findings', () => {
  const { summary, findings } = parseFindings('just a verdict, nothing anchored');
  assert.equal(findings.length, 0);
  assert.equal(summary, 'just a verdict, nothing anchored');
});

test('parseClusters: tolerates fenced / single-line-fenced / prose-wrapped JSON', () => {
  const obj = '{"clusters":[{"survivor":"a","duplicates":["b"],"reason":"x"}]}';
  assert.equal(parseClusters(obj).clusters.length, 1);
  assert.equal(parseClusters('```json\n' + obj + '\n```').clusters.length, 1);
  assert.equal(parseClusters('```json ' + obj + ' ```').clusters.length, 1); // single-line fence
  assert.equal(parseClusters('Here you go:\n' + obj + '\nThanks!').clusters.length, 1);
  assert.equal(parseClusters('sorry, no json'), null);
  assert.equal(parseClusters(''), null);
});

test('applyClusters: drops duplicates, keep-wins, ignores unknown ids, omission=keep', () => {
  const core = { info() {}, warning() {} };
  const allInline = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  // b is a duplicate of survivor a; d is unmentioned (kept); ghost is unknown.
  const parsed = { clusters: [
    { survivor: 'a', duplicates: ['b', 'ghost'], reason: 'r' },
    { survivor: 'd', duplicates: ['a'] }, // a also survives elsewhere -> keep-wins
  ] };
  const drop = applyClusters({ core, allInline, parsed });
  assert.ok(drop.has('b'), 'b dropped');
  assert.ok(!drop.has('a'), 'a kept (keep-wins despite being listed as a duplicate)');
  assert.ok(!drop.has('ghost'), 'unknown id ignored');
  assert.ok(!drop.has('c') && !drop.has('d'), 'unmentioned / survivors kept');
  assert.equal(drop.size, 1);
});

// ----------------------------------------------------------------------------
// End-to-end via the github-script entrypoint (stubbed fetch + github)
// ----------------------------------------------------------------------------
const DIFF = ['diff --git a/foo.go b/foo.go', '--- a/foo.go', '+++ b/foo.go',
  '@@ -10,0 +10,1 @@', '+ten', '@@ -20,0 +20,1 @@', '+twenty', '@@ -30,0 +30,1 @@', '+thirty'].join('\n');
const CORR = 'http://corr', NELL = 'http://nell', ORCH = 'http://orch';
const corrReview = 'V.\n\n<!-- coc-finding file="foo.go" line="10" -->\nuse EqualFold.\n\n<!-- coc-finding file="foo.go" line="20" -->\nNil deref.';
const nellReview = 'F.\n\n<!-- coc-finding file="foo.go" line="10" -->\nEqualFold? case-sensitive.\n\n<!-- coc-finding file="foo.go" line="30" -->\nNaming.';
const CLUSTERS = '{"clusters":[{"survivor":"correctness-0","duplicates":["nelljerram-0"],"reason":"dup"}]}';

// orchOutcomes[attempt-1]: 'good' | 'input-required' | 'failed'  (orchestrator only)
function makeFetch(orchOutcomes) {
  return async (url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.method === 'message/send') return { ok: true, json: async () => ({ result: { id: b.id, status: { state: 'submitted' } } }) };
    if (url === CORR || url === NELL) {
      const text = url === CORR ? corrReview : nellReview;
      return { ok: true, json: async () => ({ result: { status: { state: 'completed' }, artifacts: [{ parts: [{ text }] }] } }) };
    }
    const attempt = parseInt(b.params.id.split('-').pop(), 10);
    const o = (orchOutcomes || [])[attempt - 1] || 'failed';
    if (o === 'good') return { ok: true, json: async () => ({ result: { status: { state: 'completed' }, artifacts: [{ parts: [{ text: CLUSTERS }] }] } }) };
    return { ok: true, json: async () => ({ result: { status: { state: o } } }) };
  };
}

async function runCouncil({ orchConfigured, orchOutcomes }) {
  for (const k of ['CORRECTNESS', 'MAINTAINABILITY', 'SECURITY', 'NELLJERRAM', 'CASEYDAVENPORT', 'ORCHESTRATOR']) {
    delete process.env[`${k}_AGENT_URL`]; delete process.env[`${k}_AGENT_TOKEN`];
  }
  process.env.CORRECTNESS_AGENT_URL = CORR; process.env.CORRECTNESS_AGENT_TOKEN = 't';
  process.env.NELLJERRAM_AGENT_URL = NELL; process.env.NELLJERRAM_AGENT_TOKEN = 't';
  if (orchConfigured) { process.env.ORCHESTRATOR_AGENT_URL = ORCH; process.env.ORCHESTRATOR_AGENT_TOKEN = 't'; }
  process.env.GITHUB_WORKSPACE = '/tmp/coc-nonexistent'; process.env.GITHUB_RUN_ID = '1'; process.env.GITHUB_RUN_ATTEMPT = '1';
  global.fetch = makeFetch(orchOutcomes);
  const posted = [];
  const github = { paginate: async () => [], rest: { pulls: {
    get: async () => ({ data: DIFF }), listReviews: () => {}, listReviewComments: () => {},
    createReviewComment: async (a) => { posted.push(`${a.path}:${a.line}`); },
    deleteReviewComment: async () => {}, createReview: async () => {}, updateReview: async () => {},
  } } };
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { pull_request: { number: 1, title: 't', body: 'b', head: { sha: 's' } } } };
  await coc({ github, context, core: { info() {}, warning() {} } });
  return posted.sort();
}

test('e2e: orchestrator dedups the cross-persona duplicate', async () => {
  const posted = await runCouncil({ orchConfigured: true, orchOutcomes: ['good'] });
  assert.deepEqual(posted, ['foo.go:10', 'foo.go:20', 'foo.go:30']); // nell's line-10 dup dropped
});

test('e2e: input-required is terminal -> fresh-task retry recovers', async () => {
  const posted = await runCouncil({ orchConfigured: true, orchOutcomes: ['input-required', 'good'] });
  assert.deepEqual(posted, ['foo.go:10', 'foo.go:20', 'foo.go:30']);
});

test('e2e: orchestrator unconfigured -> graceful, post everything', async () => {
  const posted = await runCouncil({ orchConfigured: false });
  assert.deepEqual(posted, ['foo.go:10', 'foo.go:10', 'foo.go:20', 'foo.go:30']); // both line-10 comments kept
});
