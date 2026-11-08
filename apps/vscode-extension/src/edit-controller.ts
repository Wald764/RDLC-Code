import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import {
  imageScalarProperties,
  type EditIntent,
  type PatchPlan,
  type AuthoringIntent,
  type ImageScalarProperty,
  type TextboxProperty,
  type TargetMapping,
} from '@rdlc/report-model/editing';
import type {
  EmbeddedImageDefinition,
  ImageItem,
  ReportProjection,
  Textbox,
} from '@rdlc/report-model/report';
import {
  IMAGE_DATA_INVALID,
  IMAGE_FORMAT_UNSUPPORTED,
  IMAGE_PIXELS_EXCEEDED,
  IMAGE_REPORT_BUDGET,
  IMAGE_TARGET_STALE,
  IMAGE_TOO_LARGE,
  imageReasonLabel,
  type ImageMime,
  type ImagePixels,
  type ImageRefusal,
  type ValidatedPicture,
} from '@rdlc/report-model/images';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { toPoints, resolveGeometry } from '@rdlc/report-model/geometry';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { planTextboxProperty } from '@rdlc/xml-serializer/textboxes';
import {
  reportItemNames,
  validateTextboxCapability,
  validateTextboxProperty,
  validateTextboxRename,
} from '@rdlc/validation/textboxes';
import { verifyCandidate, verifyLayoutCandidate } from './verify-candidate.js';
import { validateLayout } from '@rdlc/validation/layout';
import { planLayout } from '@rdlc/xml-serializer/layout';
import { planDataset } from '@rdlc/xml-serializer/datasets';
import {
  planPage,
  pageProperties,
  type PageProperty,
} from '@rdlc/xml-serializer/page';
import { planCreateTextbox } from '@rdlc/xml-serializer/authoring';
import {
  planCreateImage,
  planImageProperty,
  planReplacePicture,
} from '@rdlc/xml-serializer/images';
import {
  allocateDefinitionName,
  validateImageCapability,
  validateImageProperty,
} from '@rdlc/validation/images';
import {
  computeImageSize,
  defaultImagePosition,
  exceedsParseBudget,
} from './image-import.js';
import { patchPlan, sourcePatch } from '@rdlc/xml-serializer/structure';
import {
  authoringError,
  isFieldType,
  validateDatasetName,
  validateDataMutation,
} from '@rdlc/validation/datasets';
import { length, nextName, validatePage } from '@rdlc/validation/validate';
import { validatePosition, validateTableAction } from '@rdlc/validation/tables';
import { planTable } from '@rdlc/xml-serializer/tables';
import { fieldBinding, sumExpression } from '@rdlc/expressions/totals';

