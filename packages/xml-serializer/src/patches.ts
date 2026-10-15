import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';

export function applyPlan(
  snapshot: DocumentSnapshot,
  plan: PatchPlan,
  scopes: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string {
  if (snapshot.version !== plan.version) throw new Error('Stale patch plan');
  for (const dependency of plan.namespaceDependencies)
    if (scopes[dependency.nodeId]?.[dependency.prefix] !== dependency.uri)
      throw new Error('Unresolved namespace dependency');
  for (const range of plan.footprint)
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > snapshot.source.length
    )
      throw new Error('Invalid edit footprint');
  let end = 0;
  let previousStart = -1;
  let result = '';
  for (const patch of plan.patches) {
    if (
      patch.version !== snapshot.version ||
      !Number.isSafeInteger(patch.start) ||
      !Number.isSafeInteger(patch.end) ||
      patch.start < end ||
      patch.start === previousStart ||
      patch.start < 0 ||
      patch.end < patch.start ||
      patch.end > snapshot.source.length
    )
      throw new Error('Invalid, overlapping, unsorted or stale patch range');
    if (snapshot.source.slice(patch.start, patch.end) !== patch.expected)
      throw new Error('Expected source changed');
    if (
      !plan.footprint.some(
        (range) => range.start <= patch.start && range.end >= patch.end,
      )
    )
      throw new Error('Patch exceeds declared edit footprint');
    result += snapshot.source.slice(end, patch.start) + patch.replacement;
    end = patch.end;
    previousStart = patch.start;
  }
  return result + snapshot.source.slice(end);
}
