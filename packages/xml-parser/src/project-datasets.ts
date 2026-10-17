import {
  DESIGNER_NAMESPACE,
  fieldTypes,
  type FieldType,
  type LocalDataset,
} from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { children } from './names.js';

export function nodeName(node: XmlNode): string {
  return (
    node.attributes.find(
      (attribute) =>
        attribute.expandedName.namespaceUri === '' &&
        attribute.expandedName.localName === 'Name',
    )?.value ?? ''
  );
}

export function projectDatasets(root: XmlNode | null): readonly LocalDataset[] {
  return (
    root
      ? children(root, 'DataSets').flatMap((container) =>
          children(container, 'DataSet'),
        )
      : []
  ).map((node) => ({
    node,
    name: nodeName(node),
    query: children(node, 'Query')[0] ?? null,
    fields: children(node, 'Fields')
      .flatMap((container) => children(container, 'Field'))
      .map((field) => {
        const types = field.children.filter(
          (child) =>
            child.expandedName.namespaceUri === DESIGNER_NAMESPACE &&
            child.expandedName.localName === 'TypeName',
        );
        const typeName = types.length === 1 ? types[0]!.text : null;
        return {
          node: field,
          name: nodeName(field),
          dataField: children(field, 'DataField')[0]?.text ?? null,
          calculatedValue: children(field, 'Value')[0]?.text ?? null,
          typeName,
          type:
            (Object.keys(fieldTypes) as FieldType[]).find(
              (key) => fieldTypes[key] === typeName,
            ) ?? null,
        };
      }),
  }));
}
