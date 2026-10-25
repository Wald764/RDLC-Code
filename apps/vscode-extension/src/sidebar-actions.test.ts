import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateReport } from './report-evaluation.js';
import { validateMessage } from '@rdlc/report-model/protocol';
import {
  clipboardIntent,
  dataIntent,
  datasetCreateRoute,
  structureContextValue,
  structureIntent,
} from './sidebar/actions.js';

const evaluate = (path: string) =>
  evaluateReport({
    uri: `test:${path}`,
    version: 1,
    source: readFileSync(path, 'utf8'),
    eol: '\n',
  });

const attempt = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'no refusal';
};

test('native clipboard menus require both current body membership and capability', () => {
  const evaluation = evaluateReport({
    uri: 'test:body',
    version: 3,
    source: readFileSync('tests/fixtures/textboxes/supported.rdlc', 'utf8'),
    eol: '\n',
  });
  const body = evaluation.navigation.structure.nodes.find(
    (node) => node.kind === 'textbox',
  )!;
  assert.ok(body);
  for (const action of ['copy', 'cut', 'duplicate'] as const) {
    const intent = clipboardIntent(body, evaluation.scene, action);
    assert.ok(
      validateMessage({
        protocol: 2,
        kind: 'nativeAction',
        requestId: `clipboard-${action}`,
        documentLifetimeId: 'document-1',
        uri: 'file:///body.rdlc',
        baseVersion: 3,
        viewId: 'view-1',
        contextGeneration: 1,
        capability: 'clipboard',
        targetIds: [body.id],
        ...intent,
      }),
      `${action} produces a valid captured native action`,
    );
    assert.deepEqual(clipboardIntent(body, evaluation.scene, action), {
      action: 'clipboard',
      clipboard: action,
      ...(action === 'duplicate' ? { unit: 'pt' } : {}),
    });
  }
  assert.throws(
    () => clipboardIntent(body, null, 'cut'),
    /eligible report body item/,
  );
  assert.throws(
    () =>
      clipboardIntent({ ...body, capabilities: [] }, evaluation.scene, 'cut'),
    /eligible report body item/,
  );
  const structural = evaluation.navigation.structure.nodes.find(
    (node) => node.kind === 'body',
  )!;
  assert.throws(
    () => clipboardIntent(structural, evaluation.scene, 'duplicate'),
    /eligible report body item/,
  );
});

test('delete, table and group reuse the existing properties route with no mutation payload', () => {
  const grouped = evaluate('tests/fixtures/tables/grouped.rdlc');
  const nodes = grouped.navigation.structure.nodes;
  const table = nodes.find((node) => node.kind === 'table')!;
  const group = nodes.find((node) => node.kind === 'group')!;
  assert.ok(table && group);

  const routes = {
    delete: structureIntent(table, grouped.scene, 'delete', nodes),
    table: structureIntent(table, grouped.scene, 'table', nodes),
    group: structureIntent(group, grouped.scene, 'group', nodes),
  };
  for (const route of Object.values(routes)) {
    // Reaching the existing handlers means dispatching the existing properties
    // action; a forged/author payload with an auto-filled acknowledgement fails here.
    assert.deepEqual(route.intent, { action: 'properties' });
    assert.doesNotMatch(
      JSON.stringify(route.intent),
      /author|payload|confirm|deleteTextbox/,
    );
  }
  assert.deepEqual(routes.delete.targetIds, [table.id]);
  assert.deepEqual(routes.table.targetIds, [table.id]);
  // Group editing is scoped to the owning table's existing group form.
  assert.notEqual(group.id, table.id);
  assert.deepEqual(routes.group.targetIds, [table.id]);
  assert.match(routes.delete.notice, /Nothing is deleted until you confirm/);
  assert.match(routes.delete.notice, /guards still apply/);
});

test('forged or unsupported structure actions are refused with an accessible reason', () => {
  const grouped = evaluate('tests/fixtures/tables/grouped.rdlc');
  const nodes = grouped.navigation.structure.nodes;
  const table = nodes.find((node) => node.kind === 'table')!;
  const structural = nodes.find((node) => node.kind === 'body')!;
  const dataset = grouped.navigation.data.nodes.find(
    (node) => node.kind === 'dataset',
  )!;

  assert.match(
    attempt(() => structureIntent(structural, grouped.scene, 'delete', nodes)),
    /unavailable for this target/,
    'structural rows expose no deletion entry',
  );
  assert.match(
    attempt(() => structureIntent(dataset, grouped.scene, 'delete', nodes)),
    /editable report body item/,
    'definitions are not report body items',
  );
  assert.match(
    attempt(() =>
      structureIntent(
        nodes.find((node) => node.kind === 'textbox')!,
        grouped.scene,
        'table',
        nodes,
      ),
    ),
    /table target/,
  );
  assert.match(
    attempt(() => structureIntent(table, grouped.scene, 'group', nodes)),
    /group target/,
  );
  assert.match(
    attempt(() =>
      structureIntent(
        { ...nodes.find((node) => node.kind === 'group')!, parentId: null },
        grouped.scene,
        'group',
        nodes,
      ),
    ),
    /inside a report table/,
    'a group outside a table cannot borrow an unrelated form',
  );
});

