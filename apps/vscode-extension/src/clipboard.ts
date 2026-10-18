import { randomUUID } from 'node:crypto';
import {
  captureBudget,
  clipboardFormat,
  clipboardVersion,
  tokenBudget,
  type Capture,
  type CaptureIdentity,
  type CaptureReference,
  type CaptureRoot,
  type ClipboardAction,
} from '@rdlc/report-model/clipboard';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type {
  DocumentSnapshot,
  SourceRange,
} from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import {
  formatSize,
  toPoints,
  type SizeUnit,
} from '@rdlc/report-model/geometry';
import { RDL_2016, type ReportProjection } from '@rdlc/report-model/report';
import type { Bounds } from '@rdlc/report-model/scene';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { analyze } from '@rdlc/expressions/analyze';
import { rawOperandRange } from '@rdlc/expressions/references';
import { acceptedGeometry } from '@rdlc/validation/layout';
import {
  allocateNames,
  clipboardError,
  inertAnnotation,
  nameIndex,
  validateDestination,
} from '@rdlc/validation/clipboard';
import { validateRemoval } from '@rdlc/validation/datasets';
import {
  planInsertion,
  planRemoval,
  transformRoot,
} from '@rdlc/xml-serializer/clipboard';
import { child } from '@rdlc/xml-serializer/structure';
import {
  verifyCandidate,
  verifyClipboardCandidate,
} from './verify-candidate.js';

export interface Evaluated {
  readonly snapshot: DocumentSnapshot;
  readonly syntax: XmlSyntaxDocument;
  readonly projection: ReportProjection;
}
type Refusal = {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
};
const refuse = (code: string, message: string, action?: string): Refusal => ({
  ok: false,
  diagnostics: [clipboardError(code, message, action)],
});
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const prefixOf = (qualified: string) =>
  qualified.includes(':') ? qualified.slice(0, qualified.indexOf(':')) : '';
const nameAttribute = (node: XmlNode) =>
  node.attributes.find(
    (a) =>
      a.expandedName.namespaceUri === '' && a.expandedName.localName === 'Name',
  );
const content = (node: XmlNode): SourceRange =>
  node.closeRange
    ? { start: node.openRange.end, end: node.closeRange.start }
    : { start: node.openRange.end, end: node.openRange.end };

