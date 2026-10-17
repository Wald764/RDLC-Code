import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function validateReleaseConfig(
  env: Readonly<Record<string, string | undefined>>,
  publisher: string,
): { publisher: string; openvsx: 'not-configured' | 'pat' | 'oidc' } {
  assert.match(
    publisher,
    /^[a-z0-9][a-z0-9-]*$/i,
    'Invalid embedded publisher',
  );
  assert.equal(
    env.MARKETPLACE_PUBLISHER,
    publisher,
    'Marketplace publisher must match the VSIX',
  );
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  assert.ok(
    uuid.test(env.AZURE_CLIENT_ID ?? ''),
    'Missing/invalid Entra client ID',
  );
  assert.ok(
    uuid.test(env.AZURE_TENANT_ID ?? ''),
    'Missing/invalid Entra tenant ID',
  );
  assert.ok(
    !env.VSCE_PAT && !env.AZURE_CLIENT_SECRET,
    'Use the validated federated Entra mode',
  );
  assert.ok(
    env.AZURE_SUBSCRIPTION_ID
      ? uuid.test(env.AZURE_SUBSCRIPTION_ID) &&
          env.AZURE_ALLOW_NO_SUBSCRIPTIONS !== 'true'
      : env.AZURE_ALLOW_NO_SUBSCRIPTIONS === 'true',
    'Configure a subscription ID or allow-no-subscriptions, exclusively',
  );
  const configured = !!(
    env.OPENVSX_NAMESPACE ||
    env.OPENVSX_AUTH_MODE ||
    env.OVSX_PAT
  );
  if (!configured) return { publisher, openvsx: 'not-configured' };
  assert.equal(
    env.OPENVSX_NAMESPACE,
    publisher,
    'Open VSX namespace must match the VSIX',
  );
  const mode = env.OPENVSX_AUTH_MODE || (env.OVSX_PAT ? 'pat' : '');
  assert.ok(
    mode === 'pat' || mode === 'oidc',
    'Configure Open VSX pat or oidc mode',
  );
  assert.ok(
    mode === 'pat' ? !!env.OVSX_PAT?.trim() : !env.OVSX_PAT,
    'Missing PAT or conflicting PAT/OIDC configuration',
  );
  return { publisher, openvsx: mode };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(
    JSON.stringify(validateReleaseConfig(process.env, process.argv[2] ?? '')),
  );
}
