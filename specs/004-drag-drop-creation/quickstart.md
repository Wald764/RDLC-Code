# Quickstart: Validating Drag-and-Drop Creation

## Prerequisites

Node >=24.15.0 <25, pnpm 11.28.2. `pnpm install --frozen-lockfile`.

## Automated checks

```text
pnpm test:unit            # validation (nextName, allocateNames), protocol, serializer, designer
pnpm test:roundtrip       # creation/binding exact-text and outside-footprint preservation
pnpm test:compatibility   # unbound table profile and TABLE_DATASET_REQUIRED
pnpm lint && pnpm typecheck && pnpm build
pnpm test:vscode          # native undo of creation, split views, pending/stale refusal
```

Expected: all pass. Focus areas:

- `nextName`: lowest free number, gaps filled, preserved names reserved.
- Protocol: old payload shapes (`name`, `dataset`, `field`, `width`) are refused; `created` validated.
- Serializer: textbox and unbound table inserted at the given `Left`/`Top`; nothing else in the text changes; one native undo restores the exact prior text.
- Designer: drop converts client point to body coordinates at 25/50/100/200/400% and scroll offsets within 0.01pt; Alt bypasses snapping; cancelled drags send nothing; activation uses the default position and offsets repeats.

## Manual journeys (installed VSIX)

1. Blank report: drag Textbox onto the body twice → Textbox1, Textbox2 at the drop points, each selected. Undo once → only Textbox2 removed.
2. Keyboard only: Tab to the Textbox card, Enter → Textbox created at the visible body top-left plus 0.25in, focus on Name; type a name, Enter → renamed.
3. Drop Table → Table1 unbound. Activate Dataset → DataSet1. Add fields, bind Table1 in the inspector, add a column; save and reopen.
4. Add a second dataset → Table1 shows the dataset-required warning only if still unbound.
5. Duplicate Textbox2 with Textbox1 and Textbox2 present → Textbox3.
6. Drop outside the body, press Escape mid-drag, drop while another edit is pending → no change, no history entry.

Record results in `docs/validation/drag-drop-creation.md`.
