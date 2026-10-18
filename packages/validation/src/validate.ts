import type { LengthValue, Page } from '@rdlc/report-model/report';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { Reference } from '@rdlc/report-model/expressions';

const scale: Readonly<Record<string, number>> = {
  in: 96,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
};
export function length(raw: string): LengthValue | null {
  const match = /^(-?\d+(?:\.\d+)?)(pt|pc|in|mm|cm)$/.exec(raw);
  if (!match) return null;
  const pixels = Number(match[1]) * scale[match[2]!]!;
  return Number.isFinite(pixels) ? { raw, pixels } : null;
}

function diagnostic(
  code: string,
  message: string,
  category: Diagnostic['category'] = 'invalid-value',
): Diagnostic {
  return {
    code,
    message,
    category,
    severity: 'error',
    range: { start: 0, end: 0 },
    correctiveAction:
      'Correct the authored value or inspect the affected references in source.',
    blockedOperations: ['requested-edit'],
  };
}
export function validatePage(page: Page): readonly Diagnostic[] {
  const values = Object.fromEntries(
    Object.entries(page).map(([key, raw]) => [key, length(raw)?.pixels]),
  );
  if (
    Object.values(values).some((value) => value === undefined) ||
    !(values.width! > 0) ||
    !(values.height! > 0) ||
    ['top', 'right', 'bottom', 'left'].some((key) => !(values[key]! >= 0)) ||
    !(values.width! - values.left! - values.right! > 0) ||
    !(values.height! - values.top! - values.bottom! > 0)
  )
    return [
      diagnostic(
        'PAGE_DIMENSIONS',
        'Use positive page dimensions, nonnegative margins and a positive printable area.',
      ),
    ];
  return [];
}

export function validateName(
  name: string,
  existingInScope: readonly string[],
): boolean {
  return (
    /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*$/u.test(
      name,
    ) && !existingInScope.includes(name)
  );
}
export function uniqueName(
  prefix: string,
  existingInScope: readonly string[],
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix))
    throw new Error(
      'New name prefix must be an ASCII CLS-compatible identifier',
    );
  let candidate = prefix;
  let suffix = 0;
  while (existingInScope.includes(candidate))
    candidate = `${prefix}${++suffix}`;
  return candidate;
}

/** Report Builder default names: the stem plus the lowest free positive integer (Textbox1, Textbox2…). */
export function nextName(
  stem: string,
  existingInScope: readonly string[],
): string {
  return uniqueName(stem, [stem, ...existingInScope]);
}

export function validateMutation(input: {
  readonly operation: 'rename' | 'delete' | 'move' | 'setValue';
  readonly capability: boolean;
  readonly targetName: string;
  readonly references: readonly Reference[];
  readonly complete: boolean;
}): readonly Diagnostic[] {
  if (!input.capability)
    return [
      diagnostic(
        'CAPABILITY_BLOCKED',
        'This operation is not supported for this construct.',
        'unsupported',
      ),
    ];
  if (input.operation !== 'rename' && input.operation !== 'delete') return [];
  const affected = input.references.filter(
    (reference) => reference.name === input.targetName,
  );
  if (affected.length)
    return affected.map((reference) => ({
      ...diagnostic(
        'REFERENCE_IN_USE',
        `${reference.kind} ${reference.name} is referenced; update the dependent expression first.`,
        'preservation-risk',
      ),
      range: reference.range,
    }));
  return input.complete
    ? []
    : [
        diagnostic(
          'REFERENCES_OPAQUE',
          'Incomplete reference analysis cannot exclude dependencies; preserve the target.',
          'preservation-risk',
        ),
      ];
}