export type PlanOutcome =
  | {
      readonly ok: true;
      readonly plan: PatchPlan;
      readonly candidate: string;
      readonly changed: boolean;
      /** Host-allocated item of an accepted creation, located again in the result. */
      readonly created?: {
        readonly element: 'Textbox' | 'Tablix' | 'DataSet' | 'Image';
        readonly name: string;
      };
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function diagnostic(
  code: string,
  message: string,
  category: Diagnostic['category'],
  range: Textbox['node']['range'],
): Diagnostic {
  return {
    code,
    category,
    severity: 'error',
    range,
    message,
    correctiveAction:
      'Refresh the design surface and inspect the report in the source editor.',
    blockedOperations: ['requested-edit'],
  };
}

function textboxValue(
  textbox: Textbox,
  property: TextboxProperty,
): string | null {
  switch (property) {
    case 'name':
      return textbox.name;
    case 'text':
      return textbox.value ? textbox.value.text : null;
    case 'left':
    case 'top':
    case 'width':
    case 'height':
      return textbox.bounds[property];
    case 'fontFamily':
    case 'fontSize':
    case 'fontWeight':
    case 'fontStyle':
    case 'color':
    case 'textAlign':
      return textbox.style[property];
  }
}

/**
 * Host-side pipeline: capability guard, authored-value validation, minimal patch
 * plan, then reparse and intention verification before any document mutation.
 */
export function planTextboxIntent(
  snapshot: DocumentSnapshot,
  syntax: XmlSyntaxDocument,
  projection: ReportProjection,
  intent: EditIntent,
): PlanOutcome {
  if (snapshot.version !== intent.baseVersion)
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'STALE_EDIT',
          'The document changed; select the item again.',
          'stale-edit',
          { start: 0, end: 0 },
        ),
      ],
    };
  if (intent.operation === 'author')
    return planAuthoringIntent(snapshot, syntax, projection, intent);
  if (intent.operation === 'layout')
    try {
      const changes = validateLayout(projection, intent.payload);
      const plan = planLayout(snapshot, changes, intent.payload.unit);
      const candidate = verifyCandidate(snapshot, plan, (next, original) =>
        verifyLayoutCandidate(original, next, changes),
      ).source;
      return {
        ok: true,
        plan,
        candidate,
        changed: candidate !== snapshot.source,
      };
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'LAYOUT_REFUSED',
            error instanceof Error
              ? error.message
              : 'Layout could not be verified.',
            'unsupported',
            { start: 0, end: 0 },
          ),
        ],
      };
    }
  if (projection.status !== 'editable')
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'SOURCE_ONLY',
          'Fix source diagnostics before editing visually.',
          'unsupported',
          { start: 0, end: 0 },
        ),
      ],
    };
  const index = projection.textboxes.findIndex(
    (textbox) => textbox.node.id === intent.targetId,
  );
  const textbox = index >= 0 ? projection.textboxes[index] : undefined;
  if (!textbox)
    return {
      ok: false,
      diagnostics: [
        {
          code: 'TARGET_UNKNOWN',
          category: 'stale-edit',
          severity: 'error',
          range: { start: 0, end: 0 },
          message:
            'The selected item is not part of the current document version.',
          correctiveAction:
            'Reload the design surface and select the item again.',
          blockedOperations: ['requested-edit'],
        },
      ],
    };

  const { property, value } = intent.payload;
  const capability = validateTextboxCapability(textbox, property);
  if (capability.length > 0) return { ok: false, diagnostics: capability };
  if (property === 'name' && value !== textbox.name) {
    const dependencies = validateTextboxRename(syntax.root, textbox);
    if (dependencies.length > 0)
      return { ok: false, diagnostics: dependencies };
  }
  const authored = validateTextboxProperty({
    property,
    value,
    range: textbox.node.range,
    existingNames: reportItemNames(syntax.root).filter(
      (name) => name !== textbox.name,
    ),
  });
  if (authored.length > 0) return { ok: false, diagnostics: authored };

  const currentValue = textboxValue(textbox, property);
  const geometry = resolveGeometry(textbox.bounds, {
    width:
      textbox.context === 'body'
        ? toPoints(projection.section?.width ?? null)
        : null,
    height:
      textbox.context === 'body'
        ? toPoints(projection.section?.height ?? null)
        : null,
  });
  const currentPoints = geometry[property as keyof typeof geometry]?.points;
  const sameGeometry =
    ['left', 'top', 'width', 'height'].includes(property) &&
    currentPoints !== null &&
    currentPoints !== undefined &&
    currentPoints === toPoints(value);
  if (currentValue === value || sameGeometry)
    return {
      ok: true,
      changed: false,
      plan: patchPlan(snapshot, []),
      candidate: snapshot.source,
    };

  let plan: PatchPlan;
  let candidate: string;
  try {
    plan = planTextboxProperty({ snapshot, textbox, property, value });
    candidate = verifyCandidate(snapshot, plan, (verified) => {
      const projected = projectReport(verified);
      if (projected.status !== 'editable') return false;
      const edited = projected.textboxes[index];
      return edited ? textboxValue(edited, property) === value : false;
    }).source;
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'EDIT_REFUSED',
          error instanceof Error
            ? error.message
            : 'The edit could not be verified.',
          'preservation-risk',
          textbox.node.range,
        ),
      ],
    };
  }
  return { ok: true, plan, candidate, changed: candidate !== snapshot.source };
}

/**
 * Checks that must pass before the file chooser opens: the request still targets the
 * current version of an editable report with a body. Returns the refusal, if any.
 */
export function checkImageCreation(
  snapshot: DocumentSnapshot,
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  intent: AuthoringIntent,
): readonly Diagnostic[] {
  const root = syntax.root;
  if (snapshot.version !== intent.baseVersion)
    return [
      diagnostic(
        'STALE_EDIT',
        'The document changed; select the item again.',
        'stale-edit',
        { start: 0, end: 0 },
      ),
    ];
  if (!root) return syntax.diagnostics;
  if (report.status !== 'editable')
    return [
      diagnostic(
        'SOURCE_ONLY',
        'Fix source diagnostics before editing visually.',
        'unsupported',
        { start: 0, end: 0 },
      ),
    ];
  if (intent.targetId !== root.id || !report.section)
    return [authoringError(root, 'Select the report to insert an image.')];
  const payload = intent.payload;
  return payload.action === 'createImage' &&
    payload.left !== undefined &&
    payload.top !== undefined
    ? validatePosition(root, payload.left, payload.top)
    : [];
}

/** Fixed text for any planning or verification failure; no underlying error text. */
export const imageFailureMessage =
  'The image could not be inserted safely; inspect the report source.';

/** A picture the host read and validated; the plan applies to the latest snapshot. */
export interface ImportedPicture {
  readonly picture: ValidatedPicture;
  /** Chosen file name, used to name the definition. */
  readonly fileName: string;
}

const reasonCodes: Readonly<
  Record<NonNullable<EmbeddedImageDefinition['reason']>, ImageRefusal['code']>
> = {
  'format-unsupported': IMAGE_FORMAT_UNSUPPORTED,
  'data-invalid': IMAGE_DATA_INVALID,
  'mime-mismatch': IMAGE_DATA_INVALID,
  'value-expression': IMAGE_DATA_INVALID,
  'too-large': IMAGE_TOO_LARGE,
  'pixels-exceeded': IMAGE_PIXELS_EXCEEDED,
};

