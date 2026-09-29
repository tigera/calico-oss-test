# AI-Assisted Cherry-Pick and Backport Automation

**Status:** Draft for review
**Author:** Oleksandr Skoryk
**Reviewers:** Claude org owner / Security, Calico Eng leads
**Decision needed:** Approval to provision a headless-capable Claude credential for CI (see "The Ask")

---

## 1. Summary (TL;DR)

We want a GitHub Actions workflow that automatically reproduces a merged pull request onto other branches or repos (cherry-pick / backport), and uses Claude to resolve the mechanical merge conflicts that today an engineer resolves by hand. It opens a normal pull request that a human still reviews and merges. Nothing is auto-merged.

This is work engineers already do manually, invoking Claude Code on their laptops. The proposal moves that same work into CI so it happens consistently and without a person babysitting a rebase. The only thing it needs that we do not already have is a **Claude credential that is allowed to authenticate in a headless CI runner**, because our Team org enforces device trust and a CI runner is not a trusted device.

## 2. Motivation

Calico ships from multiple long-lived branches across two repos:

- `projectcalico/calico` (OSS)
- `tigera/calico-private` (Enterprise, "EP")

Two recurring, mechanical flows consume engineering time:

1. **OSS to Enterprise pick.** A change merged to OSS `master` often needs to land on EP `master`. Today this is a manual `hack/pick-oss-pr` run plus hand conflict resolution.
2. **Release backports.** A change merged to `master` (OSS or EP) often needs to go onto one or more `release-vX.YY` branches, in the same repo.

The cherry-pick itself is scriptable. The friction is the **conflict resolution**: EP carries enterprise-only scaffolding, release branches have drifted, generated files (for example `confd` golden templates) conflict in bulk. These conflicts follow a small set of well-documented patterns that engineers resolve the same way every time. That repetitive judgement is exactly what Claude already assists with on engineers' laptops today.

## 3. Scope

**In scope**

- OSS `master` PR -> EP `master` (cross-repo cherry-pick).
- OSS `master` PR -> OSS `release-vX.YY` (same-repo backport).
- EP `master` PR -> EP `release-vX.YY` (same-repo backport).
- Automatic resolution of conflicts that match documented patterns only (copyright year, enterprise-only code adjacent to the change, import ordering, generated-file goldens, OSS-vs-EP branding). Anything outside those patterns is NOT auto-resolved.
- Opening a pull request for human review.

**Out of scope (explicitly)**

- No auto-merge. A human reviews and merges every PR.
- No resolution of semantic / logic conflicts. If the conflict is not a known mechanical pattern, the workflow stops and hands off to a human (draft PR + a comment on the source PR).
- No changes to code beyond what the cherry-pick and its conflict resolution require.
- No access to production systems, clusters, customer data, or secrets beyond the two GitHub repos involved.

## 4. How it works

Two parts:

```
  (OSS repo)                         (EP repo, or same repo for backports)
  merge to master  --trigger-->      resolver workflow
                                       |
                                       |-- checkout target repo/branch
                                       |-- add source as a remote, fetch the merge commit
                                       |-- run hack/pick-oss-pr (cherry-pick)
                                       |-- on conflict: Claude resolves KNOWN patterns only
                                       |-- push branch + open PR (labelled, with a resolution report)
                                       v
                                     human reviews + merges
```

- **Trigger:** a lightweight workflow fires on a merged `master` PR and dispatches the resolver with the PR number and merge SHA. (For backports it can also be run on demand with a target branch.)
- **Resolver:** runs `hack/pick-oss-pr` (our existing, human-authored script). If the cherry-pick is clean, it just opens the PR. If it conflicts, Claude is invoked with a tightly scoped prompt and the `pick-oss-pr` skill, and is constrained to the documented resolution patterns. On anything ambiguous it aborts, opens a draft PR with the conflict markers intact, and comments on the source PR so a human picks it up.
- **Output:** a normal PR, labelled (for example `merge-oss-cherry-pick`, `auto-resolved-conflict`), containing a machine-readable resolution report listing each conflicted file and how it was resolved.

A working prototype of the resolver already exists and runs green in a test repo (`tigera/calico-enterprise-test`). The only piece blocking a production run is the credential (section 6).

## 5. Guardrails and safety

