import {
  sizeUnits,
  toPoints,
  pointsToPixels,
  type SizeUnit,
} from '@rdlc/report-model/geometry';
import type { Bounds } from '@rdlc/report-model/scene';

export const minZoom = 0.25,
  maxZoom = 4;
export const clampZoom = (zoom: number): number =>
  Number.isFinite(zoom) ? Math.min(maxZoom, Math.max(minZoom, zoom)) : 1;

/** The scroll container's client rectangle and scroll offsets, in CSS pixels. */
export interface Frame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}
type Scroll = { scrollLeft: number; scrollTop: number };

/** Preserve the idle page point at the viewport center; the browser clamps the final extent. */
export function centerScroll(
  old: Frame,
  next: Pick<Frame, 'width' | 'height'>,
): Scroll {
  return {
    scrollLeft: Math.max(0, old.scrollLeft + (old.width - next.width) / 2),
    scrollTop: Math.max(0, old.scrollTop + (old.height - next.height) / 2),
  };
}

/** Page-relative ruler marks outside scroll content; no body or device-pixel offset. */
export function rulerTicks(
  length: number,
  zoom: number,
  scroll: number,
  unit: SizeUnit,
): readonly { pixels: number; position: number; label: string }[] {
  const unitPx = pointsToPixels(toPoints(`1${unit}`)!);
  const raw = 60 / (unitPx * zoom);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((n) => n * power >= raw)! * power;
  const start = Math.max(0, Math.ceil(scroll / (zoom * unitPx * step)));
  const count = Math.min(200, Math.ceil(length / (zoom * unitPx * step)) + 1);
  return Array.from({ length: count }, (_, i) => {
    const value = (start + i) * step;
    const pixels = value * unitPx;
    return {
      pixels,
      position: pixels * zoom - scroll,
      label: String(+value.toFixed(4)),
    };
  });
}

/**
 * Client → scroll content → unzoomed body CSS pixels (96px/in), applied once.
 * The page sits at content origin; device-pixel ratio is already in client units.
 */
export function clientToBody(
  x: number,
  y: number,
  frame: Frame,
  zoom: number,
  body: { readonly left: number; readonly top: number },
): { x: number; y: number } {
  return {
    x: (x - frame.left + frame.scrollLeft) / zoom - body.left,
    y: (y - frame.top + frame.scrollTop) / zoom - body.top,
  };
}

/** Scroll offsets keeping the content point under the client anchor fixed across a zoom change. */
export function anchoredScroll(
  frame: Frame,
  zoom: number,
  next: number,
  x: number,
  y: number,
): Scroll {
  const ax = x - frame.left,
    ay = y - frame.top;
  return {
    scrollLeft: Math.max(0, ((ax + frame.scrollLeft) / zoom) * next - ax),
    scrollTop: Math.max(0, ((ay + frame.scrollTop) / zoom) * next - ay),
  };
}

/** Largest zoom fitting `size` (unzoomed px), clamped; oversized bounds stay scrollable. */
export function fitZoom(
  size: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
  margin = 16,
): number {
  return clampZoom(
    Math.min(
      (frame.width - 2 * margin) / size.width,
      (frame.height - 2 * margin) / size.height,
    ),
  );
}

/** Smallest scroll change bringing page-relative `bounds` (unzoomed px) into view. */
export function revealScroll(
  bounds: Bounds,
  frame: Frame,
  zoom: number,
  margin = 16,
): Scroll {
  const axis = (start: number, size: number, scroll: number, view: number) => {
    const from = start * zoom - margin,
      to = (start + size) * zoom + margin;
    if (to - from > view || from < scroll) return Math.max(0, from);
    return to > scroll + view ? to - view : scroll;
  };
  return {
    scrollLeft: axis(bounds.left, bounds.width, frame.scrollLeft, frame.width),
    scrollTop: axis(bounds.top, bounds.height, frame.scrollTop, frame.height),
  };
}

/** Navigable extent (unzoomed px): the page plus body items overflowing it. Report bounds are untouched. */
export function extent(
  page: Bounds,
  body: Bounds,
  items: readonly { readonly bounds: Bounds | null }[],
): { width: number; height: number } {
  let width = Math.max(page.width, body.left + body.width),
    height = Math.max(page.height, body.top + body.height);
  for (const { bounds } of items)
    if (bounds) {
      width = Math.max(width, body.left + bounds.left + bounds.width);
      height = Math.max(height, body.top + bounds.top + bounds.height);
    }
  return { width, height };
}

/** Scroll step for a pointer near or beyond a viewport edge; an unmeasured viewport never scrolls. */
export function edgeScroll(
  x: number,
  y: number,
  frame: Frame,
  edge = 24,
  step = 16,
): { dx: number; dy: number } {
  const axis = (p: number, start: number, size: number) =>
    size <= 2 * edge
      ? 0
      : p < start + edge
        ? -step
        : p > start + size - edge
          ? step
          : 0;
  return {
    dx: axis(x, frame.left, frame.width),
    dy: axis(y, frame.top, frame.height),
  };
}

