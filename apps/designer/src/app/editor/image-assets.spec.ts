import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignScene } from '@rdlc/report-model/scene';
import {
  decodeBase64,
  ImageAssetCache,
  imageAssetKeys,
  type ImageAssetEnvironment,
} from './image-assets';

/** Distinctive bytes so a leak into any view, log or label is detectable. */
const payload =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';
const jpegPayload = '/9j/4AAQSkZJRgABAQEASABIAAD/2Q==';
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
  decodes: {
    url: string;
    resolve(): void;
    reject(error: unknown): void;
  }[];
}

function harness(): Harness {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const decodes: Harness['decodes'] = [];
  const env: ImageAssetEnvironment = {
    createObjectURL: (blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    },
    revokeObjectURL: (url: string) => void revoked.push(url),
    decode: (url) =>
      new Promise<void>((resolve, reject) =>
        decodes.push({ url, resolve, reject }),
      ),
  };
  return { cache: new ImageAssetCache(env), created, revoked, decodes };
}
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('image asset cache', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports a referenced key without an asset as pending and creates nothing', () => {
    const h = harness();
    h.cache.retain(['a']);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    expect(h.created).toHaveLength(0);
  });

  it('turns base64 into a typed Blob and an object URL once the key is referenced', async () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), jpeg('b')]);
    expect(h.created.map((blob) => blob.type)).toEqual([
      'image/png',
      'image/jpeg',
    ]);
    expect(h.created[0]!.size).toBe(atob(payload).length);
    expect(h.created[1]!.size).toBe(atob(jpegPayload).length);
    const bytes = new Uint8Array(await h.created[0]!.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // Decoding is pending: no URL is exposed to the DOM until decode succeeds.
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    h.decodes[0]!.resolve();
    await settle();
    expect(h.cache.view('a')).toEqual({ state: 'ready', url: 'blob:test/1' });
    expect(h.cache.view('b')).toEqual({ state: 'pending' });
  });

  it('creates no object URL for an asset no scene item references', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('other')]);
    expect(h.created).toHaveLength(0);
    expect(h.cache.view('other')).toEqual({ state: 'pending' });
  });

  it('renders an asset that arrives after the snapshot referenced it', async () => {
    const h = harness();
    h.cache.retain(['a']);
    expect(h.cache.view('a').state).toBe('pending');
    h.cache.add([png('a')]);
    h.decodes[0]!.resolve();
    await settle();
    expect(h.cache.view('a').state).toBe('ready');
  });

  it('does not create a second URL for a key that is added again', () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.add([png('a')]);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(1);
    expect(h.decodes).toHaveLength(1);
  });

  it('revokes the object URL when no scene item references the key any longer', async () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), png('b')]);
    h.decodes.forEach((decode) => decode.resolve());
    await settle();
    h.cache.retain(['b']);
    expect(h.revoked).toEqual(['blob:test/1']);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    expect(h.cache.view('b')).toEqual({ state: 'ready', url: 'blob:test/2' });
  });

  it('re-creates the URL when a revoked key is referenced again, since the host sends each key once', async () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.decodes[0]!.resolve();
    await settle();
    h.cache.retain([]);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(2);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    h.decodes[1]!.resolve();
    await settle();
    expect(h.cache.view('a')).toEqual({ state: 'ready', url: 'blob:test/2' });
    expect(h.revoked).toEqual(['blob:test/1']);
  });

  it('marks a key undecodable when decode() fails and revokes its URL', async () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.decodes[0]!.reject(new Error('EncodingError'));
    await settle();
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
    expect(h.revoked).toEqual(['blob:test/1']);
  });

  it('does not retry an undecodable key on later snapshots', async () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.decodes[0]!.reject(new Error('EncodingError'));
    await settle();
    h.cache.retain(['a']);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(1);
    expect(h.decodes).toHaveLength(1);
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
  });

  it('allows one fresh decode attempt when an undecodable key is released and referenced again', async () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.decodes[0]!.reject(new Error('EncodingError'));
    await settle();
    h.cache.retain([]);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(2);
    expect(h.decodes).toHaveLength(2);
    h.decodes[1]!.reject(new Error('EncodingError'));
    await settle();
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
    // Still referenced: no further attempt until it is released again.
    h.cache.retain(['a']);
    expect(h.decodes).toHaveLength(2);
    h.cache.retain([]);
    h.cache.retain(['a']);
    h.decodes[2]!.resolve();
    await settle();
    expect(h.cache.view('a').state).toBe('ready');
  });

  it('never retries a key whose base64 could not be decoded into a Blob', async () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([{ key: 'a', mime: 'image/png', data: '!!!' }]);
    h.cache.retain([]);
    h.cache.retain(['a']);
    expect(h.created).toHaveLength(0);
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
  });

  it('ignores a decode result that settles after the key was released', async () => {
    const h = harness();
    h.cache.retain(['a']);
    h.cache.add([png('a')]);
    h.cache.retain([]);
    expect(h.revoked).toEqual(['blob:test/1']);
    h.decodes[0]!.resolve();
    await settle();
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
    // A late failure must not poison a key that is merely released.
    h.cache.retain(['a']);
    h.decodes[0]!.reject(new Error('late'));
    await settle();
    expect(h.cache.view('a').state).toBe('pending');
  });

  it('treats an undecodable base64 string as undecodable instead of throwing', async () => {
    const h = harness();
    h.cache.retain(['a']);
    expect(() =>
      h.cache.add([{ key: 'a', mime: 'image/png', data: '!!!' }]),
    ).not.toThrow();
    await settle();
    expect(h.cache.view('a')).toEqual({ state: 'undecodable' });
    expect(h.created).toHaveLength(0);
  });

  it('bumps its revision whenever a view can change', async () => {
    const h = harness();
    const seen = [h.cache.revision()];
    h.cache.retain(['a']);
    seen.push(h.cache.revision());
    h.cache.add([png('a')]);
    seen.push(h.cache.revision());
    h.decodes[0]!.resolve();
    await settle();
    seen.push(h.cache.revision());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('revokes every live URL on dispose', async () => {
    const h = harness();
    h.cache.retain(['a', 'b']);
    h.cache.add([png('a'), jpeg('b')]);
    h.decodes[0]!.resolve();
    await settle();
    h.cache.dispose();
    expect(h.revoked.sort()).toEqual(['blob:test/1', 'blob:test/2']);
    expect(h.cache.view('a')).toEqual({ state: 'pending' });
  });

  it('never exposes or logs the payload', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const h = harness();
    h.cache.retain(['a', 'bad']);
    h.cache.add([png('a'), { key: 'bad', mime: 'image/png', data: '!!!' }]);
    h.decodes[0]!.reject(new Error('EncodingError'));
    await settle();
    const exposed = JSON.stringify([h.cache.view('a'), h.cache.view('bad')]);
    expect(exposed).not.toContain(payload.slice(8, 40));
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

describe('decodeBase64', () => {
  // Plain arrays: jsdom and Node disagree on the Uint8Array realm.
  const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
  const bytes = (value: Uint8Array | null) => (value ? [...value] : null);

  it('decodes unpadded and padded payloads of every remainder', () => {
    expect(bytes(decodeBase64(''))).toEqual([]);
    expect(bytes(decodeBase64('TWFu'))).toEqual(text('Man'));
    expect(bytes(decodeBase64('TWE='))).toEqual(text('Ma'));
    expect(bytes(decodeBase64('TQ=='))).toEqual(text('M'));
    // Unpadded input is accepted, as with atob.
    expect(bytes(decodeBase64('TWE'))).toEqual(text('Ma'));
    expect(bytes(decodeBase64('TQ'))).toEqual(text('M'));
  });

  it('decodes the whole alphabet including + and /', () => {
    expect(bytes(decodeBase64('+/+/'))).toEqual([0xfb, 0xff, 0xbf]);
    expect(bytes(decodeBase64('/9j/'))).toEqual([0xff, 0xd8, 0xff]);
  });

  it('matches atob byte for byte on the PNG and JPEG payloads', () => {
    for (const data of [payload, jpegPayload]) {
      const expected = Uint8Array.from(atob(data), (char) =>
        char.charCodeAt(0),
      );
      expect(bytes(decodeBase64(data))).toEqual([...expected]);
    }
  });

  it('ignores ASCII whitespace like atob', () => {
    expect(bytes(decodeBase64(' TW\r\nFu\t'))).toEqual(text('Man'));
    expect(bytes(decodeBase64('TW E='))).toEqual(text('Ma'));
  });

  it('rejects invalid input', () => {
    for (const bad of [
      'T',
      'TWFuT',
      '*WFu',
      'TW-u',
      'TWFu\u00e9',
      'TQ=',
      'T===',
      'TQ===',
      '=TWF',
      'TQ==TQ==',
      'TW=u',
      'TWFu=',
    ])
      expect(decodeBase64(bad), bad).toBeNull();
  });

  it('agrees with atob on accept/reject for a spread of inputs', () => {
    for (const input of [
      '',
      'T',
      'TQ',
      'TQ=',
      'TQ==',
      'TQ===',
      'TWE=',
      'T=Q=',
      'a b c d',
    ]) {
      let reference: Uint8Array | null;
      try {
        reference = Uint8Array.from(atob(input), (char) => char.charCodeAt(0));
      } catch {
        reference = null;
      }
      expect(bytes(decodeBase64(input)), input).toEqual(
        reference && [...reference],
      );
    }
  });

  it('decodes a 5 MiB payload without pathological slowdown', () => {
    const groups = Math.ceil((5 * 1024 * 1024) / 3);
    const data = 'TWFu'.repeat(groups);
    const started = performance.now();
    const decoded = decodeBase64(data);
    const elapsed = performance.now() - started;
    expect(decoded?.length).toBe(groups * 3);
    expect(String.fromCharCode(...decoded!.subarray(0, 3))).toBe('Man');
    // Generous bound: it only guards against pathological (quadratic)
    // behaviour, not against normal CI timing variance.
    expect(elapsed).toBeLessThan(5000);
  });
});
