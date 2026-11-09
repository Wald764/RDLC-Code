import { InjectionToken, signal, type Signal } from '@angular/core';
import type { ImageAsset } from '@rdlc/report-model/protocol';
import type { DesignScene } from '@rdlc/report-model/scene';

/**
 * The browser primitives the cache depends on, injectable so tests need no real
 * object-URL store. Decoding is not one of them: the rendered `<img>` is the only
 * decoder, and its load/error events report back through `loaded` / `failed`.
 */
export interface ImageAssetEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export const IMAGE_ASSET_ENVIRONMENT =
  new InjectionToken<ImageAssetEnvironment>('IMAGE_ASSET_ENVIRONMENT', {
    providedIn: 'root',
    factory: () => ({
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    }),
  });

/**
 * What the canvas may show for a key. `pending` covers a key whose asset has not
 * arrived yet and one that was released. `loading` carries the `blob:` URL the
 * rendered `<img>` is loading (it stays hidden, never a broken image) and `ready`
 * the same URL once that `<img>` reported a decoded picture. `undecodable` is the
 * `<img>` failing to load it.
 */
export type ImageAssetView =
  | { readonly state: 'pending' }
  | { readonly state: 'loading'; readonly url: string }
  | { readonly state: 'ready'; readonly url: string }
  | { readonly state: 'undecodable' };

interface Entry {
  readonly blob: Blob;
  /** Live object URL; null while the key is released or when the picture cannot be decoded. */
  url: string | null;
  status: 'idle' | 'loading' | 'ready' | 'undecodable';
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
    if (entry?.url && entry.status === 'ready')
      return { state: 'ready', url: entry.url };
    if (entry?.url && entry.status === 'loading')
      return { state: 'loading', url: entry.url };
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
    entry.status = 'loading';
  }

  /** The rendered `<img>` of this URL loaded a picture; ignored once the URL is gone. */
  loaded(key: string, url: string): void {
    this.settle(key, url, 'ready');
  }

  /** The rendered `<img>` of this URL could not load a picture; ignored once the URL is gone. */
  failed(key: string, url: string): void {
    this.settle(key, url, 'undecodable');
  }

  /** Applies an image result unless the URL was revoked or already settled in the meantime. */
  private settle(key: string, url: string, status: 'ready' | 'undecodable') {
    const entry = this.entries.get(key);
    if (!entry || entry.url !== url || entry.status !== 'loading') return;
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
    // Released keys get a fresh load attempt when referenced again.
    entry.status = 'idle';
  }

  private changed(): void {
    this.counter.update((value) => value + 1);
  }
}
