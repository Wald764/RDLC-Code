import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { ReportSection } from '@rdlc/report-model/report';
import type { PatchPlan } from '@rdlc/report-model/editing';
import { child, element, insertChild, patchPlan } from './structure.js';
import { escapeAttribute } from './textboxes.js';

export function textboxXml(
  parent: ReportSection['node'],
  name: string,
  text = '',
  bounds = true,
  left = '0in',
  top = '0in',
  width = '2in',
  height = '0.3in',
): string {
  const e = (name: string, inner: string) => element(parent, name, inner);
  const content = e(
    'Paragraphs',
    e('Paragraph', e('TextRuns', e('TextRun', e('Value', text)))),
  );
  const geometry = bounds
    ? e('Left', left) + e('Top', top) + e('Width', width) + e('Height', height)
    : '';
  return e('Textbox', content + geometry).replace(
    '>',
    ` Name="${escapeAttribute(name)}">`,
  );
}
/** A new body textbox at the drop position with the 1in × 0.25in creation size. */
export function planCreateTextbox(
  snapshot: DocumentSnapshot,
  section: ReportSection,
  name: string,
  left: string,
  top: string,
): PatchPlan {
  const body = child(section.node, 'Body');
  if (!body) throw new Error('Missing Body.');
  const items = child(body, 'ReportItems');
  const xml = (parent: ReportSection['node']) =>
    textboxXml(parent, name, '', true, left, top, '1in', '0.25in');
  return patchPlan(snapshot, [
    insertChild(
      snapshot,
      items ?? body,
      items ? xml(items) : element(body, 'ReportItems', xml(body)),
    ),
  ]);
}
