import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type {
  EditIntent,
  PatchPlan,
  AuthoringIntent,
  TextboxProperty,
} from '@rdlc/report-model/editing';
import type { ReportProjection, Textbox } from '@rdlc/report-model/report';
import type { XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { planTextboxProperty } from '@rdlc/xml-serializer/textboxes';
import {
  reportItemNames,
  validateTextboxCapability,
  validateTextboxProperty,
  validateTextboxRename,
} from '@rdlc/validation/textboxes';
import { verifyCandidate } from './verify-candidate.js';
import { planDataset } from '@rdlc/xml-serializer/datasets';
import {
  planPage,
  pageProperties,
  type PageProperty,
} from '@rdlc/xml-serializer/page';
import { planCreateTextbox } from '@rdlc/xml-serializer/authoring';
import { patchPlan, sourcePatch } from '@rdlc/xml-serializer/structure';
import {
  authoringError,
  isFieldType,
  validateDatasetName,
  validateDataMutation,
} from '@rdlc/validation/datasets';
import { length, validatePage } from '@rdlc/validation/validate';
import { validateTableAction } from '@rdlc/validation/tables';
import { planTable } from '@rdlc/xml-serializer/tables';
import { fieldBinding, sumExpression } from '@rdlc/expressions/totals';

export type PlanOutcome =
  | {
      readonly ok: true;
      readonly plan: PatchPlan;
      readonly candidate: string;
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
  return { ok: true, plan, candidate };
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
  let plan: PatchPlan;
  let verify: (candidate: ReportProjection) => boolean;
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
        (!field || !field.type)
      )
        return fail('Unknown or absent field types are read-only.');
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
          payload.action === 'createDataset' ||
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
        );
        if (errors.length) return { ok: false, diagnostics: errors };
      }
      plan = planDataset(snapshot, root, dataset, field, payload);
      const datasetIndex = dataset ? report.datasets.indexOf(dataset) : -1;
      const fieldIndex = field ? dataset!.fields.indexOf(field) : -1;
      verify = (candidate) => {
        const next = candidate.datasets[datasetIndex];
        switch (payload.action) {
          case 'createDataset':
            return candidate.datasets.some(
              (entry) =>
                entry.name === payload.name &&
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
      const errors = validateDatasetName(
        root,
        payload.name,
        reportItemNames(root),
      );
      if (errors.length) return { ok: false, diagnostics: errors };
      plan = planCreateTextbox(snapshot, report.section, payload.name);
      verify = (candidate) =>
        candidate.textboxes.some(
          (textbox) =>
            textbox.context === 'body' &&
            textbox.name === payload.name &&
            textbox.value?.text === '',
        );
    } else if (
      [
        'createTable',
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
          );
          if (dependencies.length)
            return { ok: false, diagnostics: dependencies };
        }
      }
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
      );
      const tableIndex = table ? report.tables.indexOf(table) : -1;
      verify = (candidate) => {
        const next =
          payload.action === 'createTable'
            ? candidate.tables.find((entry) => entry.name === payload.name)
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
              next.dataset === payload.dataset &&
              next.columns.length === 1 &&
              next.rows[0]?.cells[0]?.textbox?.value?.text ===
                fieldBinding(payload.field)
            );
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
    return { ok: true, plan, candidate };
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : 'Authoring could not be verified.',
    );
  }
}
