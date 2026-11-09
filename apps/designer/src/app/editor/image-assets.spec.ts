import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignScene } from '@rdlc/report-model/scene';
import {
  ImageAssetCache,
  imageAssetKeys,
  type ImageAssetEnvironment,
} from './image-assets';

/** Distinctive bytes so a leak into any view, log or label is detectable. */
const bytesOf = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const payload = bytesOf(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
);
const jpegPayload = bytesOf('/9j/4AAQSkZJRgABAQEASABIAAD/2Q==');
const png = (key: string) => ({
  key,
  mime: 'image/png' as const,
  data: payload,
});
const jpeg = (key: string) => ({
  key,
  mime: 'image/jpeg' as const,
  data: jpegPayload,
});

interface Harness {
  cache: ImageAssetCache;
  created: Blob[];
  revoked: string[];
}

function harness(): Harness {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const env: ImageAssetEnvironment = {
    createObjectURL: (blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
  };
  return { cache: new ImageAssetCache(env), created, revoked };
}

describe('image asset cache', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports a referenced key without an asset as pending and creates nothing', () => {
    const h = harness();
    h.cache.retain(['a']);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    expect(h.created).toHaveLength(0);
  });

  it('turns the host bytes into a typed Blob and a loading object URL once the key is referenced', async () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), jpeg('b')]);
    expect(h.created.map((blob) => blob.type)).toEqual([
      'image/png',
      'image/jpeg',
    ]);
    expect(h.created[0]!.size).toBe(payload.length);
    expect(h.created[1]!.size).toBe(jpegPayload.length);
    const bytes = new Uint8Array(await h.created[0]!.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // The URL is usable at once (no separate decode step); the rendered <img> decodes it.
    expect(h.cache.view('a')).toEqual({ state: 'loading', url: 'blob:test/1' });
    expect(h.cache.view('b')).toEqual({ state: 'loading', url: 'blob:test/2' });
  });

  it('becomes ready only when the rendered image reports a loaded picture', () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), png('b')]);
    h.cache.loaded('a', 'blob:test/1');
    expect(h.cache.view('a')).toEqual({ state: 'ready', url: 'blob:test/1' });
    expect(h.cache.view('b')).toEqual({ state: 'loading', url: 'blob:test/2' });
    expect(h.revoked).toEqual([]);
  });

  it('builds the Blob from an ArrayBuffer, a typed array or a view onto a larger buffer', async () => {
    const h = harness();
    h.cache.retain(['buffer', 'typed', 'view']);
    const arrayBuffer = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    ) as ArrayBuffer;
    const larger = new Uint8Array(payload.length + 16).fill(0xee);
    larger.set(payload, 8);
    h.cache.add([
      { key: 'buffer', mime: 'image/png', data: arrayBuffer },
      { key: 'typed', mime: 'image/png', data: payload },
      {
        key: 'view',
        mime: 'image/png',
        data: larger.subarray(8, 8 + payload.length),
      },
    ]);
    expect(h.created).toHaveLength(3);
    for (const blob of h.created) {
      expect(blob.type).toBe('image/png');
      expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([
        ...payload,
      ]);
    }
  });

  it('creates no object URL for an asset no scene item references', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('other')]);
    expect(h.created).toHaveLength(0);
    expect(h.cache.view('other')).toEqual({ state: 'pending' });
  });

  it('renders an asset that arrives after the snapshot referenced it', () => {
    const h = harness();
    h.cache.retain(['a']);
    expect(h.cache.view('a').state).toBe('pending');
    h.cache.add([png('a')]);
    expect(h.cache.view('a').state).toBe('loading');
    h.cache.loaded('a', 'blob:test/1');
    expect(h.cache.view('a').state).toBe('ready');
  });

  it('keeps an asset that arrives before the snapshot referencing it, and loads it on that snapshot', () => {
    const h = harness();
    // Host order: imageAssets first, then the snapshot that references the key.
    h.cache.add([png('a')]);
    expect(h.created).toHaveLength(0);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    h.cache.retain(['other']);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(1);
    expect(h.cache.view('a')).toEqual({ state: 'loading', url: 'blob:test/1' });
    h.cache.loaded('a', 'blob:test/1');
    expect(h.cache.view('a').state).toBe('ready');
  });

  it('does not create a second URL for a key that is added again', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.add([png('a')]);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(1);
  });

  it('revokes the object URL when no scene item references the key any longer', () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), png('b')]);
    h.cache.loaded('a', 'blob:test/1');
    h.cache.loaded('b', 'blob:test/2');
    h.cache.retain(['b']);
    expect(h.revoked).toEqual(['blob:test/1']);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    expect(h.cache.view('b')).toEqual({ state: 'ready', url: 'blob:test/2' });
  });

  it('re-creates the URL when a revoked key is referenced again, since the host sends each key once', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.loaded('a', 'blob:test/1');
    h.cache.retain([]);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(2);
    expect(h.cache.view('a')).toEqual({ state: 'loading', url: 'blob:test/2' });
    h.cache.loaded('a', 'blob:test/2');
    expect(h.cache.view('a')).toEqual({ state: 'ready', url: 'blob:test/2' });
    expect(h.revoked).toEqual(['blob:test/1']);
  });

  it('marks a key undecodable when its image fails and revokes its URL', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.failed('a', 'blob:test/1');
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
    expect(h.revoked).toEqual(['blob:test/1']);
  });

  it('does not retry an undecodable key on later snapshots', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.failed('a', 'blob:test/1');
    h.cache.retain(['a']);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(1);
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
  });

  it('allows one fresh load attempt when an undecodable key is released and referenced again', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.failed('a', 'blob:test/1');
    h.cache.retain([]);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(2);
    h.cache.failed('a', 'blob:test/2');
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
    // Still referenced: no further attempt until it is released again.
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(2);
    h.cache.retain([]);
    h.cache.retain(['a']);
    h.cache.loaded('a', 'blob:test/3');
    expect(h.cache.view('a').state).toBe('ready');
  });

  it('ignores an image result that arrives after the key was released', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.retain([]);
    expect(h.revoked).toEqual(['blob:test/1']);
    h.cache.loaded('a', 'blob:test/1');
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    // A late failure must not poison a key that is merely released or re-loading.
    h.cache.retain(['a']);
    h.cache.failed('a', 'blob:test/1');
    expect(h.cache.view('a')).toEqual({ state: 'loading', url: 'blob:test/2' });
  });

  it('ignores a second result once the image settled', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.loaded('a', 'blob:test/1');
    h.cache.failed('a', 'blob:test/1');
    expect(h.cache.view('a').state).toBe('ready');
    expect(h.revoked).toEqual([]);
  });

  it('bumps its revision whenever a view can change', () => {
    const h = harness();
    const seen = [h.cache.revision()];
    h.cache.retain(['a']);
    seen.push(h.cache.revision());
    h.cache.add([png('a')]);
    seen.push(h.cache.revision());
    h.cache.loaded('a', 'blob:test/1');
    seen.push(h.cache.revision());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('revokes every live URL on dispose', () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), jpeg('b')]);
    h.cache.loaded('a', 'blob:test/1');
    h.cache.dispose();
    expect(h.revoked.sort()).toEqual(['blob:test/1', 'blob:test/2']);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
  });

  it('never exposes or logs the payload', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const h = harness();
    h.cache.retain(['a', 'bad']);
    h.cache.add([png('a'), jpeg('bad')]);
    h.cache.failed('bad', 'blob:test/2');
    const exposed = JSON.stringify([h.cache.view('a'), h.cache.view('bad')]);
    expect(exposed).not.toContain(
      String(payload[8]) + ',' + String(payload[9]),
    );
    expect(exposed).not.toContain('iVBORw0K');
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});

