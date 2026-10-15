import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';

test('fixture manifest records provenance, footprint, citations and genuine files', () => {
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/manifest.json', 'utf8'),
  ) as { schemaVersion: number; fixtures: Record<string, unknown>[] };
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.fixtures.length > 0);
  const ids = new Set();
  for (const fixture of manifest.fixtures) {
    for (const key of [
      'id',
      'path',
      'provenance',
      'redistribution',
      'namespace',
      'status',
      'operation',
      'preservation',
    ])
      assert.ok(typeof fixture[key] === 'string' && fixture[key]);
    assert.ok(!ids.has(fixture.id));
    ids.add(fixture.id);
    const path = resolve('tests/fixtures', fixture.path as string);
    const rel = relative(resolve('tests/fixtures'), path);
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel));
    assert.ok(existsSync(path));
    for (const key of [
      'capabilities',
      'citations',
      'editFootprint',
      'expectedDiagnostics',
    ])
      assert.ok(Array.isArray(fixture[key]));
    for (const citation of fixture.citations as string[])
      assert.ok(citation.startsWith('vendor/') && existsSync(citation));
    assert.ok('consumerEvidence' in fixture);
  }
});

test('fixture expectations agree with actual diagnostics, capabilities and untouched source', () => {
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/manifest.json', 'utf8'),
  ) as {
    fixtures: {
      id: string;
      path: string;
      status: string;
      capabilities: string[];
      expectedDiagnostics: string[];
    }[];
  };
  for (const fixture of manifest.fixtures) {
    const source = readFileSync(
      resolve('tests/fixtures', fixture.path),
      'utf8',
    );
    const syntax = parse({
      uri: `fixture:${fixture.id}`,
      version: 1,
      source,
      eol: '\n',
    });
    const projection = projectReport(syntax);
    assert.equal(syntax.snapshot.source, source);
    assert.equal(
      projection.status,
      {
        supported: 'editable',
        unsupported: 'source-only',
        malformed: 'invalid-source',
      }[fixture.status],
    );
    assert.deepEqual(
      projection.diagnostics.map((d) => d.code),
      fixture.expectedDiagnostics,
    );
    assert.deepEqual(projection.capabilities, fixture.capabilities);
  }
});
