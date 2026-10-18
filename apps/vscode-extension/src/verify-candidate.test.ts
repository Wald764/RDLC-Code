import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCandidate, verifyLayoutCandidate } from './verify-candidate.js';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { validateLayout } from '@rdlc/validation/layout';
import { planLayout } from '@rdlc/xml-serializer/layout';
import type { PatchPlan } from '@rdlc/report-model/editing';

test('layout verification rejects wrong geometry, content, bindings and hierarchy inside edited parents', () => {
  const snapshot = {
    uri: 'test:verify-layout',
    version: 1,
    source: readFileSync('tests/fixtures/interactive/mixed.rdlc', 'utf8'),
    eol: '\n' as const,
  };
  const original = parse(snapshot),
    report = projectReport(original);
  const table = report.tables[0]!;
  const changes = validateLayout(report, {
    action: 'resize',
    targetIds: [table.node.id],
    handle: 'se',
    xPt: 300,
    yPt: 300,
    unit: 'pt',
  });
  const plan = planLayout(snapshot, changes, 'pt');
  const valid = verifyCandidate(snapshot, plan, (next, old) =>
    verifyLayoutCandidate(old, next, changes),
  );
  for (const source of [
    valid.source.replace(
      /<TablixColumn><Width>[^<]+/,
      '<TablixColumn><Width>1pt',
    ),
    valid.source.replace('=Fields!Amount.Value', '=Fields!Category.Value'),
    valid.source.replace('Orders', 'WrongDataset'),
    valid.source.replace('ByLabel', 'WrongGroup'),
  ]) {
    assert.notEqual(
      source,
      valid.source,
      'The corruption must actually change the candidate',
    );
    assert.equal(
      verifyLayoutCandidate(original, parse({ ...snapshot, source }), changes),
      false,
    );
  }
});

test('geometry keeps local namespace declarations and refuses loss of scalar annotations', () => {
  const source = readFileSync(
    'tests/fixtures/textboxes/supported.rdlc',
    'utf8',
  );
  for (const annotation of ['', '<!--keep--><?keep value?>']) {
    const snapshot = {
      uri: 'test:scalar-markup',
      version: 1,
      source: source.replace(
        '<Left>0.25in</Left>',
        `<Left xmlns:x="urn:local">${annotation}0.25in</Left>`,
      ),
      eol: '\n' as const,
    };
    const original = parse(snapshot),
      report = projectReport(original);
    const changes = validateLayout(report, {
      action: 'move',
      targetIds: [report.textboxes[0]!.node.id],
      dxPt: 1,
      dyPt: 0,
      unit: 'pt',
    });
    const plan = planLayout(snapshot, changes, 'pt');
    if (annotation)
      assert.throws(
        () =>
          verifyCandidate(snapshot, plan, (next, old) =>
            verifyLayoutCandidate(old, next, changes),
          ),
        /intended change/,
      );
    else {
      const candidate = verifyCandidate(snapshot, plan, (next, old) =>
        verifyLayoutCandidate(old, next, changes),
      );
      assert.match(candidate.source, /<Left xmlns:x="urn:local">/);
    }
  }
});

test('candidate verification reparses and verifies intention before any host mutation', () => {
  const snapshot = {
    uri: 'fixture:verify',
    version: 4,
    source: '<a xmlns:p="urn:p">old<p:b/></a>',
    eol: '\n' as const,
  };
  const start = snapshot.source.indexOf('old');
  const plan: PatchPlan = {
    version: 4,
    patches: [
      {
        version: 4,
        start,
        end: start + 3,
        expected: 'old',
        replacement: 'new',
      },
    ],
    footprint: [{ start, end: start + 3 }],
    namespaceDependencies: [{ nodeId: '4:1', prefix: 'p', uri: 'urn:p' }],
  };
  assert.equal(
    verifyCandidate(
      snapshot,
      plan,
      (candidate) => candidate.root?.text === 'new',
    ).source,
    snapshot.source.replace('old', 'new'),
  );
  assert.throws(() => verifyCandidate(snapshot, plan, () => false));
  assert.throws(() =>
    verifyCandidate(
      snapshot,
      { ...plan, patches: [{ ...plan.patches[0]!, replacement: '<' }] },
      () => true,
    ),
  );
  assert.throws(() =>
    verifyCandidate(
      snapshot,
      {
        ...plan,
        namespaceDependencies: [{ nodeId: '4:1', prefix: 'p', uri: 'wrong' }],
      },
      () => true,
    ),
  );
});

test('namespace edits cannot silently reinterpret untouched descendants', () => {
  const snapshot = {
    uri: 'fixture:namespace',
    version: 1,
    source: '<a xmlns:p="urn:old"><p:b/></a>',
    eol: '\n' as const,
  };
  const start = snapshot.source.indexOf('urn:old');
  const plan: PatchPlan = {
    version: 1,
    patches: [
      {
        version: 1,
        start,
        end: start + 7,
        expected: 'urn:old',
        replacement: 'urn:new',
      },
    ],
    footprint: [{ start, end: start + 7 }],
    namespaceDependencies: [],
  };
  assert.throws(
    () => verifyCandidate(snapshot, plan, () => true),
    /namespace/i,
  );
});

test('explicit subtree deletion verifies surviving sibling namespaces and untouched lexical source', () => {
  const snapshot = {
    uri: 'fixture:delete',
    version: 1,
    source: '<a xmlns:p="urn:p"><p:b/><p:c/></a>',
    eol: '\n' as const,
  };
  const start = snapshot.source.indexOf('<p:b');
  const plan: PatchPlan = {
    version: 1,
    patches: [
      {
        version: 1,
        start,
        end: start + 6,
        expected: '<p:b/>',
        replacement: '',
      },
    ],
    footprint: [{ start, end: start + 6 }],
    namespaceDependencies: [],
  };
  assert.equal(
    verifyCandidate(
      snapshot,
      plan,
      (candidate) =>
        candidate.root?.children.length === 1 &&
        candidate.root.children[0]?.expandedName.namespaceUri === 'urn:p',
    ).source,
    snapshot.source.replace('<p:b/>', ''),
  );
});
