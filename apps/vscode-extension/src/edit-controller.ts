import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type {
  EditIntent,
  PatchPlan,
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
