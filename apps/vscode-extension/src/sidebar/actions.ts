import {
  dataKinds,
  type NavigationNode,
  type NavigationOperation,
} from '@rdlc/report-model/navigation';
import type { DesignScene } from '@rdlc/report-model/scene';
import type { ClipboardAction } from '@rdlc/report-model/clipboard';
import type { NativeIntent } from './host-context.js';

/** Eligibility is checked again by the captured host/session and existing clipboard engine. */
export function clipboardIntent(
  node: NavigationNode,
  scene: DesignScene | null,
  action: ClipboardAction,
): NativeIntent {
  if (
    !node.capabilities.some(
      (capability) =>
        capability.operation === 'clipboard' && capability.eligible,
    ) ||
    !scene?.items.some((item) => item.id === node.id && item.kind !== 'cell')
  )
    throw new Error(
      'Clipboard actions require an eligible report body item. Inspect Code XML for this target.',
    );
  return {
    action: 'clipboard',
    clipboard: action,
    ...(action === 'duplicate' ? { unit: 'pt' } : {}),
  };
}

/** Finite structure context actions; each one reuses an existing designer workflow. */
export type StructureAction = 'delete' | 'table' | 'group';

export interface StructureRoute {
  /** The existing properties route; no native intent carries a mutation payload. */
  readonly intent: NativeIntent;
  readonly targetIds: readonly string[];
  /** Accessible guidance shown once the existing form owns the interaction. */
  readonly notice: string;
}

const labels: Record<StructureAction, string> = {
  delete: 'Deletion',
  table: 'Table editing',
  group: 'Group editing',
};

const notices: Record<StructureAction, string> = {
  delete:
    'Confirm deletion of contained XML in Properties. Nothing is deleted until you confirm there; reference and preservation guards still apply.',
  table:
    'Columns, rows, groups and totals are edited in the existing table properties form.',
  group:
    'Groups are edited in the existing table properties form of the owning table.',
};

function eligible(
  node: NavigationNode | undefined,
  operation: NavigationOperation,
): boolean {
  return !!node?.capabilities.some(
    (capability) => capability.operation === operation && capability.eligible,
  );
}

/**
 * Group and table editing reuse the owning table's existing form, which is the
 * only surface that owns group/column/row questions; structural rows have no
 * canvas item of their own.
 */
function owningTable(
  node: NavigationNode,
  nodes: readonly NavigationNode[],
): NavigationNode | undefined {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  let parentId = node.parentId;
  // Projection parents are acyclic; the hop budget keeps a forged chain bounded.
  for (let hops = 0; parentId && hops <= nodes.length; hops++) {
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (parent.kind === 'table') return parent;
    parentId = parent.parentId;
  }
  return undefined;
}

/**
 * Guard at execution time and route through the existing properties/forms path:
 * deletion keeps its required contained-XML acknowledgement in the designer's own
 * form, so this host never auto-confirms a destructive payload.
 */
export function structureIntent(
  node: NavigationNode,
  scene: DesignScene | null,
  action: StructureAction,
  nodes: readonly NavigationNode[] = [],
): StructureRoute {
  const label = labels[action];
  let target = node;
  if (action === 'table' && node.kind !== 'table')
    throw new Error(
      'Table editing requires a table target in Report Structure.',
    );
  if (action === 'group') {
    if (node.kind !== 'group')
      throw new Error(
        'Group editing requires a group target in Report Structure.',
      );
    const table = owningTable(node, nodes);
    if (!table)
      throw new Error(
        'Group editing requires a group inside a report table. Inspect Code XML for this target.',
      );
    target = table;
  }
  const capability = target.capabilities.find(
    (entry) => entry.operation === 'properties',
  );
  if (!capability?.eligible)
    throw new Error(
      `${label} is unavailable for this target. ${capability?.reason ?? 'Inspect Code XML.'}`,
    );
  const item = scene?.items.find(
    (entry) => entry.id === target.id && entry.kind !== 'cell',
  );
  if (!item)
    throw new Error(
      `${label} requires an editable report body item. Inspect Code XML for this target.`,
    );
  if (item.placeholder)
    throw new Error(
      `${label} is unavailable for this target. ${target.opaqueReason ?? 'Preservation-only content; inspect Code XML.'}`,
    );
  return {
    intent: { action: 'properties' },
    targetIds: [target.id],
    notice: notices[action],
  };
}

