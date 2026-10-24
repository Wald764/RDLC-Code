export type CreationKind = 'textbox' | 'table' | 'dataset';
export interface ComponentEntry {
  readonly kind: string;
  readonly label: string;
  readonly creatable: boolean;
  readonly reason: string | null;
}
export interface ComponentCategory {
  readonly label: string;
  readonly entries: readonly ComponentEntry[];
}

/** Inert catalog shared by the native toolbox and compact designer fallback. */
export const componentCatalog: readonly ComponentCategory[] = [
  {
    label: 'Report items',
    entries: ['Textbox', 'Table', 'Image', 'Line', 'Chart', 'Subreport'],
  },
  { label: 'Containers', entries: ['Rectangle', 'List', 'Matrix'] },
  { label: 'Data', entries: ['Dataset', 'Parameter'] },
].map((category) => ({
  label: category.label,
  entries: category.entries.map((label) => ({
    kind: label.toLowerCase(),
    label,
    creatable: ['Textbox', 'Table', 'Dataset'].includes(label),
    reason: ['Textbox', 'Table', 'Dataset'].includes(label)
      ? null
      : `${label} authoring is unavailable. Existing content is preserved; use Code XML.`,
  })),
}));

export function filterComponents(query: string): readonly ComponentCategory[] {
  const needle = query.trim().toLowerCase();
  return componentCatalog
    .map((category) => ({
      ...category,
      entries: category.entries.filter((entry) =>
        entry.label.toLowerCase().includes(needle),
      ),
    }))
    .filter((category) => category.entries.length > 0);
}
