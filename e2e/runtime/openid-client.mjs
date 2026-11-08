import * as oidc from 'openid-client';
export * from 'openid-client';

export function discovery(server, clientId, metadata, clientAuthentication, options) {
  if (server.href !== 'http://oidc:8080/e2e') {
    throw new Error('The E2E HTTP adapter only accepts the mock issuer');
  }
  // Allow HTTP transport only. Signature, issuer, audience, state, nonce and
  // PKCE validation still run in the actual openid-client implementation.
  return oidc.discovery(server, clientId, metadata, clientAuthentication, {
    ...options,
    execute: [...(options?.execute ?? []), oidc.allowInsecureRequests],
  });
}
