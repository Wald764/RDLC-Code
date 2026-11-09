# Quickstart: Validating Embedded Image Authoring

This guide lists how to prove the feature works. The contracts define the behavior:
[image-import.md](contracts/image-import.md), [image-protocol.md](contracts/image-protocol.md)
and [desktop-validation.md](contracts/desktop-validation.md). Entities are defined in
[data-model.md](data-model.md).

## Prerequisites

- Node and pnpm versions as pinned in the root `package.json`. Dependencies are installed
  with `pnpm install --frozen-lockfile`. No new dependency is introduced.
- Branch `feat/006-embedded-image-authoring`.

## Targeted local validation (default)

```bash
pnpm qa:quick --plan    # show which suites the change selects
pnpm qa:quick           # run them
```

Expected result: the selected unit suites pass. These include
`packages/validation/src/images.test.ts`, `packages/xml-parser/src/project-images.test.ts`,
`packages/xml-serializer/src/images.test.ts` and the renderer tests. `tests/roundtrip`
and `tests/compatibility` are added whenever a `ROUNDTRIP_PACKAGES` package changed.

## Batch-end integration (extension or several packages changed)

```bash
pnpm qa:integration
```

Expected result: format, lint, typecheck, all unit/roundtrip/compatibility/acceptance/release
suites and `build` pass. One extension-host run executes `tests/vscode/images.test.ts`
together with the existing extension-host tests. This run includes no Desktop or visual
tests.

## Scenario checks (automated)

| Scenario | Automated by | Expected outcome |
|---|---|---|
| Insert a PNG, then a JPEG, from `blank.rdlc` | `tests/vscode/images.test.ts`, `tests/desktop/images.spec.ts::US1-insert-undo` | One `EmbeddedImages` collection, two definitions, two items, unrelated bytes unchanged. One Undo removes the item and its definition |
| Cancel the file chooser | extension-host test | No edit and no history entry |
| Refusal corpus (`spoofed`, `truncated`, `bad-crc`, `huge-dims`, `over-5mib`, budget) | `validation/src/images.test.ts` and an extension-host test | A refusal code with the limit stated. The text and history are unchanged |
| Move, resize, delete, copy, paste, duplicate, cross-report paste | `images.spec.ts::US2-manipulate`, `tests/vscode/images.test.ts` | Each action is exactly one undo step. The definition is carried across reports once |
| Inspector edits and replace-picture scope | `images.spec.ts::US3-inspector` | Only the targeted element changes |
| Structure and Data views, rename, remove, insert existing | `images.spec.ts::US4-views` | Reference counts are correct. Rename and remove are blocked when unsafe |
| Preservation corpus (`preserved.rdlc`) with an unrelated edit | `tests/roundtrip/images.test.ts` | All image-related text is byte-identical |
| Sizing modes and placeholder | `visual.spec.ts` image cases | They match the pinned baselines |
| Offline and isolation | `offline.spec.ts`, `security-observer.spec.ts` | Zero network requests and no file reads except the chosen import file |

## Comprehensive validation (GitHub Actions only)

The comprehensive validation runs only in GitHub Actions:

1. Push the branch and open one PR to `main`.
2. CI runs `Required checks`: the quality job, the Desktop matrix, the visual job,
   `changed-specs` and stability.
3. Read `qa-summary-<sha>` for the candidate SHA. If an informational failure appears, it
   is linked to an issue and keeps the feature from being FULLY VALIDATED.

A full local run (`pnpm qa:full --confirm-full`) happens only on the user's explicit request.
