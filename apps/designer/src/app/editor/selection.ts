import type { TargetMapping } from '@rdlc/report-model/editing';
import type { StructureNode } from '@rdlc/report-model/protocol';
import type {
  Bounds,
  DesignScene,
  DesignSceneItem,
} from '@rdlc/report-model/scene';

export interface Selection {
  readonly version: number;
  readonly bodyItemIds: readonly string[];
  readonly primaryId: string | null;
  readonly cellTargetId: string | null;
  /** Creation may select an accepted local definition without inventing a canvas rectangle. */
  readonly structureTargetId?: string | null;
}

export function emptySelection(version: number): Selection {
  return { version, bodyItemIds: [], primaryId: null, cellTargetId: null };
}

export function selectItem(
  selection: Selection,
  item: DesignSceneItem,
  toggle: boolean,
): Selection {
  if (item.kind === 'cell')
    return { ...emptySelection(selection.version), cellTargetId: item.id };
  const ids = toggle ? [...selection.bodyItemIds] : [];
  const index = ids.indexOf(item.id);
  if (index < 0) ids.push(item.id);
  else ids.splice(index, 1);
  return {
    ...emptySelection(selection.version),
    bodyItemIds: ids,
    primaryId:
      index < 0
        ? item.id
        : selection.primaryId === item.id
          ? (ids.at(-1) ?? null)
          : selection.primaryId,
  };
}

/** Identity shared by Structure rows and Data definition rows. */
export interface MappableNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly name: string | null;
  /** Expanded XML type (`{namespace}Local`) when the projection provides it. */
  readonly expandedName?: string;
}

/**
 * The expanded type a row identifies as: Data rows carry the real XML name, so a
 * namespace or element change is a different definition. Legacy Structure rows
 * carry only their kind, and a preserved/opaque row without an expanded type has
 * no trustworthy type at all — it never maps rather than guessing from the name.
 */
function expandedType(node: MappableNode): string | null {
  if (node.expandedName) return node.expandedName;
  return node.kind === 'preserved' || node.kind === 'opaque' ? null : node.kind;
}

/**
 * The unnamed structural spine named by the Data Model: report, sections,
 * section and body may keep tree expansion. Content and Data kinds never do.
 */
const expandableUnnamed = new Set(['report', 'sections', 'section', 'body']);

export function selectStructure(
  selection: Selection,
  id: string,
  items: readonly DesignSceneItem[],
  toggle: boolean,
  nodes: readonly StructureNode[] = [],
): Selection {
  const node = nodes.find((node) => node.id === id);
  const cellContents =
    node?.kind === 'cell' && !node.preservedReason
      ? items.filter(
          (item) =>
            item.kind === 'cell' &&
            nodes.some(
              (child) =>
                child.parentId === id &&
                child.id === item.id &&
                !child.preservedReason,
            ),
        )
      : [];
  const item =
    items.find((item) => item.id === id) ??
    (cellContents.length === 1 ? cellContents[0] : undefined);
  return item
    ? selectItem(selection, item, toggle)
    : { ...emptySelection(selection.version), structureTargetId: id };
}

/**
 * Expanded type, declared name and ancestry must be unique in both versions;
 * unnamed ancestors contribute type only.
 */
