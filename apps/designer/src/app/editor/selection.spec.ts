import { describe, expect, it } from 'vitest';
import type { DesignScene, DesignSceneItem } from '@rdlc/report-model/scene';
import {
  emptySelection,
  selectItem,
  selectAll,
  marqueeSelection,
  mapSelection,
  hitTest,
  reconcileSelection,
  selectStructure,
  reconcileStructureSelection,
  structureMappings,
} from './selection';
import type {
  NavigationNode,
  StructureNode,
} from '@rdlc/report-model/protocol';

const node = (
  id: string,
  kind: StructureNode['kind'],
  name: string | null,
  parentId: string | null = null,
): StructureNode => ({
  id,
  kind,
  name,
  parentId,
  label: name ?? kind,
  range: { start: 0, end: 0 },
  preservedReason: null,
});

/** Data projection rows carry only the identity reconciliation needs. */
const dataRow = (
  id: string,
  kind: NavigationNode['kind'],
  name: string | null,
  parentId: string | null = null,
  expandedName?: string,
) => ({
  id,
  kind,
  name,
  parentId,
  ...(expandedName ? { expandedName } : {}),
});

describe('version-scoped structural selection', () => {
  it('joins scene IDs and keeps data, cells and body membership exclusive', () => {
    const body = selectAll(1, items);
    const data = selectStructure(body, 'dataset', items, false);
    expect(data.bodyItemIds).toEqual([]);
    expect(data.structureTargetId).toBe('dataset');
    expect(selectStructure(data, '1:4', items, true).cellTargetId).toBe('1:4');
    const next = selectStructure(data, '1:1', items, true);
    expect(next.structureTargetId).toBeFalsy();
    expect(next.bodyItemIds).toContain(next.primaryId);
    const nodes = [
      node('1:c', 'cell', null),
      node('1:4', 'textbox', 'CellValue', '1:c'),
    ];
    expect(selectStructure(data, '1:c', items, false, nodes).cellTargetId).toBe(
      '1:4',
    );
  });
  it('retains only unique dataset/field identities from Data in both versions, never IDs or positions', () => {
    const before = [
      dataRow('1:d', 'dataset', 'Sales'),
      dataRow('1:f', 'field', 'Amount', '1:d'),
    ];
    const after = [
      dataRow('2:d', 'dataset', 'Sales'),
      dataRow('2:f', 'field', 'Amount', '2:d'),
    ];
    const selection = selectStructure(emptySelection(1), '1:f', [], false);
    const reconciled = reconcileStructureSelection(selection, before, after, 2);
    expect(reconciled?.structureTargetId).toBe('2:f');
    expect(reconciled?.bodyItemIds).toEqual([]);
    expect(reconciled?.cellTargetId).toBeNull();
    expect(
      reconcileStructureSelection(
        selection,
        before,
        [...after, dataRow('2:x', 'field', 'Amount', '2:d')],
        2,
      ),
    ).toBeNull();
    expect(
      reconcileStructureSelection(
        selection,
        [...before, dataRow('1:x', 'dataset', 'Sales')],
        after,
        2,
      ),
    ).toBeNull();
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:r', [], false),
        [node('1:r', 'row', null)],
        [node('2:r', 'row', null)],
        2,
      ),
    ).toBeNull();
    expect(
      mapSelection(selection, 2, [{ sourceId: '1:f', resultId: '2:f' }])
        .structureTargetId,
    ).toBe('2:f');
  });
  it('preserves expansion for unnamed report/sections/section/body only, never other unnamed kinds', () => {
    const version = (v: number): StructureNode[] => [
      node(`${v}:r`, 'report', null),
      node(`${v}:c`, 'sections', null, `${v}:r`),
      node(`${v}:s`, 'section', null, `${v}:c`),
      node(`${v}:b`, 'body', null, `${v}:s`),
      node(`${v}:t`, 'textbox', null, `${v}:b`),
      node(`${v}:x`, 'container', null, `${v}:b`),
    ];
    const expansion = new Map(
      structureMappings(version(1), version(2), true).map(
        (mapping) => [mapping.sourceId, mapping.resultId] as const,
      ),
    );
    expect(expansion.get('1:r')).toBe('2:r');
    expect(expansion.get('1:c')).toBe('2:c');
    expect(expansion.get('1:s')).toBe('2:s');
    expect(expansion.get('1:b')).toBe('2:b');
    expect(expansion.get('1:t')).toBeNull();
    expect(expansion.get('1:x')).toBeNull();
    // Selection mapping never follows an unnamed identity at all.
    const selection = new Map(
      structureMappings(version(1), version(2)).map(
        (mapping) => [mapping.sourceId, mapping.resultId] as const,
      ),
    );
    expect([...selection.values()].filter(Boolean)).toEqual([]);
  });
  it('corresponds Data definitions by expanded type, name and ancestry — never by name alone', () => {
    const widget = (id: string, namespace: string) =>
      dataRow(id, 'opaque', 'Thing', null, `{${namespace}}Widget`);
    const selection = selectStructure(emptySelection(1), '1:w', [], false);
    // Same expanded type, name and ancestry: the same definition in both versions.
    expect(
      reconcileStructureSelection(
        selection,
        [widget('1:w', 'urn:one')],
        [widget('2:w', 'urn:one')],
        2,
      )?.structureTargetId,
    ).toBe('2:w');
    // Same kind and name, different element: never map selection onto it.
    expect(
      reconcileStructureSelection(
        selection,
        [widget('1:w', 'urn:one')],
        [widget('2:w', 'urn:two')],
        2,
      ),
    ).toBeNull();
    // Without an expanded type, kind and name alone are not an identity.
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:o', [], false),
        [dataRow('1:o', 'opaque', 'Thing')],
        [dataRow('2:o', 'opaque', 'Thing')],
        2,
      ),
    ).toBeNull();
    // An ancestor whose expanded type changed invalidates its named descendant.
    const family = (v: number, namespace: string) => [
      dataRow(`${v}:d`, 'dataset', 'Sales', null, `{${namespace}}DataSet`),
      dataRow(`${v}:f`, 'field', 'Amount', `${v}:d`, '{urn:rdlc}Field'),
    ];
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:f', [], false),
        family(1, 'urn:one'),
        family(2, 'urn:two'),
        2,
      ),
    ).toBeNull();
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:f', [], false),
        family(1, 'urn:one'),
        family(2, 'urn:one'),
        2,
      )?.structureTargetId,
    ).toBe('2:f');
  });
  it('keeps known legacy Structure kinds mappable and fails closed without an expanded type', () => {
    // Legacy rows carry no expanded XML name; a recognized kind stays its own type.
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:t', [], false),
        [node('1:t', 'textbox', 'Title')],
        [node('2:t', 'textbox', 'Title')],
        2,
      )?.structureTargetId,
    ).toBe('2:t');
    // A preserved row exposes no expanded type, so name and kind must not decide.
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:w', [], false),
        [node('1:w', 'preserved', 'Widget')],
        [node('2:w', 'preserved', 'Widget')],
        2,
      ),
    ).toBeNull();
    // A row under a type-less ancestor is equally unidentifiable.
    expect(
      reconcileStructureSelection(
        selectStructure(emptySelection(1), '1:c', [], false),
        [
          node('1:w', 'preserved', 'Widget'),
          node('1:c', 'preserved', 'Inner', '1:w'),
        ],
        [
          node('2:w', 'preserved', 'Widget'),
          node('2:c', 'preserved', 'Inner', '2:w'),
        ],
        2,
      ),
    ).toBeNull();
  });
});

