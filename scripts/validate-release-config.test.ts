import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseConfig } from './validate-release-config.js';

test('preflight requires matching identities and explicit valid authentication, never leaks credentials', () => {
  const config = {
    MARKETPLACE_PUBLISHER: 'example',
    AZURE_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
    AZURE_TENANT_ID: '22222222-2222-4222-8222-222222222222',
    AZURE_ALLOW_NO_SUBSCRIPTIONS: 'true',
  };
  assert.equal(
    validateReleaseConfig(config, 'example').openvsx,
    'not-configured',
  );
  assert.equal(
    validateReleaseConfig(
      {
        ...config,
        OPENVSX_NAMESPACE: 'example',
        OVSX_PAT: 'private-test-value',
      },
      'example',
    ).openvsx,
    'pat',
  );
  assert.equal(
    validateReleaseConfig(
      { ...config, OPENVSX_NAMESPACE: 'example', OPENVSX_AUTH_MODE: 'oidc' },
      'example',
    ).openvsx,
    'oidc',
  );
  for (const change of [
    { MARKETPLACE_PUBLISHER: 'other' },
    { AZURE_CLIENT_ID: '' },
    { AZURE_ALLOW_NO_SUBSCRIPTIONS: '' },
    { OPENVSX_NAMESPACE: 'other', OVSX_PAT: 'private-test-value' },
    { OPENVSX_NAMESPACE: 'example' },
    { OVSX_PAT: 'private-test-value' },
    {
      OPENVSX_NAMESPACE: 'example',
      OPENVSX_AUTH_MODE: 'oidc',
      OVSX_PAT: 'private-test-value',
    },
    { VSCE_PAT: 'private-test-value' },
  ]) {
    assert.throws(
      () => validateReleaseConfig({ ...config, ...change }, 'example'),
      (error: unknown) =>
        error instanceof Error && !error.message.includes('private-test-value'),
    );
  }
});
