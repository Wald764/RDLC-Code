import type {
  AcceptedNavigation,
  NavigationNode,
  NavigationProjection,
} from '@rdlc/report-model/navigation';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import type { ReportProjection } from '@rdlc/report-model/report';
import {
  createNavigationNode,
  dataCollections,
  navigationFacts,
  projectData,
} from './data.js';

const kinds: Readonly<Record<string, NavigationNode['kind']>> = {
  Report: 'report',
  ReportSections: 'sections',
  ReportSection: 'section',
  Body: 'body',
  PageHeader: 'header',
  PageFooter: 'footer',
  Textbox: 'textbox',
  Tablix: 'table',
  Table: 'table',
  TablixBody: 'table-body',
  TablixRow: 'table-row',
  TableRow: 'table-row',
  TablixCell: 'table-cell',
  TableCell: 'table-cell',
  TablixMember: 'member',
  Group: 'group',
  Grouping: 'group',
  TablixHeader: 'member-header',
  Rectangle: 'container',
  List: 'container',
  Matrix: 'container',
};
const wrappers = new Set([
  'ReportItems',
  'Page',
  'TablixRows',
  'TablixCells',
  'CellContents',
  'TablixRowHierarchy',
  'TablixColumnHierarchy',
  'TablixMembers',
  'TableRows',
  'TableCells',
  'Details',
  'Header',
  'Footer',
  'TableGroups',
  'TableGroup',
]);

/** Independent read-only syntax traversal; never broadens the parser's authoring namespace. */
export function projectNavigation(
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
): AcceptedNavigation {
  const structure: NavigationNode[] = [];
  let structureTruncated = false;
  const root = syntax.root;
  const version = syntax.snapshot.version;
  if (!root || syntax.status === 'invalid-source')
    return {
      version,
      structure: { nodes: [], truncated: false },
      data: { nodes: [], truncated: false },
    };
  const facts = navigationFacts(syntax, report);
  const { namespace, known, syntaxNodes } = facts;
  const visit = (
    node: XmlNode,
    parentId: string | null,
    depth: number,
  ): void => {
    const local = node.expandedName.localName;
    if (
      node !== root &&
      node.expandedName.namespaceUri === namespace &&
      local in dataCollections
    )
      return;
    const foreign = !known || node.expandedName.namespaceUri !== namespace;
    const item =
      node.parentId !== null &&
      syntaxNodes.get(node.parentId)?.expandedName.localName === 'ReportItems';
    const kind = foreign
      ? 'preserved'
      : (kinds[local] ?? (item ? 'preserved' : undefined));
    if (!kind && !wrappers.has(local)) return;
    if (!kind) {
      node.children.forEach((child) => visit(child, parentId, depth));
      return;
    }
    if (structure.length >= 2000 || depth >= 32) {
      structureTruncated = true;
      return;
    }
    structure.push(
      createNavigationNode(
        facts,
        node,
        parentId,
        kind,
        foreign || kind === 'container',
      ),
    );
    if (foreign || kind === 'textbox' || kind === 'preserved') return;
    node.children.forEach((child) => visit(child, node.id, depth + 1));
  };
  visit(root, null, 0);
  const data = projectData(syntax, report, facts);
  const structureBudget = Math.min(
    structure.length,
    1000 + Math.max(0, 1000 - data.nodes.length),
  );
  const dataBudget = Math.min(data.nodes.length, 2000 - structureBudget);
  const prefix = (
    nodes: readonly NavigationNode[],
    limit: number,
    truncated: boolean,
  ): NavigationProjection => ({
    nodes: nodes.slice(0, limit),
    truncated: truncated || nodes.length > limit,
  });
  return {
    version,
    structure: prefix(structure, structureBudget, structureTruncated),
    data: prefix(data.nodes, dataBudget, data.truncated),
  };
}