/**
 * Plan a body image item, with its definition when the picture is new. Called with the
 * latest accepted evaluation: after the file chooser resolved (`imported`) or for an
 * existing displayable definition (`payload.definition`). Dedupes by hash, allocates the
 * definition and item names, sizes the item, checks the report budget on the candidate
 * and verifies the result. Payload bytes never appear in a diagnostic.
 */
export function planImageCreation(
  snapshot: DocumentSnapshot,
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  payload: Extract<AuthoringIntent['payload'], { action: 'createImage' }>,
  imported?: ImportedPicture,
): PlanOutcome {
  const root = syntax.root;
  if (!root) return { ok: false, diagnostics: syntax.diagnostics };
  const fail = (message: string, code?: string): PlanOutcome => ({
    ok: false,
    diagnostics: [
      code === undefined
        ? authoringError(root, message)
        : diagnostic(
            code,
            message,
            code === IMAGE_TARGET_STALE ? 'stale-edit' : 'unsupported',
            root.range,
          ),
    ],
  });
  if (report.status !== 'editable')
    return fail(
      'Fix source diagnostics before editing visually.',
      'SOURCE_ONLY',
    );
  if (!report.section)
    return fail(
      'The report body is no longer available; retry the insertion.',
      IMAGE_TARGET_STALE,
    );
  if ((payload.definition === undefined) === (imported === undefined))
    return fail(
      'An image is inserted from either a chosen file or an existing embedded image.',
    );
  let position: { left: string; top: string };
  if (payload.left !== undefined && payload.top !== undefined) {
    const errors = validatePosition(root, payload.left, payload.top);
    if (errors.length) return { ok: false, diagnostics: errors };
    position = { left: payload.left, top: payload.top };
  } else
    position = defaultImagePosition(
      [
        ...report.textboxes.filter((item) => item.context === 'body'),
        ...report.images.filter((item) => item.context === 'body'),
        ...report.tables,
      ].map((item) => item.bounds),
    );

  // Resolve the definition: an existing displayable one, a dedupe hit, or a new one.
  let value: string;
  let pixels: ImagePixels;
  let created: { name: string; mime: ImageMime; base64: string } | undefined;
  if (imported) {
    const { picture, fileName } = imported;
    const same = report.embeddedImages.find(
      (entry) => entry.displayable && entry.hash === picture.hash,
    );
    pixels = picture.pixels;
    if (same) value = same.name;
    else {
      value = allocateDefinitionName(
        fileName,
        report.embeddedImages.map((entry) => entry.name),
      );
      created = {
        name: value,
        mime: picture.mime,
        base64: Buffer.from(picture.bytes).toString('base64'),
      };
    }
  } else {
    const existing = report.embeddedImages.find(
      (entry) => entry.name === payload.definition,
    );
    if (!existing)
      return fail(
        'The embedded image no longer exists; refresh and retry.',
        IMAGE_TARGET_STALE,
      );
    if (!existing.displayable || !existing.pixels)
      return fail(
        `Embedded image "${existing.name}" cannot be inserted: ${
          existing.reason
            ? imageReasonLabel(existing.reason)
            : 'it cannot be displayed'
        }.`,
        existing.reason ? reasonCodes[existing.reason] : IMAGE_DATA_INVALID,
      );
    value = existing.name;
    pixels = existing.pixels;
  }
  const name = nextName('Image', reportItemNames(root));
  const size = computeImageSize(pixels, position.left, report.section.width);
  const item = { name, value, ...position, ...size };
  const label = imported?.fileName || value;
  try {
    const plan = planCreateImage(snapshot, root, report.section, {
      ...(created ? { definition: created } : {}),
      item,
    });
    if (exceedsParseBudget(snapshot.source, plan))
      return fail(
        `Inserting "${label}" would exceed the 16 MiB report size limit.`,
        IMAGE_REPORT_BUDGET,
      );
    const candidate = verifyCandidate(snapshot, plan, (syntax) => {
      const projected = projectReport(syntax);
      if (
        projected.status !== 'editable' ||
        projected.images.length !== report.images.length + 1 ||
        projected.embeddedImages.length !==
          report.embeddedImages.length + (created ? 1 : 0)
      )
        return false;
      const definition = projected.embeddedImages.find(
        (entry) => entry.name === value,
      );
      const inserted = projected.images.find(
        (entry) => entry.name === name && entry.context === 'body',
      );
      return (
        !!definition?.displayable &&
        (!created ||
          (definition.mime === created.mime &&
            definition.pixels?.width === pixels.width &&
            definition.pixels.height === pixels.height)) &&
        inserted?.source === 'Embedded' &&
        inserted.value?.kind === 'constant' &&
        inserted.value.text === value &&
        inserted.definition === value &&
        inserted.sizing === 'FitProportional' &&
        inserted.bounds.left === item.left &&
        inserted.bounds.top === item.top &&
        inserted.bounds.width === item.width &&
        inserted.bounds.height === item.height
      );
    }).source;
    return {
      ok: true,
      plan,
      candidate,
      changed: candidate !== snapshot.source,
      created: { element: 'Image', name },
    };
  } catch {
    // Underlying error text may quote source text, including the picture payload (FR-025),
    // so it is never surfaced: the message is fixed.
    return fail(imageFailureMessage);
  }
}