/** Selected complete body subtrees in source order, with typed dependency proof. */
export function buildCapture(
  current: Evaluated,
  targetIds: readonly string[],
):
  | {
      readonly ok: true;
      readonly capture: Capture;
      readonly nodes: readonly XmlNode[];
    }
  | Refusal {
  const { snapshot, syntax, projection } = current;
  const source = snapshot.source;
  if (projection.status !== 'editable' || !projection.section || !syntax.root)
    return refuse('SOURCE_ONLY', 'Fix source diagnostics before copying.');
  if (!targetIds.length || new Set(targetIds).size !== targetIds.length)
    return refuse('SELECTION_INVALID', 'Select one or more unique body items.');
  const selected: {
    node: XmlNode;
    kind: CaptureRoot['kind'];
    bounds: Bounds;
    raw: CaptureRoot['raw'];
    provenance: CaptureRoot['provenance'];
  }[] = [];
  for (const id of targetIds) {
    const table = projection.tables.find((t) => t.node.id === id);
    const textbox = projection.textboxes.find(
      (t) => t.node.id === id && t.context === 'body',
    );
    const item = table ?? textbox;
    if (
      !item ||
      (table && !table.structural) ||
      (textbox &&
        (!textbox.name ||
          !textbox.node.closeRange ||
          !textbox.capabilities.includes('left') ||
          !textbox.capabilities.includes('top')))
    )
      return refuse(
        'SELECTION_UNSUPPORTED',
        `${id}: copy only complete named body textboxes or supported tables.`,
      );
    const geometry = acceptedGeometry(projection, item, !!table);
    const keys = ['left', 'top', 'width', 'height'] as const;
    if (keys.some((key) => geometry[key].points === null))
      return refuse(
        'BOUNDS_UNKNOWN',
        `${item.name}: bounds are unknown or expression-valued; correct them in source.`,
      );
    selected.push({
      node: item.node,
      kind: table ? 'table' : 'textbox',
      bounds: Object.fromEntries(
        keys.map((key) => [key, geometry[key].points!]),
      ) as unknown as Bounds,
      raw: item.bounds,
      provenance: Object.fromEntries(
        keys.map((key) => [key, geometry[key].provenance]),
      ) as CaptureRoot['provenance'],
    });
  }
  selected.sort((a, b) => a.node.range.start - b.node.range.start);
  if (
    syntax.tokens.some(
      (token) =>
        token.kind === 'processing-instruction' &&
        selected.some(
          ({ node }) =>
            token.range.start >= node.range.start &&
            token.range.end <= node.range.end,
        ),
    )
  )
    return refuse(
      'METADATA_UNCLASSIFIED',
      'A processing instruction inside the selection may carry dependencies.',
    );
  // Pass 1: every nested identity, so references between selected roots stay internal.
  const identities = new Map<string, CaptureIdentity['element']>();
  const collect = (node: XmlNode) => {
    const name = nameAttribute(node);
    if (node.expandedName.namespaceUri === RDL_2016 && name)
      identities.set(name.value, node.expandedName.localName);
    node.children.forEach(collect);
  };
  selected.forEach(({ node }) => collect(node));
  const datasets = new Map<string, Set<string>>();
  const require = (dataset: string, field?: string) => {
    const fields = datasets.get(dataset) ?? new Set<string>();
    if (field !== undefined) fields.add(field);
    datasets.set(dataset, fields);
  };
  const roots: CaptureRoot[] = [];
  try {
    for (const entry of selected) {
      const root = entry.node;
      const base = root.range.start;
      const relative = (range: SourceRange | null) =>
        range && { start: range.start - base, end: range.end - base };
      const rootIdentities: CaptureIdentity[] = [];
      const references: CaptureReference[] = [];
      const inherited = new Set<string>();
      const fail = (message: string): never => {
        throw new Error(message);
      };
      const scope = (name: string, range: SourceRange | null) => {
        const element = identities.get(name);
        if (element === 'Group' || element === 'Tablix')
          references.push({ kind: 'scope', name, range: relative(range) });
        else if (projection.datasets.some((d) => d.name === name))
          require(name);
        else
          fail(
            `Scope ${name} is outside the copied selection; copy its group or data region too.`,
          );
      };
      const visit = (
        node: XmlNode,
        declared: ReadonlySet<string>,
        dataset: string | null,
      ) => {
        const own = new Set(declared);
        for (const a of node.attributes)
          if (a.qualifiedName === 'xmlns') own.add('');
          else if (a.qualifiedName.startsWith('xmlns:'))
            own.add(a.qualifiedName.slice(6));
        if (!own.has(prefixOf(node.qualifiedName)))
          inherited.add(prefixOf(node.qualifiedName));
        if (inertAnnotation(node, source)) return;
        if (node.expandedName.namespaceUri !== RDL_2016)
          fail(
            `Unclassified metadata ${node.qualifiedName} may carry identities or dependencies.`,
          );
        for (const a of node.attributes) {
          if (
            a.expandedName.namespaceUri === XMLNS ||
            a.qualifiedName === 'xmlns'
          )
            continue;
          if (
            a.expandedName.namespaceUri === '' &&
            a.expandedName.localName === 'Name'
          ) {
            const kind =
              node.expandedName.localName === 'Group' ? 'group' : 'report-item';
            rootIdentities.push({
              kind,
              element: node.expandedName.localName,
              name: a.value,
              range: relative(a.valueRange)!,
            });
            continue;
          }
          fail(
            `Unclassified attribute ${a.qualifiedName} may carry identities or dependencies.`,
          );
        }
        const local = node.expandedName.localName;
        const context =
          local === 'Tablix'
            ? (child(node, 'DataSetName')?.text ?? null)
            : dataset;
        if (node.children.length) {
          for (const next of node.children) visit(next, own, context);
          return;
        }
        const text = node.text;
        const whole = (kind: CaptureReference['kind']) =>
          references.push({
            kind,
            name: text,
            range: relative(
              rawOperandRange(source, content(node), text, {
                start: 0,
                end: text.length,
              }),
            ),
          });
        if (local === 'ToggleItem') whole('textbox');
        else if (local === 'RepeatWith') whole('data-region');
        else if (local === 'DataSetName') require(text);
        else if (local === 'Scope')
          scope(
            text,
            rawOperandRange(source, content(node), text, {
              start: 0,
              end: text.length,
            }),
          );
        else if (text.trimStart().startsWith('=')) {
          const lead = text.length - text.trimStart().length;
          const analysis = analyze(text.trimStart());
          if (!analysis.complete)
            fail(
              `${node.qualifiedName}: an opaque or dynamic expression cannot be proven safe to copy.`,
            );
          const operand = (range: SourceRange | undefined) =>
            range
              ? rawOperandRange(source, content(node), text, {
                  start: range.start + lead,
                  end: range.end + lead,
                })
              : null;
          const scopes = analysis.references
            .filter((r) => r.kind === 'group' || r.kind === 'dataset')
            .map((r) => r.name)
            .filter((name) => projection.datasets.some((d) => d.name === name));
          for (const reference of analysis.references) {
            if (reference.kind === 'field') {
              const owner =
                context ?? (new Set(scopes).size === 1 ? scopes[0]! : null);
              if (!owner)
                fail(
                  `Field ${reference.name} has no resolvable dataset scope; add an explicit dataset scope.`,
                );
              require(owner!, reference.name);
            } else if (reference.kind === 'report-item')
              references.push({
                kind: 'textbox',
                name: reference.name,
                range: relative(operand(reference.nameRange)),
              });
            else scope(reference.name, operand(reference.nameRange));
          }
        }
      };
      visit(root, new Set(), null);
      const geometry = (name: string) => {
        const node = child(root, name);
        return node?.closeRange && !node.children.length
          ? relative(content(node))
          : null;
      };
      roots.push({
        kind: entry.kind,
        xml: source.slice(root.range.start, root.range.end),
        namespaces: { ...root.namespaces },
        inherited: [...inherited],
        qualifiedName: root.qualifiedName,
        contentStart: root.openRange.end - base,
        bounds: entry.bounds,
        raw: entry.raw,
        provenance: entry.provenance,
        geometry: {
          left: geometry('Left'),
          top: geometry('Top'),
          width: geometry('Width'),
          height: geometry('Height'),
        },
        identities: rootIdentities,
        references,
      });
    }
  } catch (error) {
    return refuse(
      'DEPENDENCY_UNPROVEN',
      error instanceof Error ? error.message : 'Dependencies are unproven.',
    );
  }
  const requirements: Capture['datasets'][number][] = [];
  for (const [name, fields] of datasets) {
    const dataset = projection.datasets.filter((d) => d.name === name);
    if (dataset.length !== 1)
      return refuse(
        'DATASET_MISSING',
        `Dataset ${name} is not uniquely declared.`,
      );
    const definitions = [];
    for (const field of fields) {
      const found = dataset[0]!.fields.filter((f) => f.name === field);
      if (
        found.length !== 1 ||
        !found[0]!.typeName ||
        !found[0]!.type ||
        found[0]!.calculatedValue !== null
      )
        return refuse(
          'DATASET_UNPROVEN',
          `Field ${name}.${field} is missing, calculated or has an unknown type.`,
        );
      definitions.push({
        name: field,
        dataField: found[0]!.dataField,
        typeName: found[0]!.typeName,
      });
    }
    requirements.push({ name, fields: definitions });
  }
  const draft = {
    id: randomUUID(),
    schema: RDL_2016,
    profile: 'rdlc-code/interactive' as const,
    formatVersion: clipboardVersion as typeof clipboardVersion,
    roots,
    datasets: requirements,
  };
  const size = new TextEncoder().encode(JSON.stringify(draft)).length;
  if (size > captureBudget)
    return refuse(
      'CAPTURE_TOO_LARGE',
      'The selection exceeds the 8 MiB clipboard budget; copy fewer items.',
    );
  return {
    ok: true,
    capture: deepFreeze({ ...draft, size }),
    nodes: selected.map((s) => s.node),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export type Planned =
  | {
      readonly ok: true;
      readonly plan: PatchPlan;
      readonly candidate: string;
      /** Candidate offsets of inserted roots; empty for removal. */
      readonly starts: readonly number[];
      readonly warnings: readonly Diagnostic[];
    }
  | Refusal;

/** Insert a complete capture at `offsetPt` on both axes as one verified candidate. */
export function planPaste(
  current: Evaluated,
  capture: Capture,
  offsetPt: number,
  unit: SizeUnit,
): Planned {
  const { snapshot, syntax, projection } = current;
  const errors = validateDestination(capture, syntax.root, projection);
  if (errors.length) return { ok: false, diagnostics: errors };
  const section = projection.section!;
  const body = child(section.node, 'Body');
  if (!body) return refuse('SOURCE_ONLY', 'The report has no body.');
  try {
    const names = allocateNames(capture, nameIndex(syntax.root));
    const destination = (child(body, 'ReportItems') ?? body).namespaces;
    const bodyWidth = toPoints(section.width);
    const bodyHeight = toPoints(section.height);
    const expected: Bounds[] = [];
    const warnings: Diagnostic[] = [];
    const fragments = capture.roots.map((root) => {
      const left = root.bounds.left + offsetPt;
      const top = root.bounds.top + offsetPt;
      const geometry: Partial<Record<keyof Bounds, string>> = {
        left: formatSize(left, root.raw.left, unit, 'position'),
        top: formatSize(top, root.raw.top, unit, 'position'),
      };
      // Keep the captured physical size; materialize only when derivation would change it.
      for (const [key, container, start] of [
        ['width', bodyWidth, left],
        ['height', bodyHeight, top],
      ] as const)
        if (
          root.kind === 'textbox' &&
          root.provenance[key] === 'derived' &&
          (container === null ||
            Math.abs(container - start - root.bounds[key]) > 0.01)
        )
          geometry[key] = formatSize(root.bounds[key], null, unit, 'dimension');
      const bounds = { ...root.bounds, left, top };
      expected.push(bounds);
      if (
        (bodyWidth !== null && left + bounds.width > bodyWidth + 0.01) ||
        (bodyHeight !== null && top + bounds.height > bodyHeight + 0.01)
      )
        warnings.push({
          ...clipboardError(
            'PASTE_OVERFLOW',
            'A pasted item extends beyond the body; it was inserted unchanged.',
            'Move the item or enlarge the body.',
          ),
          severity: 'warning',
          blockedOperations: [],
        });
      return transformRoot(root, { names, geometry, destination });
    });
    const { plan, starts } = planInsertion(snapshot, body, fragments);
    const candidate = verifyCandidate(snapshot, plan, (next, original) =>
      verifyClipboardCandidate(original, next, {
        inserted: capture.roots.map((root, i) => ({
          root,
          start: starts[i]!,
          fragment: fragments[i]!,
          bounds: expected[i]!,
        })),
        names,
        removed: [],
      }),
    ).source;
    return { ok: true, plan, candidate, starts, warnings };
  } catch (error) {
    return refuse(
      'PASTE_REFUSED',
      error instanceof Error ? error.message : 'Paste could not be verified.',
    );
  }
}

/** Remove every captured root in one verified candidate after whole-set guards. */
export function planCut(
  current: Evaluated,
  capture: Capture,
  nodes: readonly XmlNode[],
): Planned {
  const { snapshot, syntax } = current;
  const errors = validateRemoval(
    syntax.root!,
    nodes,
    capture.roots.flatMap((r) => r.identities),
    snapshot.source,
  );
  if (errors.length) return { ok: false, diagnostics: errors };
  try {
    const plan = planRemoval(snapshot, nodes);
    const candidate = verifyCandidate(snapshot, plan, (next, original) =>
      verifyClipboardCandidate(original, next, {
        inserted: [],
        names: new Map(),
        removed: nodes,
      }),
    ).source;
    return { ok: true, plan, candidate, starts: [], warnings: [] };
  } catch (error) {
    return refuse(
      'CUT_REFUSED',
      error instanceof Error ? error.message : 'Cut could not be verified.',
    );
  }
}

export interface ClipboardIO {
  readText(): PromiseLike<string>;
  writeText(value: string): PromiseLike<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Window-owned retention of one immutable capture; only a token reaches the OS clipboard. */
export class WindowClipboard {
  readonly window = randomUUID();
  private retained: Capture | null = null;
  private generationValue = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly io: ClipboardIO) {}

  get generation(): number {
    return this.generationValue;
  }

  /** Serializes capture replacement so concurrent views cannot pair a token with another capture. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Writes the token first; the capture becomes usable only after a successful write. */
  install(capture: Capture): Promise<boolean> {
    return this.serial(async () => {
      const token = JSON.stringify({
        format: clipboardFormat,
        version: clipboardVersion,
        window: this.window,
        capture: capture.id,
      });
      try {
        await this.io.writeText(token);
      } catch {
        return false;
      }
      this.retained = capture;
      this.generationValue++;
      return true;
    });
  }

  resolve(): Promise<
    | {
        readonly ok: true;
        readonly capture: Capture;
        readonly generation: number;
      }
    | Refusal
  > {
    return this.serial(async () => {
      let text: string;
      try {
        text = await this.io.readText();
      } catch {
        return refuse(
          'CLIPBOARD_READ_FAILED',
          'The clipboard could not be read.',
          'Copy the items again.',
        );
      }
      const reason = this.validate(text);
      return reason
        ? refuse(
            'CLIPBOARD_UNAVAILABLE',
            reason,
            'Copy or cut the items again in this window.',
          )
        : {
            ok: true as const,
            capture: this.retained!,
            generation: this.generationValue,
          };
    });
  }

  /** Exact-key envelope check; returns a refusal reason or null. */
  validate(text: string): string | null {
    if (new TextEncoder().encode(text).length > tokenBudget)
      return 'The clipboard does not contain copied report items.';
    let token: unknown;
    try {
      token = JSON.parse(text);
    } catch {
      return 'The clipboard does not contain copied report items.';
    }
    if (
      !token ||
      typeof token !== 'object' ||
      Array.isArray(token) ||
      Object.keys(token).sort().join() !== 'capture,format,version,window'
    )
      return 'The clipboard does not contain copied report items.';
    const t = token as Record<string, unknown>;
    if (t.format !== clipboardFormat || t.version !== clipboardVersion)
      return 'The clipboard item format or version is not supported.';
    if (
      typeof t.window !== 'string' ||
      typeof t.capture !== 'string' ||
      !uuid.test(t.window) ||
      !uuid.test(t.capture)
    )
      return 'The clipboard token is malformed.';
    if (t.window !== this.window)
      return 'The items were copied in another window or before a reload.';
    if (t.capture !== this.retained?.id)
      return 'The copied items are no longer available.';
    return null;
  }

  dispose(): void {
    this.retained = null;
  }
}

/** Per destination view: successful pastes of the current capture generation. */
export class PasteCounter {
  private generation = -1;
  private count = 0;
  next(generation: number): number {
    return ((generation === this.generation ? this.count : 0) + 1) * 10;
  }
  succeeded(generation: number): void {
    this.count = generation === this.generation ? this.count + 1 : 1;
    this.generation = generation;
  }
}

export interface ClipboardHost {
  /** Live document version, rechecked after every await. */
  version(): number;
  evaluate(): Evaluated;
  /** Applies through the per-document native queue; result-version IDs at `starts`. */
  commit(
    plan: PatchPlan,
    candidate: string,
    baseVersion: number,
    starts: readonly number[],
  ): Promise<{
    readonly accepted: boolean;
    readonly reason: string;
    readonly version: number;
    readonly inserted: readonly string[];
  }>;
}
export interface ClipboardRequest {
  readonly action: ClipboardAction;
  readonly baseVersion: number;
  readonly targetIds?: readonly string[];
  readonly unit?: SizeUnit;
}
export interface ClipboardOutcome {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: string;
  readonly version: number;
  readonly inserted: readonly string[];
  readonly removed: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

export async function runClipboard(
  clipboard: WindowClipboard,
  host: ClipboardHost,
  counter: PasteCounter,
  request: ClipboardRequest,
): Promise<ClipboardOutcome> {
  const base = request.baseVersion;
  const outcome = (
    accepted: boolean,
    reason: string,
    diagnostics: readonly Diagnostic[] = [],
    extra: Partial<ClipboardOutcome> = {},
  ): ClipboardOutcome => ({
    accepted,
    changed: false,
    reason,
    version: host.version(),
    inserted: [],
    removed: [],
    diagnostics,
    ...extra,
  });
  if (host.version() !== base) return outcome(false, 'STALE_EDIT');
  const commit = async (
    planned: Extract<Planned, { ok: true }>,
    removed: readonly string[],
  ) => {
    if (host.version() !== base) return outcome(false, 'STALE_EDIT');
    const result = await host.commit(
      planned.plan,
      planned.candidate,
      base,
      planned.starts,
    );
    return result.accepted
      ? outcome(true, 'APPLIED', planned.warnings, {
          changed: true,
          version: result.version,
          inserted: result.inserted,
          removed,
        })
      : outcome(false, result.reason);
  };
  if (request.action === 'paste') {
    const resolved = await clipboard.resolve();
    if (!resolved.ok)
      return outcome(
        false,
        resolved.diagnostics[0]!.code,
        resolved.diagnostics,
      );
    if (host.version() !== base) return outcome(false, 'STALE_EDIT');
    const planned = planPaste(
      host.evaluate(),
      resolved.capture,
      counter.next(resolved.generation),
      request.unit ?? 'pt',
    );
    if (!planned.ok)
      return outcome(false, planned.diagnostics[0]!.code, planned.diagnostics);
    const result = await commit(planned, []);
    if (result.accepted) counter.succeeded(resolved.generation);
    return result;
  }
  const current = host.evaluate();
  const built = buildCapture(current, request.targetIds ?? []);
  if (!built.ok)
    return outcome(false, built.diagnostics[0]!.code, built.diagnostics);
  if (request.action === 'duplicate') {
    const planned = planPaste(current, built.capture, 10, request.unit ?? 'pt');
    if (!planned.ok)
      return outcome(false, planned.diagnostics[0]!.code, planned.diagnostics);
    return commit(planned, []);
  }
  let cut: Planned | null = null;
  if (request.action === 'cut') {
    cut = planCut(current, built.capture, built.nodes);
    if (!cut.ok)
      return outcome(false, cut.diagnostics[0]!.code, cut.diagnostics);
  }
  if (!(await clipboard.install(built.capture)))
    return outcome(false, 'CLIPBOARD_WRITE_FAILED', [
      clipboardError(
        'CLIPBOARD_WRITE_FAILED',
        'The clipboard could not be written; nothing was copied or removed.',
        'Retry the action.',
      ),
    ]);
  if (!cut) return outcome(true, 'COPIED', [], { version: base });
  return commit(
    cut,
    built.nodes.map((node) => node.id),
  );
}