/** Data authoring exists only for datasets and their fields. */
const dataFormKinds: ReadonlySet<NavigationNode['kind']> = new Set([
  'dataset',
  'field',
]);

function isDataKind(kind: NavigationNode['kind']): boolean {
  return (dataKinds as readonly string[]).includes(kind);
}

/** Finite Data actions; each one reuses an existing designer form or creation route. */
export type DataAction = 'add-field' | 'edit' | 'rename' | 'delete';

/** Data routes keep the same finite shape as structure routes: intent, exact targets, guidance. */
export type DataRoute = StructureRoute;

const dataLabels: Record<DataAction, string> = {
  'add-field': 'Field creation',
  edit: 'Data editing',
  rename: 'Renaming',
  delete: 'Deletion',
};

const dataNotices: Record<DataAction, string> = {
  'add-field':
    'New fields are added in the existing dataset form of the owning dataset.',
  edit: 'Edits are applied in the existing dataset form; nothing changes until you confirm there.',
  rename:
    'Renaming is applied in the existing dataset form; the declared name stays authoritative until you confirm there.',
  delete:
    'Deletion runs in the existing dataset form. Reference and preservation guards still apply; nothing is deleted until you confirm there.',
};

/**
 * Guard the actual data node kind and its captured capability before anything
 * opens: parameters, embedded images, data sources, opaque definitions and
 * unsupported fields stay inspect/source-only, and this host never sends a
 * typed author payload, so the existing form keeps every draft, reference and
 * preservation guard (and its own acknowledgement) for the mutation itself.
 */
export function dataIntent(
  node: NavigationNode,
  action: DataAction,
  nodes: readonly NavigationNode[] = [],
): DataRoute {
  const label = dataLabels[action];
  if (!isDataKind(node.kind))
    throw new Error(
      `${label} requires a dataset or field target in Report Data.`,
    );
  if (!dataFormKinds.has(node.kind))
    throw new Error(
      `${label} is unavailable for this target. Parameters, embedded images, data sources and unsupported definitions stay inspect/source-only; inspect Code XML.`,
    );
  let target = node;
  if (action === 'add-field' && node.kind !== 'dataset') {
    const owner = nodes.find((entry) => entry.id === node.parentId);
    if (!owner || owner.kind !== 'dataset')
      throw new Error(
        'Field creation requires a field inside a dataset. Inspect Code XML for this target.',
      );
    target = owner;
  }
  for (const candidate of [node, target]) {
    const capability = candidate.capabilities.find(
      (entry) => entry.operation === 'properties',
    );
    if (!capability?.eligible)
      throw new Error(
        `${label} is unavailable for this target. ${capability?.reason ?? 'Inspect Code XML.'}`,
      );
  }
  return {
    intent: { action: 'properties' },
    targetIds: [target.id],
    notice: dataNotices[action],
  };
}

/**
 * Existing dataset creation route: the designer applies its automatic
 * defaults, so this host contributes no name, schema or mutation payload and
 * no target selection of its own.
 */
export function datasetCreateRoute(): DataRoute {
  return {
    intent: { action: 'create', create: 'dataset' },
    targetIds: [],
    notice:
      'A dataset is created by the existing creation route with its automatic defaults; edit it in the dataset form.',
  };
}

/**
 * Menu visibility only: unavailable rows stay inspect/source-only and every
 * handler above rechecks the captured capability before acting.
 */
export function structureContextValue(
  node: NavigationNode,
  table: NavigationNode | undefined,
  scene: DesignScene | null,
): string {
  // Data rows: only an eligible dataset/field claims the existing form's key.
  if (isDataKind(node.kind))
    return dataFormKinds.has(node.kind) && eligible(node, 'properties')
      ? `rdlcCode.${node.kind}`
      : 'rdlcCode.source';
  const target = node.kind === 'group' ? table : node;
  if (!target || !eligible(target, 'properties')) return 'rdlcCode.source';
  // Preservation-only members expose no mutation entry; the row keeps its reason.
  if (
    scene?.items.some(
      (entry) =>
        entry.id === target.id && entry.kind !== 'cell' && entry.placeholder,
    )
  )
    return 'rdlcCode.source';
  if (node.kind === 'group') return 'rdlcCode.group';
  const base = eligible(node, 'clipboard')
    ? 'rdlcCode.body'
    : 'rdlcCode.editable';
  return node.kind === 'table' ? `${base}.table` : base;
}
