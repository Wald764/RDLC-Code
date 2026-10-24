/* global process, URL, WebSocket, setTimeout, clearTimeout, console, fetch, Buffer */
// Rendered-designer acceptance matrix for specs/003-designer-ux-ui-overhaul.
// Run after `pnpm build`, with CHROME_PATH pointing to a local Chromium/Edge executable:
//   node tests/browser/designer-ux.mjs > dist/designer-ux.json
// The real DocumentSession (parse, plan, verify, publish, native-history routing) runs in
// Node over a minimal in-memory `vscode` stub; only the VS Code workbench itself is absent.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { cpus, totalmem, release } from 'node:os';
import { resolve, sep, extname } from 'node:path';

const stub = `
const g = (globalThis.__vscode ??= { listeners: new Set(), clipboard: '', trusted: true, writable: true, commands: [] });
export class EventEmitter {
  listeners = new Set();
  event = (listener) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of [...this.listeners]) listener(value); }
  dispose() { this.listeners.clear(); }
}
export const EndOfLine = { LF: 1, CRLF: 2 };
export class Range { constructor(start, end) { this.start = start; this.end = end; } }
export class Selection extends Range {}
export const TextEdit = { replace: (range, newText) => ({ range, newText }) };
export class WorkspaceEdit { set(uri, edits) { this.edits = edits; } }
export const workspace = {
  get isTrusted() { return g.trusted; },
  fs: { isWritableFileSystem: () => g.writable },
  onDidChangeTextDocument: (listener) => { g.listeners.add(listener); return { dispose: () => g.listeners.delete(listener) }; },
  applyEdit: (edit) => g.apply(edit),
};
export const commands = { executeCommand: async (command) => g.command(command) };
export const env = { clipboard: { readText: async () => g.clipboard, writeText: async (text) => { g.clipboard = text; } } };
export const window = { activeTextEditor: undefined };
`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'vscode'
      ? {
          url: `data:text/javascript,${encodeURIComponent(stub)}`,
          shortCircuit: true,
        }
      : next(specifier, context),
});
const { DocumentSession } = await import(
  '../../dist/apps/vscode-extension/src/document-session.js'
);
const { referenceReport } = await import(
  '../../dist/tests/performance/reference-report.js'
);
const vscode = globalThis.__vscode;

/** One open TextDocument with a native-like undo stack. */
class Doc {
  constructor(text) {
    this.text = text;
    this.version = 1;
    this.eol = 1;
    this.isClosed = false;
    this.uri = {
      toString: () => 'file:///harness/report.rdlc',
      scheme: 'file',
    };
    this.undo = [];
    this.redo = [];
  }
  getText() {
    return this.text;
  }
  positionAt(offset) {
    return offset;
  }
  change(text) {
    this.text = text;
    this.version++;
    for (const listener of vscode.listeners) listener({ document: this });
  }
}
let doc;
vscode.apply = async (edit) => {
  let text = doc.text;
  for (const change of [...edit.edits].sort(
    (a, b) => b.range.start - a.range.start,
  ))
    text =
      text.slice(0, change.range.start) +
      change.newText +
      text.slice(change.range.end);
  doc.undo.push(doc.text);
  doc.redo = [];
  doc.change(text);
  return true;
};
vscode.command = (command) => {
  vscode.commands.push(command);
  const [from, to] =
    command === 'undo' ? [doc.undo, doc.redo] : [doc.redo, doc.undo];
  if ((command === 'undo' || command === 'redo') && from.length) {
    to.push(doc.text);
    doc.change(from.pop());
  }
};