/**
 * Checks that must pass before the file chooser opens for a picture replacement: the
 * request is for the current version of an editable report and its target is an image
 * whose picture may change. Returns the refusals, if any.
 */
export function checkImageReplacement(
  snapshot: DocumentSnapshot,
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  intent: AuthoringIntent,
): readonly Diagnostic[] {
  if (snapshot.version !== intent.baseVersion)
    return [
      diagnostic(
        'STALE_EDIT',
        'The document changed; select the item again.',
        'stale-edit',
        { start: 0, end: 0 },
      ),
    ];
  const root = syntax.root;
  if (!root) return syntax.diagnostics;
  if (report.status !== 'editable')
    return [
      diagnostic(
        'SOURCE_ONLY',
        'Fix source diagnostics before editing visually.',
        'unsupported',
        { start: 0, end: 0 },
      ),
    ];
  const image = report.images.find(
    (entry) => entry.node.id === intent.targetId && entry.context === 'body',
  );
  return image
    ? validateImageCapability(image, 'image')
    : [
        diagnostic(
          IMAGE_TARGET_STALE,
          'The image no longer exists; select it again.',
          'stale-edit',
          root.range,
        ),
      ];
}

/** Fixed text for any image property planning or verification failure; no error text. */
export const imageEditFailureMessage =
  'The image could not be edited safely; inspect the report source.';

/** Fixed text for any replacement planning or verification failure; no error text. */
export const imageReplaceFailureMessage =
  'The picture could not be replaced safely; inspect the report source.';

/**
 * Plan a picture replacement against the latest accepted evaluation, after the file
 * chooser resolved. The target is the intent's node when the version is unchanged, and
 * otherwise the one body image still carrying both `original.name` and `original.definition`; a target that is gone is
 * `IMAGE_TARGET_STALE`. `item` scope reuses the B4 dedupe and naming: an identical
 * displayable picture is referenced, a new one gets a definition. `all` rewrites the
 * referenced definition in place. Choosing the picture already shown is a no-op.
 */
export function planImageReplacement(
  snapshot: DocumentSnapshot,
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  intent: AuthoringIntent,
  imported: ImportedPicture,
  original?: {
    readonly name: string | null;
    readonly definition: string | null;
  },
): PlanOutcome {
  const root = syntax.root;
  if (!root) return { ok: false, diagnostics: syntax.diagnostics };
  const fail = (message: string, code: string): PlanOutcome => ({
    ok: false,
    diagnostics: [
      diagnostic(
        code,
        message,
        code === IMAGE_TARGET_STALE ? 'stale-edit' : 'unsupported',
        root.range,
      ),
    ],
  });
  const payload = intent.payload;
  if (payload.action !== 'replaceImagePicture')
    return fail('This is not a picture replacement.', 'EDIT_REFUSED');
  if (report.status !== 'editable')
    return fail(
      'Fix source diagnostics before editing visually.',
      'SOURCE_ONLY',
    );
  let target: ImageItem | undefined;
  if (snapshot.version === intent.baseVersion)
    target = report.images.find(
      (entry) => entry.node.id === intent.targetId && entry.context === 'body',
    );
  else if (original?.name && original.definition) {
    const matches = report.images.filter(
      (entry) =>
        entry.name === original.name &&
        entry.definition === original.definition &&
        entry.context === 'body',
    );
    target = matches.length === 1 ? matches[0] : undefined;
  }
  if (!target)
    return fail(
      'The image no longer exists; select it again.',
      IMAGE_TARGET_STALE,
    );
  const blocked = validateImageCapability(target, 'image');
  if (blocked.length) return { ok: false, diagnostics: blocked };
  const { picture, fileName } = imported;
  const index = report.images.indexOf(target);
  const definitionIndex = report.embeddedImages.findIndex(
    (entry) => entry.name === target.definition,
  );
  const current = report.embeddedImages[definitionIndex];
  if (!current || (payload.scope === 'all' && !current.displayable))
    return fail(
      'The embedded image no longer exists; refresh and retry.',
      IMAGE_TARGET_STALE,
    );
  const unchanged: PlanOutcome = {
    ok: true,
    plan: patchPlan(snapshot, []),
    candidate: snapshot.source,
    changed: false,
  };
  const base64 = Buffer.from(picture.bytes).toString('base64');
  const label = fileName || current.name;
  try {
    let plan: PatchPlan;
    let verify: (projected: ReportProjection) => boolean;
    const samePictures = (projected: ReportProjection) =>
      projected.images.length === report.images.length &&
      projected.images.every(
        (entry, position) =>
          entry.name === report.images[position]!.name &&
          (position === index ||
            entry.definition === report.images[position]!.definition),
      );
    if (payload.scope === 'all') {
      if (
        current.displayable &&
        current.hash === picture.hash &&
        current.mime === picture.mime
      )
        return unchanged;
      plan = planReplacePicture(snapshot, root, {
        scope: 'all',
        definition: current,
        mime: picture.mime,
        base64,
      });
      verify = (projected) => {
        const next = projected.embeddedImages[definitionIndex];
        return (
          samePictures(projected) &&
          projected.images[index]!.definition === current.name &&
          projected.embeddedImages.length === report.embeddedImages.length &&
          next?.name === current.name &&
          next.displayable &&
          next.mime === picture.mime &&
          next.pixels?.width === picture.pixels.width &&
          next.pixels.height === picture.pixels.height &&
          projected.embeddedImages.every(
            (entry, position) =>
              position === definitionIndex ||
              (entry.name === report.embeddedImages[position]!.name &&
                entry.encodedSize ===
                  report.embeddedImages[position]!.encodedSize),
          )
        );
      };
    } else {
      const same = report.embeddedImages.find(
        (entry) => entry.displayable && entry.hash === picture.hash,
      );
      if (same?.name === current.name) return unchanged;
      let created:
        | { name: string; mime: ImageMime; base64: string }
        | undefined;
      let value: string;
      if (same) value = same.name;
      else {
        value = allocateDefinitionName(
          fileName,
          report.embeddedImages.map((entry) => entry.name),
        );
        created = { name: value, mime: picture.mime, base64 };
      }
      plan = planReplacePicture(snapshot, root, {
        scope: 'item',
        image: target,
        value,
        ...(created ? { definition: created } : {}),
      });
      verify = (projected) => {
        const next = projected.images[index];
        const definition = projected.embeddedImages.find(
          (entry) => entry.name === value,
        );
        return (
          samePictures(projected) &&
          next?.definition === value &&
          next.value?.kind === 'constant' &&
          next.value.text === value &&
          projected.embeddedImages.length ===
            report.embeddedImages.length + (created ? 1 : 0) &&
          !!definition?.displayable &&
          (!created ||
            (definition.mime === created.mime &&
              definition.pixels?.width === picture.pixels.width &&
              definition.pixels.height === picture.pixels.height))
        );
      };
    }
    if (exceedsParseBudget(snapshot.source, plan))
      return fail(
        `Replacing the picture with "${label}" would exceed the 16 MiB report size limit.`,
        IMAGE_REPORT_BUDGET,
      );
    const candidate = verifyCandidate(snapshot, plan, (next) => {
      const projected = projectReport(next);
      return projected.status === 'editable' && verify(projected);
    }).source;
    return {
      ok: true,
      plan,
      candidate,
      changed: candidate !== snapshot.source,
    };
  } catch {
    // Underlying error text may quote source text, including the picture payload (FR-025).
    return fail(imageReplaceFailureMessage, 'EDIT_REFUSED');
  }
}

