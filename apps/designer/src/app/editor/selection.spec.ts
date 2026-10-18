import { describe, expect, it } from 'vitest';
import type { DesignSceneItem } from '@rdlc/report-model/scene';
import {
  emptySelection,
  selectItem,
  selectAll,
  marqueeSelection,
  mapSelection,
  hitTest,
} from './selection';

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
