# Council of Claudes — Review-Quality & Orchestrator Design

> Design doc for the orchestrator (review-quality pass). Scoped to that work; broader
> Council history lives in the team's separate working notes.
> Status: **design complete — all 9 open questions resolved (2026-06-21); implemented in
> the orchestrator PR.** Created 2026-06-19. See "Resolved design at a glance (v1)" and
> the Decisions log below.

## Context — why we're doing this
Team members reviewed the Council's output on real (duplicated) PRs and gave feedback:
the reviews have **real value**, but two problems hurt signal-to-noise:
1. **Redundancy** — multiple personas make the same core point in slightly different words.
2. **Too many low-value / nit-pick comments** — especially Maintainability & Tests, and to a
   lesser extent the human personas (Nell, Casey).

Decision: do a quality pass on the system **before** moving it upstream to Project Calico and
deploying for real. Two improvement levers (below): an **orchestrator agent** + **persona prompt
tweaks**.

## Evidence — ground truth from PRs #218, #200, #201
We analyzed the Council's comments **and the human reviewers' replies on those threads** (the
human replies are ground-truth labels for which comments landed).

**Sample-size caveat:** #200 is richly labeled (16 human replies), #218 partial (9), #201 nearly
silent (3 replies to 38 comments — low engagement is itself a fatigue signal). Conclusions lean on
#200/#218.

**Per-persona scorecard (human-engaged comments):**

| Persona | Validated 👍 | Rejected 👎 | Neutral | Read |
|---|---|---|---|---|
| 🔎 Correctness | 3 | 0 | 0 | 100% hit when engaged — the franchise; protect |
| 🛡️ Security | 1 | 0 | 0 | valued ("makes the developer think"); protect |
| 🧪 Maintainability & Tests | 3 | 5 | 1 | only net-negative persona |
| Nell | 2 | 1 | 2 | mixed |
| Casey | 3 | 2 | 1 | mixed |

**Key findings:**
- **Redundancy is the #1 irritant — proven.** On #200 one flaky-timing issue drew ~6 near-identical
  comments; the reviewer validated the first then tagged the rest *"same as above," "also is
  duplicate," "feels 3 comments about the same issue."*
- **Maintainability's test/comment-padding is the worst offender.** Every "add a unit test / add a
  comment / make it injectable" was declined: *"too many tests is overkill," "don't want to be too
  verbose," "this is not required," "not an issue."*
- **Persona fidelity is itself a rejection axis.** Humans rejected Casey/Nell nits with *"I don't
  think Nell would add such a comment 😄"* / *"I don't think Casey would add this."* → the simulated
  personas are currently **more nit-picky than their real namesakes**.
- **Don't blanket-drop nits.** A genuinely useful efficiency nit (Casey: "store `netip.Addr` instead
  of re-parsing") earned *"good point."* Rejection tracks the **type** (cosmetic / test-padding),
  not the "nit" label → filter on **value (changes behavior/cost?)**, not on smallness.
- **No substantive comment was ever rejected.** False-positive risk lives entirely in nits +
  test/comment padding, not in Correctness/Security.
- **Volume suppresses engagement.** 38-comment PR → ~0 replies; 17-comment PR → 16 replies. Fewer,
  deduped, higher-confidence comments → more engagement. Volume reduction is itself a goal.

## Goals
- Cut redundant + low-value inline volume **roughly in half** while losing **~no substantive
  findings**.
