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

test('clipboard verification proves each inserted subtree, not only untouched source', async () => {
  const { verifyClipboardCandidate } = await import('./verify-candidate.js');
  const { allocateNames, nameIndex } = await import(
    '@rdlc/validation/clipboard'
  );
  const { buildCapture, planPaste } = await import('./clipboard.js');
  const run = (
    sourceText: string,
    destinationText: string,
    names: string[],
  ) => {
    const load = (text: string) => {
      const snapshot = {
        uri: 'test:v',
        version: 1,
        source: text,
        eol: '\n' as const,
      };
      const syntax = parse(snapshot);
      return { snapshot, syntax, projection: projectReport(syntax) };
    };
    const from = load(sourceText);
    const built = buildCapture(
      from,
      names.map(
        (n) => from.projection.textboxes.find((t) => t.name === n)!.node.id,
      ),
    );
    assert.ok(built.ok);
    const to = load(destinationText);
    const planned = planPaste(to, built.capture, 10, 'pt');
    assert.ok(planned.ok);
    const patch = planned.plan.patches[0]!;
    const fragments = planned.starts.map((start, i) =>
      planned.candidate.slice(
        start,
        planned.starts[i + 1] ?? patch.start + patch.replacement.length,
      ),
    );
    const mapping = allocateNames(built.capture, nameIndex(to.syntax.root));
    return (tamper: (fragment: string, index: number) => string) => {
      const changed = fragments.map(tamper);
      let start = patch.start;
      const inserted = built.capture.roots.map((root, i) => {
        const entry = {
          root,
          start,
          fragment: changed[i]!,
          bounds: {
            ...root.bounds,
            left: root.bounds.left + 10,
            top: root.bounds.top + 10,
          },
        };
        start += changed[i]!.length;
        return entry;
      });
      const candidate =
        destinationText.slice(0, patch.start) +
        changed.join('') +
        destinationText.slice(patch.end);
      return verifyClipboardCandidate(
        to.syntax,
        parse({ ...to.snapshot, source: candidate }),
        { inserted, names: mapping, removed: [] },
      );
    };
  };
  const dependencies = readFileSync(
    'tests/fixtures/interactive/clipboard-dependencies.rdlc',
    'utf8',
  );
  const verify = run(dependencies, dependencies, [
    'Title',
    'InternalReference',
  ]);
  assert.equal(
    verify((f) => f),
    true,
  );
  for (const [label, tamper] of [
    [
      'unmapped reference',
      (f: string) => f.replace('ReportItems!Title1', 'ReportItems!Title'),
    ],
    [
      'duplicate identity',
      (f: string) =>
        f.replace('Name="InternalReference1"', 'Name="InternalReference"'),
    ],
    [
      'rewritten annotation',
      (f: string) => f.replace('literal annotation', 'rewritten'),
    ],
    [
      'wrong geometry',
      (f: string) => f.replace('<Left>22pt</Left>', '<Left>23pt</Left>'),
    ],
    [
      'dropped content',
      (f: string) =>
        f.replace('<Value>Orders &amp; totals</Value>', '<Value/>'),
    ],
  ] as const)
    assert.equal(verify(tamper), false, label);
  const namespaces = readFileSync(
    'tests/fixtures/interactive/clipboard-namespaces.rdlc',
    'utf8',
  );
  const crossed = run(namespaces, dependencies, ['Prefixed']);
  assert.equal(
    crossed((f) => f),
    true,
  );
  assert.equal(
    crossed((f) =>
      f.replace(
        'xmlns:r="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"',
        'xmlns:r="urn:other"',
      ),
    ),
    false,
    'namespace meaning changed',
  );
});
