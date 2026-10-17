# Remote association and recovery proof

Updated: 2026-10-18. **Remote-byte association and one real recovery are proven;
T077 is closed by owner acceptance for the current scope.** Remaining hosted
failure-injection experiments are waived for now, not claimed executed.

## Observed recovery

The tagged inert probe run
[39069849589](https://github.com/Wald764/RDLC-Code/actions/runs/39069849589)
published to GitHub, Marketplace and Open VSX on attempt 1, then failed because
Open VSX's public version endpoint still returned 404 after acknowledging upload.
After visibility caught up, Re-run failed jobs completed attempt 2 successfully.

The retry downloaded original artifact `12114239416`, re-inventoried destinations,
accepted matching remote bytes and skipped the Open VSX upload. Packaging was not
rerun. Probe VSIX SHA-256:
`d2651729b678036d7a2f89c9ec422a32a71bf531162b9c88a7a8c188ea0079a2`.
See [publishing-auth.md](publishing-auth.md) for archive/manifest hashes and the
historical downloads. The probe has since been retired from the registries;
GitHub assets and the evidence remain.

## Production association

Production run
[39075357277](https://github.com/Wald764/RDLC-Code/actions/runs/39075357277)
published `0.1.0` on its first attempt, using artifact `12116543913`. Independent
downloads from GitHub, Marketplace and Open VSX were byte-identical and matched
the original manifest. Open VSX's published checksum and GitHub asset digests
also matched. Canonical VSIX SHA-256:
`13d7ed0be2110f81600615988b45e22eb596b3bdb37ff8b3b05f31503b5127f6`.
Full identities and hashes are in [release-010.md](release-010.md).

## Local coverage and remaining experiments

Release/CLI tests cover explicit VSIX mismatch despite archive warnings,
run/artifact identity, every partial-destination inventory, proven-success no-ops,
unknown/foreign versions, missing provenance, stale attempts, authenticated draft
discovery and delayed registry visibility. These are synthetic tests, not receipts
for hosted injected failures.

Still unrun: injected failures/lost responses at each destination, a concurrent
same-tag experiment, elapsed retention and the entire 30-day/50-attempt rerun
window. The owner accepted T068 and T077–T078 as-is; these gaps remain documented
as optional follow-ups. Open VSX remains configured in owner-selected PAT mode; OIDC is not
a planned requirement for that mode. Unknown versions still fail closed.
