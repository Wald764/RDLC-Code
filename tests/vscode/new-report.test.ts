import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fieldTypes } from '@rdlc/report-model/report';
import type { AuthoringIntent } from '@rdlc/report-model/editing';
import type { HostMessage } from '@rdlc/report-model/protocol';
import { parse } from '@rdlc/xml-parser/parser';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { blankReport } from '../../apps/vscode-extension/src/templates/blank-report.js';
import { DocumentSession } from '../../apps/vscode-extension/src/document-session.js';

export async function run(): Promise<void> {
  const created =
    await vscode.commands.executeCommand<vscode.TextDocument>(
      'rdlcCode.newReport',
    );
  assert.ok(created.isUntitled);
  assert.equal(created.getText().replace(/\r\n/g, '\n'), blankReport);
  const dirtyDeadline = Date.now() + 5000;
  while (!created.isDirty && Date.now() < dirtyDeadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(created.isDirty, true);
  const file = join(
    mkdtempSync(join(tmpdir(), 'rdlc-code-us2-')),
    'created.rdlc',
  );
  // Associated untitled URI exercises native Save As without an interactive destination picker.
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(file).with({ scheme: 'untitled' }),
  );
  const insert = new vscode.WorkspaceEdit();
  insert.insert(document.uri, new vscode.Position(0, 0), blankReport);
  assert.equal(await vscode.workspace.applyEdit(insert), true);
  const session = new DocumentSession(document);
  const results: Extract<HostMessage, { kind: 'editResult' }>[] = [];
  const subscription = session.onMessage((message) => {
    if (message.kind === 'editResult') results.push(message);
  });
  session.receive({ protocol: 2, kind: 'ready' });
  let sequence = 0;
  const current = () => {
    const syntax = parse({
      uri: document.uri.toString(),
      version: document.version,
      source: document.getText(),
      eol: '\n',
    });
    return { syntax, report: projectReport(syntax) };
  };
  const edit = async (
    target: (value: ReturnType<typeof current>) => string,
    payload: AuthoringIntent['payload'],
    accepted = true,
  ) => {
    session.receive({
      protocol: 2,
      kind: 'edit',
      requestId: `us2-${++sequence}`,
      baseVersion: document.version,
      targetId: target(current()),
      operation: 'author',
      payload,
    });
    const deadline = Date.now() + 10000;
    while (results.length < sequence && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const result = results[sequence - 1];
    assert.ok(result, `No result for ${payload.action}`);
    assert.equal(
      result.accepted,
      accepted,
      `${payload.action}: ${JSON.stringify(result)}`,
    );
  };
  const root = (value: ReturnType<typeof current>) => value.syntax.root!.id;
  const dataset = (value: ReturnType<typeof current>) =>
    value.report.datasets[0]!.node.id;
  const table = (value: ReturnType<typeof current>) =>
    value.report.tables[0]!.node.id;
  try {
    await edit(root, {
      action: 'setPage',
      property: 'bodyHeight',
      value: '4in',
    });
    await edit(root, { action: 'createTextbox', left: '0in', top: '0in' });
    await edit(root, { action: 'createTextbox', left: '0in', top: '0.5in' });
    await edit(root, { action: 'createDataset' });
    await edit(dataset, { action: 'renameDataset', name: 'Orders' });
    for (const [index, type] of Object.keys(fieldTypes).entries())
      await edit(dataset, {
        action: 'createField',
        name: `Field${index}`,
        type,
      });
    await edit(root, { action: 'createTable', left: '0in', top: '1in' });
    await edit(table, { action: 'setTableDataset', dataset: 'Orders' });
    await edit(table, { action: 'addColumn', field: 'Field0', width: '1in' });
    await edit(table, { action: 'addColumn', field: 'Field4', width: '1in' });
    await edit(table, {
      action: 'addGroup',
      name: 'ByLabel',
      expression: '=Fields!Field0.Value',
    });
    await edit(table, {
      action: 'addTotal',
      field: 'Field4',
      scope: 'ByLabel',
      column: '1',
    });
    await edit(table, {
      action: 'addTotal',
      field: 'Field4',
      scope: 'Orders',
      column: '1',
    });
    const before = document.getText();
    await edit(dataset, { action: 'renameDataset', name: 'Unsafe' }, false);
    await edit(
      (value) => value.report.datasets[0]!.fields[4]!.node.id,
      { action: 'deleteField' },
      false,
    );
    assert.equal(document.getText(), before);
    assert.equal(current().report.tables[0]!.structural, true);
    assert.deepEqual(
      current().report.datasets[0]!.fields.map((field) => field.typeName),
      Object.values(fieldTypes),
    );
    assert.equal(await document.save(), true);
    const reopened = await vscode.workspace.openTextDocument(
      vscode.Uri.file(file),
    );
    assert.equal(reopened.getText(), before);
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally {
    subscription.dispose();
    session.dispose();
  }
}
