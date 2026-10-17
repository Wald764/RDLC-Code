# Performance, keyboard and usability acceptance

Updated: 2026-10-18. The maintainer reports keyboard and performance checks as
satisfactory. Detailed timing records and the five-author study below are optional
for the initial release, by explicit owner decision. No timed measurements or
participant results are claimed. The procedures remain available for future use;
keyboard accessibility and automated source-budget tests remain required.
T063 is complete for that approved scope: candidate/release automated checks
passed and the owner confirmed the functional and keyboard walkthrough. Optional
protocols below do not imply actual measurements or five-author participation.

## SC-004 measurement protocol

1. Record the version-prepared candidate SHA, VSIX SHA-256, Node/pnpm/Angular/
   TypeScript versions, VS Code/Electron version, OS, CPU, RAM, storage, display
   scaling/refresh rate and power mode. Use an isolated profile and installed VSIX.
2. Prepare a synthetic supported report containing exactly 100 editable body
   textboxes and 1,048,576 UTF-8 bytes. Pad only an XML comment, never data that
   changes the editable profile. Record its digest, provenance and textbox count.
3. Keep VS Code running. Close the report editor before each of 20 opens. Each
   open must create a fresh webview, not reveal a retained editor. Measure from
   the open command to the first painted accepted snapshot whose supported
   property controls are enabled. Use browser tracing or a recording with
   timestamps that shows the command and paint, including the enabled controls.
   Host parse time and a ready/snapshot message alone are not this boundary.
4. Make 100 valid, distinct property commits. Measure commit to the corresponding
   painted accepted document change, including host roundtrip and paint. Do not
   measure optimistic drafts or rejected/stale operations. Retain all samples.
5. At least 19/20 opens must be <=3,000 ms and 95/100 interactions <=200 ms.
   Report slow and failed samples. Do not replace or drop them. Investigate before
   tuning parser budgets; never weaken preservation or source access.

`tests/performance/editor.test.ts` verifies the record validator with synthetic
boundary and percentile cases. It is not a timed-editor benchmark. To validate
real samples, call `validateMeasurements` from compiled
`dist/scripts/validate-acceptance.js` with these fields:

```json
{
  "candidate": "REPLACE_WITH_40_HEX_SHA",
  "hardware": "REPLACE_WITH_REFERENCE_WORKSTATION",
  "vscode": "REPLACE_WITH_TESTED_VERSION",
  "fixtureBytes": 1048576,
  "textboxes": 100,
  "freshWebviewPerOpen": true,
  "openBoundary": "command-to-painted-enabled-snapshot",
  "interactionBoundary": "commit-to-painted-accepted-change",
  "opensMs": [],
  "interactionsMs": []
}
```

The empty sample arrays intentionally fail. No actual timings were collected.

## SC-006 keyboard-only workflow

Starting in the installed extension, use only keyboard input to create a report,
configure page/body, create/select/rename/move/resize/style/delete a textbox,
create/rename/remove a dataset and fields, add a table, edit cell binding/text,
add/remove columns, add/change/remove row groups and both total scopes, undo/redo,
save, close and reopen. Attempt referenced renames/deletions and open their
diagnostics/source locations. Record each action, accessible labels, visible
focus, focus recovery after accepted snapshots, and any trap. Component tests
do not replace this installed workflow. Outcome: owner-reported acceptance;
separate per-action focus/accessibility logs were not supplied.

## SC-001 usability

Recruit five independent report authors. Give the same short creation task and
instructions, without coaching: create a report, add meaningful content, save,
close and reopen it. Record elapsed time, successful artifact, assistance and
failures for each participant, with consent and no unnecessary personal data.
At least four must complete within ten minutes. Outcome: no participants tested.
