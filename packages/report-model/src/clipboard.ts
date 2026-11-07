import type { SourceRange } from './document.js';
import type { Bounds } from './scene.js';

export const clipboardFormat = 'rdlc-code/items';
export const clipboardVersion = 1;
/** UTF-8 budgets: OS clipboard envelope and retained host-side payload. */
export const tokenBudget = 1024;
export const captureBudget = 8 * 1024 * 1024;

/** The only OS clipboard content: an untrusted lookup key, never edit authority. */
export interface ClipboardToken {
  readonly format: typeof clipboardFormat;
  readonly version: typeof clipboardVersion;
  readonly window: string;
  readonly capture: string;
}

/** A declared identity; `range` is the Name attribute value range within `CaptureRoot.xml`. */
export interface CaptureIdentity {
  readonly kind: 'report-item' | 'group';
  readonly element: string;
  readonly name: string;
  readonly range: SourceRange;
}
/**
 * An understood reference. `textbox`/`data-region` name report items; `scope` names a
 * copied group or data region. `range` is the exact raw operand within `xml`, or
 * null when no lossless rewrite exists.
 */
export interface CaptureReference {
  readonly kind: 'textbox' | 'data-region' | 'scope';
  readonly name: string;
  readonly range: SourceRange | null;
}
export interface CaptureRoot {
  readonly kind: 'textbox' | 'table' | 'image';
  /** Exact source slice of one complete subtree; a table includes its cells/groups. */
  readonly xml: string;
  /** Namespace environment in scope at the root element. */
  readonly namespaces: Readonly<Record<string, string>>;
  /** Prefixes used in the subtree but bound outside it. */
  readonly inherited: readonly string[];
  readonly qualifiedName: string;
  /** Offset just after the root start tag, where absent properties are inserted. */
  readonly contentStart: number;
  /** Original physical geometry in points, captured before any offset. */
  readonly bounds: Bounds;
  readonly raw: Readonly<Record<keyof Bounds, string | null>>;
  readonly provenance: Readonly<Record<keyof Bounds, 'explicit' | 'derived'>>;
  /** Text content range of each literal geometry element within `xml`. */
  readonly geometry: Readonly<Record<keyof Bounds, SourceRange | null>>;
  readonly identities: readonly CaptureIdentity[];
  readonly references: readonly CaptureReference[];
  /**
   * An embedded `image` root only: the definition name its constant `Value` holds, with the
   * exact operand range within `xml`. `range` is null when no lossless rewrite exists.
   */
  readonly embedded?: {
    readonly name: string;
    readonly range: SourceRange | null;
  };
}
/** External dataset dependency with the exact source field definitions required. */
export interface DatasetRequirement {
  readonly name: string;
  readonly fields: readonly {
    readonly name: string;
    readonly dataField: string | null;
    readonly typeName: string;
  }[];
}
/**
 * An embedded image definition a captured image item references, displayable or not. The
 * payload stays host-side inside `xml` and counts toward `captureBudget`; it is never logged.
 */
export interface EmbeddedImageRequirement {
  readonly name: string;
  /** SHA-256 of the decoded bytes of a displayable definition; null for any other. */
  readonly hash: string | null;
  /**
   * Content identity used to reuse a target definition: `hash` for a displayable one, and a
   * digest of the exact `EmbeddedImage` source with the `Name` value removed otherwise.
   */
  readonly identity: string;
  readonly mime: string | null;
  /** Exact `EmbeddedImage` source. */
  readonly xml: string;
  /** The `Name` attribute value range within `xml`, used when a collision renames it. */
  readonly nameRange: SourceRange;
}
/** Immutable host snapshot; never live source IDs or webview-provided XML. */
export interface Capture {
  readonly id: string;
  readonly schema: string;
  readonly profile: 'rdlc-code/interactive';
  readonly formatVersion: typeof clipboardVersion;
  /** One or more roots in source order. */
  readonly roots: readonly CaptureRoot[];
  readonly datasets: readonly DatasetRequirement[];
  /**
   * Definitions referenced by the captured image items, one per name, in the source report's
   * definition order. A referenced name with no definition has no entry and is never invented.
   */
  readonly images: readonly EmbeddedImageRequirement[];
  /** UTF-8 bytes of subtree text, namespace environments and dependencies. */
  readonly size: number;
}
export const clipboardActions = ['copy', 'cut', 'paste', 'duplicate'] as const;
export type ClipboardAction = (typeof clipboardActions)[number];
