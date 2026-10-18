import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { AuthoringIntent, PatchPlan } from '@rdlc/report-model/editing';
import {
  DESIGNER_NAMESPACE,
  fieldTypes,
  type DatasetField,
  type LocalDataset,
  type FieldType,
} from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { escapeAttribute, escapeText } from './textboxes.js';
import {
  child,
  element,
  insertChild,
  patchPlan,
  renameNode,
  sourcePatch,
} from './structure.js';

export function planDataset(
  snapshot: DocumentSnapshot,
  root: XmlNode,
  dataset: LocalDataset | null,
  field: DatasetField | null,
  payload: AuthoringIntent['payload'],
  /** Host-allocated name for `createDataset`. */
  createdName = '',
): PatchPlan {
  switch (payload.action) {
    case 'createDataset': {
      const container = child(root, 'DataSets');
      const parent = container ?? root;
      const xml = element(
        parent,
        'DataSet',
        element(parent, 'CaseSensitivity', 'Auto'),
      ).replace('>', ` Name="${escapeAttribute(createdName)}">`);
      return patchPlan(snapshot, [
        insertChild(
          snapshot,
          parent,
          container ? xml : element(parent, 'DataSets', xml),
        ),
      ]);
    }
    case 'renameDataset':
    case 'renameField':
      return patchPlan(snapshot, [
        renameNode(snapshot, field?.node ?? dataset!.node, payload.name),
      ]);
    case 'deleteField': {
      if (dataset!.fields.length > 1)
        return patchPlan(snapshot, [
          sourcePatch(snapshot, field!.node.range, ''),
        ]);
      const fields = child(dataset!.node, 'Fields')!;
      if (fields.attributes.length || fields.children.length !== 1)
        throw new Error(
          'The last-field container has preserved content; edit it in source.',
        );
      const preserved =
        snapshot.source.slice(fields.openRange.end, field!.node.range.start) +
        snapshot.source.slice(field!.node.range.end, fields.closeRange!.start);
      const replacement =
        preserved +
        (dataset!.node.children.length === 1
          ? element(dataset!.node, 'CaseSensitivity', 'Auto')
          : '');
      return patchPlan(snapshot, [
        sourcePatch(snapshot, fields.range, replacement),
      ]);
    }
    case 'deleteDataset': {
      const container = child(root, 'DataSets')!;
      if (container.children.length > 1)
        return patchPlan(snapshot, [
          sourcePatch(snapshot, dataset!.node.range, ''),
        ]);
      if (
        !container.closeRange ||
        container.attributes.some(
          (attribute) =>
            attribute.expandedName.namespaceUri !==
            'http://www.w3.org/2000/xmlns/',
        )
      )
        throw new Error('Dataset container metadata is preservation-only.');
      const preserved =
        snapshot.source.slice(
          container.openRange.end,
          dataset!.node.range.start,
        ) +
        snapshot.source.slice(
          dataset!.node.range.end,
          container.closeRange.start,
        );
      return patchPlan(snapshot, [
        sourcePatch(snapshot, container.range, preserved),
      ]);
    }
    case 'createField': {
      const parent = child(dataset!.node, 'Fields') ?? dataset!.node;
      let prefix = Object.entries(parent.namespaces).find(
        ([prefix, uri]) => prefix && uri === DESIGNER_NAMESPACE,
      )?.[0];
      let declaration = '';
      if (!prefix) {
        prefix = 'rd';
        let suffix = 0;
        while (Object.hasOwn(parent.namespaces, prefix))
          prefix = `rd${++suffix}`;
        declaration = ` xmlns:${prefix}="${DESIGNER_NAMESPACE}"`;
      }
      const inner =
        element(parent, 'DataField', escapeText(payload.name)) +
        `<${prefix}:TypeName${declaration}>${fieldTypes[payload.type as FieldType]}</${prefix}:TypeName>`;
      const xml = element(parent, 'Field', inner).replace(
        '>',
        ` Name="${escapeAttribute(payload.name)}">`,
      );
      return patchPlan(snapshot, [
        insertChild(
          snapshot,
          parent,
          parent === dataset!.node ? element(parent, 'Fields', xml) : xml,
        ),
      ]);
    }
    case 'setFieldType': {
      const node = field!.node.children.find(
        (node) =>
          node.expandedName.namespaceUri === DESIGNER_NAMESPACE &&
          node.expandedName.localName === 'TypeName',
      );
      if (!node?.closeRange || node.children.length)
        throw new Error('Type metadata is preservation-only.');
      return patchPlan(snapshot, [
        sourcePatch(
          snapshot,
          { start: node.openRange.end, end: node.closeRange.start },
          fieldTypes[payload.type as FieldType],
        ),
      ]);
    }
    default:
      throw new Error('Not a dataset action.');
  }
}