const items: DesignSceneItem[] = [
  {
    id: '1:1',
    kind: 'textbox',
    sourceOrder: 0,
    zIndex: 1,
    label: 'A',
    placeholder: false,
    bounds: { left: 0, top: 0, width: 10, height: 10 },
  },
  {
    id: '1:2',
    kind: 'table',
    sourceOrder: 1,
    zIndex: 2,
    label: 'B',
    placeholder: false,
    bounds: { left: 0, top: 0, width: 20, height: 20 },
  },
  {
    id: '1:3',
    kind: 'preserved',
    sourceOrder: 2,
    label: 'Locked',
    placeholder: true,
    bounds: null,
  },
  {
    id: '1:4',
    kind: 'cell',
    parentTableId: '1:2',
    label: 'Cell',
    placeholder: false,
    bounds: { left: 0, top: 0, width: 5, height: 5 },
  },
];

describe('ordered body selection', () => {
  it('toggles membership, promotes the last remaining member and keeps cells exclusive', () => {
    let selection = selectItem(emptySelection(1), items[0]!, false);
    selection = selectItem(selection, items[1]!, true);
    expect(selection.bodyItemIds).toEqual(['1:1', '1:2']);
    expect(selection.primaryId).toBe('1:2');
    selection = selectItem(selection, items[1]!, true);
    expect(selection.primaryId).toBe('1:1');
    selection = selectItem(selection, items[3]!, true);
    expect(selection.bodyItemIds).toEqual([]);
    expect(selection.cellTargetId).toBe('1:4');
    expect(selectItem(selection, items[0]!, true).cellTargetId).toBeNull();
  });

  it('selects all placeholders but not cells; marquee requires complete known bounds and adds in source order', () => {
    expect(selectAll(1, items).bodyItemIds).toEqual(['1:1', '1:2', '1:3']);
    const rect = { left: 0, top: 0, width: 15, height: 15 };
    expect(
      marqueeSelection(emptySelection(1), items, rect, false).bodyItemIds,
    ).toEqual(['1:1']);
    const initial = selectItem(emptySelection(1), items[2]!, false);
    expect(
      marqueeSelection(
        initial,
        [...items].reverse(),
        { ...rect, width: 20, height: 20 },
        true,
      ).bodyItemIds,
    ).toEqual(['1:3', '1:1', '1:2']);
  });

  it('maps all members and primary by proven IDs only at the matching version', () => {
    const selection = selectAll(1, items);
    const mappings = [
      { sourceId: '1:1', resultId: '2:8' },
      { sourceId: '1:2', resultId: '2:9' },
      { sourceId: '1:3', resultId: null },
    ];
    expect(mapSelection(selection, 2, mappings)).toEqual({
      version: 2,
      bodyItemIds: ['2:8', '2:9'],
      primaryId: '2:9',
      cellTargetId: null,
    });
  });

  it('hits higher drawing priority then later source ties, never inventing bounds', () => {
    expect(
      hitTest(
        items.filter((i) => i.kind !== 'cell'),
        2,
        2,
      )?.id,
    ).toBe('1:2');
    expect(hitTest([{ ...items[0]!, zIndex: 2 }, items[1]!], 2, 2)?.id).toBe(
      '1:2',
    );
    expect(hitTest(items, 100, 100)).toBeNull();
  });
});

