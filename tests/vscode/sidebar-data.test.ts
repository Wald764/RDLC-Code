import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dataCommandActions,
  dataCreateCommand,
} from '../../apps/vscode-extension/src/sidebar/views.js';

interface Manifest {
  readonly contributes: {
    readonly commands: readonly { readonly command: string }[];
    readonly menus: Readonly<
      Record<
        string,
        readonly { readonly command: string; readonly when?: string }[]
      >
    >;
  };
}

/**
 * US3 wiring regression: the five native Data commands declared in
 * package.json are exactly the ones the sidebar registers, and their menu
 * scopes stay limited to the Data view. Handler behavior (capability guard,
 * existing form route, no authoring payload) is covered by
 * `apps/vscode-extension/src/sidebar-actions.test.ts`.
 */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('Wald764.rdlc-code');
  assert.ok(extension, 'the installed or development extension is discovered');
  await extension.activate();
  const manifest = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../apps/vscode-extension/package.json'),
      'utf8',
    ),
  ) as Manifest;
  const contributed = manifest.contributes.commands
    .map((entry) => entry.command)
    .filter((id) => id.startsWith('rdlcCode.sidebar.data'));
  const registered = [
    ...Object.keys(dataCommandActions),
    dataCreateCommand,
  ].map((id) => `rdlcCode.sidebar.${id}`);
  assert.deepEqual(
    [...registered].sort(),
    [...contributed].sort(),
    'every contributed Data command is registered, and nothing extra',
  );
  const commands = await vscode.commands.getCommands(true);
  for (const id of contributed)
    assert.ok(
      commands.includes(id),
      `${id} is registered in the live Extension Host`,
    );

  const title = manifest.contributes.menus['view/title'] ?? [];
  assert.ok(
    title.some(
      (entry) =>
        entry.command === `rdlcCode.sidebar.${dataCreateCommand}` &&
        /view == rdlcCode\.data/.test(entry.when ?? ''),
    ),
    'dataset creation stays a Data view title action',
  );
  const itemContext = manifest.contributes.menus['view/item/context'] ?? [];
  for (const id of Object.keys(dataCommandActions)) {
    const entry = itemContext.find(
      (candidate) => candidate.command === `rdlcCode.sidebar.${id}`,
    );
    assert.ok(entry, `${id} has a row menu entry`);
    assert.match(
      entry.when ?? '',
      /view == rdlcCode\.data/,
      `${id} never appears outside the Data view`,
    );
  }
}
