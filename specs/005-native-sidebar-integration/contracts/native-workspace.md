# Native Workspace Contract

**Status**: Design contract; runtime acceptance is not yet executed.

## Contributions and commands

Contribute container `rdlcCode` to `viewsContainers.activitybar`, with title **RDLC Code** and package-relative icon `media/rdlc-activity.svg`. Contribute native TreeViews `rdlcCode.structure` (**Report Structure**), `rdlcCode.data` (**Report Data**) and `rdlcCode.components` (**Components**). Register providers on extension activation, independently of opening a designer. Retain existing `rdlcCode.newReport`, `rdlcCode.openDesigner` and `rdlcCode.openSource` command IDs.

Add internal commands under `rdlcCode.sidebar.*` for activate, properties, source, contextual action, filter and clear filter. Command arguments are captured host-owned action contexts, never raw XML, executable strings, caller-supplied source ranges or a basename. Menu context keys control presentation only; every handler independently checks eligibility. New Report uses the existing command; Open Report uses a local file picker followed by the existing designer-opening route.

Host view controls own placement, ordering, visibility and restoration. Never execute a move/reset/focus-view command on activation or refresh. Each view identifies its active report in its description/message; no-report welcome actions remain reachable before a custom editor opens.

## Tree presentation

Implement `getChildren`, `getTreeItem`, `getParent` and bounded refresh events. UI IDs represent only safely reconciled display identity; actions resolve current version-local targets separately. Categories and truncation markers have no report-node authority. Expand/reveal accepted ancestors without collapsing unrelated branches or taking keyboard focus. Unknown/ambiguous correspondence loses its UI identity and selection rather than inheriting an unrelated target.

Report Structure excludes datasets/fields. Report Data exposes Datasets/Fields, Parameters, Embedded Images and Data Sources, with explicit empty, opaque and incomplete states. Names and type/status are inert text; tooltips omit image payloads, query bodies, connection strings and expression bodies. Full names remain accessible. Source access uses the current host syntax range, including opaque definitions.

Structure permits native body-item multi-selection only when the existing selection rules accept it. Programmatic canvas-to-tree synchronization reveals the primary target with `focus: false` and exposes **Selected**, **Primary** and the accepted selection count in accessible descriptions/row cues. Native `TreeView.selection` is not an arbitrary writable set: native highlight alone never claims the entire accepted membership. Mixed cell/data/structural requests are refused and accepted cues restored. Refresh/reveal echoes do not dispatch another action.

## Components

| Category | Kinds | Activation |
| --- | --- | --- |
| Report items | Textbox, Table | Existing automatic creation |
| Report items | Image, Line, Chart, Subreport | Reason/details only |
| Containers | Rectangle, List, Matrix | Reason/details only |
| Data | Dataset | Existing automatic creation |
| Data | Parameter | Reason/details only |

Reuse one canonical capability catalog across native and Angular consumers. Filter via a title action opening native input; filter labels case-insensitively, retain matching category context and unavailable rows. Cancel preserves the previous filter. No matches exposes Clear Filter; filter and expansion never edit the report.

Textbox/Table activation uses the associated designer's existing viewport placement, snapping, lowest-free name allocation and post-acceptance focus. Textbox remains 1in × 0.25in; Table remains unbound with two 1in columns and two 0.25in rows. Dataset has no canvas geometry. No naming/binding creation form is introduced. One accepted creation is one native Undo step.

Native dragging is unavailable by default. A public-API Desktop probe must record actual transfer delivery and all AT-05 drop assertions before a drag controller or drag instructions are shipped. Do not use URI command/file tricks or private workbench APIs. An explicit compact designer fallback retains existing HTML drag insertion whether native views are hidden or moved; showing it never forces a native view open.

## Focus, layout and refusal

Tree activation settles the associated inspector draft first. Cancel preserves draft and accepted selection; Discard revalidates the captured action; Apply settles the draft and terminates the original action without replay against a newer version. Properties/creation explicitly focus the relevant existing inspector; canvas-origin selection never steals focus. Each result produces one accessible accepted/refused announcement.

Center known positive canvas bounds at unchanged zoom using page/body transforms and clamped reachable scroll extents. Data/structural/unknown bounds never synthesize a rectangle or scroll. Oversized targets use the same clamped-center rule. Elective fallback/layout changes defer during gestures; unavoidable host resizing cancels the preview before measuring the new frame and commits zero gesture edits.

All empty/loading/invalid/source-only/truncated/refused states expose labeled local recovery/source actions. Native disabled insertion rows expose reasons rather than mutation commands; direct command invocation still refuses. Light+, Dark+, High Contrast and High Contrast Light plus 100%/200% scaling require actual Desktop assertions under [desktop-validation.md](desktop-validation.md).
