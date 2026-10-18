import { sizeUnits, type SizeUnit } from '@rdlc/report-model/geometry';
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
}
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
};

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
  return { state: state as unknown as ViewState, invalid };
}