/** Disposable per-view preferences; never report content or shared history. */
export interface ViewState {
  readonly zoom: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly unit: SizeUnit;
  readonly gridSpacing: number;
  readonly gridUnit: SizeUnit;
  readonly gridVisible: boolean;
  readonly gridSnap: boolean;
  readonly guidesVisible: boolean;
  readonly guidesSnap: boolean;
  /** Preferred wide-layout panel widths (CSS px); effective widths derive from {@link panelLayout}. */
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly leftVisible: boolean;
  readonly rightVisible: boolean;
  readonly leftTab: 'components' | 'structure';
  readonly inspectorExpanded: Readonly<Record<InspectorSection, boolean>>;
}
export const inspectorSections = [
  'general',
  'position',
  'appearance',
  'typography',
  'border',
  'data',
  'visibility',
  'pagination',
  'advanced',
] as const;
export type InspectorSection = (typeof inspectorSections)[number];
export const panelBounds = {
  left: [180, 360],
  right: [240, 480],
} as const;
export const defaultViewState: ViewState = {
  zoom: 1,
  scrollLeft: 0,
  scrollTop: 0,
  unit: 'pt',
  gridSpacing: 10,
  gridUnit: 'pt',
  gridVisible: true,
  gridSnap: true,
  guidesVisible: true,
  guidesSnap: true,
  leftWidth: 220,
  rightWidth: 300,
  leftVisible: true,
  rightVisible: true,
  leftTab: 'components',
  inspectorExpanded: {
    general: true,
    position: true,
    appearance: false,
    typography: true,
    border: false,
    data: true,
    visibility: false,
    pagination: false,
    advanced: false,
  },
};
const isUnit = (v: unknown) => sizeUnits.includes(v as SizeUnit);
const isBool = (v: unknown) => typeof v === 'boolean';
const valid: Record<keyof ViewState, (v: unknown) => boolean> = {
  zoom: (v) => typeof v === 'number' && v >= minZoom && v <= maxZoom,
  scrollLeft: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  scrollTop: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  unit: isUnit,
  gridSpacing: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
  gridUnit: isUnit,
  gridVisible: isBool,
  gridSnap: isBool,
  guidesVisible: isBool,
  guidesSnap: isBool,
  leftWidth: (v) => inBounds(v, panelBounds.left),
  rightWidth: (v) => inBounds(v, panelBounds.right),
  leftVisible: isBool,
  rightVisible: isBool,
  leftTab: (v) => v === 'components' || v === 'structure',
  inspectorExpanded: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
};
function inBounds(v: unknown, [min, max]: readonly [number, number]): boolean {
  return typeof v === 'number' && v >= min && v <= max;
}

/** Validates restored webview state field by field; invalid fields fall back to defaults. */
export function restoreViewState(input: unknown): {
  state: ViewState;
  invalid: (keyof ViewState)[];
} {
  const source = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const state: Record<string, unknown> = { ...defaultViewState };
  const invalid: (keyof ViewState)[] = [];
  for (const key of Object.keys(valid) as (keyof ViewState)[]) {
    if (!(key in source)) continue;
    if (valid[key](source[key])) state[key] = source[key];
    else invalid.push(key);
  }
  // Closed vocabulary: unknown keys are dropped, non-boolean values default per section.
  const expanded = state['inspectorExpanded'] as Record<string, unknown>;
  state['inspectorExpanded'] = Object.fromEntries(
    inspectorSections.map((key) => [
      key,
      isBool(expanded[key])
        ? expanded[key]
        : defaultViewState.inspectorExpanded[key],
    ]),
  );
  return { state: state as unknown as ViewState, invalid };
}

/** Canvas minimum plus its vertical ruler, reserved before inline panels. */
const canvasReserve = 320 + 20;
const structureWidth = 260;

/**
 * Effective inline panel widths for a workspace width. Left overlays below 1100px,
 * both below 800px; inline panels shrink toward their minimums to keep a 320px canvas.
 * Preferences are never rewritten. At >=800px the minimums always fit.
 * Wide workspaces show Structure beside Components when the canvas keeps 640px.
 */
export function panelLayout(
  width: number,
  view: Pick<
    ViewState,
    'leftWidth' | 'rightWidth' | 'leftVisible' | 'rightVisible'
  >,
): {
  left: number;
  structure: number;
  right: number;
  leftOverlay: boolean;
  rightOverlay: boolean;
} {
  const leftOverlay = width < 1100,
    rightOverlay = width < 800;
  let left = leftOverlay || !view.leftVisible ? 0 : view.leftWidth;
  let right = rightOverlay || !view.rightVisible ? 0 : view.rightWidth;
  let excess = left + right + canvasReserve - width;
  if (excess > 0 && right) {
    const next = Math.max(panelBounds.right[0], right - excess);
    excess -= right - next;
    right = next;
  }
  if (excess > 0 && left) left = Math.max(panelBounds.left[0], left - excess);
  const structure =
    left && width >= 1400 && width - left - structureWidth - right >= 640
      ? structureWidth
      : 0;
  return { left, structure, right, leftOverlay, rightOverlay };
}

/**
 * Menu origin inside the webview: opens above or left of the pointer when it would
 * overflow, then clamps. The webview cannot draw over VS Code's own panels.
 */
export function menuPosition(
  x: number,
  y: number,
  menu: { readonly width: number; readonly height: number },
  area: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(value, Math.max(0, max)));
  return {
    x: clamp(
      x + menu.width > area.width ? x - menu.width : x,
      area.width - menu.width,
    ),
    y: clamp(
      y + menu.height > area.height ? y - menu.height : y,
      area.height - menu.height,
    ),
  };
}
