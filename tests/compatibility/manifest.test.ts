import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { projectStructure } from '@rdlc/renderer/structure';
import { renderScene } from '@rdlc/renderer/render';
import { planTextboxIntent } from '../../apps/vscode-extension/src/edit-controller.js';

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

test('corpus structure is bounded and view-only; no-op and refused intents keep every source exact', () => {
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/manifest.json', 'utf8'),
  ) as { fixtures: { id: string; path: string }[] };
  assert.ok(manifest.fixtures.length >= 12);
  for (const fixture of manifest.fixtures) {
    const source = readFileSync(
      resolve('tests/fixtures', fixture.path),
      'utf8',
    );
    const snapshot = {
      uri: `fixture:${fixture.id}`,
      version: 1,
      source,
      eol: '\n' as const,
    };
    const syntax = parse(snapshot);
    const projection = projectReport(syntax);
    const { nodes } = projectStructure(syntax, projection);
    const scene = renderScene(projection);
    assert.equal(syntax.snapshot.source, source, fixture.id);
    assert.ok(nodes.length <= 2000, fixture.id);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    assert.equal(byId.size, nodes.length, `${fixture.id}: unique ids`);
    for (const node of nodes) {
      assert.ok(
        Number.isInteger(node.range.start) &&
          node.range.start >= 0 &&
          node.range.start <= node.range.end &&
          node.range.end <= source.length,
        `${fixture.id}: ${node.id} range`,
      );
      let depth = 0;
      for (let id = node.parentId; id !== null; id = byId.get(id)!.parentId) {
        assert.ok(byId.has(id), `${fixture.id}: ${node.id} parent`);
        assert.ok(++depth <= 32, `${fixture.id}: ${node.id} depth`);
      }
    }
    if (projection.status !== 'editable') {
      assert.equal(
        projection.textboxes.filter((t) => t.capabilities.length).length,
        0,
        fixture.id,
      );
      continue;
    }
    assert.ok(scene, fixture.id);
    for (const textbox of projection.textboxes) {
      if (!textbox.name || !textbox.capabilities.includes('name')) continue;
      const intent = (property: 'name' | 'width', value: string) =>
        planTextboxIntent(snapshot, syntax, projection, {
          requestId: 'corpus',
          baseVersion: 1,
          targetId: textbox.node.id,
          operation: 'setProperty',
          payload: { property, value },
        });
      const same = intent('name', textbox.name);
      assert.ok(same.ok && !same.changed && same.candidate === source);
      if (textbox.capabilities.includes('width'))
        assert.equal(intent('width', '-1in').ok, false, fixture.id);
    }
  }
});
