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
): string {
  const e = (name: string, inner: string) => element(parent, name, inner);
  const content = e(
    'Paragraphs',
    e('Paragraph', e('TextRuns', e('TextRun', e('Value', text)))),
  );
  const geometry = bounds
    ? e('Left', '0in') +
      e('Top', '0in') +
      e('Width', '2in') +
      e('Height', '0.3in')
    : '';
  return e('Textbox', content + geometry).replace(
    '>',
    ` Name="${escapeAttribute(name)}">`,
  );
}
export function planCreateTextbox(
  snapshot: DocumentSnapshot,
  section: ReportSection,
  name: string,
): PatchPlan {
  const body = child(section.node, 'Body');
  if (!body) throw new Error('Missing Body.');
  const items = child(body, 'ReportItems');
  return patchPlan(snapshot, [
    insertChild(
      snapshot,
      items ?? body,
      items
        ? textboxXml(items, name)
        : element(body, 'ReportItems', textboxXml(body, name)),
    ),
  ]);
}
