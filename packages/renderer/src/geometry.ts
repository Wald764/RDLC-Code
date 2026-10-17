const scale: Readonly<Record<string, number>> = {
  in: 96,
  pt: 96 / 72,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
};

/** Pure RdlSize to CSS pixel conversion; no runtime report data is involved. */
export function toPixels(raw: string | null): number | null {
  if (raw === null) return null;
  const match = /^(-?\d+(?:\.\d+)?)(pt|pc|in|mm|cm)$/.exec(raw.trim());
  if (!match) return null;
  const pixels = Number(match[1]) * scale[match[2]!]!;
  return Number.isFinite(pixels) ? pixels : null;
}
