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
  readonly blob: Blob;
  /** Live object URL; null while the key is released or when the picture cannot be decoded. */
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

/**
 * The picture as a Blob straight from the host's bytes: no text decoding, which is
 * also why nothing here needs `atob`. A copy is the Blob's own storage, so the
 * message buffer is not retained.
 */
function toBlob(asset: ImageAsset): Blob {
  return new Blob([asset.data as BlobPart], { type: asset.mime });
}

/**
 * Webview-side store of host-sent pictures: bytes -> Blob -> object URL, keyed by
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
      this.entries.set(asset.key, {
        blob: toBlob(asset),
        url: null,
        status: 'idle',
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
    if (!entry || entry.url || entry.status !== 'idle') return;
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
    // Released keys get a fresh decode attempt when referenced again.
    entry.status = 'idle';
  }

  private changed(): void {
    this.counter.update((value) => value + 1);
  }
}
