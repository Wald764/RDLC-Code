import type {
  ReportSection,
  Table,
  TableRow,
  RowGroup,
  TotalDefinition,
  Textbox,
} from '@rdlc/report-model/report';
import { RDL_2016 } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { children } from './names.js';
import { nodeName } from './project-datasets.js';

export function projectTables(
  section: ReportSection | null,
  textboxes: readonly Textbox[],
): readonly Table[] {
  const body = section ? children(section.node, 'Body')[0] : null;
  const items = body ? children(body, 'ReportItems')[0] : null;
  return (items ? children(items, 'Tablix') : []).map((node) => {
    let reason: string | null = null;
    const one = (
      parent: XmlNode | null | undefined,
      name: string,
    ): XmlNode | null => {
      const found = parent ? children(parent, name) : [];
      if (found.length !== 1) reason = `Missing or duplicate ${name}.`;
      return found[0] ?? null;
    };
    const tablixBody = one(node, 'TablixBody');
    const columnsNode = one(tablixBody, 'TablixColumns');
    const rowsNode = one(tablixBody, 'TablixRows');
    const columnHierarchy = one(node, 'TablixColumnHierarchy');
    const columnMembers = one(columnHierarchy, 'TablixMembers');
    const rowHierarchy = one(node, 'TablixRowHierarchy');
    const rowMembers = one(rowHierarchy, 'TablixMembers');
    if (
      [columnHierarchy, rowHierarchy].some((hierarchy) =>
        hierarchy?.children.some(
          (child) =>
            child.expandedName.localName !== 'TablixMembers' ||
            child.expandedName.namespaceUri !== RDL_2016,
        ),
      )
    )
      reason = 'Unsupported hierarchy contents.';
    const columnNodes = columnsNode
      ? children(columnsNode, 'TablixColumn')
      : [];
    const staticColumns = columnMembers
      ? children(columnMembers, 'TablixMember')
      : [];
    const positive = (value: string) =>
      /^\d+(?:\.\d+)?(?:in|cm|mm|pt|pc)$/.test(value) &&
      Number.isFinite(parseFloat(value)) &&
      parseFloat(value) > 0;
    if (
      columnNodes.length === 0 ||
      columnNodes.length !== staticColumns.length ||
      staticColumns.some((member) => member.children.length > 0)
    )
      reason = 'Only flat static columns are structurally editable.';
    const columns = columnNodes.map((column, index) => ({
      node: column,
      width: children(column, 'Width')[0]?.text ?? '',
      member: staticColumns[index] ?? column,
    }));
    const leaves: XmlNode[] = [];
    const groups: RowGroup[] = [];
    const ancestors = new Map<string, readonly string[]>();
    const walk = (
      member: XmlNode,
      scopes: readonly string[],
      detailAncestor = false,
    ) => {
      const group = children(member, 'Group')[0];
      if (group && detailAncestor)
        reason = 'A detail member cannot have a dynamic member descendant.';
      if (group)
        groups.push({
          node: group,
          member,
          name: nodeName(group),
          expressions: children(group, 'GroupExpressions')
            .flatMap((container) => children(container, 'GroupExpression'))
            .map((expression) => expression.text),
        });
      const nested = children(member, 'TablixMembers').flatMap((container) =>
        children(container, 'TablixMember'),
      );
      const next = group ? [...scopes, nodeName(group)] : scopes;
      const detail =
        group !== undefined && children(group, 'GroupExpressions').length === 0;
      if (nested.length)
        nested.forEach((child) => walk(child, next, detailAncestor || detail));
      else {
        leaves.push(member);
        ancestors.set(member.id, scopes);
      }
    };
    if (rowMembers)
      children(rowMembers, 'TablixMember').forEach((member) =>
        walk(member, []),
      );
    const rowNodes = rowsNode ? children(rowsNode, 'TablixRow') : [];
    if (rowNodes.length !== leaves.length || rowNodes.length === 0)
      reason = 'Body rows must match row hierarchy leaves.';
    const rows: TableRow[] = rowNodes.map((row, index) => ({
      node: row,
      member: leaves[index] ?? row,
      height: children(row, 'Height')[0]?.text ?? '',
      cells: children(row, 'TablixCells')
        .flatMap((container) => children(container, 'TablixCell'))
        .map((cell) => {
          const contents = children(cell, 'CellContents');
          const boxes = contents.flatMap((content) =>
            children(content, 'Textbox'),
          );
          const textbox =
            boxes.length === 1
              ? (textboxes.find(
                  (textbox) => textbox.node.id === boxes[0]!.id,
                ) ?? null)
              : null;
          if (
            contents.length !== 1 ||
            !textbox?.value ||
            contents[0]!.children.length !== 1
          )
            reason =
              'Merged, spanning or unsupported cells are preservation-only.';
          return { node: cell, textbox };
        }),
    }));
    if (
      columns.some((column) => !positive(column.width)) ||
      rows.some(
        (row) => !positive(row.height) || row.cells.length !== columns.length,
      )
    )
      reason =
        'Positive dimensions and matching per-row cell counts are required.';
    const dataset = children(node, 'DataSetName')[0]?.text ?? null;
    const totals: TotalDefinition[] = [];
    for (const row of rows) {
      if (children(row.member, 'Group').length) continue;
      for (const cell of row.cells) {
        const expression = cell.textbox?.value?.text ?? '';
        const scope =
          /^=Sum\(Fields![\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]*\.Value, "([^"]+)"\)$/u.exec(
            expression,
          )?.[1];
        if (scope) {
          const kind = scope === dataset ? 'dataset' : 'group';
          if (
            kind === 'group' &&
            !ancestors.get(row.member.id)?.includes(scope)
          )
            reason =
              'Group totals must be static rows inside their named group.';
          if (
            kind === 'dataset' &&
            (ancestors.get(row.member.id)?.length ?? 0) > 0
          )
            reason = 'Dataset-wide totals must be outside the dynamic group.';
          totals.push({ cell, expression, scope, kind });
        }
      }
    }
    const known = new Set([
      'Tablix',
      'TablixBody',
      'TablixColumns',
      'TablixColumn',
      'Width',
      'TablixRows',
      'TablixRow',
      'Height',
      'TablixCells',
      'TablixCell',
      'CellContents',
      'Textbox',
      'TablixColumnHierarchy',
      'TablixRowHierarchy',
      'TablixMembers',
      'TablixMember',
      'Group',
      'GroupExpressions',
      'GroupExpression',
      'KeepWithGroup',
      'DataSetName',
      'Left',
      'Top',
      'Style',
    ]);
    const inspect = (current: XmlNode) => {
      if (
        current.expandedName.namespaceUri !== RDL_2016 ||
        !known.has(current.expandedName.localName)
      )
        reason = 'Opaque table structure is preservation-only.';
      if (
        current.expandedName.localName === 'Textbox' ||
        current.expandedName.localName === 'Style'
      )
        return;
      if (
        current.attributes.some(
          (attribute) =>
            attribute.expandedName.namespaceUri !==
              'http://www.w3.org/2000/xmlns/' &&
            !(
              attribute.expandedName.namespaceUri === '' &&
              attribute.expandedName.localName === 'Name'
            ),
        )
      )
        reason = 'Opaque structural attributes are preservation-only.';
      current.children.forEach(inspect);
    };
    inspect(node);
    for (const property of ['Left', 'Top', 'Width', 'Height']) {
      const value = children(node, property)[0]?.text;
      if (
        value !== undefined &&
        (property === 'Left' || property === 'Top'
          ? !/^\d+(?:\.\d+)?(?:in|cm|mm|pt|pc)$/.test(value)
          : !positive(value))
      )
        reason =
          'Expression-valued or invalid table geometry is preservation-only.';
    }
    return {
      node,
      name: nodeName(node),
      dataset,
      columns,
      rows,
      groups,
      totals,
      bounds: {
        left: children(node, 'Left')[0]?.text ?? '0in',
        top: children(node, 'Top')[0]?.text ?? '0in',
        width: children(node, 'Width')[0]?.text ?? null,
        height: children(node, 'Height')[0]?.text ?? null,
      },
      structural: reason === null,
      blockedReason: reason,
    };
  });
}
