# Remote association and recovery proof

Date: 2026-10-17. Status: **unrun**; V10 / T077 remains incomplete.

Local tests cover exact VSIX digest verification independent of archive warnings,
run/artifact identity, destination inventory, partial success at every stage,
proven-success reuse, missing proof, unknown existing-version conflicts and
30-day/50-attempt limits. They supply synthetic inventories, not registry receipts.

Before enabling real recovery, use a controlled repository and publisher to
inject each destination failure and a lost publish response. Record immutable
artifact ID/run/manifest/digest, authenticated inventory observations, confirmed
success association and failed-job reuse without rebuild. Establish reliable
prior acknowledged Marketplace publication bound to the canonical digest, or
prove exact bytes through a supported remote endpoint. No unchanged Marketplace
download or undocumented checksum API is assumed. Unknown versions must conflict.
Open VSX is not configured; repeat applicable tests if it is configured later.
Same-tag exclusion and durable retention still require workflow-level proof.
