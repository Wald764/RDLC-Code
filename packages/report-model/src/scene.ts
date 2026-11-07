import type { ResolvedGeometry } from './geometry.js';
import type {
  ImageFormat,
  ImagePixels,
  ImageReason,
  ImageSizing,
} from './images.js';

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
/** Supported text values; `null` preserves an absent or opaque value. */
export interface SceneTextStyle {
  readonly fontFamily: string | null;
  readonly fontSize: string | null;
  readonly fontWeight: string | null;
  readonly fontStyle: string | null;
  readonly color: string | null;
  readonly textAlign: string | null;
}
/** Authored RdlSize strings; `null` preserves an absent or expression value. */
export interface SceneBounds {
  readonly left: string | null;
  readonly top: string | null;
  readonly width: string | null;
  readonly height: string | null;
}
/**
 * How an image item is shown. A picture only names its asset by hash: the bytes
 * reach the webview through the separate `imageAssets` message, never the scene.
 */
export type SceneImageDisplay =
  | {
      readonly state: 'picture';
      /** Hash of the displayable definition; the key of the `imageAssets` entry. */
      readonly assetKey: string;
      readonly pixels: ImagePixels;
    }
  | {
      readonly state: 'placeholder';
      /** The projection reason; the scene never invents one. */
      readonly reason: ImageReason | 'source-preserved' | 'reference-missing';
    };
/** Facts about the referenced definition; every field is `null` when none resolves. */
export interface SceneImageMetadata {
  readonly format: ImageFormat | 'other' | null;
  readonly pixels: ImagePixels | null;
  /** Length of the base64 text, never the text itself. */
  readonly encodedSize: number | null;
}
/**
 * Pure geometry/labels; no HTML, scripts, resource URLs or evaluated data. Text is
 * the exact unevaluated RDL string, never an evaluated report value.
 */
export interface DesignScene {
  readonly version: number;
  readonly page: Bounds;
  readonly body: Bounds;
  readonly items: readonly {
    readonly id: string;
    readonly bounds: Bounds | null;
    readonly kind?: 'textbox' | 'table' | 'cell' | 'preserved' | 'image';
    readonly parentTableId?: string;
    /** Source XML cell; `id` may instead name its rendered child textbox. */
    readonly xmlCellId?: string;
    readonly sourceOrder?: number;
    readonly zIndex?: number;
    readonly resolvedGeometry?: ResolvedGeometry;
    readonly operations?: Readonly<
      Record<
        'moveX' | 'moveY' | 'resizeX' | 'resizeY',
        { readonly eligible: boolean; readonly reason: string | null }
      >
    >;
    readonly label: string;
    readonly placeholder: boolean;
    readonly name?: string | null;
    readonly text?: string | null;
    readonly geometry?: SceneBounds | null;
    readonly style?: SceneTextStyle | null;
    readonly capabilities?: readonly string[];
    /** `kind: 'image'` only. */
    readonly sizing?: ImageSizing;
    /** `kind: 'image'` only. */
    readonly display?: SceneImageDisplay;
    /** `kind: 'image'` only. */
    readonly metadata?: SceneImageMetadata;
  }[];
}
export type DesignSceneItem = DesignScene['items'][number];
