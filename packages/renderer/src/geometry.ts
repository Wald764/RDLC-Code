import { toPoints, pointsToPixels } from '@rdlc/report-model/geometry';
import type { ResolvedGeometry } from '@rdlc/report-model/geometry';
import type { Bounds, DesignSceneItem } from '@rdlc/report-model/scene';

/** Pure RdlSize to CSS pixel conversion; no runtime report data is involved. */
export function toPixels(raw: string | null): number | null {
  const points = toPoints(raw);
  const pixels = points === null ? null : pointsToPixels(points);
  return pixels !== null && Number.isFinite(pixels) ? pixels : null;
}

export function geometryBounds(geometry: ResolvedGeometry): Bounds | null {
  const { left, top, width, height } = geometry;
  if ([left, top, width, height].some((value) => value.points === null))
    return null;
  const bounds = {
    left: pointsToPixels(left.points!),
    top: pointsToPixels(top.points!),
    width: pointsToPixels(width.points!),
    height: pointsToPixels(height.points!),
  };
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
}

export function geometryOperations(
  geometry: ResolvedGeometry,
  capabilities: readonly string[],
  reason: string | null = null,
): NonNullable<DesignSceneItem['operations']> {
  const eligible = (
    position: 'left' | 'top',
    dimension: 'width' | 'height',
  ) => {
    const allowed =
      !reason &&
      geometry[position].points !== null &&
      geometry[dimension].points !== null &&
      capabilities.includes(position) &&
      capabilities.includes(dimension);
    return {
      eligible: !!allowed,
      reason: allowed
        ? null
        : (reason ??
          `Unknown or preservation-only ${position}/${dimension}; inspect the item in source.`),
    };
  };
  return {
    moveX: eligible('left', 'width'),
    moveY: eligible('top', 'height'),
    resizeX: eligible('left', 'width'),
    resizeY: eligible('top', 'height'),
  };
}
