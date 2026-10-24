import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the native report workspace contributes three local views without replacing Explorer', () => {
  const manifest = JSON.parse(
    readFileSync('apps/vscode-extension/package.json', 'utf8'),
  );
  assert.deepEqual(manifest.contributes.viewsContainers.activitybar, [
    { id: 'rdlcCode', title: 'RDLC Code', icon: 'media/rdlc-activity.svg' },
  ]);
  assert.deepEqual(
    manifest.contributes.views.rdlcCode.map(
      (view: { id: string; name: string }) => [view.id, view.name],
    ),
    [
      ['rdlcCode.structure', 'Report Structure'],
      ['rdlcCode.data', 'Report Data'],
      ['rdlcCode.components', 'Components'],
    ],
  );
  assert.equal(manifest.contributes.views.explorer, undefined);
  for (const command of [
    'newReport',
    'openDesigner',
    'openSource',
    'sidebar.openReport',
    'sidebar.activate',
    'sidebar.properties',
    'sidebar.source',
    'sidebar.filter',
    'sidebar.clearFilter',
  ])
    assert.ok(
      manifest.contributes.commands.some(
        (entry: { command: string }) => entry.command === `rdlcCode.${command}`,
      ),
      command,
    );
  assert.match(
    readFileSync('apps/vscode-extension/media/rdlc-activity.svg', 'utf8'),
    /<svg/,
  );
  assert.equal(manifest.dependencies.playwright, undefined);
  assert.ok(
    manifest.contributes.viewsWelcome.some(
      (entry: { view: string; contents: string }) =>
        entry.view === 'rdlcCode.structure' &&
        entry.contents.includes('rdlcCode.newReport') &&
        entry.contents.includes('rdlcCode.sidebar.openReport'),
    ),
  );
});
