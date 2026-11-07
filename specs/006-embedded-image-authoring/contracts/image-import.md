# Contract: Local Image Import and Embedded Storage

## Input

- Exactly one file, chosen through `vscode.window.showOpenDialog`, with the filter `png`,
  `jpg` and `jpeg`. The filter is a convenience only, because format detection uses the
  file content (FR-002).
- Read sequence: first `workspace.fs.stat`, which refuses a file larger than 5 MiB before
  reading it, then `workspace.fs.readFile`. No other file access happens.

## Validation (`validatePicture(bytes, fileName)` in `packages/validation/src/images.ts`)

The checks run in this order, and the first failure stops the import:

1. The content signature is PNG or JPEG. Otherwise the import fails with `IMAGE_FORMAT_UNSUPPORTED`.
2. The structural walk succeeds: PNG chunk CRCs plus `IHDR` and `IEND`, or JPEG markers
   through SOF and `EOI`. Otherwise the import fails with `IMAGE_DATA_INVALID`.
3. The file is at most 5 MiB. Otherwise the import fails with `IMAGE_TOO_LARGE`, and the
   message states the limit and the actual size.
4. Width and height are at most 16,384 px and width × height is at most 40,000,000.
   Otherwise the import fails with `IMAGE_PIXELS_EXCEEDED`.

## Storage (MS-RDL 2.306, 2.3.20)

The new definition is written in this shape:

```xml
<EmbeddedImage Name="{name}">
  <MIMEType>image/png|image/jpeg</MIMEType>
  <ImageData>{base64 of the unmodified bytes, single line}</ImageData>
</EmbeddedImage>
```

- If `EmbeddedImages` is absent, it is created as the last child of `Report`
  (unordered `xsd:choice`, see research R1). The indentation and EOL of the new element are
  taken from the surrounding source, as the existing `element()` helper does.
- If a displayable definition with the same SHA-256 hash already exists, it is reused and
  nothing is written for the definition.
- The name follows the rule in research R8, for example `logo`, `logo_1`.
- The candidate text must stay within the 16 MiB parse budget. Otherwise the import fails
  with `IMAGE_REPORT_BUDGET`, before verification.

## New image item

The new item is written in this shape:

```xml
<Image Name="Image{n}">
  <Source>Embedded</Source>
  <Value>{name}</Value>
  <Sizing>FitProportional</Sizing>
  <Top>…</Top><Left>…</Left><Height>…</Height><Width>…</Width>
</Image>
```

- **Size**: the natural pixel size at 96 DPI, in the unit convention of the existing
  `planCreateTextbox`. If the width would exceed `bodyWidth − left`, it is scaled down
  while keeping the aspect ratio. Each dimension has a floor equal to the existing minimum
  item size.
- **Position**: the drop point for `drop`. For `default`, the existing default-placement
  rule of textbox creation applies.
- **Insertion point**: the end of `Body/ReportItems`, which is created when absent. This
  uses the same path as `planCreateTextbox`.

## Output guarantees

- One `WorkspaceEdit`, so one undo step. Text outside the plan footprint stays byte-identical.
- No image bytes appear in diagnostics, logs, the scene, view labels or tooltips (FR-025).