test('preserved and source-only targets stay inspect/source-only with their reason', () => {
  const opaque = evaluate(
    'tests/fixtures/textboxes/supported-plus-opaque.rdlc',
  );
  const nodes = opaque.navigation.structure.nodes;
  const preserved = nodes.find((node) => node.kind === 'preserved')!;
  const preservationOnly = nodes.find((node) => node.name === 'Rich')!;
  const supported = nodes.find((node) => node.name === 'Title')!;
  assert.ok(preserved && preservationOnly && supported);
  for (const node of [preserved, preservationOnly])
    assert.equal(
      structureContextValue(node, undefined, opaque.scene),
      'rdlcCode.source',
      `${node.kind}/${node.name ?? ''} keeps inspect and Code XML only`,
    );
  assert.equal(
    structureContextValue(supported, undefined, opaque.scene),
    'rdlcCode.body',
  );
  assert.match(
    attempt(() =>
      structureIntent(preservationOnly, opaque.scene, 'delete', nodes),
    ),
    /unavailable for this target/,
  );

  const sourceOnly = evaluate(
    'tests/fixtures/textboxes/unsupported-profile.rdlc',
  );
  const sourceNode = sourceOnly.navigation.structure.nodes.find(
    (node) => node.kind === 'textbox',
  )!;
  assert.equal(
    structureContextValue(sourceNode, undefined, sourceOnly.scene),
    'rdlcCode.source',
  );
  assert.match(
    attempt(() =>
      structureIntent(
        sourceNode,
        sourceOnly.scene,
        'delete',
        sourceOnly.navigation.structure.nodes,
      ),
    ),
    /Source-only report/,
  );
});

test('table and group rows expose only their owning existing forms', () => {
  const grouped = evaluate('tests/fixtures/tables/grouped.rdlc');
  const nodes = grouped.navigation.structure.nodes;
  const table = nodes.find((node) => node.kind === 'table')!;
  const group = nodes.find((node) => node.kind === 'group')!;
  const structural = nodes.find((node) => node.kind === 'body')!;

  assert.equal(
    structureContextValue(table, undefined, grouped.scene),
    'rdlcCode.body.table',
  );
  assert.equal(
    structureContextValue(group, table, grouped.scene),
    'rdlcCode.group',
  );
  // Without an editable owning table the group row stays inspect/source-only.
  assert.equal(
    structureContextValue(group, undefined, grouped.scene),
    'rdlcCode.source',
  );
  assert.equal(
    structureContextValue(structural, undefined, grouped.scene),
    'rdlcCode.source',
  );
});

test('group routes use the blocked owning table reason and hide its unavailable form', () => {
  const grouped = evaluate('tests/fixtures/tables/grouped.rdlc');
  const nodes = grouped.navigation.structure.nodes;
  const table = nodes.find((node) => node.kind === 'table')!;
  const group = nodes.find((node) => node.kind === 'group')!;
  const blockedTable = {
    ...table,
    opaqueReason: 'The owning table contains preserved content.',
  };
  const blockedNodes = nodes.map((node) =>
    node.id === table.id ? blockedTable : node,
  );
  const scene = {
    ...grouped.scene!,
    items: grouped.scene!.items.map((item) =>
      item.id === table.id ? { ...item, placeholder: true } : item,
    ),
  };
  assert.equal(
    structureContextValue(group, blockedTable, scene),
    'rdlcCode.source',
  );
  assert.match(
    attempt(() => structureIntent(group, scene, 'group', blockedNodes)),
    /The owning table contains preserved content\./,
  );
});

test('data actions reuse the existing dataset form and send no author payload', () => {
  const report = evaluate('tests/fixtures/sidebar/data.rdlc');
  const nodes = report.navigation.data.nodes;
  const dataset = nodes.find(
    (node) => node.kind === 'dataset' && node.name === 'Sales',
  )!;
  const field = nodes.find(
    (node) => node.kind === 'field' && node.name === 'Id',
  )!;
  assert.ok(dataset && field);

  const routes = {
    edit: dataIntent(field, 'edit', nodes),
    rename: dataIntent(field, 'rename', nodes),
    delete: dataIntent(dataset, 'delete', nodes),
    // Add field resolves to the owning dataset, the only form with that control.
    addField: dataIntent(field, 'add-field', nodes),
  };
  for (const route of Object.values(routes)) {
    // The existing designer form owns the mutation: no typed author payload and
    // no pre-filled acknowledgement can travel with the dispatch.
    assert.deepEqual(route.intent, { action: 'properties' });
    assert.doesNotMatch(
      JSON.stringify(route.intent),
      /author|payload|confirm|xml/i,
    );
  }
  assert.deepEqual(routes.edit.targetIds, [field.id]);
  assert.deepEqual(routes.rename.targetIds, [field.id]);
  assert.deepEqual(routes.delete.targetIds, [dataset.id]);
  assert.deepEqual(routes.addField.targetIds, [dataset.id]);
  assert.match(routes.delete.notice, /guards still apply/);
  assert.match(routes.delete.notice, /nothing is deleted until you confirm/i);
  // Datasets have no contained-XML acknowledgement: the existing reference
  // guards of the authoring form are the whole deletion contract.
  assert.doesNotMatch(routes.delete.notice, /contained XML|checkbox/i);
  assert.match(routes.addField.notice, /owning dataset/);

  // Dataset creation reuses the existing route with its automatic defaults.
  const created = datasetCreateRoute();
  assert.deepEqual(created.intent, { action: 'create', create: 'dataset' });
  assert.deepEqual(created.targetIds, []);
  assert.doesNotMatch(
    JSON.stringify(created.intent),
    /author|payload|confirm/i,
  );
});