export function planAuthoringIntent(
  snapshot: DocumentSnapshot,
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  intent: AuthoringIntent,
): PlanOutcome {
  const root = syntax.root;
  if (!root) return { ok: false, diagnostics: syntax.diagnostics };
  const fail = (message: string): PlanOutcome => ({
    ok: false,
    diagnostics: [authoringError(root, message)],
  });
  if (snapshot.version !== intent.baseVersion || report.status !== 'editable')
    return fail('Stale or unsupported report; refresh and retry.');
  const payload = intent.payload;
  if (payload.action === 'createImage')
    return intent.targetId === root.id
      ? planImageCreation(snapshot, syntax, report, payload)
      : fail('Select the report to insert an image.');
  const dataset =
    report.datasets.find(
      (dataset) =>
        dataset.node.id === intent.targetId ||
        dataset.fields.some((field) => field.node.id === intent.targetId),
    ) ?? null;
  const field =
    dataset?.fields.find((field) => field.node.id === intent.targetId) ?? null;
  const textbox = report.textboxes.find(
    (textbox) => textbox.node.id === intent.targetId,
  );
  const image = report.images.find(
    (image) => image.node.id === intent.targetId,
  );
  let plan: PatchPlan;
  let verify: (candidate: ReportProjection) => boolean;
  let created:
    | { element: 'Textbox' | 'Tablix' | 'DataSet' | 'Image'; name: string }
    | undefined;
  try {
    if (
      [
        'createDataset',
        'renameDataset',
        'deleteDataset',
        'createField',
        'renameField',
        'deleteField',
        'setFieldType',
      ].includes(payload.action)
    ) {
      if (
        payload.action === 'createDataset'
          ? root.id !== intent.targetId
          : !dataset
      )
        return fail('Select a dataset or field in the current snapshot.');
      if (
        ['renameField', 'deleteField', 'setFieldType'].includes(
          payload.action,
        ) &&
        (!field || !field.type || field.calculatedValue !== null)
      )
        return fail(
          'Unknown, absent or calculated field definitions are read-only.',
        );
      if (
        ['renameDataset', 'deleteDataset', 'createField'].includes(
          payload.action,
        ) &&
        field
      )
        return fail('Select the dataset, not a field.');
      if ('type' in payload && !isFieldType(payload.type))
        return fail('Choose one of the seven supported field types.');
      if ('name' in payload) {
        const names =
          payload.action === 'renameDataset'
            ? report.datasets
                .filter((entry) => entry !== dataset)
                .map((entry) => entry.name)
            : dataset!.fields
                .filter((entry) => entry !== field)
                .map((entry) => entry.name);
        const errors = validateDatasetName(
          field?.node ?? dataset?.node ?? root,
          payload.name,
          names,
        );
        if (errors.length) return { ok: false, diagnostics: errors };
      }
      if (
        [
          'renameDataset',
          'deleteDataset',
          'renameField',
          'deleteField',
        ].includes(payload.action)
      ) {
        const target = field ?? dataset!;
        const errors = validateDataMutation(
          root,
          target.node,
          field ? 'field' : 'dataset',
          target.name,
          // Deletion matches Cut (002): opaque content blocks only where it spells the name.
          // Renames stay strict because references would need rewriting.
          payload.action.startsWith('delete') ? snapshot.source : undefined,
        );
        if (errors.length) return { ok: false, diagnostics: errors };
      }
      if (payload.action === 'createDataset')
        created = {
          element: 'DataSet',
          name: nextName(
            'DataSet',
            report.datasets.map((entry) => entry.name),
          ),
        };
      plan = planDataset(
        snapshot,
        root,
        dataset,
        field,
        payload,
        created?.name,
      );
      const datasetIndex = dataset ? report.datasets.indexOf(dataset) : -1;
      const fieldIndex = field ? dataset!.fields.indexOf(field) : -1;
      verify = (candidate) => {
        const next = candidate.datasets[datasetIndex];
        switch (payload.action) {
          case 'createDataset':
            return candidate.datasets.some(
              (entry) =>
                entry.name === created!.name &&
                entry.query === null &&
                entry.fields.length === 0,
            );
          case 'renameDataset':
            return next?.name === payload.name;
          case 'deleteDataset':
            return (
              candidate.datasets.length === report.datasets.length - 1 &&
              !candidate.datasets.some((entry) => entry.name === dataset!.name)
            );
          case 'createField':
            return (
              next?.fields.some(
                (entry) =>
                  entry.name === payload.name &&
                  entry.dataField === payload.name &&
                  entry.type === payload.type,
              ) ?? false
            );
          case 'renameField':
            return (
              next?.fields[fieldIndex]?.name === payload.name &&
              next.fields[fieldIndex]?.dataField === field!.dataField
            );
          case 'deleteField':
            return (
              next?.fields.length === dataset!.fields.length - 1 &&
              !next.fields.some((entry) => entry.name === field!.name)
            );
          case 'setFieldType':
            return next?.fields[fieldIndex]?.type === payload.type;
          default:
            return false;
        }
      };
    } else if (payload.action === 'setPage') {
      if (
        intent.targetId !== root.id ||
        !report.section?.page ||
        !(pageProperties as readonly string[]).includes(payload.property)
      )
        return fail('Select a supported page/body property.');
      const property = payload.property as PageProperty;
      const errors =
        property === 'bodyWidth' || property === 'bodyHeight'
          ? (length(payload.value)?.pixels ?? 0) > 0
            ? []
            : [
                authoringError(
                  root,
                  'Body dimensions must be positive RdlSize values.',
                ),
              ]
          : validatePage({ ...report.section.page, [property]: payload.value });
      if (errors.length) return { ok: false, diagnostics: errors };
      plan = planPage(snapshot, report.section, property, payload.value);
      verify = (candidate) =>
        property === 'bodyWidth'
          ? candidate.section?.width === payload.value
          : property === 'bodyHeight'
            ? candidate.section?.height === payload.value
            : candidate.section?.page?.[property] === payload.value;
    } else if (payload.action === 'createTextbox') {
      if (intent.targetId !== root.id || !report.section)
        return fail('Select the report to create a body textbox.');
      const errors = validatePosition(root, payload.left, payload.top);
      if (errors.length) return { ok: false, diagnostics: errors };
      const name = nextName('Textbox', reportItemNames(root));
      created = { element: 'Textbox', name };
      plan = planCreateTextbox(
        snapshot,
        report.section,
        name,
        payload.left,
        payload.top,
      );
      verify = (candidate) =>
        candidate.textboxes.some(
          (textbox) =>
            textbox.context === 'body' &&
            textbox.name === name &&
            textbox.value?.text === '' &&
            textbox.bounds.left === payload.left &&
            textbox.bounds.top === payload.top,
        );
    } else if (
      [
        'createTable',
        'renameTable',
        'setTableDataset',
        'setTableProperty',
        'setColumnWidth',
        'setRowHeight',
        'deleteTable',
        'addColumn',
        'removeColumn',
        'addGroup',
        'changeGroup',
        'removeGroup',
        'addTotal',
        'changeTotal',
        'removeTotal',
      ].includes(payload.action)
    ) {
      const table =
        report.tables.find(
          (table) =>
            table.node.id === intent.targetId ||
            table.groups.some((group) => group.node.id === intent.targetId),
        ) ?? null;
      const errors = validateTableAction(
        root,
        report,
        table,
        intent.targetId,
        payload,
        snapshot.source,
      );
      if (errors.length) return { ok: false, diagnostics: errors };
      if (!report.section) return fail('Missing report section.');
      if (payload.action === 'deleteTable' && table) {
        for (const group of table.groups) {
          const errors = validateDataMutation(
            root,
            table.node,
            'group',
            group.name,
            snapshot.source,
          );
          if (errors.length) return { ok: false, diagnostics: errors };
        }
        for (const name of [
          table.name,
          ...table.rows.flatMap((row) =>
            row.cells.map((cell) => cell.textbox?.name ?? ''),
          ),
        ]) {
          const errors = validateDataMutation(
            root,
            table.node,
            'report-item',
            name,
            snapshot.source,
          );
          if (errors.length) return { ok: false, diagnostics: errors };
        }
      }
      if (
        table &&
        (payload.action === 'removeColumn' || payload.action === 'removeTotal')
      ) {
        const cells =
          payload.action === 'removeColumn'
            ? table.rows.map((row) => row.cells[Number(payload.column)]!)
            : table.rows[Number(payload.row)]!.cells;
        for (const cell of cells) {
          if (!cell.textbox) return fail('Cannot delete an unsupported cell.');
          const dependencies = validateDataMutation(
            root,
            cell.textbox.node,
            'report-item',
            cell.textbox.name ?? '',
            snapshot.source,
          );
          if (dependencies.length)
            return { ok: false, diagnostics: dependencies };
        }
      }
      if (payload.action === 'createTable')
        created = {
          element: 'Tablix',
          name: nextName('Table', reportItemNames(root)),
        };
      plan = planTable(
        snapshot,
        report.section,
        table,
        intent.targetId,
        payload,
        reportItemNames(root),
        'field' in payload ? fieldBinding(payload.field) : '',
        'field' in payload && 'scope' in payload
          ? sumExpression(payload.field, payload.scope)
          : '',
        created?.name,
      );
      const tableIndex = table ? report.tables.indexOf(table) : -1;
      verify = (candidate) => {
        const next =
          payload.action === 'createTable'
            ? candidate.tables.find((entry) => entry.name === created!.name)
            : candidate.tables[tableIndex];
        if (payload.action === 'deleteTable')
          return (
            candidate.tables.length === report.tables.length - 1 &&
            !candidate.tables.some((entry) => entry.name === table!.name)
          );
        if (!next?.structural) return false;
        switch (payload.action) {
          case 'createTable':
            return (
              next.dataset === null &&
              next.columns.length === 2 &&
              next.rows.length === 2 &&
              next.bounds.left === payload.left &&
              next.bounds.top === payload.top
            );
          case 'renameTable':
            return next.name === payload.name;
          case 'setTableDataset':
            return next.dataset === payload.dataset;
          case 'setTableProperty':
            return (
              next.bounds[payload.property as 'left' | 'top'] === payload.value
            );
          case 'setColumnWidth':
            return (
              next.columns[Number(payload.column)]?.width === payload.width
            );
          case 'setRowHeight':
            return next.rows[Number(payload.row)]?.height === payload.height;
          case 'addColumn':
            return (
              next.columns.length === table!.columns.length + 1 &&
              next.rows.every(
                (row) =>
                  row.cells.at(-1)?.textbox?.value?.text ===
                  fieldBinding(payload.field),
              )
            );
          case 'removeColumn':
            return next.columns.length === table!.columns.length - 1;
          case 'addGroup':
          case 'changeGroup':
            return next.groups.some(
              (group) =>
                group.name === payload.name &&
                group.expressions[0] === payload.expression,
            );
          case 'removeGroup':
            return next.groups.length === table!.groups.length - 1;
          case 'addTotal':
            return (
              next.rows.length === table!.rows.length + 1 &&
              next.totals.some(
                (total) =>
                  total.scope === payload.scope &&
                  total.expression ===
                    sumExpression(payload.field, payload.scope),
              )
            );
          case 'changeTotal':
            return (
              next.rows.length === table!.rows.length &&
              next.rows.some(
                (row) =>
                  row.cells[Number(payload.column)]?.textbox?.value?.text ===
                  sumExpression(payload.field, payload.scope),
              )
            );
          case 'removeTotal':
            return next.rows.length === table!.rows.length - 1;
          default:
            return false;
        }
      };
    } else if (payload.action === 'replaceImagePicture') {
      return fail('Replacing a picture opens the file chooser first.');
    } else if (payload.action === 'setImageProperty') {
      if (!image || image.context !== 'body')
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              IMAGE_TARGET_STALE,
              'The image no longer exists; select it again.',
              'stale-edit',
              root.range,
            ),
          ],
        };
      const property = payload.property as ImageScalarProperty;
      const known = (imageScalarProperties as readonly string[]).includes(
        property,
      );
      const capability = known ? validateImageCapability(image, property) : [];
      if (capability.length) return { ok: false, diagnostics: capability };
      if (property === 'name' && payload.value !== image.name) {
        const dependencies = validateTextboxRename(root, image);
        if (dependencies.length)
          return { ok: false, diagnostics: dependencies };
      }
      const errors = validateImageProperty({
        property,
        value: payload.value,
        range: image.node.range,
        existingNames: reportItemNames(root).filter(
          (entry) => entry !== image.name,
        ),
        definitions: report.embeddedImages,
      });
      if (errors.length) return { ok: false, diagnostics: errors };
      const imageValue = (entry: ImageItem): string | null => {
        switch (property) {
          case 'name':
            return entry.name;
          case 'sizing':
            return entry.sizing;
          case 'value':
            return entry.value?.kind === 'constant' ? entry.value.text : null;
          case 'toolTip':
            return entry.toolTip?.text ?? '';
        }
      };
      if (imageValue(image) === payload.value)
        return {
          ok: true,
          plan: patchPlan(snapshot, []),
          candidate: snapshot.source,
          changed: false,
        };
      plan = planImageProperty({
        snapshot,
        image,
        property,
        value: payload.value,
      });
      const imageIndex = report.images.indexOf(image);
      verify = (candidate) => {
        const next = candidate.images[imageIndex];
        return (
          candidate.images.length === report.images.length &&
          candidate.embeddedImages.length === report.embeddedImages.length &&
          next !== undefined &&
          imageValue(next) === payload.value &&
          (property !== 'value' || next.definition === payload.value)
        );
      };
    } else if (payload.action === 'deleteImage') {
      // Editable and geometry-only body images; preservation-only ones have no capabilities.
      if (
        !image ||
        image.context !== 'body' ||
        image.capabilities.length === 0 ||
        payload.confirm !== 'delete-contained-content'
      )
        return fail(
          'Explicitly confirm deletion of this supported body image and all its contained XML.',
        );
      const errors = validateDataMutation(
        root,
        image.node,
        'report-item',
        image.name ?? '',
        snapshot.source,
      );
      if (errors.length) return { ok: false, diagnostics: errors };
      // Only the Image element goes; EmbeddedImages keeps every definition.
      plan = patchPlan(snapshot, [sourcePatch(snapshot, image.node.range, '')]);
      verify = (candidate) =>
        candidate.images.length === report.images.length - 1 &&
        candidate.embeddedImages.length === report.embeddedImages.length &&
        (image.name === null ||
          !candidate.images.some((entry) => entry.name === image.name));
    } else {
      if (
        payload.action !== 'deleteTextbox' ||
        !textbox ||
        textbox.context !== 'body' ||
        payload.confirm !== 'delete-contained-content'
      )
        return fail(
          'Explicitly confirm deletion of this textbox and all its contained XML.',
        );
      const errors = validateDataMutation(
        root,
        textbox.node,
        'report-item',
        textbox.name ?? '',
        snapshot.source,
      );
      if (errors.length) return { ok: false, diagnostics: errors };
      plan = patchPlan(snapshot, [
        sourcePatch(snapshot, textbox.node.range, ''),
      ]);
      verify = (candidate) =>
        candidate.textboxes.length === report.textboxes.length - 1 &&
        !candidate.textboxes.some((entry) => entry.name === textbox.name);
    }
    const candidate = verifyCandidate(snapshot, plan, (syntax) => {
      const projected = projectReport(syntax);
      return projected.status === 'editable' && verify(projected);
    }).source;
    return {
      ok: true,
      plan,
      candidate,
      changed: candidate !== snapshot.source,
      ...(created ? { created } : {}),
    };
  } catch (error) {
    return fail(
      payload.action === 'setImageProperty'
        ? imageEditFailureMessage
        : error instanceof Error
          ? error.message
          : 'Authoring could not be verified.',
    );
  }
}