- **Human in the loop, always.** No auto-merge. Every change is a reviewable PR.
- **Bounded autonomy.** Claude is restricted to a fixed tool set (git, file read/edit) and to documented conflict patterns. Non-matching conflicts are never guessed; they are handed off.
- **Fail safe, not fail open.** On any uncertainty the workflow stops and produces a draft PR plus a human ping. It never force-resolves.
- **Idempotent.** If a pick already exists, it is a no-op. It cannot spam duplicate PRs.
- **Least privilege.** The workflow touches only the specific source and target repos. It does not need org-wide access.
- **Auditable.** Every run is a GitHub Actions log; every change is a commit and a PR with a resolution report. Prompt-injection surface (PR titles/bodies) is passed as data, never as instructions.

## 6. Credentials and permissions (the security-relevant part)

The workflow needs two kinds of credential:

1. **GitHub write access** to the target repo (to push a branch and open a PR). This uses an existing bot identity (for example the marvin bot) or a scoped GitHub App. No new standing access is required; this is the same identity that already opens automated PRs.

2. **A Claude credential that authenticates in a headless CI runner.** This is the one thing we do not have today.

**Why the blocker exists:** our Claude **Team** org enforces device trust. A token minted from a Team account only validates on a registered trusted device. A CI runner is a fresh, untrusted machine, so the token is rejected with:

> Unable to verify organization for the current authentication token. This machine requires organization `d3453e13-...` but the token could not be validated.

This is working as intended for interactive laptop use; it simply blocks unattended CI. We need one credential that is exempt from device trust for this automation. Options, any one of which unblocks us:

- **(a) An Anthropic API key** issued for a workspace/service in our org. Standard CI pattern, not device-bound. (Note: the API Console is currently IT-restricted for the `tigera.io` domain, so this requires the org owner to enable it or issue the key.)
- **(b) A dedicated automation/service account** in the Claude org, or a device-trust exemption, from which a long-lived headless token can be generated.
- **(c) Bedrock or Vertex access.** If we run Claude through AWS Bedrock or GCP Vertex, CI authenticates via cloud IAM (GitHub OIDC) with no Anthropic token at all. Highest security bar, most setup.

Recommendation: **(a)** for speed, or **(c)** if we prefer no standing secret.

## 7. Cost and usage impact

Expected to be approximately **net-neutral**, not net-new spend:

- Engineers already run these picks and backports by hand, invoking Claude Code on their laptops against the same org plan. This automation moves that existing usage into CI; it does not create a new class of consumption.
- Each run is bounded (a single conflict-resolution task, capped turns). Volume is gated by how many PRs actually need picking/backporting, which is the same population engineers handle manually today.
- If desired, we can pin a specific model tier and cap per-run turns to make the ceiling explicit, and we can report per-run token usage in the workflow summary for visibility.

## 8. Auditability and observability

- Every run: a GitHub Actions log, retained per repo policy.
- Every change: a commit authored by the bot identity and a PR with a resolution report (which files, which pattern, what changed).
- Labels let downstream automation and humans filter AI-resolved PRs for extra scrutiny.

## 9. Rollout plan

1. **Phase 0 (done):** prototype resolver proven in test repos.
2. **Phase 1:** enable on the OSS -> EP `master` pick, credential permitting, in a low-risk window, watched.
3. **Phase 2:** extend to release backports (OSS and EP), one repo at a time.
4. **Review:** after N real PRs, review resolution quality and the human-handoff rate before widening.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong conflict resolution lands | No auto-merge; human reviews; resolution report highlights every change; restricted to documented patterns |
| Prompt injection via PR text | PR title/body passed as data via env, never interpolated into instructions |
| Credential misuse | Scoped to the two repos; Claude credential is for model access only, no GitHub scope; standard secret handling |
| Runaway usage | Capped turns per run; volume bounded by real pick/backport demand; usage reported per run |
| Bypassing org device trust | We are NOT exfiltrating device tokens; we are requesting a sanctioned headless credential through the org owner |

## 11. Decisions requested

1. Approve the concept (human-reviewed, bounded, net-neutral automation).
2. Choose the Claude credential path: **(a) API key**, **(b) service account / device-trust exemption**, or **(c) Bedrock/Vertex**.
3. Confirm the bot GitHub identity to use for opening PRs.
