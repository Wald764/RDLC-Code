import type { CaptureRoot } from '@rdlc/report-model/clipboard';
import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { escapeAttribute } from './textboxes.js';
import {
  child,
  element,
  insertChild,
  patchPlan,
  sourcePatch,
} from './structure.js';

interface FragmentEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/**
 * Patch one captured subtree only for allocated identities, understood references,
 * geometry and root-local namespace closure; every other byte is preserved.
 */
export function transformRoot(
  root: CaptureRoot,
  input: {
    /** Copied old→new names across the whole capture. */
    readonly names: ReadonlyMap<string, string>;
    readonly geometry: Partial<
      Record<'left' | 'top' | 'width' | 'height', string>
    >;
    /** Namespace environment at the destination insertion parent. */
    readonly destination: Readonly<Record<string, string>>;
  },
): string {
  const edits: FragmentEdit[] = [];
  const rename = (name: string) => input.names.get(name) ?? name;
  for (const identity of root.identities)
    if (rename(identity.name) !== identity.name)
      edits.push({
        ...identity.range,
        replacement: escapeAttribute(rename(identity.name)),
      });
  for (const reference of root.references) {
    if (rename(reference.name) === reference.name) continue;
    if (!reference.range)
      throw new Error(
        `${reference.name} has no exact lexical operand; rewrite it in source before copying.`,
      );
    // Allocated names are identifiers, so neither text nor CDATA needs escaping.
    edits.push({ ...reference.range, replacement: rename(reference.name) });
  }
  const colon = root.qualifiedName.indexOf(':');
  const prefix = colon < 0 ? '' : root.qualifiedName.slice(0, colon);
  const tag = (name: string) => (prefix ? `${prefix}:${name}` : name);
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    const value = input.geometry[key];
    if (value === undefined) continue;
    const name = key[0]!.toUpperCase() + key.slice(1);
    const range = root.geometry[key];
    edits.push(
      range
        ? { ...range, replacement: value }
        : {
            start: root.contentStart,
            end: root.contentStart,
            replacement: `<${tag(name)}>${value}</${tag(name)}>`,
          },
    );
  }
  const declarations = root.inherited
    .filter((p) => p !== 'xml' && input.destination[p] !== root.namespaces[p])
    .map((p) => {
      if (p && !root.namespaces[p])
        throw new Error(`Copied prefix ${p} has no namespace binding.`);
      return ` ${p ? `xmlns:${p}` : 'xmlns'}="${escapeAttribute(root.namespaces[p] ?? '')}"`;
    });
  if (declarations.length)
    edits.push({
      start: 1 + root.qualifiedName.length,
      end: 1 + root.qualifiedName.length,
      replacement: declarations.join(''),
    });
  edits.sort((a, b) => a.start - b.start);
  let result = '';
  let end = 0;
  for (const edit of edits) {
    if (edit.start < end) throw new Error('Overlapping copied-fragment edits.');
    result += root.xml.slice(end, edit.start) + edit.replacement;
    end = edit.end;
  }
  return result + root.xml.slice(end);
}

/**
 * One insertion patch at the end of Body/ReportItems, creating or opening the
 * container when missing or self-closing. Returns each fragment's candidate offset.
 */
export function planInsertion(
  snapshot: DocumentSnapshot,
  body: XmlNode,
  fragments: readonly string[],
): { readonly plan: PatchPlan; readonly starts: readonly number[] } {
  const items = child(body, 'ReportItems');
  const xml = fragments.join('');
  let patch;
  let prefix: number;
  if (items) {
    patch = insertChild(snapshot, items, xml);
    prefix = items.closeRange
      ? 0
      : patch.replacement.length -
        xml.length -
        `</${items.qualifiedName}>`.length;
  } else {
    const wrapped = element(body, 'ReportItems', '\u0000');
    const at = body.closeRange ? body.openRange.end : null;
    if (at === null) throw new Error('Cannot insert into a self-closing Body.');
    patch = sourcePatch(
      snapshot,
      { start: at, end: at },
      wrapped.replace('\u0000', xml),
    );
    prefix = wrapped.indexOf('\u0000');
  }
  const starts: number[] = [];
  let offset = patch.start + prefix;
  for (const fragment of fragments) {
    starts.push(offset);
    offset += fragment.length;
  }
  return { plan: patchPlan(snapshot, [patch]), starts };
}

/** Remove every selected root in one plan; nothing else changes. */
export function planRemoval(
  snapshot: DocumentSnapshot,
  roots: readonly XmlNode[],
): PatchPlan {
  return patchPlan(
    snapshot,
    roots.map((root) => sourcePatch(snapshot, root.range, '')),
  );
}
