import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleHistoryChange } from './history-settle.js';

/** A document whose version only moves when the test says the change arrived. */
function fixture() {
  const document = { version: 7, isClosed: false };
  const listeners = new Set<() => void>();
  const closers = new Set<() => void>();
  return {
    document,
    listeners,
    closers,
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    onClose: (listener: () => void) => {
      closers.add(listener);
      return { dispose: () => void closers.delete(listener) };
    },
    close() {
      document.isClosed = true;
      for (const listener of [...closers]) listener();
    },
    arrive(version = 8) {
      document.version = version;
      for (const listener of [...listeners]) listener();
    },
  };
}

test('a change that already arrived settles without waiting', async () => {
  const f = fixture();
  f.document.version = 8;
  assert.equal(
    await settleHistoryChange(f.document, 7, f.onChange, f.onClose, 10_000),
    true,
  );
  assert.equal(f.listeners.size + f.closers.size, 0);
});

test('a change delivered after the command resolved is awaited, not missed', async () => {
  const f = fixture();
  const settled = settleHistoryChange(
    f.document,
    7,
    f.onChange,
    f.onClose,
    10_000,
  );
  assert.equal(f.listeners.size, 1);
  assert.equal(f.closers.size, 1);
  f.arrive();
  assert.equal(await settled, true);
  assert.equal(
    f.listeners.size + f.closers.size,
    0,
    'every subscription is released',
  );
});

test('events that leave the version unchanged do not settle early', async () => {
  const f = fixture();
  let result: boolean | undefined;
  const settled = settleHistoryChange(
    f.document,
    7,
    f.onChange,
    f.onClose,
    10_000,
  ).then((value) => (result = value));
  f.arrive(7);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result, undefined);
  f.arrive(9);
  await settled;
  assert.equal(result, true);
});

test('a genuine no-op settles false once the bounded wait ends', async () => {
  const f = fixture();
  assert.equal(
    await settleHistoryChange(f.document, 7, f.onChange, f.onClose, 20),
    false,
  );
  assert.equal(
    f.listeners.size + f.closers.size,
    0,
    'every subscription is released',
  );
});

test('a closed document settles false immediately', async () => {
  const f = fixture();
  f.document.isClosed = true;
  assert.equal(
    await settleHistoryChange(f.document, 7, f.onChange, f.onClose, 10_000),
    false,
  );
  assert.equal(f.listeners.size + f.closers.size, 0);
});

test('a document that closes while waiting settles false promptly', async () => {
  const f = fixture();
  const settled = settleHistoryChange(
    f.document,
    7,
    f.onChange,
    f.onClose,
    10_000,
  );
  f.close();
  assert.equal(await settled, false);
  assert.equal(
    f.listeners.size + f.closers.size,
    0,
    'every subscription is released',
  );
});
