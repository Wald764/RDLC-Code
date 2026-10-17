import type { XmlNode } from '@rdlc/report-model/syntax';
import { RDL_2016 } from '@rdlc/report-model/report';

export { RDL_2016 };

export function children(node: XmlNode, name: string): readonly XmlNode[] {
  return node.children.filter(
    (child) =>
      child.expandedName.namespaceUri === RDL_2016 &&
      child.expandedName.localName === name,
  );
}

export function child(node: XmlNode, name: string): XmlNode | null {
  return children(node, name)[0] ?? null;
}
