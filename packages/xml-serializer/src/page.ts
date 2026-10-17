import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { ReportSection } from '@rdlc/report-model/report';
import { child, patchPlan, setScalar } from './structure.js';

export const pageProperties = [
  'width',
  'height',
  'top',
  'right',
  'bottom',
  'left',
  'bodyWidth',
  'bodyHeight',
] as const;
export type PageProperty = (typeof pageProperties)[number];
export function planPage(
  snapshot: DocumentSnapshot,
  section: ReportSection,
  property: PageProperty,
  value: string,
): PatchPlan {
  const parent =
    property === 'bodyWidth'
      ? section.node
      : property === 'bodyHeight'
        ? child(section.node, 'Body')
        : child(section.node, 'Page');
  if (!parent) throw new Error('Missing section property container.');
  const name =
    property === 'bodyWidth'
      ? 'Width'
      : property === 'bodyHeight'
        ? 'Height'
        : property === 'width'
          ? 'PageWidth'
          : property === 'height'
            ? 'PageHeight'
            : `${property[0]!.toUpperCase()}${property.slice(1)}Margin`;
  return patchPlan(snapshot, [setScalar(snapshot, parent, name, value)]);
}
