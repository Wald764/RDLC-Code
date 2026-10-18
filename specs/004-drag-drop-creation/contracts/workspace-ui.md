# Contract: Creation Interaction in the Designer

## Catalog cards

- Available cards (Textbox, Table, Dataset) are draggable; Textbox and Table can be dropped on the canvas body. Dataset has no drop target and is created by activation.
- Unavailable cards are not draggable; their explanation stays focus- and hover-accessible.
- Activation (click without drag, Enter, Space) creates the component immediately (R7 default position for Textbox/Table).

## Drag over the canvas

- A footprint preview at the default size follows the pointer, positioned at the snapped body point (Alt: unsnapped), with guides when guides are on.
- Over invalid areas (outside the body, ineligible state) the preview shows the invalid style and the drop effect is `none`.
- Escape, leaving the canvas, window blur and workspace resize clear the preview; nothing is sent.

## After a request

- While pending, further creation is blocked with the existing pending notice.
- On acceptance, the `created` item is selected in canvas, Structure and inspector. For keyboard creation, focus moves to the inspector's Name field; for drops, focus moves to the canvas.
- One live-region announcement: "Created Textbox1." On refusal: the host reason, once.

## Inspector

- Tables gain a Name field (rename) and a Dataset select (bind or rebind), plus the existing column/row/group controls once bound.
- An unbound table in a multi-dataset report shows the `TABLE_DATASET_REQUIRED` message next to the Dataset select.

## Removed

The compact creation form (textbox name, dataset name, table name/dataset/first field/width) is removed from the Components panel.
