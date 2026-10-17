import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { XmlNode } from '@rdlc/report-model/syntax';
import {
  DESIGNER_NAMESPACE,
  RDL_2016,
  fieldTypes,
  type FieldType,
} from '@rdlc/report-model/report';
import { analyze } from '@rdlc/expressions/analyze';
import { validateName } from './validate.js';

export function authoringError(
  node: XmlNode,
  message: string,
  code = 'AUTHORING_BLOCKED',
): Diagnostic {
  return {
    code,
    message,
    range: node.range,
    severity: 'error',
    category: 'preservation-risk',
    correctiveAction:
      'Correct the value or update the affected references in source before retrying.',
    blockedOperations: ['requested-edit'],
  };
}
export function validateDatasetName(
  node: XmlNode,
  name: string,
  existing: readonly string[],
): readonly Diagnostic[] {
  return validateName(name, existing)
    ? []
    : [
        authoringError(
          node,
          'Use a unique CLS-compatible name in this scope.',
          'NAME_INVALID',
        ),
      ];
}
export function isFieldType(value: string): value is FieldType {
  return Object.hasOwn(fieldTypes, value);
}

/** Unknown extension semantics and dynamic references cannot prove a destructive edit safe. */
export function validateDataMutation(
  root: XmlNode,
  target: XmlNode,
  kind: 'dataset' | 'field' | 'group' | 'report-item',
  name: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const groups: string[] = [];
  const collect = (node: XmlNode) => {
    if (
      node.expandedName.namespaceUri === RDL_2016 &&
      node.expandedName.localName === 'Group'
    ) {
      const value = node.attributes.find(
        (attribute) =>
          attribute.expandedName.namespaceUri === '' &&
          attribute.expandedName.localName === 'Name',
      )?.value;
      if (value) groups.push(value);
    }
    node.children.forEach(collect);
  };
  collect(root);
  const expression = (text: string, node: XmlNode) => {
    if (!text.trimStart().startsWith('=')) return;
    const analysis = analyze(text.trimStart(), groups);
    if (!analysis.complete)
      diagnostics.push(
        authoringError(
          node,
          'Opaque expression may reference the selected name.',
          'REFERENCES_OPAQUE',
        ),
      );
    if (
      analysis.references.some(
        (reference) => reference.kind === kind && reference.name === name,
      )
    )
      diagnostics.push(
        authoringError(
          node,
          `${kind} ${name} is referenced here.`,
          'REFERENCE_IN_USE',
        ),
      );
  };
  const visit = (node: XmlNode) => {
    if (node === target) return;
    const namespace = node.expandedName.namespaceUri;
    if (
      namespace !== RDL_2016 &&
      !(
        namespace === DESIGNER_NAMESPACE &&
        node.expandedName.localName === 'TypeName'
      )
    )
      diagnostics.push(
        authoringError(
          node,
          'Unknown extension semantics may contain dependencies.',
          'REFERENCES_OPAQUE',
        ),
      );
    if (node.children.length === 0) expression(node.text, node);
    for (const attribute of node.attributes) {
      expression(attribute.value, node);
      if (
        attribute.expandedName.namespaceUri &&
        attribute.expandedName.namespaceUri !== 'http://www.w3.org/2000/xmlns/'
      )
        diagnostics.push(
          authoringError(
            node,
            'Unknown extension attribute may contain dependencies.',
            'REFERENCES_OPAQUE',
          ),
        );
    }
    const bindings =
      kind === 'dataset'
        ? ['DataSetName', 'DataSet', 'Scope']
        : kind === 'field'
          ? ['AggregateIndicatorField', 'RelationshipField', 'RelatedField']
          : kind === 'report-item'
            ? ['ToggleItem', 'RepeatWith']
            : ['Scope'];
    if (
      namespace === RDL_2016 &&
      bindings.includes(node.expandedName.localName) &&
      node.text === name
    )
      diagnostics.push(
        authoringError(
          node,
          `${kind} ${name} is referenced here.`,
          'REFERENCE_IN_USE',
        ),
      );
    node.children.forEach(visit);
  };
  visit(root);
  return diagnostics;
}