- Preserve the multi-voice demo value (distinct personas, incl. Nell/Casey avatars).
- Keep Correctness/Security untouched (they're clean).

## Lever 1 — Orchestrator agent (the centerpiece; needs design)
An "intelligence layer" agent that sits in front of / after the individual review agents. Initial
purpose: **dedupe + value-filter** the combined output. Long-term: a place to add cross-cutting
review intelligence.

**Where it fits (proposed):** the workflow already fans out to personas in parallel and **collects
all findings before posting** (`council_of_claudes.js`). Insert the orchestrator between collection
and posting:
> fan out → collect all findings → **orchestrator: keep/drop + dedupe** → post survivors, still
> attributed to their original personas (preserves Nell/Casey voices).

**My recommendations so far (to validate together):**
- **Conservative:** only remove clear cross-persona duplicates + clear low-value; when unsure, keep.
- **Value-based nit filter, not label-based** (a good efficiency nit is keepable).
- **Preserve per-persona attribution:** for a duplicate cluster, keep the single best/highest-authority
  instance (Correctness/Security own bugs) and drop the rest.
- **Graceful degradation:** if the orchestrator errors/times out, post everything unfiltered — never
  lose a review.

**Token/context budget (addresses the "will it fit?" concern):**
- Per-PR persona comment text ≈ **6–10K tokens** (measured across the 3 PRs).
- Diff (capped at 100 KB) ≈ **~25K tokens**.
- gpt-5 context ~200K+; kagent request limit 4 MiB → even **diff + all comments (~35K) fits**.
- **But the orchestrator likely doesn't need the full diff.** For deduping, the comments carry their
  own context (`file:line` + finding text). → **Start "comments-only" (~6–10K tokens)**; if it needs
  code context to judge "misses the mark," feed only the **specific hunks** the comments anchor to.

## Lever 2 — Persona prompt tweaks (companion)
- **Maintainability & Tests (highest priority):** hard-gate test suggestions — only when the change
  introduces untested branching/regression-prone logic **not already covered** in this PR; never for
  mechanical/plumbing changes or FV/E2E-covered paths. Consolidate "duplicated in A and B" into one
  comment; demote doc/comment asks to the summary.
- **Nell / Casey:** recalibrate toward their **real namesakes' substance-first style** (the ground
  truth says they over-nitpick vs. the real people). This revises the earlier "leave them alone, let
  the orchestrator filter" idea — do both.
- **Correctness / Security:** leave as-is. Optional **lane discipline** nudge across personas —
  each reviews through its *own lens* and shouldn't re-raise what's clearly another lens's domain
  (e.g. a compile error / race is Correctness's lane). This reduces redundancy at the source
  *without* asserting any persona is "more authoritative" (see vNext — authority is deliberately
  open).

## Open design questions (agenda for tonight)
1. **Orchestrator input scope:** comments-only vs. comments + anchored hunks vs. comments + full diff?
   (Lean toward comments-only to start.)
2. **Responsibilities:** dedup only, or dedup + value-filter? Does it also re-rank / cap volume?
3. **Output schema:** how does it return verdicts so the GHA can act deterministically? (e.g. per-comment
   `keep|drop` + reason, plus dedup groupings with a chosen survivor.)
4. **Attribution model:** keep survivors under original personas (recommended) vs. a single consolidated
   "Council" review?
5. **Where it runs:** a new kagent persona/agent called by the GHA, gated on its own secret (like the others)?
6. **Failure handling:** confirm "post unfiltered on orchestrator failure."
7. **How aggressive:** target volume / confidence threshold; risk of over-filtering substantive items.
8. **Interaction with Lever 2:** how much to fix at the source (prompts) vs. downstream (orchestrator).
9. **Benchmark:** re-run the 3 sample PRs through the new pipeline and compare to the human ground truth
   (this is also the seed of the regression-suite idea).

## Guiding principle
This is a **multi-agent** system, not a monolith. Keep responsibility/control/complexity
distributed; resist concentrating judgement in any single agent (including the orchestrator).
A division of labour between agents *is* the architecture — so the orchestrator does one thing
well rather than becoming a single point of complexity/failure.

## Decisions log

### Q2 — Responsibilities → **dedup only**
The orchestrator's single job is to eliminate **redundant** comments (cross-persona, and within a
persona). It does **not** value-judge / nit-filter as a primary responsibility — that stays with
the individual personas (see Q8). Keeps the orchestrator simple, low-token, low-risk, and avoids a
single point of complexity. (Open: a *conservative* "drop obvious junk" backstop — TBD, leaning no
for v1 to keep the job pure.)

