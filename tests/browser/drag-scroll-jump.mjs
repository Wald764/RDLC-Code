/* global process, URL, WebSocket, setTimeout, clearTimeout, structuredClone, console, fetch */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Run after the designer build, with CHROME_PATH pointing to a local Chromium executable.
const chrome = process.env.CHROME_PATH;
assert.ok(chrome, 'Set CHROME_PATH to a local Chromium executable.');
const root = resolve('dist/designer/browser');
const profile = await mkdtemp(resolve('dist/drag-scroll-layout-'));
const server = createServer(async (request, response) => {
  try {
    const file = resolve(
      root,
      `.${new URL(request.url, 'http://localhost').pathname.replace(/\/$/, '/index.html')}`,
    );
    assert.ok(file.startsWith(root + sep));
    response.setHeader(
      'Content-Type',
      { '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ??
        'text/html',
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = spawn(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = Number(
        (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(
          '\n',
        )[0],
      );
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(port, 'Chromium debugging endpoint did not start.');
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    })
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.equal(
      result.exceptionDetails,
      undefined,
      JSON.stringify(result.exceptionDetails),
    );
    return result.result.value;
  };
  const settle = () =>
    evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
  await send('Page.enable');
  await send('Runtime.enable');
  const snapshot = {
    protocol: 2,
    kind: 'snapshot',
    version: 2,
    projection: {
      status: 'editable',
      capabilities: ['source', 'projection'],
      diagnostics: [],
    },
    scene: {
      version: 2,
      page: { left: 0, top: 0, width: 1000, height: 1200 },
      body: { left: 0, top: 0, width: 800, height: 700 },
      items: [
        {
          id: '2:3',
          kind: 'textbox',
          name: 'Title',
          label: 'Title: Drag target',
          text: 'Drag target',
          placeholder: false,
          bounds: { left: 200, top: 240, width: 288, height: 48 },
          geometry: {
            left: '150pt',
            top: '180pt',
            width: '216pt',
            height: '36pt',
          },
          capabilities: ['text', 'left', 'top', 'width', 'height'],
          operations: Object.fromEntries(
            ['moveX', 'moveY', 'resizeX', 'resizeY'].map((key) => [
              key,
              { eligible: true, reason: null },
            ]),
          ),
        },
      ],
    },
    authoring: {
      id: '2:0',
      page: {
        width: '10in',
        height: '12in',
        top: '0in',
        right: '0in',
        bottom: '0in',
        left: '0in',
        bodyWidth: '6in',
        bodyHeight: '5in',
      },
      datasets: [],
      tables: [],
    },
  };
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__snapshot = ${JSON.stringify(snapshot)}; window.__sent = []; window.__focus = []; const focus = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function(options) { const before = scrollY; focus.call(this, options); window.__focus.push({ tag: this.tagName, options, before, after: scrollY }); }; window.acquireVsCodeApi = () => ({ postMessage(message) { window.__sent.push(message); if (message.kind === 'ready') window.postMessage(window.__snapshot, '*'); } });`,
  });
  const mouse = (type, x, y) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' ? 'none' : 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  const state = () =>
    evaluate(`(() => {
    const body = document.querySelector('.body').getBoundingClientRect();
    const preview = document.querySelector('.preview')?.getBoundingClientRect();
    const item = document.querySelector('.item').getBoundingClientRect();
    return { bodyX: body.left + scrollX, bodyY: body.top + scrollY, scrollX, scrollY, focus: window.__focus, item: { left: item.left, top: item.top, width: item.width, height: item.height }, preview: preview ? { left: preview.left, top: preview.top, width: preview.width, height: preview.height } : null };
  })()`);
  const stable = (before, after, label) => {
    for (const key of ['bodyX', 'bodyY', 'scrollX', 'scrollY'])
      assert.ok(
        Math.abs(before[key] - after[key]) < 0.05,
        `${label}: ${key} changed ${before[key]} -> ${after[key]}; ${JSON.stringify(after)}`,
      );
  };
  const version = await send('Browser.getVersion');
  const results = [];
  for (const handle of ['move', 'se'])
    for (const deviceScaleFactor of [1, 2])
      for (const initialScroll of [0, 120])
        for (const snapshotFirst of [true, false]) {
          await send('Emulation.setDeviceMetricsOverride', {
            width: 900,
            height: 800,
            deviceScaleFactor,
            mobile: false,
          });
          await send('Page.navigate', {
            url: `http://127.0.0.1:${server.address().port}/`,
          });
          let ready = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluate("!!document.querySelector('.item')")) {
              ready = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          assert.ok(
            ready,
            'Built Angular designer did not accept its initial snapshot.',
          );
          await settle();
          await evaluate(
            `scrollTo(${initialScroll ? 80 : 0}, ${initialScroll})`,
          );
          const before = await state();
          let x = before.item.left + 10,
            y = before.item.top + 10;
          if (handle === 'se') {
            await mouse('mousePressed', x, y);
            await mouse('mouseReleased', x, y);
            await settle();
            const rect = await evaluate(
              "(() => { const r = document.querySelector('[data-handle=se]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()",
            );
            x = rect.x;
            y = rect.y;
          }
          stable(before, await state(), 'Selection');
          await mouse('mousePressed', x, y);
          await mouse('mouseMoved', x + 8, y + 4);
          await settle();
          const preview = await state();
          stable(before, preview, 'Preview status insertion');
          assert.ok(preview.preview, 'Expected a visible captured preview.');
          assert.ok(
            await evaluate(
              "document.querySelector('.editor').textContent.includes('Preview only')",
            ),
          );
          if (handle === 'move') {
            assert.ok(
              Math.abs(preview.preview.left - (before.item.left + 8)) < 0.05,
              'Horizontal pointer anchor drifted.',
            );
            assert.ok(
              Math.abs(preview.preview.top - (before.item.top + 4)) < 0.05,
              'Vertical pointer anchor drifted.',
            );
          } else {
            assert.ok(
              Math.abs(preview.preview.width - (before.item.width + 8)) < 0.05,
              'Resize X delta incorrectly scaled.',
            );
            assert.ok(
              Math.abs(preview.preview.height - (before.item.height + 4)) <
                0.05,
              'Resize Y delta incorrectly scaled.',
            );
          }
          // An intentional window scroll is reflected once in report-space deltas.
          await evaluate('scrollBy(0, 24)');
          await mouse('mouseMoved', x + 32, y + 16);
          await settle();
          const scrolled = await state();
          if (handle === 'move')
            assert.ok(
              Math.abs(scrolled.preview.top - (y + 16 - 10)) < 0.05,
              'Pointer anchor drifted after intentional scrolling.',
            );
          await mouse('mouseReleased', x + 32, y + 16);
          await settle();
          stable(scrolled, await state(), 'Pending status');
          const request = await evaluate(
            "window.__sent.findLast(message => message.kind === 'edit')",
          );
          assert.ok(request, 'Captured release did not submit an edit.');
          if (handle === 'move') {
            assert.equal(request.payload.dxPt, 24);
            assert.equal(request.payload.dyPt, 30);
          } else {
            assert.equal(request.payload.xPt, 390);
            assert.equal(request.payload.yPt, 246);
          }
          const next = structuredClone(snapshot);
          next.version = next.scene.version = 3;
          next.authoring.id = '3:0';
          next.scene.items[0].id = '3:3';
          next.scene.items[0].bounds =
            handle === 'move'
              ? { left: 232, top: 280, width: 288, height: 48 }
              : { left: 200, top: 240, width: 320, height: 88 };
          const result = {
            protocol: 2,
            kind: 'editResult',
            requestId: request.requestId,
            baseVersion: 2,
            version: 3,
            accepted: true,
            changed: true,
            mappings: [{ sourceId: '2:3', resultId: '3:3' }],
            reason: 'APPLIED',
            diagnostics: [],
          };
          const messages = snapshotFirst ? [next, result] : [result, next];
          for (const message of messages) {
            await evaluate(
              `window.postMessage(${JSON.stringify(message)}, '*')`,
            );
            await settle();
            stable(scrolled, await state(), 'Authoritative acceptance/focus');
          }
          assert.ok(
            await evaluate(
              "document.querySelector('.item').classList.contains('selected')",
            ),
          );
          assert.ok(
            await evaluate(
              "document.activeElement === document.querySelector('rdlc-authoring')",
            ),
            'Authoring restart focus was lost.',
          );
          // Cancellation, no-op, invalid release and refusal share the same stable feedback slot.
          const press = async () => {
            const { item } = await state();
            const point = { x: item.left + 10, y: item.top + 10 };
            await mouse('mousePressed', point.x, point.y);
            return point;
          };
          const editCount = () =>
            evaluate(
              "window.__sent.filter(message => message.kind === 'edit').length",
            );
          const count = await editCount();
          let point = await press();
          await mouse('mouseMoved', point.x + 8, point.y + 4);
          await settle();
          await send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
          });
          await mouse('mouseReleased', point.x + 8, point.y + 4);
          await settle();
          stable(scrolled, await state(), 'Cancelled drag');
          assert.equal(await editCount(), count);
          point = await press();
          await mouse('mouseMoved', -200, point.y);
          await settle();
          await mouse('mouseReleased', -200, point.y);
          await settle();
          stable(scrolled, await state(), 'Invalid release');
          assert.equal(await editCount(), count);
          for (const accepted of [true, false]) {
            point = await press();
            await mouse('mouseMoved', point.x + 8, point.y + 4);
            await settle();
            const end = accepted ? point : { x: point.x + 8, y: point.y + 4 };
            await mouse('mouseReleased', end.x, end.y);
            await settle();
            const latest = await evaluate(
              "window.__sent.findLast(message => message.kind === 'edit')",
            );
            if (accepted) {
              assert.equal(latest.payload.dxPt, 0);
              assert.equal(latest.payload.dyPt, 0);
            }
            const unchanged = {
              protocol: 2,
              kind: 'editResult',
              requestId: latest.requestId,
              baseVersion: 3,
              version: 3,
              accepted,
              changed: false,
              mappings: [],
              reason: accepted ? 'UNCHANGED' : 'REJECTED',
              diagnostics: [],
            };
            await evaluate(
              `window.postMessage(${JSON.stringify(unchanged)}, '*')`,
            );
            await settle();
            stable(scrolled, await state(), accepted ? 'No-op' : 'Refusal');
          }
          await evaluate(
            `window.postMessage({ protocol: 2, kind: 'protocolError', supportedVersion: 2, reason: 'Long informational message '.repeat(150) }, '*')`,
          );
          await settle();
          stable(scrolled, await state(), 'Wrapped informational message');
          assert.ok(
            await evaluate(
              "(() => { const feedback = document.querySelector('.feedback'); return feedback.scrollHeight > feedback.clientHeight; })()",
            ),
            'Long feedback must overflow within its slot, not enlarge it.',
          );
          const independent = structuredClone(next);
          independent.version = independent.scene.version = 4;
          independent.authoring.id = '4:0';
          independent.scene.items[0].id = '4:3';
          await evaluate(
            `window.postMessage(${JSON.stringify(independent)}, '*')`,
          );
          await settle();
          stable(scrolled, await state(), 'Independent snapshot');
          assert.ok(
            await evaluate(
              "document.activeElement === document.querySelector('rdlc-authoring')",
            ),
          );
          results.push({
            handle,
            deviceScaleFactor,
            initialScroll,
            snapshotFirst,
            bodyDocumentY: before.bodyY,
            scrollAfter: (await state()).scrollY,
          });
        }
  console.log(
    JSON.stringify(
      { browser: version.product, status: 'PASS', cases: results },
      null,
      2,
    ),
  );
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
