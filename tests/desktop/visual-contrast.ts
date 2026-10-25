/**
 * Colour maths behind the visual contrast assertions: a fail-closed PNG
 * decode, honest sRGB compositing of an element's computed colour through its
 * ancestor opacities, and foreground oracles over composited screenshot
 * pixels.
 *
 * Nothing here touches the DOM, Playwright or the filesystem, so
 * `tests/desktop/visual-contrast.test.ts` checks the maths directly with
 * synthetic images: 2:1 text beside a high-contrast decoy must fail, known
 * 4.5:1 and 7:1 pairs must measure their documented ratio, and a truncated
 * screenshot must throw instead of returning pixels.
 */
import { inflateSync } from 'node:zlib';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Image {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** A computed colour carried with the opacity it is actually painted through. */
export interface Paint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

export interface Edge {
  readonly width: number;
  readonly paint: Paint;
}

/** Real computed border widths: a fixed pixel band samples outside the border. */
export interface Edges {
  readonly top: Edge;
  readonly right: Edge;
  readonly bottom: Edge;
  readonly left: Edge;
}

export interface Measurement {
  /** Observed composited contrast of the painted foreground against the surface. */
  readonly ratio: number;
  readonly background: number;
  readonly foreground: number;
  /** Expected painted colour once an element proves it, else null. */
  readonly expected: number | null;
  /** An observed cluster backs the foreground; never inferred from distance alone. */
  readonly matched: boolean;
  readonly pixels: number;
  readonly cluster: number;
  /** Border edge a boundary measurement reports, null elsewhere. */
  readonly edge: string | null;
  /**
   * Contrast of the farthest colour in the box: supplementary evidence only,
   * never an acceptance condition. Text and boundaries do not record it.
   */
  readonly diagnostic: number | null;
  /** Why the painted foreground could not be proven; null when it was proven. */
  readonly reason: string | null;
}

/** The glyph paint proven by computed style, or the reason it is not proven. */
export interface Glyph {
  readonly paint: Paint | null;
  readonly reason: string | null;
}

/**
 * Antialiasing moves a few channel levels, nothing more: a further cluster is
 * a different colour, and the measurement fails closed instead of guessing.
 */
export const CHANNEL_TOLERANCE = 12;

/** The smallest painted cluster that may speak for a colour. */
export const MIN_CLUSTER_PIXELS = 3;

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Decode a screenshot, or fail closed: a truncated or malformed PNG throws
 * instead of returning partial pixels that could stand in for evidence.
 */
export function decodePng(buffer: Buffer): Image {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE))
    throw new Error('The screenshot is not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let ended = false;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (offset + 12 + length > buffer.length)
      throw new Error(
        `Truncated PNG: the chunk at byte ${offset} claims ${length} bytes`,
      );
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      if (data.length < 13)
        throw new Error('Truncated PNG: IHDR is shorter than 13 bytes');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Error('Truncated PNG: the stream ends before IEND');
  if (width === 0 || height === 0)
    throw new Error('Malformed PNG: the header declares no pixels');
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0)
    throw new Error(
      `Unsupported screenshot PNG: bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace}`,
    );
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height)
    throw new Error(
      'Malformed PNG: scanline bytes do not match the dimensions',
    );
  const lines = new Uint8Array(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let position = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[position++]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[position++]!;
      const left = x >= channels ? lines[y * stride + x - channels]! : 0;
      const up = y > 0 ? lines[(y - 1) * stride + x]! : 0;
      const upLeft =
        y > 0 && x >= channels ? lines[(y - 1) * stride + x - channels]! : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG row filter ${filter}`);
      }
      lines[y * stride + x] = result & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (
    let pixel = 0, source = 0;
    pixel < width * height;
    pixel++, source += channels
  ) {
    data[pixel * 4] = lines[source]!;
    data[pixel * 4 + 1] = lines[source + 1]!;
    data[pixel * 4 + 2] = lines[source + 2]!;
    data[pixel * 4 + 3] = channels === 4 ? lines[source + 3]! : 255;
  }
  return { width, height, data };
}

/** Read a computed colour and its opacity, or fail closed on an unknown format. */
export function paint(css: string, opacity: number): Paint {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    throw new Error(`Invalid composited opacity ${opacity} for ${css}`);
  const { r, g, b, a } = parseColour(css);
  return { r, g, b, alpha: a * opacity };
}

function parseColour(css: string): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const value = css.trim();
  const unsupported = new Error(`Unsupported computed colour: ${css}`);
  const hexMatch = /^#([0-9a-fA-F]+)$/.exec(value);
  if (hexMatch) {
    const digits = hexMatch[1]!;
    if (![3, 4, 6, 8].includes(digits.length)) throw unsupported;
    const pair = digits.length > 4;
    const at = (index: number): number =>
      Number.parseInt(
        pair
          ? digits.slice(index * 2, index * 2 + 2)
          : `${digits[index]}${digits[index]}`,
        16,
      );
    return {
      r: at(0),
      g: at(1),
      b: at(2),
      a: digits.length === 4 || digits.length === 8 ? at(3) / 255 : 1,
    };
  }
  const rgbMatch = /^rgba?\(([^)]*)\)$/.exec(value);
  if (rgbMatch) {
    const parts = rgbMatch[1]!.split(/[,/\s]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) throw unsupported;
    const channel = (text: string): number => {
      const percent = text.endsWith('%');
      const amount = Number(percent ? text.slice(0, -1) : text);
      if (!Number.isFinite(amount)) throw unsupported;
      const scaled = percent ? (amount / 100) * 255 : amount;
      return Math.round(Math.min(255, Math.max(0, scaled)));
    };
    const alpha = parts.length === 3 ? 1 : alphaValue(parts[3]!);
    return {
      r: channel(parts[0]!),
      g: channel(parts[1]!),
      b: channel(parts[2]!),
      a: alpha,
    };
  }
  const srgbMatch = /^color\(srgb\s+([^)]*)\)$/.exec(value);
  if (srgbMatch) {
    const parts = srgbMatch[1]!.split(/[/\s]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) throw unsupported;
    const channel = (text: string): number => {
      const amount = Number(text);
      if (!Number.isFinite(amount)) throw unsupported;
      return Math.round(Math.min(1, Math.max(0, amount)) * 255);
    };
    return {
      r: channel(parts[0]!),
      g: channel(parts[1]!),
      b: channel(parts[2]!),
      a: parts.length === 3 ? 1 : alphaValue(parts[3]!),
    };
  }
  throw unsupported;
}

function alphaValue(text: string): number {
  const amount = Number(text.endsWith('%') ? text.slice(0, -1) : text);
  if (!Number.isFinite(amount)) throw new Error(`Unsupported alpha: ${text}`);
  return Math.min(1, Math.max(0, text.endsWith('%') ? amount / 100 : amount));
}

/**
 * Paint a colour with alpha over a surface: browsers composite in sRGB, so the
 * blend happens on the gamma-encoded channels, never on linear light.
 */
export function paintedOver(colour: Paint, background: number): number {
  const blend = (channel: number, base: number): number =>
    Math.round(channel * colour.alpha + base * (1 - colour.alpha));
  return (
    (blend(colour.r, (background >> 16) & 255) << 16) |
    (blend(colour.g, (background >> 8) & 255) << 8) |
    blend(colour.b, background & 255)
  );
}

/** Largest per-channel difference between two packed colours. */
export function channelDistance(left: number, right: number): number {
  return Math.max(
    Math.abs(((left >> 16) & 255) - ((right >> 16) & 255)),
    Math.abs(((left >> 8) & 255) - ((right >> 8) & 255)),
    Math.abs((left & 255) - (right & 255)),
  );
}

const linear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (key: number): number =>
  0.2126 * linear((key >> 16) & 255) +
  0.7152 * linear((key >> 8) & 255) +
  0.0722 * linear(key & 255);

export function contrastRatio(left: number, right: number): number {
  const a = luminance(left);
  const b = luminance(right);
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return (high + 0.05) / (low + 0.05);
}

export const hex = (key: number): string =>
  `#${key.toString(16).padStart(6, '0')}`;

const clamp = (value: number, limit: number): number =>
  Math.min(Math.max(value, 0), limit);

/**
 * Whole pixels of a fractional box: a box with real size never rounds away to
 * an empty sample, which would silently drop a one-pixel border.
 */
function span(
  start: number,
  size: number,
  limit: number,
): readonly [number, number] {
  const from = clamp(Math.round(start), limit);
  let to = clamp(Math.round(start + size), limit);
  if (to <= from && size > 0 && from < limit) to = from + 1;
  return [from, to] as const;
}

export function regionCounts(image: Image, rect: Rect): Map<number, number> {
  const [x0, x1] = span(rect.x, rect.width, image.width);
  const [y0, y1] = span(rect.y, rect.height, image.height);
  const counts = new Map<number, number>();
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const index = (y * image.width + x) * 4;
      const key =
        (image.data[index]! << 16) |
        (image.data[index + 1]! << 8) |
        image.data[index + 2]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  return counts;
}

/** The surface actually painted in a region: the colour most pixels carry. */
export function dominant(counts: Map<number, number>): {
  key: number;
  pixels: number;
} {
  let key = 0;
  let pixels = 0;
  let total = 0;
  for (const [colour, count] of counts) {
    total += count;
    if (count > pixels) {
      pixels = count;
      key = colour;
    }
  }
  return { key, pixels: pixels || total };
}

interface Cluster {
  readonly key: number;
  readonly count: number;
  readonly distance: number;
}

/**
 * The cluster that actually carries the expected colour: nearest to it among
 * clusters with enough pixels, never the farthest colour in the box. No
 * supported cluster inside the tolerance is reported, not adopted.
 */
function pinnedCluster(counts: Map<number, number>, expected: number): Cluster {
  let supported: Cluster | null = null;
  let nearest: Cluster | null = null;
  for (const [colour, count] of counts) {
    const candidate = {
      key: colour,
      count,
      distance: channelDistance(colour, expected),
    };
    const closer = (current: Cluster | null, next: Cluster): boolean =>
      !current ||
      next.distance < current.distance ||
      (next.distance === current.distance && next.count > current.count);
    if (closer(nearest, candidate)) nearest = candidate;
    if (count >= MIN_CLUSTER_PIXELS && closer(supported, candidate))
      supported = candidate;
  }
  return supported ?? nearest ?? { key: expected, count: 0, distance: 0 };
}

const isMatched = (cluster: Cluster): boolean =>
  cluster.count >= MIN_CLUSTER_PIXELS && cluster.distance <= CHANNEL_TOLERANCE;

/**
 * Contrast of painted text: the surface is the dominant colour actually
 * rendered in the box, and the foreground only counts when an observed cluster
 * carries the element's own colour composited over that surface. A
 * high-contrast decoy in the same box cannot stand in for low-contrast text.
 * A box whose glyphs cover most of its own area fails closed rather than
 * measuring the text against itself.
 */
export function textContrast(
  image: Image,
  rect: Rect,
  colour: Paint,
): Measurement {
  const counts = regionCounts(image, rect);
  const background = dominant(counts);
  const expected = paintedOver(colour, background.key);
  const cluster = pinnedCluster(counts, expected);
  return {
    ratio: contrastRatio(cluster.key, background.key),
    background: background.key,
    foreground: cluster.key,
    expected,
    matched: isMatched(cluster),
    pixels: background.pixels,
    cluster: cluster.count,
    edge: null,
    diagnostic: null,
    reason: null,
  };
}

/**
 * Contrast of an essential boundary: the box's dominant colour is the
 * interior surface, the bands follow the real computed border widths, and the
 * boundary colour is pinned the same way text is. The worst edge decides.
 */
export function boundaryContrast(
  image: Image,
  rect: Rect,
  edges: Edges,
): Measurement {
  const interior = dominant(regionCounts(image, rect));
  const score = (measurement: Measurement): number =>
    measurement.matched ? measurement.ratio : Number.NEGATIVE_INFINITY;
  let worst: Measurement | null = null;
  for (const { name, band, colour } of bands(rect, edges)) {
    const counts = regionCounts(image, band);
    const expected = paintedOver(colour, interior.key);
    const cluster = pinnedCluster(counts, expected);
    const pixels = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const measurement: Measurement = {
      ratio: contrastRatio(cluster.key, interior.key),
      background: interior.key,
      foreground: cluster.key,
      expected,
      matched: isMatched(cluster),
      pixels,
      cluster: cluster.count,
      edge: name,
      diagnostic: null,
      reason: null,
    };
    if (!worst || score(measurement) < score(worst)) worst = measurement;
  }
  return (
    worst ?? {
      ratio: 0,
      background: interior.key,
      foreground: interior.key,
      expected: null,
      matched: false,
      pixels: 0,
      cluster: 0,
      edge: null,
      diagnostic: null,
      reason: null,
    }
  );
}

/** The farthest supported colour in a box: supplementary evidence only. */
function farthestColour(
  counts: Map<number, number>,
  background: number,
  pixels: number,
): { key: number; count: number } | null {
  const support = Math.max(MIN_CLUSTER_PIXELS, Math.floor(pixels * 0.001));
  const backgroundLuminance = luminance(background);
  let best: { key: number; count: number } | null = null;
  let furthest = 0;
  for (const [colour, count] of counts) {
    if (colour === background || count < support) continue;
    const distance = Math.abs(luminance(colour) - backgroundLuminance);
    if (
      !best ||
      distance > furthest ||
      (distance === furthest && count > best.count)
    ) {
      best = { key: colour, count };
      furthest = distance;
    }
  }
  return best;
}

/**
 * Contrast of an essential icon glyph. The box is measured exactly like text
 * when the glyph paint is proven by computed style. When it cannot be proven
 * the measurement stays unvalidated with its reason, `matched` stays false and
 * the farthest colour is reported only as `diagnostic`, so neither a
 * high-contrast decoy nor a maximum possible contrast can certify the icon.
 */
export function glyphContrast(
  image: Image,
  rect: Rect,
  glyph: Glyph,
): Measurement {
  const counts = regionCounts(image, rect);
  const background = dominant(counts);
  const farthest = farthestColour(counts, background.key, background.pixels);
  const diagnostic = farthest ? contrastRatio(farthest.key, background.key) : 0;
  if (!glyph.paint)
    return {
      ratio: 0,
      background: background.key,
      foreground: farthest?.key ?? background.key,
      expected: null,
      matched: false,
      pixels: background.pixels,
      cluster: farthest?.count ?? 0,
      edge: null,
      diagnostic,
      reason: glyph.reason ?? 'the glyph paint is not proven by computed style',
    };
  const expected = paintedOver(glyph.paint, background.key);
  const cluster = pinnedCluster(counts, expected);
  return {
    ratio: contrastRatio(cluster.key, background.key),
    background: background.key,
    foreground: cluster.key,
    expected,
    matched: isMatched(cluster),
    pixels: background.pixels,
    cluster: cluster.count,
    edge: null,
    diagnostic,
    reason: null,
  };
}

/**
 * Whole-pixel envelope: a border painted on a fractional coordinate can land
 * on either neighbouring device row, so the band spans both and the pinned
 * cluster decides which pixels actually count.
 */
const envelope = (band: Rect): Rect => ({
  x: Math.floor(band.x),
  y: Math.floor(band.y),
  width: Math.ceil(band.x + band.width) - Math.floor(band.x),
  height: Math.ceil(band.y + band.height) - Math.floor(band.y),
});

function bands(
  rect: Rect,
  edges: Edges,
): { name: string; band: Rect; colour: Paint }[] {
  const list: { name: string; band: Rect; colour: Paint }[] = [];
  const top = Math.min(edges.top.width, rect.height);
  const right = Math.min(edges.right.width, rect.width);
  const bottom = Math.min(edges.bottom.width, rect.height);
  const left = Math.min(edges.left.width, rect.width);
  const push = (name: string, band: Rect, colour: Paint): void => {
    if (band.width > 0 && band.height > 0)
      list.push({ name, band: envelope(band), colour });
  };
  push(
    'top',
    { x: rect.x, y: rect.y, width: rect.width, height: top },
    edges.top.paint,
  );
  push(
    'right',
    {
      x: rect.x + rect.width - right,
      y: rect.y,
      width: right,
      height: rect.height,
    },
    edges.right.paint,
  );
  push(
    'bottom',
    {
      x: rect.x,
      y: rect.y + rect.height - bottom,
      width: rect.width,
      height: bottom,
    },
    edges.bottom.paint,
  );
  push(
    'left',
    { x: rect.x, y: rect.y, width: left, height: rect.height },
    edges.left.paint,
  );
  return list;
}
