import { describe, expect, it } from 'vitest';
import { pixelsToPoints } from '@rdlc/report-model/geometry';
import {
  anchoredScroll,
  centerScroll,
  centeredTargetScroll,
  rulerTicks,
  clampZoom,
  clientToBody,
  defaultViewState,
  edgeScroll,
  extent,
  fitZoom,
  menuPosition,
  panelLayout,
  restoreViewState,
  revealScroll,
} from './viewport';

const frame = {
  left: 40,
  top: 30,
  width: 800,
  height: 600,
  scrollLeft: 0,
  scrollTop: 0,
};
const body = { left: 96, top: 48 };
const zooms = [0.25, 0.5, 1, 2, 4] as const;

describe('viewport transforms', () => {
  for (const zoom of zooms)
    it(`centers native targets at unchanged ${zoom} zoom with reachable clamping`, () => {
      const bounds = { left: 4000, top: 3000, width: 240, height: 120 };
      const scroll = centeredTargetScroll(bounds, frame, zoom, {
        width: 10000 * zoom,
        height: 10000 * zoom,
      });
      expect(
        (bounds.left + bounds.width / 2) * zoom - scroll.scrollLeft,
      ).toBeCloseTo(frame.width / 2, 8);
      expect(
        (bounds.top + bounds.height / 2) * zoom - scroll.scrollTop,
      ).toBeCloseTo(frame.height / 2, 8);
      expect(
        centeredTargetScroll(bounds, frame, zoom, { width: 900, height: 700 }),
      ).toEqual({ scrollLeft: 100, scrollTop: 100 });
      expect(
        centeredTargetScroll(
          { ...bounds, width: 0 },
          { ...frame, scrollLeft: 17, scrollTop: 23 },
          zoom,
          { width: 900, height: 700 },
        ),
      ).toEqual({ scrollLeft: 17, scrollTop: 23 });
    });
  for (const zoom of zooms)
    it(`rebases idle center and page ruler without a body/DPR offset at ${zoom}`, () => {
      const old = { ...frame, scrollLeft: 600, scrollTop: 400 };
      const next = centerScroll(old, { width: 400, height: 300 });
      expect((next.scrollLeft + 200) / zoom).toBe(
        (old.scrollLeft + 400) / zoom,
      );
      expect((next.scrollTop + 150) / zoom).toBe((old.scrollTop + 300) / zoom);
      const ticks = rulerTicks(500, zoom, 75, 'pt');
      expect(ticks.length).toBeGreaterThan(0);
      for (const tick of ticks)
        expect(tick.position).toBeCloseTo(tick.pixels * zoom - 75, 8);
      expect(centerScroll(frame, { width: 2000, height: 2000 })).toEqual({
        scrollLeft: 0,
        scrollTop: 0,
      });
    });
  for (const zoom of zooms)
    it(`converts client → scroll → body origin once at ${zoom * 100}%`, () => {
      const scrolled = { ...frame, scrollLeft: 120, scrollTop: 75 };
      // Body point (10px, 20px) drawn at zoom: client = frame + (origin + point) * zoom - scroll.
      const x = 40 + (96 + 10) * zoom - 120,
        y = 30 + (48 + 20) * zoom - 75;
      const point = clientToBody(x, y, scrolled, zoom, body);
      expect(point.x).toBeCloseTo(10, 9);
      expect(point.y).toBeCloseTo(20, 9);
    });

  it('never applies device-pixel ratio as a geometry multiplier', () => {
    const before = clientToBody(300, 200, frame, 2, body);
    const ratio = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2.5,
      configurable: true,
    });
    try {
      expect(clientToBody(300, 200, frame, 2, body)).toEqual(before);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', {
        value: ratio,
        configurable: true,
      });
    }
  });

  it('produces identical report-space drag deltas at every zoom and scroll', () => {
    // A 9pt drag is 12 unzoomed CSS pixels, i.e. 12 * zoom screen pixels.
    for (const zoom of zooms)
      for (const scrollLeft of [0, 333]) {
        const view = { ...frame, scrollLeft };
        const a = clientToBody(100, 100, view, zoom, body);
        const b = clientToBody(100 + 12 * zoom, 100, view, zoom, body);
        expect(pixelsToPoints(b.x - a.x)).toBeCloseTo(9, 9);
      }
  });

  it('clamps zoom to 25–400%', () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('keeps the viewport center fixed for toolbar zoom', () => {
    const view = { ...frame, scrollLeft: 200, scrollTop: 100 };
    const cx = view.left + view.width / 2,
      cy = view.top + view.height / 2;
    const before = clientToBody(cx, cy, view, 1, body);
    const scroll = anchoredScroll(view, 1, 2, cx, cy);
    const after = clientToBody(cx, cy, { ...view, ...scroll }, 2, body);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('keeps the report point under the pointer fixed for pointer zoom', () => {
    const view = { ...frame, scrollLeft: 1000, scrollTop: 1000 };
    for (const [from, to] of [
      [1, 4],
      [4, 2],
      [0.25, 1],
    ] as const) {
      const before = clientToBody(500, 400, view, from, body);
      const scroll = anchoredScroll(view, from, to, 500, 400);
      const after = clientToBody(500, 400, { ...view, ...scroll }, to, body);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it('fits the largest zoom within 25–400% and leaves oversized bounds scrollable', () => {
    expect(fitZoom({ width: 384, height: 100 }, frame, 16)).toBeCloseTo(
      (800 - 32) / 384,
      9,
    );
    expect(fitZoom({ width: 10, height: 10 }, frame, 16)).toBe(4);
    expect(fitZoom({ width: 100000, height: 10 }, frame, 16)).toBe(0.25);
  });

  it('reveals overflow without moving already visible bounds', () => {
    const visible = { left: 10, top: 10, width: 50, height: 50 };
    expect(revealScroll(visible, frame, 1, 16)).toEqual({
      scrollLeft: 0,
      scrollTop: 0,
    });
    const offscreen = { left: 2000, top: 1500, width: 100, height: 40 };
    const scroll = revealScroll(offscreen, frame, 2, 16);
    expect(scroll.scrollLeft).toBe((2000 + 100) * 2 + 16 - 800);
    expect(scroll.scrollTop).toBe((1500 + 40) * 2 + 16 - 600);
    // Bounds larger than the viewport align their start.
    const large = { left: 100, top: 100, width: 5000, height: 50 };
    expect(revealScroll(large, frame, 1, 16).scrollLeft).toBe(84);
  });

  it('extends navigable extent to overflowing items without changing the page', () => {
    const page = { left: 0, top: 0, width: 816, height: 1056 };
    const bodyBounds = { left: 96, top: 96, width: 576, height: 192 };
    const items = [{ bounds: { left: 900, top: 10, width: 100, height: 20 } }];
    expect(extent(page, bodyBounds, items)).toEqual({
      width: 96 + 1000,
      height: 1056,
    });
    expect(page.width).toBe(816);
  });

  it('pans and auto-scrolls only near or beyond viewport edges', () => {
    expect(edgeScroll(400, 300, frame)).toEqual({ dx: 0, dy: 0 });
    expect(edgeScroll(41, 300, frame).dx).toBeLessThan(0);
    expect(edgeScroll(2000, 300, frame).dx).toBeGreaterThan(0);
    expect(edgeScroll(400, 1000, frame).dy).toBeGreaterThan(0);
    // An unmeasured viewport never auto-scrolls.
    expect(edgeScroll(0, 0, { ...frame, width: 0, height: 0 })).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  it('auto-scroll followed by anchor recompute keeps the report anchor', () => {
    // Pointer fixed at the edge while content scrolls: the body point under it advances by the scroll.
    const before = clientToBody(835, 300, frame, 2, body);
    const { dx } = edgeScroll(835, 300, frame);
    const after = clientToBody(
      835,
      300,
      { ...frame, scrollLeft: frame.scrollLeft + dx },
      2,
      body,
    );
    expect(after.x - before.x).toBeCloseTo(dx / 2, 9);
  });
});

describe('per-view state restore', () => {
  it('defaults to 100%, pt, 10pt and all four toggles on', () => {
    expect(defaultViewState).toEqual({
      zoom: 1,
      scrollLeft: 0,
      scrollTop: 0,
      unit: 'pt',
      gridSpacing: 10,
      gridUnit: 'pt',
      gridVisible: true,
      gridSnap: true,
      guidesVisible: true,
      guidesSnap: true,
      leftWidth: 220,
      rightWidth: 300,
      leftVisible: false,
      rightVisible: true,
      leftTab: 'components',
      inspectorExpanded: {
        general: true,
        position: true,
        appearance: false,
        typography: true,
        border: false,
        data: true,
        visibility: false,
        pagination: false,
        advanced: false,
      },
    });
    expect(restoreViewState(undefined)).toEqual({
      state: defaultViewState,
      invalid: [],
    });
  });

  it('restores valid values and rejects invalid ones individually', () => {
    const restored = restoreViewState({
      zoom: 2,
      scrollLeft: 10,
      scrollTop: -5,
      unit: 'mm',
      gridSpacing: 0,
      gridUnit: 'furlong',
      gridVisible: false,
      gridSnap: 'yes',
      guidesVisible: true,
      guidesSnap: false,
      leftVisible: true,
    });
    expect(restored.state).toEqual({
      ...defaultViewState,
      zoom: 2,
      scrollLeft: 10,
      unit: 'mm',
      gridVisible: false,
      guidesSnap: false,
      // An explicit fallback preference survives the compact default.
      leftVisible: true,
    });
    expect(restored.invalid).toEqual([
      'scrollTop',
      'gridSpacing',
      'gridUnit',
      'gridSnap',
    ]);
    expect(restoreViewState({ zoom: 10 }).invalid).toEqual(['zoom']);
    expect(restoreViewState({ zoom: Infinity }).state.zoom).toBe(1);
  });

  it('defaults panel preferences independently and ignores unknown or obsolete fields', () => {
    const restored = restoreViewState({
      zoom: 2,
      leftWidth: 400,
      rightWidth: 480,
      leftVisible: 'no',
      rightVisible: false,
      leftTab: 'datasets',
      inspectorExpanded: {
        general: false,
        advanced: true,
        bogus: true,
        data: 1,
      },
      obsolete: 'kept out',
      selection: ['2:3'],
      draft: { text: 'x' },
    });
    expect(restored.state).toMatchObject({
      zoom: 2,
      leftWidth: 220,
      rightWidth: 480,
      leftVisible: false,
      rightVisible: false,
      leftTab: 'components',
    });
    expect(restored.state.inspectorExpanded).toEqual({
      ...defaultViewState.inspectorExpanded,
      general: false,
      advanced: true,
    });
    expect(restored.state).not.toHaveProperty('obsolete');
    expect(restored.state).not.toHaveProperty('selection');
    expect(restored.state).not.toHaveProperty('draft');
    expect(restored.invalid).toEqual(['leftWidth', 'leftVisible', 'leftTab']);
    for (const width of [NaN, Infinity, 179, 361, '220'])
      expect(restoreViewState({ leftWidth: width }).state.leftWidth).toBe(220);
    expect(restoreViewState({ inspectorExpanded: [] }).invalid).toEqual([
      'inspectorExpanded',
    ]);
  });
});

describe('effective panel layout', () => {
  const view = { ...defaultViewState, leftVisible: true };
  it('uses 220/300 defaults with a majority canvas at 1280px', () => {
    const layout = panelLayout(1280, view);
    expect(layout).toEqual({
      left: 220,
      structure: 0,
      right: 300,
      leftOverlay: false,
      rightOverlay: false,
    });
    expect(1280 - layout.left - layout.right).toBeGreaterThan(640);
  });
  it('switches left to overlay below 1100px and both below 800px', () => {
    expect(panelLayout(1024, view)).toMatchObject({
      left: 0,
      right: 300,
      leftOverlay: true,
      rightOverlay: false,
    });
    for (const width of [640, 400, 320])
      expect(panelLayout(width, view)).toEqual({
        left: 0,
        structure: 0,
        right: 0,
        leftOverlay: true,
        rightOverlay: true,
      });
  });
  it('clamps effective widths for a 320px canvas without changing preferences', () => {
    const wide = { ...view, leftWidth: 360, rightWidth: 480 };
    for (const width of [1100, 1024, 800]) {
      const layout = panelLayout(width, wide);
      expect(width - 20 - layout.left - layout.right).toBeGreaterThanOrEqual(
        320,
      );
      expect(layout.left === 0 || layout.left >= 180).toBe(true);
      expect(layout.right >= 240).toBe(true);
    }
    expect(panelLayout(1400, wide)).toMatchObject({ left: 360, right: 480 });
    expect(wide).toMatchObject({ leftWidth: 360, rightWidth: 480 });
  });
  it('shows Structure beside Components only when the canvas keeps 640px', () => {
    expect(panelLayout(1440, view).structure).toBe(260);
    expect(panelLayout(1399, view).structure).toBe(0);
    expect(
      panelLayout(1440, { ...view, leftWidth: 360, rightWidth: 480 }).structure,
    ).toBe(0);
    expect(panelLayout(1920, { ...view, leftVisible: false }).structure).toBe(
      0,
    );
  });
  it('gives hidden panels zero width in the wide layout', () => {
    expect(
      panelLayout(1280, { ...view, leftVisible: false, rightVisible: false }),
    ).toMatchObject({
      left: 0,
      right: 0,
      leftOverlay: false,
      rightOverlay: false,
    });
  });
});

describe('context menu placement', () => {
  const area = { width: 800, height: 400 };
  const menu = { width: 260, height: 300 };
  it('opens below and right of the pointer when it fits', () => {
    expect(menuPosition(100, 50, menu, area)).toEqual({ x: 100, y: 50 });
  });
  it('flips above and left near the bottom-right edges', () => {
    expect(menuPosition(700, 380, menu, area)).toEqual({ x: 440, y: 80 });
  });
  it('clamps a menu taller than the area to the top', () => {
    expect(menuPosition(10, 100, { width: 260, height: 500 }, area)).toEqual({
      x: 10,
      y: 0,
    });
  });
});
