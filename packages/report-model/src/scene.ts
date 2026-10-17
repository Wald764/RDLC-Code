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
 * Pure geometry/labels; no HTML, scripts, resource URLs or evaluated data. Text is
 * the exact unevaluated RDL string, never an evaluated report value.
 */
export interface DesignScene {
  readonly version: number;
  readonly page: Bounds;
  readonly body: Bounds;
  readonly items: readonly {
    readonly id: string;
    readonly bounds: Bounds;
    readonly label: string;
    readonly placeholder: boolean;
    readonly name?: string | null;
    readonly text?: string | null;
    readonly geometry?: SceneBounds | null;
    readonly style?: SceneTextStyle | null;
    readonly capabilities?: readonly string[];
  }[];
}
export type DesignSceneItem = DesignScene['items'][number];