/** Reconcile parsed nodes by preserved source location and parent, never scene order. */
export function correlateTargets(
  original: XmlSyntaxDocument,
  result: XmlSyntaxDocument,
  plan: PatchPlan,
  targetIds: readonly string[],
): readonly TargetMapping[] {
  const index = (root: XmlNode | null) => {
    const nodes: { node: XmlNode; parent: XmlNode | null }[] = [];
    const visit = (node: XmlNode, parent: XmlNode | null) => {
      nodes.push({ node, parent });
      node.children.forEach((child) => visit(child, node));
    };
    if (root) visit(root, null);
    return nodes;
  };
  const before = new Map(
    index(original.root).map((entry) => [entry.node.id, entry]),
  );
  const after = new Map(
    index(result.root).map((entry) => [entry.node.range.start, entry]),
  );
  const translated = (start: number) =>
    start +
    plan.patches
      .filter((patch) => patch.end <= start)
      .reduce(
        (delta, patch) =>
          delta + patch.replacement.length - (patch.end - patch.start),
        0,
      );
  const mappings: TargetMapping[] = [];
  for (const sourceId of targetIds) {
    const entry = before.get(sourceId);
    if (!entry) continue;
    const { node, parent } = entry;
    const replacement = plan.patches.find(
      (patch) =>
        patch.start <= node.range.start &&
        patch.end >= node.range.end &&
        patch.end > patch.start,
    );
    if (replacement) {
      if (replacement.replacement === '')
        mappings.push({ sourceId, resultId: null });
      continue;
    }
    const candidate = after.get(translated(node.range.start));
    if (
      candidate &&
      candidate.node.expandedName.localName === node.expandedName.localName &&
      candidate.node.expandedName.namespaceUri ===
        node.expandedName.namespaceUri &&
      (parent
        ? candidate.parent?.range.start === translated(parent.range.start)
        : candidate.parent === null)
    )
      mappings.push({ sourceId, resultId: candidate.node.id });
  }
  return mappings;
}
