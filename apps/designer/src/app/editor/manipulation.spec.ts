import { describe, expect, it } from 'vitest';
import { resizeHandles } from '@rdlc/report-model/editing';
import { directProposal } from './manipulation';

describe('immutable report-space direct manipulation', () => {
  const origin = { left: 10, top: 20, width: 100, height: 50 };
  for (const handle of resizeHandles)
    it(`holds opposite ${handle} edges fixed`, () => {
      const proposal = directProposal(origin, handle, 3, 4);
      expect(proposal.valid).toBe(true);
      expect(proposal.bounds.left).toBe(handle.includes('w') ? 13 : 10);
      expect(proposal.bounds.top).toBe(handle.includes('n') ? 24 : 20);
      expect(proposal.bounds.width).toBe(
        handle.includes('w') ? 97 : handle.includes('e') ? 103 : 100,
      );
      expect(proposal.bounds.height).toBe(
        handle.includes('n') ? 46 : handle.includes('s') ? 54 : 50,
      );
      expect(origin).toEqual({ left: 10, top: 20, width: 100, height: 50 });
    });
  it('keeps invalid proposals visible without clamping', () => {
    expect(directProposal(origin, 'move', -11, 0)).toMatchObject({
      valid: false,
      bounds: { left: -1 },
    });
    expect(directProposal(origin, 'w', 101, 0)).toMatchObject({
      valid: false,
      bounds: { width: -1 },
    });
    expect(directProposal(origin, 'move', 3, 4).bounds.left).toBe(13);
    expect(directProposal(origin, 'move', 3, 4).bounds.left).toBe(13);
  });
});
