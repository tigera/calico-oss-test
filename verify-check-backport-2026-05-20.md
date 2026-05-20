# Verify check_backport_labels.yml (2026-05-20)

Smoke test for the refactored PR check workflow after merging #126.

Expected:
- Single sticky bot comment appears with the marker
  `<!-- backport-label-bot -->`, listing the `backport/release-vX.Y`
  labels derived from current release branches.
- Initial gate state: fail (no decision label applied).
- Apply `skip-releases-backport` → workflow re-runs on `labeled`
  event → comment updates to "Backport decision recorded." and gate
  flips to passing.
- Remove that label and apply `backport/release-v3.31` → comment
  stays at pass, gate stays passing.
- Remove all backport-related labels → comment goes back to the
  "missing decision" message, gate fails.
- During no-op re-runs (e.g., re-triggering with the same label set),
  the workflow log says "Bot comment unchanged; skipping update to
  avoid notification churn."