describe('imageAssetKeys', () => {
  const item = (
    id: string,
    extra: Partial<DesignScene['items'][number]> = {},
  ): DesignScene['items'][number] => ({
    id,
    bounds: { left: 0, top: 0, width: 10, height: 10 },
    label: id,
    placeholder: false,
    ...extra,
  });

  it('collects the asset keys of picture items only', () => {
    const scene: DesignScene = {
      version: 1,
      page: { left: 0, top: 0, width: 100, height: 100 },
      body: { left: 0, top: 0, width: 100, height: 100 },
      items: [
        item('1', { kind: 'textbox' }),
        item('2', {
          kind: 'image',
          sizing: 'Fit',
          display: {
            state: 'picture',
            assetKey: 'k1',
            pixels: { width: 1, height: 1 },
          },
        }),
        item('3', {
          kind: 'image',
          sizing: 'Fit',
          display: { state: 'placeholder', reason: 'data-invalid' },
        }),
        item('4', {
          kind: 'image',
          sizing: 'Clip',
          display: {
            state: 'picture',
            assetKey: 'k1',
            pixels: { width: 1, height: 1 },
          },
        }),
      ],
    };
    expect([...imageAssetKeys(scene)]).toEqual(['k1']);
    expect(imageAssetKeys(null).size).toBe(0);
  });
});
