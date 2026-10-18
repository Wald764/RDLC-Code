import type { Bounds } from '@rdlc/report-model/scene';
import type { resizeHandles } from '@rdlc/report-model/editing';

export type DirectHandle = 'move' | (typeof resizeHandles)[number];

/** Always recompute from the accepted origin, never from the previous preview. */
export function directProposal(
  origin: Bounds,
  handle: DirectHandle,
  dx: number,
  dy: number,
): { bounds: Bounds; valid: boolean } {
  let { left, top, width, height } = origin;
  if (handle === 'move') {
    left += dx;
    top += dy;
  } else {
    if (handle.includes('w')) {
      left += dx;
      width -= dx;
    }
    if (handle.includes('e')) width += dx;
    if (handle.includes('n')) {
      top += dy;
      height -= dy;
    }
    if (handle.includes('s')) height += dy;
  }
  const bounds = { left, top, width, height };
  return {
    bounds,
    valid:
      Object.values(bounds).every(Number.isFinite) &&
      left >= 0 &&
      top >= 0 &&
      width > 0 &&
      height > 0,
  };
}
