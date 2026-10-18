import type { Bounds } from '@rdlc/report-model/scene';
import type { DirectHandle } from './manipulation';

/** A known, unselected sibling in body-relative points. */
export interface PlacementTarget {
  readonly id: string;
  readonly label: string;
  readonly order: number;
  readonly bounds: Bounds;
}
export type GuideEdge = 'start' | 'center' | 'end';
export interface Guide {
  readonly axis: 'x' | 'y';
  /** Null for the body boundary. */
  readonly targetId: string | null;
  readonly label: string;
  readonly order: number;
  readonly edge: GuideEdge;
  /** Report coordinate of the target line, in points. */
  readonly value: number;
  readonly moving: GuideEdge;
  /** Screen distance in CSS pixels. */
  readonly distance: number;
}
export interface PlacementOptions {
  /** CSS pixels per point at the current zoom. */
  readonly scale: number;
  readonly body: { readonly width: number; readonly height: number };
  readonly targets: readonly PlacementTarget[];
  /** Grid spacing in points, or null when grid snapping is off. */
  readonly grid: number | null;
  /** Whether a matched guide snaps; guides are reported either way. */
  readonly guides: boolean;
  readonly tolerance?: number;
}

const edges: readonly GuideEdge[] = ['start', 'center', 'end'];
const line = (start: number, size: number, edge: GuideEdge) =>
  edge === 'start'
    ? start
    : edge === 'center'
      ? start + size / 2
      : start + size;

/** Moving lines for one axis: all three for a move, only the dragged edge for a resize. */
function movingEdges(handle: DirectHandle, axis: 'x' | 'y'): GuideEdge[] {
  if (handle === 'move') return [...edges];
  const [before, after] = axis === 'x' ? ['w', 'e'] : ['n', 's'];
  return handle.includes(before!)
    ? ['start']
    : handle.includes(after!)
      ? ['end']
      : [];
}

/** Nearest grid line from the body origin; exact ties choose the smaller coordinate. */
function gridLine(value: number, grid: number): number {
  const low = Math.floor(value / grid + 1e-9) * grid,
    high = low + grid;
  return value - low <= high - value + 1e-9 ? low : high;
}

/**
 * Snap adjustment (points) for a proposed moving bounds or selection union.
 * Per axis, the nearest guide within tolerance wins over the grid. Guide ties
 * prefer the body boundary, earlier source order, then the smaller coordinate.
 */
export function snapDelta(
  moving: Bounds,
  handle: DirectHandle,
  options: PlacementOptions,
): { dx: number; dy: number; guides: Guide[] } {
  const tolerance = options.tolerance ?? 6;
  const guides: Guide[] = [];
  const delta = { x: 0, y: 0 };
  for (const axis of ['x', 'y'] as const) {
    const start = axis === 'x' ? moving.left : moving.top,
      size = axis === 'x' ? moving.width : moving.height;
    const lines = movingEdges(handle, axis);
    if (!lines.length) continue;
    const span = axis === 'x' ? options.body.width : options.body.height;
    const candidates = [
      // Order -1 ranks the body boundary ahead of any sibling on equal distance.
      { targetId: null, label: 'Body', order: -1, start: 0, size: span },
      ...options.targets.map((t) => ({
        targetId: t.id,
        label: t.label,
        order: t.order,
        start: axis === 'x' ? t.bounds.left : t.bounds.top,
        size: axis === 'x' ? t.bounds.width : t.bounds.height,
      })),
    ];
    let best: Guide | null = null;
    for (const m of lines) {
      const from = line(start, size, m);
      for (const c of candidates)
        for (const edge of edges) {
          const value = line(c.start, c.size, edge);
          const distance = Math.abs(value - from) * options.scale;
          if (distance > tolerance) continue;
          const guide: Guide = {
            axis,
            targetId: c.targetId,
            label: c.label,
            order: c.order,
            edge,
            value,
            moving: m,
            distance,
          };
          if (
            !best ||
            distance < best.distance ||
            (distance === best.distance &&
              (c.order < best.order ||
                (c.order === best.order && value < best.value)))
          )
            best = guide;
        }
    }
    if (best) {
      guides.push(best);
      if (options.guides) {
        delta[axis] = best.value - line(start, size, best.moving);
        continue;
      }
    }
    if (options.grid !== null) {
      // Move snaps the union's top-left; resize snaps the dragged edge.
      const from = line(start, size, lines.length > 1 ? 'start' : lines[0]!);
      delta[axis] = gridLine(from, options.grid) - from;
    }
  }
  return { dx: delta.x, dy: delta.y, guides };
}