### Q8 — Division of labour (source vs. orchestrator) → **strict split**
- **Orchestrator:** dedup only — the one problem that is *structurally* unfixable at the source
  (no persona can see the others' output).
- **Persona prompts (Lever 2):** own everything else — nit/volume reduction by value-judgement
  (esp. Maintainability & Tests), and Nell/Casey fidelity to their real namesakes' substance-first
  style. Each persona is improved standalone.
The orchestrator fixes nothing except redundancy; all other quality control lives in the personas.

### Q5 — Where it runs → **new kagent agent, gated on its own secret**
A new gpt-5 kagent agent (`ORCHESTRATOR_AGENT_URL` / `_TOKEN`), called from
`council_of_claudes.js` after all personas return and before posting, using the existing async
submit+poll pattern. If the secret is unset → skip orchestration and post everything (consistent
with persona gating). Cost: one extra serial async generation (~1–2 min) at the end.
Dedup must be **semantic** (same point, different words) → needs an LLM, not fuzzy text matching.
(Future optimization: a cheap exact-match prefilter in code before the LLM call.)

### Q1 — Input scope → **comments-only; all inline comments from all personas**
The orchestrator receives a list of findings, each `{id, persona, file, line, body}` — **no diff**
(dedup needs only the finding text + location). 
- **(A) Inline comments only for v1**; persona summaries pass through untouched (a summary is a
  paragraph that can't be partially dropped without rewriting). *Future:* have personas emit
  summaries as discrete bullet-point sections so the orchestrator can drop whole sections by
  reference (no rewrite) — same decisions-only principle.
- **(B) Dedup the entire combined set — cross-persona AND within-persona.** Redundancy is the
  orchestrator's job regardless of source; within-persona dedup is a safety net in case a persona
  fails to self-consolidate (Lever 2 still asks personas to self-consolidate; this backstops it).

### Q3 — Output schema → **clusters of duplicates only; omission = keep**
The orchestrator returns **decisions only, never rewritten comment bodies** (the JS holds the real
comment objects + persona markers and applies decisions — no rewrite, no hallucination risk):
```json
{ "clusters": [ { "survivor": "<id>", "duplicates": ["<id>", ...], "reason": "<one line>" } ] }
```
The JS keeps every `survivor`, keeps every id **not mentioned anywhere** (safe default), and drops
only the listed `duplicates`. Properties: compact (unique findings need zero output); an orchestrator
omission/partial result degrades to *less dedup*, never a lost finding; defensive JS validation —
ignore unknown/hallucinated ids, and if an id is both a survivor and a duplicate, **keep wins**.

### Q4 — Survivor selection → **clarity-first, regardless of persona**
A dedup cluster contains comments making the *same point* (they agree), so survivor selection is
purely about phrasing, not correctness → **keep the single clearest, most actionable instance**,
regardless of which persona authored it (best wording = best understanding for the human author).
The survivor **keeps its original persona identity/avatar/marker** (no merging into a generic
"Council" voice — preserves the Nell/Casey voices). No authority/pecking-order is used (see vNext).

### Q6 — Failure handling → **graceful degradation (post all)**
If the orchestrator errors, times out (exceeds the poll window), returns unparseable JSON, **or is
not configured** (secret unset) → log a warning and **post all comments unfiltered**. The
orchestrator runs after collection, so the full comment set is always in hand → fallback is trivial
and lossless. Never lose a review.

### Q7 — Aggressiveness → **conservative clustering, no hard cap**
- **No hard volume cap** in v1 — dedup + Lever-2 source reductions cut volume organically; a numeric
  cap reintroduces the risk of dropping a *substantive* comment to hit a number. Measure after the
  benchmark; add a cap only if still needed.
- **Tune against over-merging:** cluster only when the underlying issue **and** the suggested fix are
  essentially the same (same actionable point, different wording / ±a line or two). NOT duplicates:
  same file/function/topic but different issues; a general point vs. a specific instance. Prompt
  biases toward **leaving comments separate when unsure** — second safeguard alongside omission=keep.

### Q9 — Benchmark / validation → **fresh duplicate PRs vs. labeled baseline**
Validate the new pipeline on the 3 sample PRs (#218/#200/#201) by generating **fresh** duplicate
PRs (new branches, e.g. a `-v2` suffix) so the existing PRs — which carry the old Council comments
**and the human-reply ground truth** — stay intact as the labeled baseline. Score the new run
against the existing human labels on three criteria:
1. **Orchestrator:** the redundant clusters humans complained about collapse to one (e.g. #200
   flaky-timing 6→1, #218 unused-macro 3→1); no non-duplicate is dropped.
2. **Lever-2:** comments humans *rejected* shrink (Maintainability "add a test"; Nell/Casey off-
   persona nits).
3. **Both:** comments humans *validated* survive (the race, case-sensitivity, int64→int32 truncation).

Generalized methodology (for every future change): **fresh duplicate PRs → compare to a baseline**
(a prior iteration now; a permanent labeled set eventually). Full regression suite = out of scope
(tracked separately as future work); this is a lightweight one-time before/after for now.

## Eval tooling (decided 2026-06-23)
`eval-benchmark-pr.py` becomes a **two-iteration comparison**: `eval-benchmark-pr.py <prA> <prB>`
compares the Council's inline comments on two duplicate PRs of the same original (e.g. v1 #218 vs
v2 #238).
- **Matching = location-based (option A): `(persona, file, line)`.** Both PRs reproduce the same
  diff, so line numbers align. Deterministic / no evaluator variance (important for a tracked
  metric); labeled honestly as a location match. Semantic (LLM) matching deferred to the scoring
  phase.
- **Metrics:** total per PR, shared (matched), only-in-A, only-in-B — overall and **per persona
  (same-persona only)**.
- **Caveat:** comparing two stochastic runs conflates the real change (e.g. orchestrator) with
  gpt-5 run-to-run variance. For the *orchestrator specifically*, the cleanest signal is its own
  `keep/drop` decisions in the v2 Actions log.

## Human-in-the-loop quality scoring (FUTURE — own design discussion)
The true success metric is human judgement ("is this comment valuable?"), since automated diffs
measure *what changed*, not *better/worse*. Plan: humans mark each Council comment good/bad and we
track good-rate across iterations → the basis for the eventual **single score**
(e.g. `good/(good+bad)`). Make it cheap: **capture labels as GitHub 👍/👎 reactions** (one click,
machine-readable) and only label the **changed** comments (the diff tool's only-in-A/only-in-B
sets) since stable comments keep prior labels. Downside: human bandwidth. Refine later (same
labelers, blind to which iteration, etc.). This is the path to the single numeric score.

## Iteration 1 results — orchestrator (2026-06-24) ✅ VALIDATED
Eval method: orchestrator's own keep/drop decisions (Actions log) on three v2 PRs (orchestrator on
claude-opus-4-8; personas on gpt-5, matching the labeled baselines). The v1-vs-v2 *diff* is
variance-dominated (#218↔#238 shared only 6 of 35/24; #200→#240 even went +6), so the keep/drop log
is the trustworthy attribution signal — not the diff.

| v2 PR | input → posted | dropped | reduction |
|---|---|---|---|
| #238 (calico#12602) | 32 → 24 | 8 | 25% |
| #241 (calico#12451) | 42 → 23 | 19 | 45% |
| #240 (calico#12960) | 23 → 13 | 10 | 43% |
| **total** | **97 → 60** | **37** | **~38%** |

**~38% of inline volume removed as redundant, with substantive findings preserved.** Each dropped
cluster is one coherent point that 2–4 *different* personas independently raised — exactly the
multi-persona redundancy the team complained about. Representative collapses:
- #241 case-sensitivity (`EqualFold`): keep Casey, drop Correctness + Nell (3→1).
- #241 duplicated docker helper: keep Nell, drop Maintainability ×2 + Nell (4→1).
- #238 connlimit double-decrement race: keep Security, drop Correctness + Nell (3→1).
- #240 racy `Eventually`: keep Casey, drop Correctness + Maintainability (3→1).
- Within-persona too: #241 copyright-year nit — Maintainability said it 4×, collapsed to 1.

Survivor selection behaves as designed (clarity-first): keeps Security/Correctness for genuine
bug/security points (e.g. #240 interval-bound → Security; #241 AllowedUses → Security), human voices
elsewhere. **One cross-lens merge to human-spot-check:** #240 `keep maintainability-3, drop
security-2` (ticker/clock vs manual `time.Since`) — plausibly the same point, but dropping a
Security-authored comment is exactly what the future human-labeling loop should verify.

**Operational notes:** #240 hung the orchestrator on three earlier runs (~20:10–00:58) but completed
first-attempt at 02:05 → looks like transient kagent load, not payload (its input was the *smallest*
of the three). Fixes shipped along the way: job `timeout-minutes` 15→30 (#242); orchestrator
fresh-task retry + richer error diagnostics + RUN_ATTEMPT-in-msgId (#244).

**Verdict: orchestrator iteration validated.** Next: Lever-2 persona-prompt tweaks (gate
Maintainability's reflexive test-asks; recalibrate Nell/Casey toward their real substance-first
style), evaluated the same way against these v2 PRs as the new baseline.

## Iteration 2 (Lever-2 persona prompts) — PRELIMINARY (2026-06-24)
**Caveat: a single PR pair, one run each — directional only, not definitive.** An `ITER` mix-up
left only **calico#12602** comparable: v2 #238 (orchestrator-only) vs v3 #247 (+ Lever-2 prompts).
Personas gpt-5 and the orchestrator active in *both*, so this isolates Lever-2 (modulo run-to-run
variance). The original v2 results for #240/#241 remain recorded under "Iteration 1 results" above,
even though those PRs' *comments* were overwritten by the mix-up.

Volume was flat (v2 24 posted / v3 26; orchestrator dedup steady 8/32 → 7/33) — the right lens is
**composition**, which shifted as intended:
- **Maintainability & Tests — clear win:** reflexive "add a unit test" asks went **3 → 0**, replaced
  by substantive findings (dedup, mutable-snapshot return, magic-number cadence, dead-code macro,
  flaky 12s sleep).
- **Casey — voice/focus recalibrated (validates `casey-report.html`):** naming feedback appeared
  (his real #1, absent in v2); the "I am a little bit skeptical" catchphrase (1-in-3,800 in real
  data) disappeared — skepticism now arrives as questions; briefer, with escape hatches; no cosmetic
  nits. Count rose 8→15 but higher-signal (caught a real `range`-over-int compile bug ×4 + naming).
- **Nell — little change here:** already substantive in v2; this PR didn't elicit the bare
  intent-check behavior we targeted (will show on PRs that previously triggered it).
- **No loss of substance** — v3 arguably found *more* real bugs (compile error, RST tail-call paths),
  partly variance.

Next: the authoritative test — the **real Nell & Casey** judging their own simulated voices on PRs
they pick (planned 2026-06-25).

## Orchestrator `input-required` hang — root cause (diagnostics win) + fix
The earlier #240 "hangs" were diagnosed via the new poll logging:
`task did not complete within 420s (last state: input-required, 82 polls ok, 0 poll errors)`. The
orchestrator task occasionally lands in the A2A **`input-required`** state — the agent asks for a
follow-up instead of returning the clusters JSON. Our poll loop only treated
completed/failed/canceled/rejected as terminal, so it polled the full budget and gave up. A2A states
come from the kagent runtime (menagerie just proxies); in our **fire-and-forget** usage we never send
the follow-up, so an `input-required` task never progresses. It's sampling nondeterminism, not
input-specific. **Fix (separate PR):** treat `input-required` / `auth-required` as terminal in
`reviewWithAgent` → fail fast so the fresh-task retry fires in seconds; and tell the orchestrator
prompt to never ask for input (always return JSON, `{clusters:[]}` if unsure).

## Resolved design at a glance (v1)
End-to-end flow:
1. Personas (with **Lever-2** prompt tweaks) review the PR in parallel as today → inline comments + summaries.
2. `council_of_claudes.js` collects all inline comments, assigns each a stable `id`, builds `[{id, persona, file, line, body}]`.
3. If `ORCHESTRATOR_AGENT_URL/_TOKEN` set → call the orchestrator kagent agent (async submit+poll), **comments-only, no diff**.
4. Orchestrator returns `{clusters:[{survivor, duplicates[], reason}]}` (dedup only; clarity-first survivor; original persona kept).
5. JS applies: keep survivors + all unmentioned ids; drop listed duplicates; ignore unknown ids; keep-wins on conflict.
6. Post surviving inline comments under their original personas; summaries posted as-is (untouched in v1).
7. **Any** orchestrator failure / unset secret → post everything unfiltered.

Plus **Lever 2** (persona prompts, parallel work): Maintainability test-gating; Nell/Casey fidelity recalibration; cross-persona lane-discipline nudge.

Build order (revised 2026-06-21): ship the two levers as **separate iterations** to isolate
variables in a human-judged (noisy) evaluation — clean A→B→C progression: *current baseline →
+orchestrator → +Lever-2*, each step independently attributable.
1. **Orchestrator first** (the heavier change; front-loaded for early team evaluation/buy-in).
   Cleanly evaluable on its own axis ("did redundancy collapse?"), and stress-tests dedup against
   the personas' full, un-reduced redundancy.
2. **Validate** via fresh duplicate PRs vs. the labeled baseline (Q9).
3. **Then Lever-2** persona tweaks as a second iteration; re-validate against the orchestrator-only baseline.

Team-eval framing for iteration 1: this targets **redundancy only** — nit-noise (Maintainability
test-padding, Nell/Casey nits) is still present and is the *separate, planned* Lever-2 change. Ask
reviewers specifically: "are the duplicate comments gone?"

## Evaluation: LLM variance (methodology note)
The pipeline is stochastic, so two duplicate PRs of the same original (X-1, X-2) on the *same*
system version will differ. Expected shape: **substantive findings are largely stable** run-to-run;
**the nit/marginal tail is where variance lives** (and wording always differs → compare
*semantically*, never exact-text). Accounting for it:
1. **Measure the noise floor** — run the same version twice (X-1/X-2) as a control to see how big an
   improvement must be to beat noise.
2. **Score against stable human labels**, not run-to-run (comparing a stochastic output to a fixed
   reference is far more robust).
3. **Lower temperature** for eval runs if the kagent ModelConfig exposes it (cluster-side knob, like
   model choice) → more reproducible regression runs.
4. **Average over multiple runs / more PRs.**
5. **The orchestrator is relatively variance-robust to evaluate** — it dedupes *whatever* the
   personas emit, so its effect self-normalizes against persona variance. (Persona-prompt tweaks —
   iteration 2 — are harder: the change and the noise share an axis. Another reason orchestrator-first.)
These become core requirements of the eventual regression suite.

## Tooling: iteration suffix (DONE — PR #229)
`gen-benchmark-pr.sh` now takes an optional `ITER` label: `ITER=v2 ./gen-benchmark-pr.sh <N>` →
`coc-sample-<N>-v2-*` branches + a `[v2]` PR title tag. Lets fresh duplicates coexist with the
labeled baselines (which key on the unsuffixed `coc-sample-<N>-*`). Empty by default (unchanged).

## Model isolation (decided 2026-06-22)
The kagent cluster moved environments and now offers more models. To keep the orchestrator's effect
**cleanly isolated** (the whole reason for shipping it as its own iteration):
- **Personas stay on `gpt-5`** for this evaluation — matching the labeled baselines (#218/#200/#201),
  which were generated with gpt-5 personas. So baseline → new-run changes *only* the orchestrator.
- **Orchestrator runs on `claude-opus-4-8`** — fine, because it's a brand-new component (not a changed
  variable relative to baseline), and opus suits the semantic dedup judgement. Only `orchestrator.md`
  carries the opus model ref; the 5 persona docs stay `gpt-5`.
- **Persona model upgrade (gpt-5 → claude-opus-4-8) becomes its own future iteration**, measured
  separately (flip the persona docs then). Same variable-isolation discipline.

## Evaluation method (orchestrator iteration)
- **Primary — the orchestrator's own keep/drop decisions** (variance-immune, no model confound): from
  the Actions log (`keep X, drop [Y,Z] — reason`), judge precision (were dropped comments genuine
  duplicates of the survivor?), the failure mode (did any non-duplicate get dropped?), and recall
  (obvious duplicates it missed?).
- **Secondary — gpt-5-matched baseline cross-check:** since personas match the baselines' model, verify
  the *specific* duplicate complaints humans made (e.g. #200 flaky-timing "same as above" ×5) collapse.

## vNext / out of scope (revisit later)
- **Persona authority hierarchy / agents reviewing or debating each other's comments.** Considered
  and deliberately deferred: adds a layer of complexity and unclear value to the human author.
  Authority is irrelevant to dedup (a cluster already agrees); it would only matter for
  *conflicting-judgment* resolution. Concrete-but-informal observation for now: Correctness &
  Security have empirically produced the most reliable/actionable comments — but we are **not**
  encoding any formal precedence in v1.
- **Summary-review dedup** via structured bullet-point sections (see Q1-A).
- **Exact-match prefilter in code** before the LLM dedup call (Q5 optimization).
- **Benchmark methodology shift → Council-vs-Council (post-upstreaming rethink).** Phase 1 ends when
  this system merges into the Project Calico monorepo. After that, the anticipated workflow:
  (1) the Council runs *live* in Project Calico; (2) future review-system changes are developed/tested
  in `calico-oss-test` first, then cherry-picked upstream; (3) `gen-benchmark-pr.sh` reproduces PRs to
  compare the **live** Council against the **in-development** Council. So the benchmark's basis shifts
  from *human-vs-Council* to *version-vs-version (Council-vs-Council)*. Implications to revisit then:
  `gen-benchmark-pr.sh` re-scoped (the as-first-reviewed mode is tied to the sunsetting
  human-vs-Council comparison; full-diff likely becomes the norm); inputs must be apples-to-apples
  across versions (a `FULL`/consistent-mode control may then be worth adding — deliberately deferred
  now as YAGNI); and `eval-benchmark-pr.py` (already a two-iteration diff) becomes the core tool.
