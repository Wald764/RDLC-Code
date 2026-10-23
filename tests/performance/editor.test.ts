import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMeasurements } from '../../scripts/validate-acceptance.js';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { renderScene } from '@rdlc/renderer/render';
import { projectStructure } from '@rdlc/renderer/structure';
import { validateMessage } from '@rdlc/report-model/protocol';
import { referenceReport } from './reference-report.js';

test('SC-004 requires all samples, exact paint boundaries and both percentile counts', () => {
  const record = {
    candidate: 'a'.repeat(40),
    hardware: 'Recorded CPU, RAM, OS, display',
    vscode: '1.142.0',
    fixtureBytes: 1048576,
    textboxes: 100,
    freshWebviewPerOpen: true,
    openBoundary: 'command-to-painted-enabled-snapshot',
    interactionBoundary: 'commit-to-painted-accepted-change',
    opensMs: [...Array<number>(19).fill(3000), 4000],
    interactionsMs: [
      ...Array<number>(95).fill(200),
      ...Array<number>(5).fill(300),
    ],
  };
  assert.doesNotThrow(() => validateMeasurements(record));
  for (const change of [
    { opensMs: record.opensMs.slice(1) },
    { interactionsMs: record.interactionsMs.slice(1) },
    { opensMs: Array<number>(20).fill(3001) },
    { interactionsMs: Array<number>(100).fill(201) },
    { freshWebviewPerOpen: false },
    { openBoundary: 'parse-only' },
    { interactionBoundary: 'host-only' },
    { fixtureBytes: 1000000 },
    { opensMs: [...Array<number>(19).fill(1), NaN] },
    { hardware: '' },
  ])
    assert.throws(() => validateMeasurements({ ...record, ...change }));
});

test('the 1 MiB / 100-item reference report fits the bounded hierarchy and snapshot budgets', () => {
  const source = referenceReport();
  assert.equal(Buffer.byteLength(source), 1048576);
  const syntax = parse({
    uri: 'test:reference',
    version: 1,
    source,
    eol: '\n',
  });
  const projection = projectReport(syntax);
  assert.equal(projection.status, 'editable');
  const scene = renderScene(projection);
  const structure = projectStructure(syntax, projection);
  assert.equal(scene?.items.length, 100);
  assert.equal(structure.truncated, false);
  assert.equal(
    structure.nodes.filter((node) => node.kind === 'textbox').length,
    100,
  );
  assert.ok(
    validateMessage({
      protocol: 1,
      kind: 'snapshot',
      version: 1,
      sourceLength: source.length,
      structure,
      projection: {
        status: projection.status,
        capabilities: projection.capabilities,
        diagnostics: projection.diagnostics,
      },
      scene,
      authoring: null,
    }),
  );
});
