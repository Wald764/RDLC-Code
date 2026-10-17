import assert from 'node:assert/strict';

export function validateMeasurements(record: {
  candidate: string;
  hardware: string;
  vscode: string;
  fixtureBytes: number;
  textboxes: number;
  freshWebviewPerOpen: boolean;
  openBoundary: string;
  interactionBoundary: string;
  opensMs: number[];
  interactionsMs: number[];
}): void {
  assert.match(record.candidate, /^[a-f0-9]{40}$/);
  assert.ok(
    record.hardware.trim() && record.vscode.trim(),
    'Record hardware and VS Code version',
  );
  assert.equal(record.fixtureBytes, 1048576);
  assert.equal(record.textboxes, 100);
  assert.equal(record.freshWebviewPerOpen, true);
  assert.equal(record.openBoundary, 'command-to-painted-enabled-snapshot');
  assert.equal(record.interactionBoundary, 'commit-to-painted-accepted-change');
  for (const [samples, count, budget, passes] of [
    [record.opensMs, 20, 3000, 19],
    [record.interactionsMs, 100, 200, 95],
  ] as const) {
    assert.equal(samples.length, count, 'Incomplete measurement series');
    assert.ok(
      samples.every((value) => Number.isFinite(value) && value >= 0),
      'Invalid timing',
    );
    assert.ok(
      samples.filter((value) => value <= budget).length >= passes,
      'SC-004 budget failed',
    );
  }
}