const chrome = process.env.CHROME_PATH;
assert.ok(chrome, 'Set CHROME_PATH to a local Chromium executable.');
const fixture = (path) => readFile(`tests/fixtures/${path}`, 'utf8');
const root = resolve('dist/designer/browser');
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
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const profile = await mkdtemp(resolve('dist/designer-ux-'));
const browser = spawn(
  chrome,
  [
    '--headless=new',
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
const only = process.env.ONLY?.split(',');
const run = (section) => !only || only.includes(section);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// Page instrumentation: webview API bridge, input-to-paint probes and state persistence.
const init = `
window.__sent = []; window.__recv = [];
// A fresh navigation starts a new webview; a reload restores the same view's state.
if (location.search === '?fresh') sessionStorage.removeItem('vsstate');
let state = JSON.parse(sessionStorage.getItem('vsstate') ?? 'null');
window.acquireVsCodeApi = () => ({
  postMessage(message) { window.__sent.push({ t: performance.now(), message }); window.__host(JSON.stringify(message)); },
  getState: () => state,
  setState(next) { state = next; sessionStorage.setItem('vsstate', JSON.stringify(next)); },
});
addEventListener('message', (event) => window.__recv.push({ t: performance.now(), kind: event.data?.kind, version: event.data?.version, requestId: event.data?.requestId, accepted: event.data?.accepted, changed: event.data?.changed, reason: event.data?.reason }), true);
window.__probes = {};
// Starts at the next matching event's timeStamp; ends when the frame showing cond() has rendered.
window.__arm = (name, types, cond, filter = () => true) => {
  window.__probes[name] = new Promise((done) => {
    const start = (event) => {
      if (!filter(event)) return;
      for (const type of types) removeEventListener(type, start, true);
      const t0 = event.timeStamp, deadline = t0 + 3000;
      const step = () => requestAnimationFrame(() => {
        if (!cond()) return performance.now() > deadline ? done(Infinity) : step();
        const channel = new MessageChannel();
        channel.port1.onmessage = () => done(performance.now() - t0);
        channel.port2.postMessage(0);
      });
      step();
    };
    for (const type of types) addEventListener(type, start, true);
  });
};
window.__agreement = () => {
  const text = (element) => element?.textContent.replace(/\\s+/g, ' ').trim() ?? '';
  const status = text(document.querySelector('.status-text'));
  const label = (name) => document.querySelector('.toolbar [title^="' + name + '"]')?.getAttribute('aria-disabled') === 'true';
  return {
    tree: [...document.querySelectorAll('[role=treeitem][aria-selected=true]')].map((node) => node.dataset.node),
    canvas: [...document.querySelectorAll('.item.selected')].map((item) => item.getAttribute('aria-label')),
    primary: document.querySelector('.item.primary')?.getAttribute('aria-label') ?? null,
    count: Number(status.match(/(\\d+) selected/)?.[1] ?? NaN),
    statusPrimary: status.match(/Primary: (.*?)(?: · |$)/)?.[1] ?? null,
    alignDisabled: label('Align left'),
    distributeDisabled: label('Distribute horizontal'),
    status,
  };
};
`;

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) listeners.get(message.method)?.(message.params);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`Timed out: ${method}`));
      }, 20000);
      pending.set(id, { resolve: done, reject: fail, timeout });
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
      `${expression}\n${JSON.stringify(result.exceptionDetails)}`,
    );
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Runtime.addBinding', { name: '__host' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  let session = null;
  listeners.set('Runtime.bindingCalled', (params) =>
    session?.receive(JSON.parse(params.payload)),
  );
  const page = {
    send,
    evaluate,
    close: () => {
      session?.dispose();
      socket.close();
    },
    settle: () =>
      evaluate(
        'new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))',
      ),
    async until(expression, label, timeout = 5000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await wait(10);
      }
      const context = await evaluate(
        "JSON.stringify({ feedback: document.querySelector('.feedback')?.textContent.trim(), sent: window.__sent.slice(-3).map(e => e.message.kind + ':' + (e.message.payload?.action ?? '')), recv: window.__recv.slice(-4).map(r => r.kind), active: document.activeElement?.outerHTML.slice(0, 80) })",
      );
      assert.fail(`${label}: ${expression} ${context}`);
    },
    /** Opens the designer on the shared document with a fresh host session. */
    async open({ width = 1280, height = 800, scale = 1, reload = false } = {}) {
      session?.dispose();
      session = new DocumentSession(
        doc,
        undefined,
        undefined,
        async () => true,
      );
      session.onMessage((message) =>
        send('Runtime.evaluate', {
          expression: `window.postMessage(${JSON.stringify(message)}, '*')`,
        }).catch(() => {}),
      );
      await page.viewport(width, height, scale);
      await send('Page.navigate', { url: reload ? url : `${url}?fresh` });
      await page.until(
        "!!document.querySelector('.page') || !!document.querySelector('.empty-state [role=status]')",
        'Designer accepted its snapshot',
      );
      await page.settle();
    },
    viewport: (width, height, deviceScaleFactor) =>
      send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor,
        mobile: false,
      }),
    mouse: (type, x, y, modifiers = 0, button = 'left') =>
      send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        modifiers,
        button,
        buttons:
          type === 'mouseReleased'
            ? 0
            : type === 'mouseMoved' && button === 'none'
              ? 0
              : button === 'middle'
                ? 4
                : 1,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      }),
    async click(selector, modifiers = 0) {
      const point = await page.center(selector);
      assert.equal(point.covered, null, `${selector} is covered`);
      await page.mouse('mousePressed', point.x, point.y, modifiers);
      await page.mouse('mouseReleased', point.x, point.y, modifiers);
      await page.settle();
    },
    async center(selector, scroll = false) {
      const point = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        ${scroll ? "element.scrollIntoView({ block: 'center', inline: 'nearest' });" : ''}
        const r = element.getBoundingClientRect();
        const hit = (x, y) => { const top = document.elementFromPoint(x, y); return !top || element.contains(top) || top.contains(element); };
        // Prefer the centre; otherwise the first uncovered point of a 7×7 grid (floating feedback may overlap).
        const points = [[0.5, 0.5], ...[1, 2, 3, 4, 5, 6, 7].flatMap(a => [1, 2, 3, 4, 5, 6, 7].map(b => [a / 8, b / 8]))];
        const found = points.map(([a, b]) => ({ x: r.left + r.width * a, y: r.top + r.height * b })).find(p => p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight && hit(p.x, p.y));
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        return found ? { ...found, covered: null } : { x, y, covered: document.elementFromPoint(x, y)?.outerHTML.slice(0, 120) ?? 'offscreen' };
      })()`);
      assert.ok(point, `Missing ${selector}`);
      return point;
    },
    async key(key, modifiers = 0, code = key) {
      const text = key === 'Enter' ? '\r' : key.length === 1 ? key : undefined;
      const keyCode =
        {
          Backspace: 8,
          Tab: 9,
          Enter: 13,
          Escape: 27,
          ' ': 32,
          End: 35,
          Home: 36,
          ArrowLeft: 37,
          ArrowUp: 38,
          ArrowRight: 39,
          ArrowDown: 40,
          F10: 121,
        }[key] ?? key.toUpperCase().charCodeAt(0);
      const base = {
        key,
        code,
        modifiers,
        windowsVirtualKeyCode: keyCode,
      };
      await send('Input.dispatchKeyEvent', {
        type: text && !modifiers ? 'keyDown' : 'rawKeyDown',
        ...base,
        ...(text && !modifiers ? { text } : {}),
      });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await page.settle();
    },
    edits: () =>
      evaluate(
        "window.__sent.filter(entry => ['edit', 'clipboard', 'history'].includes(entry.message.kind)).length",
      ),
    async idle() {
      // Every request has its correlated result and the pending notice is gone.
      await page.until(
        "window.__sent.filter(e => ['edit', 'clipboard', 'history'].includes(e.message.kind)).length === window.__recv.filter(r => ['editResult', 'clipboardResult', 'historyResult'].includes(r.kind)).length && !document.querySelector('.feedback')?.textContent.includes('Applying edit')",
        'Host settled',
      );
      await page.settle();
    },
  };
  return page;
}

const results = { candidate: null, environment: null, sections: {} };
const failures = [];
const check = (section, label, ok, detail) => {
  (results.sections[section] ??= { checks: [] }).checks.push({
    label,
    ok: !!ok,
    ...(detail === undefined ? {} : { detail }),
  });
  if (!ok) failures.push(`${section}: ${label} ${JSON.stringify(detail)}`);
};
const summary = (samples, limit) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) =>
    +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(
      2,
    );
  return {
    n: samples.length,
    withinLimit: samples.filter((value) => value <= limit).length,
    limitMs: limit,
    p50: at(0.5),
    p95: at(0.95),
    max: +sorted.at(-1).toFixed(2),
  };
};

const rect = (selector) => `(() => {
  const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
})()`;
const setZoom = (percent) =>
  `(() => { const field = document.querySelector('.zoom-field'); field.value = '${percent}'; field.dispatchEvent(new Event('change')); })()`;

let socket;
try {
  let port;
  for (let attempt = 0; attempt < 100 && !port; attempt++) {
    try {
      port = Number(
        (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(
          '\n',
        )[0],
      );
    } catch {
      await wait(100);
    }
  }
  assert.ok(port, 'Chromium debugging endpoint did not start.');
  const newTarget = async () => {
    const target = await (
      await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: 'PUT',
      })
    ).json();
    return { ...(await connect(target)), id: target.id };
  };
  const page = await newTarget();
  socket = page;
  const version = await page.send('Browser.getVersion');
  results.environment = {
    browser: version.product,
    os: `${process.platform} ${release()}`,
    cpu: `${cpus()[0].model} × ${cpus().length}`,
    memoryGiB: +(totalmem() / 2 ** 30).toFixed(1),
    node: process.version,
    host: 'Real DocumentSession over an in-memory vscode stub (no VS Code workbench)',
  };

  // ---------------------------------------------------------------- Layout matrix (T052/T056, SC-008)
  const layout = [];
  if (run('layout'))
    for (const [width, height] of [
      [1280, 800],
      [1024, 768],
      [640, 480],
      [400, 600],
    ])
      for (const scale of [1, 2]) {
        doc = new Doc(await fixture('datasets/blank.rdlc'));
        const original = doc.text;
        await page.open({ width, height, scale });
        const measure = await page.evaluate(`(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const editor = r('.editor'), canvas = r('.viewport');
        const rows = (s) => { const kids = [...document.querySelector(s).children].filter(k => k.getBoundingClientRect().height > 0); const boxes = kids.map(k => k.getBoundingClientRect()); return Math.max(...boxes.map(b => b.top)) < Math.min(...boxes.map(b => b.bottom)) ? 1 : 2; };
        const toolbar = document.querySelector('.toolbar');
        const outside = (b) => { const x = b.getBoundingClientRect(), t = toolbar.getBoundingClientRect(); return x.right > t.right + 0.5 || x.left < t.left - 0.5; };
        const commands = [...toolbar.querySelectorAll(':scope > div button, :scope > button, :scope > details > summary')].filter(b => b.getBoundingClientRect().width > 0);
        const atRest = commands.filter(outside);
        const clipped = atRest.length;
        return { editor: { width: editor.width, height: editor.height }, canvas: { width: canvas.width, height: canvas.height },
          widthRatio: canvas.width / editor.width, heightRatio: canvas.height / editor.height,
          toolbarRows: rows('.toolbar'), statusRows: rows('.status'), toolbarHeight: toolbar.getBoundingClientRect().height,
          statusHeight: r('.status').height, clipped,
          pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          leftOverlay: document.querySelector('.editor').classList.contains('compact-left'),
          rightOverlay: document.querySelector('.editor').classList.contains('compact-right') };
      })()`);
        // Scrolled-out commands must come into view when reached by keyboard focus.
        const unreachable = [];
        const commandCount = await page.evaluate(
          "document.querySelectorAll('.toolbar > div button, .toolbar > button, .toolbar > details > summary').length",
        );
        for (let index = 0; index < commandCount; index++) {
          await page.evaluate(
            `document.querySelectorAll('.toolbar > div button, .toolbar > button, .toolbar > details > summary')[${index}].focus()`,
          );
          await page.settle();
          const lost = await page.evaluate(`(() => {
          const b = document.querySelectorAll('.toolbar > div button, .toolbar > button, .toolbar > details > summary')[${index}];
          const x = b.getBoundingClientRect(), t = document.querySelector('.toolbar').getBoundingClientRect();
          return x.width > 0 && (x.right > t.right + 0.5 || x.left < t.left - 0.5 || x.bottom > t.bottom + 0.5) ? b.title || b.textContent.trim() : null;
        })()`);
          if (lost) unreachable.push(lost);
        }
        await page.evaluate(
          "document.activeElement.blur(); document.querySelector('.toolbar').scrollLeft = 0",
        );
        measure.unreachable = unreachable.length;
        measure.unreachableCommands = unreachable;
        const entry = { width, height, scale, ...measure };
        if (width === 1280)
          check(
            'layout',
            `${width}×${height}@${scale}x default canvas >50% width and >=70% height`,
            measure.widthRatio > 0.5 && measure.heightRatio >= 0.7,
            {
              widthRatio: measure.widthRatio,
              heightRatio: measure.heightRatio,
            },
          );
        check(
          'layout',
          `${width}×${height}@${scale}x canvas >=320px, single-row toolbar/status, no page scroll, every command visible or focus-reachable in the toolbar`,
          measure.canvas.width >= 320 &&
            measure.toolbarRows === 1 &&
            measure.statusRows === 1 &&
            measure.pageScrollX <= 0 &&
            measure.unreachable === 0,
          measure,
        );
        check(
          'layout',
          `${width}×${height}@${scale}x overlay thresholds`,
          measure.leftOverlay === width < 1100 &&
            measure.rightOverlay === width < 800,
          { left: measure.leftOverlay, right: measure.rightOverlay },
        );
        // Overlays: open one at a time without reflowing the canvas; Escape returns focus.
        if (measure.leftOverlay) {
          const before = await page.evaluate(rect('.viewport'));
          await page.click('.left-access');
          const opened = await page.evaluate(rect('.viewport'));
          const leftOpen = await page.evaluate(
            "(() => { const p = document.querySelector('.left-panel'); const r = p.getBoundingClientRect(); return p.classList.contains('open') && r.width >= 180 && r.top >= 39 && r.top <= 41; })()",
          );
          let oneOverlay = true;
          if (measure.rightOverlay) {
            await page.click('.right-access');
            oneOverlay = await page.evaluate(
              "!document.querySelector('.left-panel').classList.contains('open') && document.querySelector('.inspector').classList.contains('open')",
            );
          }
          await page.key('Escape');
          const closed = await page.evaluate(
            "!document.querySelector('.left-panel.open, .inspector.open') && document.activeElement.matches(" +
              JSON.stringify(
                measure.rightOverlay ? '.right-access' : '.left-access',
              ) +
              ')',
          );
          const drift = Math.max(
            ...['left', 'top', 'width', 'height'].map((key) =>
              Math.abs(before[key] - opened[key]),
            ),
          );
          entry.overlay = { leftOpen, oneOverlay, closed, drift };
          check(
            'layout',
            `${width}×${height}@${scale}x overlay opens without canvas reflow, one at a time, Escape returns focus`,
            leftOpen && oneOverlay && closed && drift <= 1,
            entry.overlay,
          );
        }
        // Insertion, tree selection, numeric resize and save/reopen through the real host.
        const leftOpen = async () => {
          if (
            measure.leftOverlay &&
            !(await page.evaluate(
              "!!document.querySelector('.left-panel.open')",
            ))
          )
            await page.click('.left-access');
        };
        await leftOpen();
        await page.click('[data-card="Textbox"]');
        await page.until(
          "document.querySelectorAll('.item').length === 1",
          'Textbox inserted',
        );
        await page.idle();
        await leftOpen();
        if (await page.evaluate("!!document.querySelector('#structure-tab')"))
          await page.click('#structure-tab');
        const treeTextbox = '[role=treeitem][aria-level]:last-of-type';
        await page.center(treeTextbox, true);
        await page.click(treeTextbox);
        if (measure.rightOverlay) await page.click('.right-access');
        else if (
          measure.leftOverlay &&
          (await page.evaluate("!!document.querySelector('.left-panel.open')"))
        )
          await page.key('Escape');
        const field = '[data-property="width"]';
        await page.center(field, true);
        await page.click(field);
        await page.evaluate(
          `(() => { const f = document.querySelector('${field}'); f.select?.(); })()`,
        );
        await page.send('Input.insertText', { text: '2in' });
        await page.key('Enter');
        await page.idle();
        const saved = doc.text;
        const accepted = /<Width>2in<\/Width>/.test(saved);
        doc = new Doc(saved);
        await page.open({ width, height, scale });
        const reopened = await page.evaluate(
          "document.querySelectorAll('.item').length === 1",
        );
        check(
          'layout',
          `${width}×${height}@${scale}x insertion, tree selection, numeric resize and save/reopen`,
          accepted && reopened && saved !== original,
          { accepted, reopened },
        );
        layout.push(entry);
      }
  if (run('layout')) results.sections.layout.matrix = layout;

  // ---------------------------------------------------------------- Panels, separators and restoration (T052)
  if (run('panels')) {
    doc = new Doc(await fixture('interactive/mixed.rdlc'));
    const original = doc.text;
    await page.open({ width: 1280, height: 800 });
    const separator = '.separator[aria-controls="left-panel"]';
    const value = () =>
      page.evaluate(
        `+document.querySelector('${separator}').getAttribute('aria-valuenow')`,
      );
    const initial = await value();
    await page.evaluate(`document.querySelector('${separator}').focus()`);
    await page.key('ArrowRight');
    const stepped = await value();
    await page.key('Home');
    const min = await value();
    await page.key('End');
    const max = await value();
    await page.key('Home');
    const point = await page.center(separator);
    assert.equal(point.covered, null, 'Separator is covered');
    await page.mouse('mousePressed', point.x, point.y);
    await page.mouse('mouseMoved', point.x + 60, point.y, 0, 'left');
    await page.mouse('mouseReleased', point.x + 60, point.y);
    await page.settle();
    const dragged = await value();
    check(
      'panels',
      'left separator: default 220, 10px keyboard step, bounds 180–360, pointer resize',
      initial === 220 &&
        stepped === 230 &&
        min === 180 &&
        max === 360 &&
        Math.abs(dragged - (180 + 60)) <= 1,
      { initial, stepped, min, max, dragged },
    );
    const right = await page.evaluate(
      "[...document.querySelectorAll('.separator')].map(s => [s.getAttribute('aria-valuenow'), s.getAttribute('aria-valuemin'), s.getAttribute('aria-valuemax')])[1]",
    );
    check(
      'panels',
      'right separator: default 300, bounds 240–480',
      right.join() === '300,240,480',
      right,
    );
    // Idle hide/restore keeps the report point at the canvas center at unchanged zoom.
    await page.evaluate(setZoom(200));
    await page.settle();
    await page.evaluate(
      "(() => { const v = document.querySelector('.viewport'); v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2; v.scrollTop = (v.scrollHeight - v.clientHeight) / 2; })()",
    );
    await page.settle();
    const centre = () =>
      page.evaluate(`(() => {
        const v = document.querySelector('.viewport').getBoundingClientRect();
        const p = document.querySelector('.page').getBoundingClientRect();
        const zoom = +document.querySelector('.zoom-field').value / 100;
        return { x: (v.left + v.width / 2 - p.left) / zoom, y: (v.top + v.height / 2 - p.top) / zoom, zoom };
      })()`);
    const drifts = [];
    for (const button of [
      '.left-access',
      '.left-access',
      '.right-access',
      '.right-access',
    ]) {
      const before = await centre();
      await page.click(button);
      await wait(50);
      await page.settle();
      const after = await centre();
      drifts.push({
        button,
        px: +Math.max(
          Math.abs(after.x - before.x) * after.zoom,
          Math.abs(after.y - before.y) * after.zoom,
        ).toFixed(3),
        zoomUnchanged: after.zoom === before.zoom,
      });
    }
    check(
      'panels',
      'idle hide/restore keeps the centre report point within 1px at unchanged zoom',
      drifts.every((d) => d.px <= 1 && d.zoomUnchanged),
      drifts,
    );
    // Same-view restoration and independent views; preferences never edit the report.
    await page.evaluate(`document.querySelector('${separator}').focus()`);
    await page.key('Home');
    for (let i = 0; i < 8; i++) await page.key('ArrowRight');
    await page.viewport(1024, 768, 1);
    await page.settle();
    await page.click('.left-access');
    await page.click('#structure-tab');
    await page.open({ width: 1024, height: 768, reload: true });
    const restored = await page.evaluate(
      "document.querySelector('#structure-tab').getAttribute('aria-selected')",
    );
    await page.open({ width: 1280, height: 800, reload: true });
    const restoredWidth = await value();
    const second = await newTarget();
    let independent;
    try {
      await second.open({ width: 1280, height: 800 });
      independent = await second.evaluate(
        "+document.querySelector('.separator').getAttribute('aria-valuenow')",
      );
    } finally {
      // Close the independent view and foreground the first again (background tabs pause rAF).
      second.close();
      await fetch(`http://127.0.0.1:${port}/json/close/${second.id}`);
      await page.send('Page.bringToFront');
    }
    check(
      'panels',
      'preferred width and left tab restore per view (260px survives a 1024px clamp); a new view keeps defaults',
      restored === 'true' && restoredWidth === 260 && independent === 220,
      { restored, restoredWidth, independent },
    );
    check(
      'panels',
      'panel, zoom, scroll and restoration actions leave the report exact with zero edits',
      doc.text === original && (await page.edits()) === 0,
    );
  }

  // ---------------------------------------------------------------- Coordinates and manipulation (T056, SC-006)
  if (run('coordinates')) {
    const supported = await fixture('textboxes/supported.rdlc');
    const samples = [];
    const cancellations = [];
    const rulers = [];
    for (const scale of [1, 2])
      for (const zoom of [25, 50, 100, 200, 400])
        for (const scrolled of [false, true]) {
          doc = new Doc(supported);
          await page.open({ width: 1280, height: 800, scale });
          await page.evaluate(setZoom(zoom));
          await page.settle();
          if (scrolled)
            await page.evaluate(
              "(() => { const v = document.querySelector('.viewport'); v.scrollLeft = Math.min(60, v.scrollWidth - v.clientWidth); v.scrollTop = Math.min(80, v.scrollHeight - v.clientHeight); })()",
            );
          await page.settle();
          // Rulers derive from page coordinate × zoom − scroll; body origin matches the body element.
          const ruler = await page.evaluate(`(() => {
            const page = document.querySelector('.page').getBoundingClientRect();
            const body = document.querySelector('.body').getBoundingClientRect();
            const unit = document.querySelector('[aria-label="Display unit"]').value;
            const perUnit = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 }[unit];
            const z = ${zoom} / 100;
            const h = [...document.querySelectorAll('.ruler.horizontal span')].map(s => Math.abs(s.getBoundingClientRect().left - (page.left + +s.textContent * perUnit * z)));
            const v = [...document.querySelectorAll('.ruler.vertical span')].map(s => Math.abs(s.getBoundingClientRect().top - (page.top + +s.textContent * perUnit * z)));
            const bx = document.querySelector('.ruler.horizontal .body-origin').getBoundingClientRect().left - body.left;
            const by = document.querySelector('.ruler.vertical .body-origin').getBoundingClientRect().top - body.top;
            return { ticks: h.length + v.length, maxTickError: Math.max(0, ...h, ...v), bodyOriginError: Math.max(Math.abs(bx), Math.abs(by)) };
          })()`);
          rulers.push({ scale, zoom, scrolled, ...ruler });
          // Drag (Alt bypasses snapping) and SE resize; feedback during the gesture must not move the frame.
          for (const [kind, dx, dy] of [
            ['move', 37, 23],
            ['move', -29, 17],
            ['move', 11, -31],
            ['se', 41, 19],
            ['se', -13, 27],
          ]) {
            // Bring the grabbed corner into view; the scrolled case keeps an extra odd offset.
            await page.evaluate(`(() => {
              const v = document.querySelector('.viewport'), r = v.getBoundingClientRect(), i = document.querySelector('.item').getBoundingClientRect();
              const extra = ${scrolled ? 7 : 0};
              if ('${kind}' === 'move') { v.scrollLeft += i.left - r.left - 80 + extra; v.scrollTop += i.top - r.top - 80 + extra; }
              else { v.scrollLeft += i.right - r.right + 120 + extra; v.scrollTop += i.bottom - r.bottom + 120 + extra; }
            })()`);
            await page.settle();
            await page.click(kind === 'move' ? '.item' : '.item .content');
            const before = await page.evaluate(
              `({ item: ${rect('.item')}, page: ${rect('.page')}, body: ${rect('.body')} })`,
            );
            const from =
              kind === 'move'
                ? {
                    x: before.item.left + Math.min(30, before.item.width / 3),
                    y: before.item.top + before.item.height / 2,
                  }
                : await page.center('[data-handle=se]');
            const count = await page.edits();
            await page.mouse('mousePressed', from.x, from.y, 1);
            await page.mouse(
              'mouseMoved',
              from.x + dx / 2,
              from.y + dy / 2,
              1,
              'left',
            );
            await page.evaluate(
              "window.postMessage({ protocol: 2, kind: 'protocolError', supportedVersion: 2, reason: 'Feedback during an active gesture '.repeat(20) }, '*')",
            );
            await page.mouse('mouseMoved', from.x + dx, from.y + dy, 1, 'left');
            await page.settle();
            const during = await page.evaluate(
              `({ page: ${rect('.page')}, preview: ${rect('.preview')} })`,
            );
            await page.mouse('mouseReleased', from.x + dx, from.y + dy, 1);
            await page.idle();
            const sent = await page.evaluate(
              "window.__sent.findLast(entry => entry.message.kind === 'edit')?.message",
            );
            if (!during.preview || !sent) {
              samples.push({
                scale,
                zoom,
                scrolled,
                kind,
                missing: true,
                item: before.item,
                from,
              });
              await page.key('Escape');
              continue;
            }
            const z = zoom / 100;
            const toPt = (px) => (px / z) * 0.75;
            const geometry =
              kind === 'move'
                ? Math.max(
                    Math.abs(sent.payload.dxPt - toPt(dx)),
                    Math.abs(sent.payload.dyPt - toPt(dy)),
                  )
                : Math.max(
                    Math.abs(
                      sent.payload.xPt -
                        (((before.item.right - before.body.left) / z) * 0.75 +
                          toPt(dx)),
                    ),
                    Math.abs(
                      sent.payload.yPt -
                        (((before.item.bottom - before.body.top) / z) * 0.75 +
                          toPt(dy)),
                    ),
                  );
            assert.equal(
              sent.payload.action,
              kind === 'move' ? 'move' : 'resize',
            );
            const anchor =
              kind === 'move'
                ? Math.max(
                    Math.abs(during.preview.left - (before.item.left + dx)),
                    Math.abs(during.preview.top - (before.item.top + dy)),
                  )
                : Math.max(
                    Math.abs(during.preview.width - (before.item.width + dx)),
                    Math.abs(during.preview.height - (before.item.height + dy)),
                  );
            samples.push({
              scale,
              zoom,
              scrolled,
              kind,
              edits: (await page.edits()) - count,
              originDriftPx: +Math.max(
                Math.abs(during.page.left - before.page.left),
                Math.abs(during.page.top - before.page.top),
              ).toFixed(3),
              previewAnchorErrorPx: +anchor.toFixed(3),
              geometryErrorPt: +geometry.toFixed(4),
              accepted: await page.evaluate(
                "window.__recv.findLast(entry => entry.kind === 'editResult') && !document.querySelector('#report-refusal')",
              ),
            });
          }
        }
    // Host resize during each gesture type cancels before rebasing and commits nothing.
    for (const gesture of ['move', 'se', 'marquee', 'pan']) {
      doc = new Doc(supported);
      await page.open({ width: 1280, height: 800 });
      await page.click('.item');
      const item = await page.evaluate(rect('.item'));
      const body = await page.evaluate(rect('.body'));
      const from =
        gesture === 'move'
          ? { x: item.left + 30, y: item.top + item.height / 2 }
          : gesture === 'se'
            ? await page.center('[data-handle=se]')
            : {
                x: body.left + body.width - 20,
                y: body.top + body.height - 20,
              };
      const count = await page.edits();
      const scroll = () =>
        page.evaluate(
          "(() => { const v = document.querySelector('.viewport'); return [v.scrollLeft, v.scrollTop]; })()",
        );
      await page.evaluate("document.querySelector('.viewport').focus()");
      if (gesture === 'pan')
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: ' ',
          code: 'Space',
          windowsVirtualKeyCode: 32,
        });
      const scrolledBefore = await scroll();
      await page.mouse('mousePressed', from.x, from.y);
      await page.mouse('mouseMoved', from.x - 30, from.y - 20, 0, 'left');
      await page.settle();
      const active =
        gesture === 'pan'
          ? (await scroll()).join() !== scrolledBefore.join()
          : await page.evaluate(
              `!!document.querySelector('${gesture === 'marquee' ? '.marquee' : '.preview'}')`,
            );
      await page.viewport(1180, 760, 1);
      await page.settle();
      await page.mouse('mouseMoved', from.x - 60, from.y - 40, 0, 'left');
      await page.mouse('mouseReleased', from.x - 60, from.y - 40);
      if (gesture === 'pan')
        await page.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: ' ',
          code: 'Space',
          windowsVirtualKeyCode: 32,
        });
      await page.settle();
      const leftover = await page.evaluate(
        "!!document.querySelector('.preview, .marquee')",
      );
      cancellations.push({
        gesture,
        active,
        edits: (await page.edits()) - count,
        leftoverPreview: leftover,
        notice: await page.evaluate(
          "document.querySelector('.feedback').textContent.trim().slice(0, 120)",
        ),
        scroll: await scroll(),
      });
    }
    const worst = (key) =>
      Math.max(...samples.filter((s) => !s.missing).map((s) => s[key]));
    check(
      'coordinates',
      'ruler ticks and body origin agree with page/body geometry within 1px at every zoom, offset and scale',
      rulers.every(
        (r) => r.ticks > 0 && r.maxTickError <= 1 && r.bodyOriginError <= 1,
      ),
      {
        worstTick: Math.max(...rulers.map((r) => r.maxTickError)),
        worstBody: Math.max(...rulers.map((r) => r.bodyOriginError)),
      },
    );
    check(
      'coordinates',
      '100 drag/resize samples: <=1px origin drift and preview anchor, <=0.01pt geometry, one accepted edit each',
      samples.length === 100 &&
        worst('originDriftPx') <= 1 &&
        worst('previewAnchorErrorPx') <= 1 &&
        worst('geometryErrorPt') <= 0.01 &&
        samples.every((s) => !s.missing && s.edits === 1 && s.accepted),
      {
        n: samples.length,
        originDriftPx: worst('originDriftPx'),
        previewAnchorErrorPx: worst('previewAnchorErrorPx'),
        geometryErrorPt: worst('geometryErrorPt'),
        notAccepted: samples.filter((s) => !s.accepted).length,
        missing: samples.filter((s) => s.missing).slice(0, 4),
      },
    );
    check(
      'coordinates',
      'host resize during drag, resize, marquee and pan commits zero edits and leaves no preview',
      cancellations.every(
        (c) => c.active && c.edits === 0 && !c.leftoverPreview,
      ),
      cancellations,
    );
    results.sections.coordinates.rulers = rulers;
    results.sections.coordinates.samples = samples;
  }

  // ---------------------------------------------------------------- Structure/arrangement journey (T030)
  if (run('journey')) {
    doc = new Doc(await fixture('interactive/mixed.rdlc'));
    const original = doc.text;
    await page.open({ width: 1440, height: 900 });
    const tree = (label) => `[role=treeitem][data-node="${label}"]`;
    const nodeId = (text) =>
      page.evaluate(
        `[...document.querySelectorAll('[role=treeitem]')].find(n => n.querySelector('.label').textContent.trim() === ${JSON.stringify(text)})?.dataset.node`,
      );
    const pick = async (text, modifiers = 0) => {
      const id = await nodeId(text);
      assert.ok(id, `Tree entry ${text}`);
      await page.center(tree(id), true);
      await page.click(tree(id), modifiers);
      return id;
    };
    const labels = await page.evaluate(
      "[...document.querySelectorAll('[role=treeitem] .label')].map(l => l.textContent.trim())",
    );
    results.sections.journey = { checks: [], treeLabels: labels };
    const current = () =>
      page.evaluate(
        "[...document.querySelectorAll('[role=treeitem] .label')].map(l => l.textContent.trim())",
      );
    let visibleLabels = labels;
    const find = (pattern) =>
      visibleLabels.find((label) => pattern.test(label));
    // Expand the table hierarchy down to its cells (rows and cells start collapsed below level 5).
    for (let depth = 0; depth < 4; depth++) {
      await page.evaluate(
        "[...document.querySelectorAll('[role=treeitem][aria-expanded=false]')].filter(n => /Tablix|Row|Cell/.test(n.textContent)).forEach(n => n.querySelector('.twisty').click())",
      );
      await page.settle();
    }
    visibleLabels = await current();
    results.sections.journey.treeLabels = visibleLabels;
    await pick(find(/Behind/));
    const obscured = await page.evaluate('window.__agreement()');
    check(
      'journey',
      'obscured Behind selected through Structure; canvas, status and tree agree',
      obscured.count === 1 &&
        /Behind/.test(obscured.primary ?? '') &&
        obscured.statusPrimary === obscured.primary,
      obscured,
    );
    await page.evaluate(setZoom(400));
    await page.evaluate(
      "(() => { const v = document.querySelector('.viewport'); v.scrollLeft = 0; v.scrollTop = 0; })()",
    );
    await page.settle();
    await pick(find(/LaterTie/));
    await page.click('.toolbar [title="Reveal selection"]');
    await wait(50);
    const revealed = await page.evaluate(`(() => {
      const v = document.querySelector('.viewport').getBoundingClientRect(), i = document.querySelector('.item.selected').getBoundingClientRect();
      return { inside: i.left >= v.left - 1 && i.top >= v.top - 1 && i.left < v.right && i.top < v.bottom, zoom: document.querySelector('.zoom-field').value };
    })()`);
    check(
      'journey',
      'offscreen LaterTie revealed at unchanged 400% zoom',
      revealed.inside && revealed.zoom === '400',
      revealed,
    );
    await page.evaluate(setZoom(100));
    await page.settle();
    await pick(find(/UnknownWidth/));
    const unknown = await page.evaluate(
      "({ frame: !!document.querySelector('.selection-frame'), source: [...document.querySelectorAll('.inspector button')].some(b => /source|Code XML/i.test(b.textContent)) })",
    );
    check(
      'journey',
      'unknown-bounds item shows no guessed frame and offers source access',
      !unknown.frame && unknown.source,
      unknown,
    );
    await pick(find(/OrdersTable/));
    const table = await page.evaluate('window.__agreement()');
    await pick(find(/LabelCell/));
    const cell = await page.evaluate(
      "({ ...window.__agreement(), handles: document.querySelectorAll('.handle').length })",
    );
    await pick(find(/DataSet \(Orders\)/));
    const data = await page.evaluate(
      "({ ...window.__agreement(), frame: !!document.querySelector('.selection-frame') })",
    );
    check(
      'journey',
      'table frame, exclusive cell and rectangle-free dataset targets are distinct',
      /OrdersTable/.test(table.primary ?? '') &&
        /Cell/.test(cell.status) &&
        cell.handles === 0 &&
        /dataset/i.test(data.status) &&
        !data.frame &&
        data.canvas.length === 0,
      { table: table.status, cell: cell.status, data: data.status },
    );
    // Multi-selection, arrangement and duplicate are the only editing steps.
    check(
      'journey',
      'Structure selection, reveal and zoom leave the report exact with zero edits',
      doc.text === original && (await page.edits()) === 0,
    );
    // The three fixture textboxes overlap exactly; nudge Front 10pt so alignment has an effect.
    await pick(find(/Front/));
    await page.evaluate("document.querySelector('.viewport').focus()");
    await page.key('ArrowRight', 8);
    await page.idle();
    const before = doc.text;
    await pick(find(/Front/));
    await pick(find(/LaterTie/), 8);
    await pick(find(/Behind/), 8);
    const multi = await page.evaluate('window.__agreement()');
    check(
      'journey',
      'additive selection: three members, primary agreement, alignment and distribution eligible',
      multi.count === 3 &&
        multi.canvas.length === 3 &&
        multi.statusPrimary === multi.primary &&
        !multi.alignDisabled &&
        !multi.distributeDisabled,
      multi,
    );
    await page.click('.toolbar [title="Align left"]');
    await page.idle();
    const aligned = doc.text !== before;
    const afterAlign = await page.evaluate('window.__agreement()');
    await page.click('.toolbar [title^="Distribute vertical"]');
    await page.idle();
    await page.click('.toolbar [title="Duplicate"]');
    await page.idle();
    const results2 = await page.evaluate(
      "window.__recv.filter(r => ['editResult', 'clipboardResult'].includes(r.kind)).length",
    );
    check(
      'journey',
      'align, distribute and duplicate each settle through the host; selection survives alignment',
      aligned &&
        afterAlign.count === 3 &&
        results2 >= 3 &&
        (doc.text.match(/<Textbox /g) ?? []).length >
          (original.match(/<Textbox /g) ?? []).length,
      { aligned, afterAlign: afterAlign.count, results: results2 },
    );
    const changes = doc.undo.length;
    for (let i = 0; i < changes; i++) {
      await page.click('.toolbar [title^="Undo"]');
      await page.idle();
    }
    check(
      'journey',
      `${changes} toolbar Undo requests (one per accepted change) restore the exact original source`,
      doc.text === original && changes >= 2,
      { changes },
    );
  }

  // ---------------------------------------------------------------- Timings on the 1 MiB / 100-item reference (T058)
  if (run('timing')) {
    doc = new Doc(referenceReport());
    results.sections.timing = {
      checks: [],
      reference: { bytes: Buffer.byteLength(doc.text), items: 100 },
    };
    await page.open({ width: 1280, height: 800 });
    await page.click('#structure-tab');
    const selection = [];
    const disagreements = [];
    for (let i = 0; i < 100; i++) {
      const index = (i * 37) % 100;
      const mode = i % 4;
      const selector =
        mode === 1
          ? `[role=treeitem][data-node="${await page.evaluate(`[...document.querySelectorAll('[role=treeitem]')].find(n => n.querySelector('.label').textContent.trim() === 'Textbox (Item${index + 1})')?.dataset.node`)}"]`
          : `[data-item="${index}"]`;
      const additive = mode === 3;
      const expected = await page.evaluate(`window.__agreement().count`);
      await page.center(selector, true);
      await page.evaluate(
        `window.__arm('select', ['pointerdown'], () => { const a = window.__agreement(); return ${additive ? `a.count === ${expected + 1}` : `a.count === 1 && document.querySelector('[data-item="${index}"]').classList.contains('selected')`}; })`,
      );
      await page.click(selector, additive ? 8 : 0);
      selection.push(await page.evaluate('window.__probes.select'));
      const a = await page.evaluate('window.__agreement()');
      if (
        !(
          a.count === a.tree.length &&
          a.count === a.canvas.length &&
          a.statusPrimary === a.primary &&
          a.alignDisabled === a.count < 2 &&
          a.distributeDisabled === a.count < 3
        )
      )
        disagreements.push({ i, ...a, status: undefined });
    }
    check(
      'timing',
      '100 selection changes: identity, primary and eligibility agree in tree, canvas, status and toolbar',
      disagreements.length === 0,
      disagreements.slice(0, 3),
    );
    check('timing', 'selection creates zero edits', (await page.edits()) === 0);
    const selectionSummary = summary(selection, 100);
    check(
      'timing',
      'SC-004: >=95/100 input-to-painted selection updates <=100ms',
      selectionSummary.withinLimit >= 95,
      selectionSummary,
    );

    await page.click('[data-item="0"]');
    const feedback = [];
    for (let i = 0; i < 100; i++) {
      const item = await page.evaluate(rect('[data-item="0"]'));
      await page.evaluate(
        "window.__arm('feedback', ['pointermove'], () => !!document.querySelector('.preview'), e => e.buttons === 1)",
      );
      await page.mouse('mousePressed', item.left + 5, item.top + 5);
      await page.mouse('mouseMoved', item.left + 15, item.top + 12, 0, 'left');
      feedback.push(await page.evaluate('window.__probes.feedback'));
      await page.key('Escape');
      await page.mouse('mouseReleased', item.left + 15, item.top + 12);
      await page.settle();
    }
    check(
      'timing',
      'cancelled feedback samples create zero edits',
      (await page.edits()) === 0,
    );
    const feedbackSummary = summary(feedback, 50);
    check(
      'timing',
      'SC-005: >=95/100 input-to-painted drag feedback samples <=50ms',
      feedbackSummary.withinLimit >= 95,
      feedbackSummary,
    );

    const display = [],
      endToEnd = [],
      roundtrip = [];
    await page.click('[data-item="0"]');
    for (let i = 0; i < 100; i++) {
      await page.evaluate("document.querySelector('.viewport').focus()");
      const left = await page.evaluate(
        'document.querySelector(\'[data-item="0"]\').style.left',
      );
      const version = await page.evaluate(
        "window.__recv.findLast(r => r.kind === 'snapshot').version",
      );
      const cond = `() => document.querySelector('[data-item="0"]').style.left !== ${JSON.stringify(left)}`;
      await page.evaluate(`window.__arm('accept', ['keyup'], ${cond})`);
      await page.evaluate(
        `window.__arm('display', ['message'], ${cond}, e => e.data?.kind === 'snapshot' && e.data.version > ${version})`,
      );
      const key = i % 2 ? 'ArrowLeft' : 'ArrowRight';
      await page.key(key);
      endToEnd.push(await page.evaluate('window.__probes.accept'));
      display.push(await page.evaluate('window.__probes.display'));
      roundtrip.push(
        await page.evaluate(
          `(() => { const s = window.__sent.findLast(e => e.message.kind === 'edit'); const r = window.__recv.find(e => e.kind === 'editResult' && e.requestId === s.message.requestId); return r ? r.t - s.t : Infinity; })()`,
        ),
      );
      await page.idle();
    }
    const displaySummary = summary(display, 200);
    check(
      'timing',
      'SC-005: >=95/100 accepted-snapshot-to-paint samples <=200ms',
      displaySummary.withinLimit >= 95,
      displaySummary,
    );
    results.sections.timing.requestToVisibleAcceptance = summary(endToEnd, 200);
    results.sections.timing.hostRoundtrip = summary(roundtrip, 200);

    await page.click('#components-tab');
    const search = [];
    for (let i = 0; i < 100; i++) {
      const query = ['tab', 'TEXT', 'data', 'zzz', ''][i % 5];
      const expected = await page.evaluate(
        `(() => { const all = [...document.querySelectorAll('[data-card]')].length; return null; })()`,
      );
      void expected;
      await page.evaluate(
        `(() => { const f = document.querySelector('.search input'); f.focus(); f.select(); })()`,
      );
      await page.evaluate(
        `window.__arm('search', ['input'], () => ${query === 'zzz' ? "!!document.querySelector('[data-clear]')" : query === '' ? "document.querySelectorAll('[data-card]').length === 11" : `[...document.querySelectorAll('[data-card]')].every(c => c.textContent.toLowerCase().includes(${JSON.stringify(query.toLowerCase())}) || c.closest('section').getAttribute('aria-label').toLowerCase().includes(${JSON.stringify(query.toLowerCase())}))`})`,
      );
      if (query) await page.send('Input.insertText', { text: query });
      else {
        await page.key('Backspace', 0, 'Backspace');
      }
      search.push(await page.evaluate('window.__probes.search'));
    }
    const searchSummary = summary(search, 100);
    check(
      'timing',
      'SC-009: >=95/100 search input-to-paint samples <=100ms',
      searchSummary.withinLimit >= 95,
      searchSummary,
    );
    const panel = [];
    for (let i = 0; i < 100; i++) {
      const shown = await page.evaluate(
        "document.querySelector('.left-access').getAttribute('aria-expanded')",
      );
      await page.evaluate(
        `window.__arm('panel', ['pointerdown'], () => document.querySelector('.left-access').getAttribute('aria-expanded') !== '${shown}' && (document.querySelector('.left-panel').getBoundingClientRect().width > 0) === ${shown !== 'true'})`,
      );
      await page.click('.left-access');
      panel.push(await page.evaluate('window.__probes.panel'));
    }
    const panelSummary = summary(panel, 100);
    check(
      'timing',
      'SC-009: >=95/100 panel toggle input-to-paint samples <=100ms',
      panelSummary.withinLimit >= 95,
      panelSummary,
    );
    Object.assign(results.sections.timing, {
      selection: selectionSummary,
      feedback: feedbackSummary,
      acceptedDisplay: displaySummary,
      search: searchSummary,
      panel: panelSummary,
    });
  }

  // ---------------------------------------------------------------- Keyboard, themes and contrast (T045 partial)
  if (run('keyboard')) {
    doc = new Doc(await fixture('datasets/blank.rdlc'));
    await page.open({ width: 1280, height: 800 });
    const stops = [];
    await page.evaluate('document.activeElement?.blur()');
    for (let i = 0; i < 80; i++) {
      await page.key('Tab');
      stops.push(
        await page.evaluate(`(() => { const e = document.activeElement; const s = getComputedStyle(e);
          return { region: e.closest('.toolbar') ? 'toolbar' : e.closest('.left-panel') ? 'left' : e.closest('.inspector') ? 'inspector' : e.closest('.status') ? 'status' : e.matches('.viewport') ? 'canvas' : e.closest('.feedback') ? 'feedback' : e.matches('.separator') ? 'separator' : e.tagName,
            name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40), visible: e.matches(':focus-visible') && (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none') }; })()`),
      );
    }
    // Tabbing past the last control leaves the document (BODY); that is the host's focus, not a trap.
    const inside = stops.filter((s) => s.region !== 'BODY');
    const regions = [...new Set(inside.map((s) => s.region))];
    check(
      'keyboard',
      'Tab reaches toolbar, Components/Structure, separators, canvas, Properties and status with visible focus',
      ['toolbar', 'left', 'separator', 'canvas', 'inspector', 'status'].every(
        (r) => regions.includes(r),
      ) && inside.every((s) => s.visible),
      {
        regions,
        stops: inside.length,
        invisible: inside.filter((s) => !s.visible).slice(0, 5),
      },
    );
    // Keyboard-only creation, tree selection, context menu and diagnostics.
    await page.evaluate(
      'document.querySelector(\'[data-card="Textbox"]\').focus()',
    );
    await page.key('Enter');
    await page.until(
      "document.querySelectorAll('.item').length === 1",
      'Keyboard creation',
    );
    await page.idle();
    await page.evaluate("document.querySelector('#structure-tab').focus()");
    await page.key('Enter');
    await page.evaluate(
      'document.querySelector(\'[role=treeitem][tabindex="0"]\').focus()',
    );
    await page.key('End');
    await page.key('Enter');
    const treeSelected = await page.evaluate(
      "window.__agreement().count === 1 && !!document.querySelector('.item.selected')",
    );
    await page.evaluate("document.querySelector('.viewport').focus()");
    await page.key('F10', 8, 'F10');
    const menu = await page.evaluate(
      "document.activeElement?.getAttribute('role') === 'menuitem'",
    );
    await page.key('ArrowDown');
    await page.key('Escape');
    const menuReturn = await page.evaluate(
      "!document.querySelector('.context-menu') && document.activeElement.matches('.viewport')",
    );
    await page.evaluate(
      'document.querySelector(\'[data-property="width"]\').focus()',
    );
    await page.key('ArrowLeft');
    const fieldKeys = (await page.edits()) === 1;
    check(
      'keyboard',
      'keyboard-only creation, tree End/Enter selection, Shift+F10 menu with Escape focus return; field arrows not intercepted',
      treeSelected && menu && menuReturn && fieldKeys,
      { treeSelected, menu, menuReturn, fieldKeys },
    );

    // Contrast of rendered colors under transcribed default theme tokens.
    const themes = {
      'Light Modern': {
        foreground: '#3b3b3b',
        descriptionForeground: '#3b3b3b',
        'editor-background': '#ffffff',
        'sideBar-background': '#f8f8f8',
        'panel-border': '#e5e5e5',
        'widget-border': '#e5e5e5',
        focusBorder: '#005fb8',
        'inputOption-activeBackground': '#bed6ed',
        'inputOption-activeForeground': '#000000',
        'list-activeSelectionBackground': '#e8e8e8',
        'list-activeSelectionForeground': '#000000',
        'input-background': '#ffffff',
        'input-foreground': '#3b3b3b',
        'input-border': '#cecece',
        'input-placeholderForeground': '#767676',
        'button-secondaryBackground': '#e5e5e5',
        'button-secondaryForeground': '#3b3b3b',
        disabledForeground: '#61616180',
        errorForeground: '#f85149',
        'editorWarning-foreground': '#bf8803',
        'menu-background': '#ffffff',
        'menu-foreground': '#3b3b3b',
        'menu-selectionBackground': '#005fb8',
        'menu-selectionForeground': '#ffffff',
        'editorWidget-background': '#f8f8f8',
        'editorWidget-foreground': '#3b3b3b',
        'editorWidget-border': '#e5e5e5',
      },
      'Dark Modern': {
        foreground: '#cccccc',
        descriptionForeground: '#9d9d9d',
        'editor-background': '#1f1f1f',
        'sideBar-background': '#181818',
        'panel-border': '#2b2b2b',
        'widget-border': '#313131',
        focusBorder: '#0078d4',
        'inputOption-activeBackground': '#2489db82',
        'inputOption-activeForeground': '#ffffff',
        'list-activeSelectionBackground': '#04395e',
        'list-activeSelectionForeground': '#ffffff',
        'input-background': '#313131',
        'input-foreground': '#cccccc',
        'input-border': '#3c3c3c',
        'input-placeholderForeground': '#989898',
        'button-secondaryBackground': '#313131',
        'button-secondaryForeground': '#cccccc',
        disabledForeground: '#cccccc80',
        errorForeground: '#f85149',
        'editorWarning-foreground': '#cca700',
        'menu-background': '#1f1f1f',
        'menu-foreground': '#cccccc',
        'menu-selectionBackground': '#0078d4',
        'menu-selectionForeground': '#ffffff',
        'editorWidget-background': '#202020',
        'editorWidget-foreground': '#cccccc',
        'editorWidget-border': '#313131',
      },
      'Dark High Contrast': {
        foreground: '#ffffff',
        descriptionForeground: '#ffffff',
        'editor-background': '#000000',
        'sideBar-background': '#000000',
        'panel-border': '#6fc3df',
        'widget-border': '#6fc3df',
        contrastBorder: '#6fc3df',
        focusBorder: '#f38518',
        'inputOption-activeBackground': '#000000',
        'inputOption-activeForeground': '#ffffff',
        'list-activeSelectionBackground': '#000000',
        'list-activeSelectionForeground': '#ffffff',
        'input-background': '#000000',
        'input-foreground': '#ffffff',
        'input-border': '#6fc3df',
        'input-placeholderForeground': '#ffffffb3',
        'button-secondaryBackground': '#000000',
        'button-secondaryForeground': '#ffffff',
        'button-border': '#6fc3df',
        disabledForeground: '#a5a5a5',
        errorForeground: '#f48771',
        'editorWarning-foreground': '#ffd370',
        'menu-background': '#000000',
        'menu-foreground': '#ffffff',
        'menu-selectionBackground': '#000000',
        'menu-selectionForeground': '#ffffff',
        'editorWidget-background': '#0c141f',
        'editorWidget-foreground': '#ffffff',
        'editorWidget-border': '#6fc3df',
      },
    };
    const contrast = {};
    for (const [theme, tokens] of Object.entries(themes)) {
      await page.evaluate(
        `(() => { const s = document.documentElement.style; for (const p of [...s]) if (p.startsWith('--vscode-')) s.removeProperty(p); for (const [k, v] of Object.entries(${JSON.stringify(tokens)})) s.setProperty('--vscode-' + k, v); })()`,
      );
      await page.click('.item');
      await page.settle();
      contrast[theme] = await page.evaluate(`(() => {
        // Computed colors are rgb()/rgba(), or color(srgb r g b / a) with 0–1 channels for color-mix().
        const parse = (c) => { const m = c.match(/[\\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; const k = c.startsWith('color(') ? 255 : 1; return { r: m[0] * k, g: m[1] * k, b: m[2] * k, a: m.length > 3 ? m[3] : 1 }; };
        const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
        const background = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) chain.unshift(parse(getComputedStyle(n).backgroundColor)); return chain.reduce((base, c) => over(c, base), { r: 255, g: 255, b: 255, a: 1 }); };
        const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const failures = [];
        let texts = 0;
        for (const e of document.querySelectorAll('.editor *')) {
          if (parseFloat(getComputedStyle(e).fontSize) === 0 || e.closest('.page') || e.closest('[hidden]') || e.closest('.sr-only') || e.matches('.sr-only')) continue;
          if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
          const s = getComputedStyle(e); if (s.visibility === 'hidden' || +s.opacity === 0) continue;
          const bg = background(e); const fg = over(parse(s.color), bg);
          const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
          const inactive = !!e.closest('[aria-disabled="true"], :disabled');
          const value = ratio(fg, bg); texts++;
          if (value < (large ? 3 : 4.5)) failures.push({ text: e.textContent.trim().slice(0, 30), ratio: +value.toFixed(2), inactive, fontSize: s.fontSize });
        }
        // Boundaries: the actual focus outline of a panel control and the selection frame against their backgrounds.
        const frame = document.querySelector('.selection-frame');
        const frameColor = parse(getComputedStyle(frame).borderTopStyle !== 'none' ? getComputedStyle(frame).borderTopColor : getComputedStyle(frame).outlineColor);
        const tab = document.querySelector('#components-tab, .left-panel button');
        tab.focus({ focusVisible: true });
        const focusColor = parse(getComputedStyle(tab).outlineColor);
        const canvas = background(document.querySelector('.viewport'));
        const page = background(document.querySelector('.page'));
        return { texts, failures,
          boundaries: { selectionOnPage: +ratio(over(frameColor, page), page).toFixed(2), focusOnPanel: +ratio(over(focusColor, background(tab.parentElement)), background(tab.parentElement)).toFixed(2), focusVisible: tab.matches(':focus-visible'), pageOnCanvas: +ratio(page, canvas).toFixed(2),
            pageOutlineOnCanvas: +ratio(over(parse(getComputedStyle(document.querySelector('.page')).boxShadow.match(/(?:rgba?|color)[(][^)]*[)]/)[0]), canvas), canvas).toFixed(2),
            bodyOutlineOnPage: +ratio(over(parse(getComputedStyle(document.querySelector('.body')).outlineColor), page), page).toFixed(2) } };
      })()`);
    }
    for (const [theme, measured] of Object.entries(contrast)) {
      const active = measured.failures.filter((f) => !f.inactive);
      check(
        'contrast',
        `${theme}: active text >=4.5:1 (large >=3:1)`,
        active.length === 0,
        { texts: measured.texts, failures: active.slice(0, 8) },
      );
      check(
        'contrast',
        `${theme}: selection, focus, page and body boundaries >=3:1`,
        measured.boundaries.selectionOnPage >= 3 &&
          measured.boundaries.focusOnPanel >= 3 &&
          measured.boundaries.pageOutlineOnCanvas >= 3 &&
          measured.boundaries.bodyOutlineOnPage >= 3,
        measured.boundaries,
      );
    }
    results.sections.contrast.measured = contrast;
    await page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    await page.settle();
    const forced = await page.evaluate(
      "(() => { const f = getComputedStyle(document.querySelector('.selection-frame')); return { style: f.borderTopStyle !== 'none' ? f.borderTopStyle : f.outlineStyle, width: f.borderTopWidth } })()",
    );
    check(
      'contrast',
      'forced-colors keeps a visible selection boundary',
      forced.style !== 'none',
      forced,
    );
    await page.send('Emulation.setEmulatedMedia', { features: [] });
  }

  // ---------------------------------------------------------------- Source-only and restricted honesty
  if (run('honesty')) {
    const states = {};
    for (const [name, path] of [
      ['malformed', 'xml/malformed.rdlc'],
      ['unsupported-profile', 'textboxes/unsupported-profile.rdlc'],
    ]) {
      doc = new Doc(await fixture(path));
      await page.open({ width: 1280, height: 800 });
      states[name] = await page.evaluate(
        "({ status: document.querySelector('.empty-state [role=status], .status-text')?.textContent.trim().slice(0, 120), code: [...document.querySelectorAll('button')].some(b => b.textContent.includes('Code XML')), loading: document.body.textContent.includes('Loading report') })",
      );
    }
    check(
      'honesty',
      'malformed and unsupported reports explain the limitation, offer Code XML and never stay loading',
      Object.values(states).every((s) => s.status && s.code && !s.loading),
      states,
    );
    doc = new Doc(await fixture('textboxes/supported.rdlc'));
    const original = doc.text;
    vscode.writable = false;
    vscode.commands.length = 0;
    await page.open({ width: 1280, height: 800 });
    await page.click('[data-card="Textbox"]');
    await page.until(
      "!!document.querySelector('#report-refusal') || document.querySelector('.feedback').textContent.includes('Not applied')",
      'Read-only refusal',
    );
    await page.click('.toolbar [title^="Undo"]');
    await page.until(
      "window.__recv.some(r => r.kind === 'historyResult')",
      'Read-only history result',
    );
    const refusal = await page.evaluate(
      "document.querySelector('.feedback').textContent.replace(/\\s+/g, ' ').trim().slice(0, 200)",
    );
    vscode.writable = true;
    vscode.trusted = false;
    await page.click('.toolbar [title^="Undo"]');
    await page.settle();
    vscode.trusted = true;
    check(
      'honesty',
      'read-only creation and native history refuse with an actionable message and leave the report exact',
      doc.text === original && !vscode.commands.includes('undo'),
      { refusal },
    );
    const preview = await page.evaluate(
      "(() => { const b = [...document.querySelectorAll('.status button')].find(b => b.textContent.includes('Preview')); return { disabled: b.disabled, label: b.parentElement.getAttribute('aria-label') }; })()",
    );
    check(
      'honesty',
      'Preview is disabled and explains the populated-rendering limitation',
      preview.disabled && /not supported/.test(preview.label),
      preview,
    );
  }
} catch (error) {
  failures.push(`harness: ${error instanceof Error ? error.stack : error}`);
} finally {
  socket?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
results.status = failures.length ? 'FAIL' : 'PASS';
results.failures = failures;
console.log(JSON.stringify(results, null, 2));
process.exitCode = failures.length ? 1 : 0;
