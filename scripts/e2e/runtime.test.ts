import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('E2E の HTTP 許可は指定 issuer の discovery だけに適用する', () => {
  const output = execFileSync(process.execPath, ['--import=./e2e/runtime/register.mjs', '--input-type=module', '-e', `
    import * as oidc from 'openid-client';
    let calls = 0;
    globalThis.fetch = async url => {
      if (String(url) !== 'http://oidc:8080/e2e/.well-known/openid-configuration') throw new Error('Unexpected URL');
      calls++;
      return new Response(JSON.stringify({
        issuer: 'http://oidc:8080/e2e', authorization_endpoint: 'http://oidc:8080/e2e/authorize',
        token_endpoint: 'http://oidc:8080/e2e/token', jwks_uri: 'http://oidc:8080/e2e/jwks',
        response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256']
      }), { headers: { 'content-type': 'application/json' } });
    };
    const config = await oidc.discovery(new URL('http://oidc:8080/e2e'), 'e2e-client');
    oidc.enableNonRepudiationChecks(config);
    if (config.serverMetadata().issuer !== 'http://oidc:8080/e2e' || calls !== 1) throw new Error('Discovery failed');
    try { await oidc.discovery(new URL('http://other.test/e2e'), 'client'); throw new Error('Not rejected'); }
    catch (error) { if (!error.message.includes('only accepts the mock issuer')) throw error; }
    console.log('verified');
  `], { encoding: 'utf8' });
  expect(output.trim()).toBe('verified');
});

test('ダミー ADC は Google への通信より前に失敗する', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { GoogleAuth } from 'google-auth-library';
    import http from 'node:http';
    import https from 'node:https';
    let requests = 0;
    const blocked = () => { requests++; throw new Error('Network request attempted'); };
    http.request = https.request = globalThis.fetch = blocked;
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'] });
    let failed = false;
    try { await auth.getAccessToken(); } catch { failed = true; }
    if (!failed || requests !== 0) throw new Error('ADC must fail locally');
    console.log('verified');
  `], { encoding: 'utf8', env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: 'e2e/google-credentials.json', GOOGLE_CLOUD_PROJECT: 'e2e-project' } });
  expect(output.trim()).toBe('verified');
});