test('inspect-only and non-data targets refuse before any form opens', () => {
  for (const path of [
    'tests/fixtures/sidebar/data.rdlc',
    'tests/fixtures/sidebar/data-opaque.rdlc',
  ]) {
    const report = evaluate(path);
    const nodes = report.navigation.data.nodes;
    const inspectOnly = nodes.filter(
      (node) => node.kind !== 'dataset' && node.kind !== 'field',
    );
    assert.ok(inspectOnly.length > 0, path);
    for (const node of inspectOnly) {
      const where = `${path}: ${node.kind}`;
      assert.match(
        attempt(() => dataIntent(node, 'delete', nodes)),
        /stay inspect\/source-only/,
        where,
      );
      // A forged capability cannot reach the form: the kind guard runs first.
      const forged = {
        ...node,
        capabilities: [
          { operation: 'properties' as const, eligible: true, reason: null },
        ],
      };
      assert.match(
        attempt(() => dataIntent(forged, 'edit', nodes)),
        /stay inspect\/source-only/,
        where,
      );
      assert.equal(
        structureContextValue(node, undefined, report.scene),
        'rdlcCode.source',
        where,
      );
    }
  }

  const report = evaluate('tests/fixtures/sidebar/data.rdlc');
  const nodes = report.navigation.data.nodes;
  const textbox = report.navigation.structure.nodes.find(
    (node) => node.kind === 'textbox',
  )!;
  assert.match(
    attempt(() => dataIntent(textbox, 'rename', nodes)),
    /requires a dataset or field target/,
    'structure rows never borrow a data form',
  );
  const orphan = {
    ...nodes.find((node) => node.kind === 'field')!,
    parentId: null,
  };
  assert.match(
    attempt(() => dataIntent(orphan, 'add-field', nodes)),
    /inside a dataset/,
    'a detached field cannot borrow an unrelated dataset form',
  );
});

test('every dataset and field row follows its own computed capability', () => {
  const report = evaluate('tests/fixtures/sidebar/data.rdlc');
  const nodes = report.navigation.data.nodes;
  let openable = 0;
  let refused = 0;
  for (const node of nodes) {
    if (node.kind !== 'dataset' && node.kind !== 'field') continue;
    const capability = node.capabilities.find(
      (entry) => entry.operation === 'properties',
    )!;
    const where = `${node.kind}/${node.name ?? '<unnamed>'}`;
    if (capability?.eligible) {
      openable++;
      assert.deepEqual(dataIntent(node, 'edit', nodes).intent, {
        action: 'properties',
      });
      assert.equal(
        structureContextValue(node, undefined, report.scene),
        `rdlcCode.${node.kind}`,
        where,
      );
    } else {
      refused++;
      for (const action of ['edit', 'rename', 'delete', 'add-field'] as const) {
        const message = attempt(() => dataIntent(node, action, nodes));
        assert.match(
          message,
          /unavailable for this target/,
          `${where}/${action}`,
        );
        if (capability?.reason)
          assert.ok(message.includes(capability.reason), `${where}/${action}`);
      }
      assert.equal(
        structureContextValue(node, undefined, report.scene),
        'rdlcCode.source',
        where,
      );
    }
  }
  assert.ok(openable > 0 && refused > 0, `${openable}/${refused}`);
});

test('source-only reports expose no data authoring entry', () => {
  const report = evaluate('tests/fixtures/sidebar/data-source-only.rdlc');
  const nodes = report.navigation.data.nodes;
  const dataset = nodes.find((node) => node.kind === 'dataset')!;
  const field = nodes.find((node) => node.kind === 'field')!;
  assert.match(
    attempt(() => dataIntent(dataset, 'delete', nodes)),
    /unavailable for this target/,
  );
  assert.match(
    attempt(() => dataIntent(field, 'rename', nodes)),
    /unavailable for this target/,
  );
  assert.equal(
    structureContextValue(dataset, undefined, report.scene),
    'rdlcCode.source',
  );
  assert.equal(
    structureContextValue(field, undefined, report.scene),
    'rdlcCode.source',
  );
});