export function structureMappings(
  from: readonly MappableNode[],
  to: readonly MappableNode[],
  /**
   * View state only (tree expansion): also map unnamed nodes whose kind and
   * ancestry are unique, but only for the unnamed structural spine. Never for
   * selection.
   */
  unnamed = false,
): TargetMapping[] {
  const identities = (nodes: readonly MappableNode[]) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const keys = new Map<string, string>();
    const unique = new Map<string, string | null>();
    for (const node of nodes) {
      const type = expandedType(node);
      // No expanded type: no identity, and its descendants are pruned below.
      if (type === null) continue;
      const ancestors: string[] = [];
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      while (parent) {
        ancestors.unshift(`${expandedType(parent) ?? ''}:${parent.name ?? ''}`);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      const key = JSON.stringify([ancestors, type, node.name]);
      keys.set(node.id, key);
      unique.set(key, unique.has(key) ? null : node.id);
    }
    for (const node of nodes) {
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      while (parent) {
        const parentKey = keys.get(parent.id);
        if (!parentKey || !unique.get(parentKey)) keys.delete(node.id);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
    }
    return { keys, unique };
  };
  const before = identities(from),
    after = identities(to);
  return from.map((node) => {
    const key = before.keys.get(node.id);
    const resultId =
      key &&
      (node.name || (unnamed && expandableUnnamed.has(node.kind))) &&
      before.unique.get(key)
        ? (after.unique.get(key) ?? null)
        : null;
    return {
      sourceId: node.id,
      resultId: resultId && after.keys.has(resultId) ? resultId : null,
    };
  });
}

export function reconcileStructureSelection(
  selection: Selection,
  from: readonly MappableNode[],
  to: readonly MappableNode[],
  version: number,
): Selection | null {
  const result = structureMappings(from, to).find(
    (mapping) => mapping.sourceId === selection.structureTargetId,
  )?.resultId;
  return result
    ? { ...emptySelection(version), structureTargetId: result }
    : null;
}

export function selectAll(
  version: number,
  items: readonly DesignSceneItem[],
): Selection {
  const ids = items
    .filter((i) => i.kind !== 'cell')
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .map((i) => i.id);
  return {
    ...emptySelection(version),
    bodyItemIds: ids,
    primaryId: ids.at(-1) ?? null,
  };
}

export function marqueeSelection(
  selection: Selection,
  items: readonly DesignSceneItem[],
  rect: Bounds,
  add: boolean,
): Selection {
  const enclosed = items.filter(
    (i) =>
      i.kind !== 'cell' &&
      i.bounds &&
      i.bounds.left >= rect.left &&
      i.bounds.top >= rect.top &&
      i.bounds.left + i.bounds.width <= rect.left + rect.width &&
      i.bounds.top + i.bounds.height <= rect.top + rect.height,
  );
  let result = add
    ? { ...selection, cellTargetId: null }
    : emptySelection(selection.version);
  for (const item of enclosed.sort(
    (a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0),
  ))
    if (!result.bodyItemIds.includes(item.id))
      result = selectItem(result, item, true);
  return result;
}

export function mapSelection(
  selection: Selection,
  version: number,
  mappings: readonly TargetMapping[],
): Selection {
  const mapped = (id: string | null) =>
    mappings.find((m) => m.sourceId === id)?.resultId ?? null;
  const ids = selection.bodyItemIds
    .map(mapped)
    .filter((id): id is string => id !== null);
  return {
    version,
    bodyItemIds: ids,
    primaryId: mapped(selection.primaryId) ?? ids.at(-1) ?? null,
    cellTargetId: mapped(selection.cellTargetId),
    ...(selection.structureTargetId
      ? { structureTargetId: mapped(selection.structureTargetId) }
      : {}),
  };
}

export function hitTest(
  items: readonly DesignSceneItem[],
  x: number,
  y: number,
): DesignSceneItem | null {
  return (
    [...items]
      .sort(
        (a, b) =>
          (b.zIndex ?? 0) - (a.zIndex ?? 0) ||
          (b.sourceOrder ?? 0) - (a.sourceOrder ?? 0),
      )
      .find(
        (i) =>
          i.bounds &&
          x >= i.bounds.left &&
          y >= i.bounds.top &&
          x <= i.bounds.left + i.bounds.width &&
          y <= i.bounds.top + i.bounds.height,
      ) ?? null
  );
}

/** Structural identity for independent versions: name, kind and parent; never an ordinal or ID. */
function identity(item: DesignSceneItem, scene: DesignScene): string | null {
  // The scene carries no expanded type for preserved content, so kind and name
  // never prove that two versions hold the same element.
  if (!item.name || item.kind === 'preserved') return null;
  const parent = item.parentTableId
    ? scene.items.find((i) => i.id === item.parentTableId)?.name
    : '';
  if (parent === undefined || parent === null) return null;
  if (
    item.parentTableId &&
    scene.items.filter(
      (candidate) => candidate.kind === 'table' && candidate.name === parent,
    ).length !== 1
  )
    return null;
  return `${item.kind ?? ''}\u0000${parent}\u0000${item.name}`;
}

/** Returns null when any selected member lacks a unique identity in either version. */
export function reconcileSelection(
  selection: Selection,
  from: DesignScene,
  to: DesignScene,
): Selection | null {
  const unique = (scene: DesignScene) => {
    const map = new Map<string, string | null>();
    for (const item of scene.items) {
      const key = identity(item, scene);
      if (key !== null) map.set(key, map.has(key) ? null : item.id);
    }
    return map;
  };
  const before = unique(from),
    after = unique(to);
  const mapped = (id: string | null): string | null | undefined => {
    if (id === null) return null;
    const item = from.items.find((i) => i.id === id);
    const key = item ? identity(item, from) : null;
    if (key === null || !before.get(key)) return undefined;
    return after.get(key) ?? undefined;
  };
  const ids = selection.bodyItemIds.map(mapped);
  const primary = mapped(selection.primaryId),
    cell = mapped(selection.cellTargetId);
  if (ids.includes(undefined) || primary === undefined || cell === undefined)
    return null;
  return {
    version: to.version,
    bodyItemIds: ids as string[],
    primaryId: primary,
    cellTargetId: cell,
  };
}
