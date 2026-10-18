export const sizeUnits = ['pt', 'pc', 'in', 'mm', 'cm'] as const;
export type SizeUnit = (typeof sizeUnits)[number];
const pointsPerUnit: Readonly<Record<SizeUnit, number>> = {
  pt: 1,
  pc: 12,
  in: 72,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
};
export function parseSize(raw: string | null): {
  readonly raw: string;
  readonly unit: SizeUnit;
  readonly points: number;
} | null {
  if (raw === null) return null;
  const match = /^(-?\d+(?:\.\d+)?)(pt|pc|in|mm|cm)$/.exec(raw.trim());
  if (!match) return null;
  const unit = match[2] as SizeUnit;
  const points = Number(match[1]) * pointsPerUnit[unit];
  return Number.isFinite(points) ? { raw, unit, points } : null;
}
export const toPoints = (raw: string | null): number | null =>
  parseSize(raw)?.points ?? null;
export const pointsToPixels = (points: number): number => points * (96 / 72);
export const pixelsToPoints = (pixels: number): number => pixels * (72 / 96);

/** Expand exponent notation because RdlSize only accepts decimal literals. */
function decimal(value: number): string {
  const [mantissa, exponent] = value.toPrecision(15).split('e');
  if (exponent === undefined)
    return mantissa!.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const digits = mantissa!.replace('.', '');
  const point = 1 + Number(exponent);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`.replace(/0+$/, '');
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}
export function formatSize(
  points: number,
  original: string | null,
  unit: SizeUnit = 'pt',
  kind: 'position' | 'dimension' = 'position',
): string {
  if (
    !Number.isFinite(points) ||
    points < 0 ||
    (kind === 'dimension' && points === 0)
  )
    throw new Error(
      'Coordinates must be finite, positions nonnegative and dimensions positive.',
    );
  const parsed = parseSize(original);
  if (parsed?.points === points) return original!;
  const chosen = parsed?.unit ?? unit;
  const formatted = `${decimal(points / pointsPerUnit[chosen])}${chosen}`;
  const quantized = toPoints(formatted);
  if (
    quantized === null ||
    (points > 0 && quantized <= 0) ||
    Math.abs(quantized - points) > 0.01
  )
    throw new Error('Geometry cannot be represented within 0.01pt.');
  return formatted;
}
export interface GeometryValue {
  readonly raw: string | null;
  readonly unit: SizeUnit | null;
  readonly provenance: 'explicit' | 'derived' | 'unknown';
  readonly points: number | null;
}
export type ResolvedGeometry = Readonly<
  Record<'left' | 'top' | 'width' | 'height', GeometryValue>
>;
export function resolveGeometry(
  raw: Readonly<Record<keyof ResolvedGeometry, string | null>>,
  container: { readonly width: number | null; readonly height: number | null },
): ResolvedGeometry {
  const resolve = (
    value: string | null,
    fallback: number | null,
    dimension: boolean,
  ): GeometryValue => {
    const parsed = parseSize(value);
    const points = value === null ? fallback : (parsed?.points ?? null);
    const valid =
      points !== null &&
      Number.isFinite(points) &&
      (dimension ? points > 0 : points >= 0);
    return {
      raw: value,
      unit: parsed?.unit ?? null,
      provenance: valid ? (value === null ? 'derived' : 'explicit') : 'unknown',
      points: valid ? points : null,
    };
  };
  const left = resolve(raw.left, 0, false);
  const top = resolve(raw.top, 0, false);
  return {
    left,
    top,
    width: resolve(
      raw.width,
      container.width !== null && left.points !== null
        ? container.width - left.points
        : null,
      true,
    ),
    height: resolve(
      raw.height,
      container.height !== null && top.points !== null
        ? container.height - top.points
        : null,
      true,
    ),
  };
}
