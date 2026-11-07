# Contract: Automated Validation for Feature 006

This contract follows `docs/validation/qa-policy.md`. Every new test is critical unless it
is listed as informational in `tests/desktop/qa-classification.ts`.

## Coverage file

`tests/desktop/coverage-006.json` uses the existing schema (`schemaVersion: 1`) with these
fields:

- `feature`: `006-embedded-image-authoring`.
- `authority.spec`: `specs/006-embedded-image-authoring/spec.md`.
- `authority.evidenceContract`: this file.

There is one row per acceptance scenario (US1.1–US5.4) and per measurable criterion
(SC-001–SC-008). `coverage-assertions.ts` checks every reference statically. Batch 0
generalizes that check to every `tests/desktop/coverage*.json` file.

## Test levels per requirement

| Area | Unit (`node --test`) | Roundtrip / compatibility | Extension host (`tests/vscode/images.test.ts`) | Desktop (`tests/desktop/*.spec.ts`) |
|---|---|---|---|---|
| Format, limits and names (FR-001–FR-006) | `validation/src/images.test.ts` | — | refusal corpus, budget, stale | — |
| Projection and preservation (FR-023) | `xml-parser/src/project-images.test.ts` | `tests/roundtrip/images.test.ts`, `tests/compatibility/images.test.ts` | — | — |
| Plans and atomicity (FR-008, FR-009, FR-013) | `xml-serializer/src/images.test.ts` | byte identity outside the footprint | insert, undo and redo | `images.spec.ts::US1-insert-undo` |
| Display and placeholders (FR-014–FR-016) | `renderer/src/render.test.ts` | — | — | `visual.spec.ts::US-IMG-sizing-*`, `::US-IMG-placeholder` |
| Manipulation (FR-010–FR-012) | `validation/src/clipboard.test.ts` | `tests/roundtrip/clipboard.test.ts` | cross-report paste | `images.spec.ts::US2-manipulate` |
| Inspector (FR-017–FR-019) | designer `*.spec.ts` | — | property intents | `images.spec.ts::US3-inspector` |
| Views (FR-020–FR-022) | `renderer/src/structure.test.ts`, `data.test.ts` | — | sidebar commands | `images.spec.ts::US4-views` |
| Offline and isolation (FR-016, FR-024, SC-004) | `tests/package/offline.test.ts` (CSP) | — | — | `offline.spec.ts` and `security-observer.spec.ts` (image fixture added to the existing loops) |
| Gating (FR-026) | — | — | read-only and untrusted cases | — |
| Performance (SC-006) | `tests/performance/images.test.ts` (projection and render for 50 images) | — | — | `images.spec.ts::SC-006-timing` |

## Informational classification (added)

| Test | Signature | Justification |
|---|---|---|
| `images.spec.ts::SC-006-timing` | latency budget only | Runner speed is not a product defect. This mirrors `SC-003-timing` |
| `visual.spec.ts` image cases | screenshot or pixel mismatch only | Same rule as the existing visual cases |

Any other failure of these tests is critical.

## Fixture corpus (`tests/fixtures/images/`, registered in `tests/fixtures/manifest.json`)

| Fixture | Content |
|---|---|
| `blank.rdlc` | Supported report with no `EmbeddedImages` |
| `authored.rdlc` | PNG and JPEG definitions, items in each sizing mode, and one unused definition |
| `preserved.rdlc` | External, Database and expression `Value` items; GIF, BMP and `image/x-png` definitions; malformed base64; a missing reference; unknown children; a foreign-namespace attribute; an image in a table cell |
| `many.rdlc` | 50 embedded images (generated deterministically by the fixture script) |
| `pictures/` | Small `logo.png` and `photo.jpg` files; `spoofed.png` (JPEG bytes); `truncated.png`; `bad-crc.png`; `huge-dims.png` (header only); `over-5mib.jpg` (generated at test time, not committed) |

## Local vs CI

- Local: `pnpm qa:quick` after each batch, and `pnpm qa:integration` at the batch ends
  marked in the [plan](../plan.md#implementation-batches). Desktop, visual and package
  runs are local only on explicit request.
- CI: the feature PR runs the full matrix, `Required checks`, the visual job and the
  stability job for changed specs. Results are reported against the candidate SHA.
