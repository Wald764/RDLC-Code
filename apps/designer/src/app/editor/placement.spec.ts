import { describe, expect, it } from 'vitest';
import { snapDelta, type PlacementTarget } from './placement';

const body = { width: 400, height: 300 };
const sibling: PlacementTarget = {
  id: 's',
  label: 'Sibling',
  order: 1,
  bounds: { left: 100, top: 100, width: 50, height: 20 },
};
const options = (over: Partial<Parameters<typeof snapDelta>[2]> = {}) => ({
  scale: 96 / 72,
  body,
  targets: [sibling],
  grid: 10,
  guides: true,
  ...over,
});

describe('grid snapping', () => {
  for (const zoom of [0.25, 0.5, 1, 2, 4])
    it(`keeps report-grid edges and bypass independent at ${zoom * 100}%`, () => {
      const bounds = { left: 23, top: 47, width: 34, height: 10 };
      const settings = options({
        scale: (zoom * 96) / 72,
        targets: [],
        guides: false,
      });
      expect(snapDelta(bounds, 'e', settings)).toMatchObject({ dx: 3, dy: 0 });
      expect(snapDelta(bounds, 'move', { ...settings, grid: null })).toEqual({
        dx: 0,
        dy: 0,
        guides: [],
      });
    });
  it('snaps the union top-left to the nearest body-origin intersection', () => {
    const result = snapDelta(
      { left: 23, top: 47, width: 30, height: 30 },
      'move',
      options({ targets: [], guides: false }),
    );
    expect(result.dx).toBeCloseTo(-3, 9);
    expect(result.dy).toBeCloseTo(3, 9);
    expect(result.guides).toEqual([]);
  });

  it('chooses the smaller coordinate on an exact tie', () => {
    const result = snapDelta(
      { left: 25, top: 35, width: 1, height: 1 },
      'move',
      options({ targets: [], guides: false }),
    );
    expect(result.dx).toBeCloseTo(-5, 9);
    expect(result.dy).toBeCloseTo(-5, 9);
  });

  it('snaps only dragged resize edges', () => {
    // East edge at 57 → 60; west/top/bottom are fixed.
    const result = snapDelta(
      { left: 23, top: 47, width: 34, height: 10 },
      'e',
      options({ targets: [], guides: false }),
    );
    expect(result.dx).toBeCloseTo(3, 9);
    expect(result.dy).toBe(0);
    const north = snapDelta(
      { left: 23, top: 47, width: 34, height: 10 },
      'n',
      options({ targets: [], guides: false }),
    );
    expect(north).toMatchObject({ dx: 0 });
    expect(north.dy).toBeCloseTo(3, 9);
  });

  it('disabled grid and guide snapping leave the proposal untouched', () => {
    expect(
      snapDelta(
        { left: 23, top: 47, width: 30, height: 30 },
        'move',
        options({ grid: null, guides: false }),
      ),
    ).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('guide snapping', () => {
  it('prefers the nearest guide within 6 CSS pixels over the grid, per axis', () => {
    // Moving left edge at 103pt: sibling left 100pt is 3pt = 4px away.
    const result = snapDelta(
      { left: 103, top: 207, width: 60, height: 20 },
      'move',
      options(),
    );
    expect(result.dx).toBeCloseTo(-3, 9);
    expect(result.dy).toBeCloseTo(3, 9); // grid; no guide near y=207
    expect(result.guides).toEqual([
      expect.objectContaining({
        axis: 'x',
        targetId: 's',
        label: 'Sibling',
        edge: 'start',
        moving: 'start',
        value: 100,
      }),
    ]);
  });

  it('applies a constant 6 CSS-pixel tolerance at every zoom', () => {
    // A wide target keeps its center/right lines far from the moving lines.
    const wide = { ...sibling, bounds: { ...sibling.bounds, width: 1000 } };
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const scale = (zoom * 96) / 72;
      const near = 5.9 / scale,
        far = 6.1 / scale;
      expect(
        snapDelta(
          { left: 100 + near, top: 250, width: 1000, height: 10 },
          'move',
          options({ scale, grid: null, targets: [wide] }),
        ).guides,
      ).toHaveLength(1);
      expect(
        snapDelta(
          { left: 100 + far, top: 250, width: 1000, height: 10 },
          'move',
          options({ scale, grid: null, targets: [wide] }),
        ).guides,
      ).toHaveLength(0);
    }
  });

  it('breaks ties by body boundary, then source order, then smaller coordinate', () => {
    const a = { ...sibling, id: 'a', label: 'A', order: 2 };
    const b = {
      ...sibling,
      id: 'b',
      label: 'B',
      order: 1,
      bounds: { ...sibling.bounds, left: 106 },
    };
    // Moving left at 103: A left (100) and B left (106) are both 3pt away; B is earlier.
    const order = snapDelta(
      { left: 103, top: 250, width: 1000, height: 10 },
      'move',
      options({ targets: [a, b], grid: null }),
    );
    expect(order.guides[0]).toMatchObject({ targetId: 'b', value: 106 });
    // Equal order: the smaller coordinate wins.
    const smaller = snapDelta(
      { left: 103, top: 250, width: 1000, height: 10 },
      'move',
      options({ targets: [a, { ...b, order: 2 }], grid: null }),
    );
    expect(smaller.guides[0]).toMatchObject({ targetId: 'a', value: 100 });
    // Body boundary beats an equally near sibling.
    const edge = {
      ...sibling,
      id: 'e',
      label: 'E',
      order: 0,
      bounds: { left: 6, top: 200, width: 10, height: 10 },
    };
    const boundary = snapDelta(
      { left: 3, top: 250, width: 1000, height: 10 },
      'move',
      options({ targets: [edge], grid: null }),
    );
    expect(boundary.guides[0]).toMatchObject({ targetId: null, value: 0 });
  });

  it('matches centers and far edges as well as near edges', () => {
    // Moving center (110 + 15 = 125) near sibling center 125.
    const result = snapDelta(
      { left: 111, top: 250, width: 30, height: 10 },
      'move',
      options({ grid: null }),
    );
    expect(result.dx).toBeCloseTo(-1, 9);
    expect(result.guides[0]).toMatchObject({
      edge: 'center',
      moving: 'center',
    });
  });

  it('reports guides without snapping when guide snapping is disabled', () => {
    const result = snapDelta(
      { left: 103, top: 207, width: 60, height: 20 },
      'move',
      options({ guides: false, grid: null }),
    );
    expect(result).toMatchObject({ dx: 0, dy: 0 });
    expect(result.guides).toHaveLength(1);
  });

  it('considers only the dragged edge while resizing', () => {
    // West handle: the left edge at 152 is near sibling right (150).
    const result = snapDelta(
      { left: 152, top: 250, width: 30, height: 10 },
      'w',
      options({ grid: null }),
    );
    expect(result.dx).toBeCloseTo(-2, 9);
    expect(result.guides[0]).toMatchObject({ edge: 'end', moving: 'start' });
    expect(
      snapDelta(
        { left: 152, top: 250, width: 30, height: 10 },
        's',
        options({ grid: null }),
      ).dx,
    ).toBe(0);
  });
});
