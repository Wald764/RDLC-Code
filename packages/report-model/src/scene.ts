export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
/** Pure geometry/labels; no HTML, scripts, resource URLs or evaluated data. */
export interface DesignScene {
  readonly version: number;
  readonly page: Bounds;
  readonly body: Bounds;
  readonly items: readonly {
    readonly id: string;
    readonly bounds: Bounds;
    readonly label: string;
    readonly placeholder: boolean;
  }[];
}
