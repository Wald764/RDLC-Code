import { InjectionToken, signal, type Signal } from '@angular/core';
import type { ImageAsset } from '@rdlc/report-model/protocol';
import type { DesignScene } from '@rdlc/report-model/scene';

/**
 * The browser primitives the cache depends on, injectable so tests need neither a
 * real object-URL store nor a real image decoder.
 */
export interface ImageAssetEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** Resolves when the browser can decode the picture; rejects when it cannot. */
  decode(url: string): Promise<void>;
}

export const IMAGE_ASSET_ENVIRONMENT =
  new InjectionToken<ImageAssetEnvironment>('IMAGE_ASSET_ENVIRONMENT', {
    providedIn: 'root',
    factory: () => ({
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      decode: (url) => {
        const image = new Image();
        image.src = url;
        return image.decode();
      },
    }),
  });

/**
 * What the canvas may show for a key. `pending` covers a key whose asset has not
 * arrived yet, one that is still decoding and one that was released: never a
 * broken image. Only `ready` carries a URL, and it is always a `blob:` URL.
 */
export type ImageAssetView =
  | { readonly state: 'pending' }
  | { readonly state: 'ready'; readonly url: string }
  | { readonly state: 'undecodable' };

interface Entry {
  readonly blob: Blob | null;
  /** Live object URL; null while the key is released or when the blob is unusable. */
  url: string | null;
  status: 'idle' | 'decoding' | 'ready' | 'undecodable';
}

/** Asset keys the scene's picture items reference. */
export function imageAssetKeys(scene: DesignScene | null): Set<string> {
  const keys = new Set<string>();
  for (const item of scene?.items ?? [])
    if (item.kind === 'image' && item.display?.state === 'picture')
      keys.add(item.display.assetKey);
  return keys;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Maps a char code to its 6-bit value, or -1 for anything outside the alphabet. */
const BASE64_LOOKUP: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1)
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  return table;
})();

/** ASCII whitespace the forgiving base64 decoding ignores: TAB, LF, FF, CR, space. */
function isBase64Whitespace(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x20
  );
}

/**
 * Decodes standard base64 to bytes, following the forgiving-base64 rules of the
 * platform `atob` (ASCII whitespace ignored, up to two trailing `=` accepted only
 * when the length is a multiple of four, anything else rejected) without calling
 * it: the offline guard forbids `atob` in the bundle. Returns null on invalid input.
 */
export function decodeBase64(text: string): Uint8Array | null {
  const sextets = new Uint8Array(text.length);
  let count = 0;
  let padding = 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isBase64Whitespace(code)) continue;
    seen += 1;
    if (code === 0x3d) {
      padding += 1;
      continue;
    }
    // Data after padding, or a char outside the alphabet, is invalid.
    const value = padding === 0 && code < 128 ? BASE64_LOOKUP[code]! : -1;
    if (value < 0) return null;
    sextets[count] = value;
    count += 1;
  }
  if (padding > 0 && (padding > 2 || seen % 4 !== 0)) return null;
  const remainder = count % 4;
  if (remainder === 1) return null;
  const length =
    Math.floor(count / 4) * 3 + (remainder === 0 ? 0 : remainder - 1);
  const bytes = new Uint8Array(length);
  let out = 0;
  let cursor = 0;
  for (; cursor + 4 <= count; cursor += 4) {
    const chunk =
      (sextets[cursor]! << 18) |
      (sextets[cursor + 1]! << 12) |
      (sextets[cursor + 2]! << 6) |
      sextets[cursor + 3]!;
    bytes[out++] = (chunk >> 16) & 0xff;
    bytes[out++] = (chunk >> 8) & 0xff;
    bytes[out++] = chunk & 0xff;
  }
  if (remainder >= 2) {
    const chunk = (sextets[cursor]! << 18) | (sextets[cursor + 1]! << 12);
    bytes[out++] = (chunk >> 16) & 0xff;
    if (remainder === 3) {
      const full = chunk | (sextets[cursor + 2]! << 6);
      bytes[out++] = (full >> 8) & 0xff;
    }
  }
  return bytes;
}

function toBlob(asset: ImageAsset): Blob | null {
  const bytes = decodeBase64(asset.data);
  return bytes ? new Blob([bytes as BlobPart], { type: asset.mime }) : null;
}

/**
 * Webview-side store of host-sent pictures: base64 -> Blob -> object URL, keyed by
 * asset key. The host sends each key once, so the decoded Blob is kept for the
 * life of the view and only its object URL follows the scene: it is created when a
 * scene item references the key and revoked when none does. Payloads never leave
 * this class: not in views, logs or errors.
 */
export class ImageAssetCache {
  private readonly entries = new Map<string, Entry>();
  private referenced: ReadonlySet<string> = new Set();
  private readonly counter = signal(0);
  /** Changes whenever any `view()` may have changed; read it to stay reactive. */
  readonly revision: Signal<number> = this.counter.asReadonly();

  constructor(private readonly env: ImageAssetEnvironment) {}

  /** Stores newly received assets; a key already held is left untouched. */
  add(assets: readonly ImageAsset[]): void {
    for (const asset of assets) {
      if (this.entries.has(asset.key)) continue;
      const blob = toBlob(asset);
      this.entries.set(asset.key, {
        blob,
        url: null,
        status: blob ? 'idle' : 'undecodable',
      });
      this.activate(asset.key);
    }
    this.changed();
  }

  /** Applies the keys the latest snapshot references; call it after each snapshot. */
  retain(keys: Iterable<string>): void {
    this.referenced = new Set(keys);
    for (const [key, entry] of this.entries) {
      if (!this.referenced.has(key)) this.release(entry);
      else this.activate(key);
    }
    this.changed();
  }

  view(key: string): ImageAssetView {
    this.counter();
    const entry = this.entries.get(key);
    if (entry?.status === 'ready' && entry.url)
      return { state: 'ready', url: entry.url };
    if (entry?.status === 'undecodable') return { state: 'undecodable' };
    return { state: 'pending' };
  }

  /** Revokes every live URL and forgets every asset. */
  dispose(): void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.referenced = new Set();
    this.changed();
  }

  private activate(key: string): void {
    const entry = this.entries.get(key);
    if (!entry?.blob || entry.url || entry.status !== 'idle') return;
    if (!this.referenced.has(key)) return;
    const url = this.env.createObjectURL(entry.blob);
    entry.url = url;
    entry.status = 'decoding';
    this.env.decode(url).then(
      () => this.settle(key, url, 'ready'),
      () => this.settle(key, url, 'undecodable'),
    );
  }

  /** Applies a decode result unless the URL was revoked in the meantime. */
  private settle(key: string, url: string, status: 'ready' | 'undecodable') {
    const entry = this.entries.get(key);
    if (!entry || entry.url !== url) return;
    if (status === 'undecodable') {
      this.env.revokeObjectURL(url);
      entry.url = null;
    }
    entry.status = status;
    this.changed();
  }

  private release(entry: Entry): void {
    if (entry.url) {
      this.env.revokeObjectURL(entry.url);
      entry.url = null;
    }
    // Released keys get a fresh decode attempt when referenced again; a key whose
    // base64 never produced a Blob has nothing to retry.
    if (entry.blob) entry.status = 'idle';
  }

  private changed(): void {
    this.counter.update((value) => value + 1);
  }
}