describe('scene selection reconciliation', () => {
  const frame = { left: 0, top: 0, width: 600, height: 800 };
  const scene = (
    version: number,
    items: readonly DesignSceneItem[],
  ): DesignScene => ({ version, page: frame, body: frame, items });
  const item = (
    id: string,
    kind: NonNullable<DesignSceneItem['kind']>,
    name: string | null,
  ): DesignSceneItem => ({
    id,
    kind,
    name,
    label: name ?? kind,
    placeholder: kind === 'preserved',
    bounds: null,
    sourceOrder: 0,
  });

  it('never maps a preserved item by kind and name alone, while recognized names correspond', () => {
    const selection = selectItem(
      emptySelection(1),
      item('1:5', 'preserved', 'Rectangle'),
      false,
    );
    // The scene carries no expanded type for preserved content, so kind and name
    // cannot prove that two versions hold the same element.
    expect(
      reconcileSelection(
        selection,
        scene(1, [item('1:5', 'preserved', 'Rectangle')]),
        scene(2, [item('2:5', 'preserved', 'Rectangle')]),
      ),
    ).toBeNull();
    const named = selectItem(
      emptySelection(1),
      item('1:6', 'textbox', 'Title'),
      false,
    );
    expect(
      reconcileSelection(
        named,
        scene(1, [item('1:6', 'textbox', 'Title')]),
        scene(2, [item('2:6', 'textbox', 'Title')]),
      )?.bodyItemIds,
    ).toEqual(['2:6']);
  });
});
