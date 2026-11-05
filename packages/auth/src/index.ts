import { readFile } from "node:fs/promises";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as oidc from "openid-client";

export interface OidcAuthOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientAuth:
    | { readonly kind: "secret"; readonly clientSecret: string }
    | { readonly kind: "federated"; readonly assertionFile: string; readonly assertionType?: string };
  readonly redirectUri: string;
  readonly allowed: { readonly email?: string; readonly sub?: string };
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly secureCookies: boolean;
  readonly now?: () => Date;
}

interface User {
  readonly sub: string;
  readonly email?: string;
}

const LOGIN_COOKIE = "fpm_oidc_login";
const SESSION_COOKIE = "fpm_session";
const LOGIN_TTL_SECONDS = 10 * 60;
const JWT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUser(value: unknown): value is User {
  return isRecord(value) && isNonEmptyString(value.sub)
    && (value.email === undefined || typeof value.email === "string");
}

function isCurrent(value: Record<string, unknown>, now: number): boolean {
  return typeof value.issuedAt === "number" && Number.isFinite(value.issuedAt)
    && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
    && value.issuedAt <= now && now < value.expiresAt;
}

async function readSignedPayload(c: Context, name: string, secret: string) {
  const value = await getSignedCookie(c, secret, name);
  if (typeof value !== "string") return undefined;
  try {
    const payload: unknown = JSON.parse(value);
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function clientAuthentication(options: OidcAuthOptions["clientAuth"]): oidc.ClientAuth {
  if (options.kind === "secret") return oidc.ClientSecretBasic(options.clientSecret);

  // oauth4webapi awaits custom ClientAuth functions; do not cache rotating tokens.
  return async (_server, client, body) => {
    const assertion = (await readFile(options.assertionFile, "utf8")).trim();
    if (!assertion) throw new Error("The client assertion file is empty");
    body.set("client_id", client.client_id);
    body.set("client_assertion", assertion);
    body.set("client_assertion_type", options.assertionType ?? JWT_ASSERTION_TYPE);
  };
}

export async function createOidcAuth(options: OidcAuthOptions): Promise<{
  routes: Hono;
  middleware: MiddlewareHandler;
}> {
  if (typeof options.sessionSecret !== "string" || options.sessionSecret.length < 32) {
    throw new RangeError("sessionSecret must be at least 32 characters");
  }
  if (!isNonEmptyString(options.allowed.email) && !isNonEmptyString(options.allowed.sub)) {
    throw new RangeError("An allowed email or sub is required");
  }
  if (!Number.isSafeInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0
    || options.sessionTtlSeconds > 400 * 24 * 60 * 60) {
    throw new RangeError("sessionTtlSeconds must be a positive integer of at most 400 days");
  }

  const redirectUri = new URL(options.redirectUri);
  const config = await oidc.discovery(
    new URL(options.issuer), options.clientId, undefined, clientAuthentication(options.clientAuth),
  );
  oidc.enableNonRepudiationChecks(config);

  const now = options.now ?? (() => new Date());
  const timestamp = () => now().getTime() / 1_000;
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: options.secureCookies,
  };
  const routes = new Hono();

  routes.get("/login", async (c) => {
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const location = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri.href,
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
    });
    const issuedAt = timestamp();
    await setSignedCookie(c, LOGIN_COOKIE, JSON.stringify({
      kind: "login",
      state,
      nonce,
      codeVerifier,
      issuedAt,
      expiresAt: issuedAt + LOGIN_TTL_SECONDS,
    }), options.sessionSecret, { ...cookieOptions, maxAge: LOGIN_TTL_SECONDS });
    return c.redirect(location.href, 302);
  });

  routes.get("/callback", async (c) => {
    try {
      const login = await readSignedPayload(c, LOGIN_COOKIE, options.sessionSecret);
      const params = new URL(c.req.url).searchParams;
      if (!login || login.kind !== "login" || !isCurrent(login, timestamp())
        || !isNonEmptyString(login.state) || !isNonEmptyString(login.nonce)
        || !isNonEmptyString(login.codeVerifier)
        || params.getAll("state").length !== 1 || params.get("state") !== login.state) {
        return c.json({ error: "invalid login state" }, 400);
      }

      // Use the configured public callback URL, including behind a reverse proxy.
      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = params.toString();
      let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
      try {
        tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
          expectedState: login.state,
          expectedNonce: login.nonce,
          pkceCodeVerifier: login.codeVerifier,
          idTokenExpected: true,
        }, { redirect_uri: redirectUri.href });
      } catch {
        return c.json({ error: "authentication failed" }, 400);
      }

      const claims = tokens.claims();
      if (!claims || !isNonEmptyString(claims.sub)) {
        return c.json({ error: "invalid ID token" }, 400);
      }
      const allowedBySub = isNonEmptyString(options.allowed.sub) && claims.sub === options.allowed.sub;
      const allowedByEmail = isNonEmptyString(options.allowed.email)
        && claims.email === options.allowed.email && claims.email_verified === true;
      if (!allowedBySub && !allowedByEmail) return c.json({ error: "forbidden" }, 403);

      const user: User = {
        sub: claims.sub,
        ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      };
      const issuedAt = timestamp();
      await setSignedCookie(c, SESSION_COOKIE, JSON.stringify({
        kind: "session",
        user,
        issuedAt,
        expiresAt: issuedAt + options.sessionTtlSeconds,
      }), options.sessionSecret, { ...cookieOptions, maxAge: options.sessionTtlSeconds });
      return c.redirect("/", 302);
    } finally {
      deleteCookie(c, LOGIN_COOKIE, cookieOptions);
    }
  });

  routes.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, cookieOptions);
    deleteCookie(c, LOGIN_COOKIE, cookieOptions);
    return c.redirect("/", 302);
  });

  const middleware: MiddlewareHandler = async (c, next) => {
    const session = await readSignedPayload(c, SESSION_COOKIE, options.sessionSecret);
    if (!session || session.kind !== "session" || !isCurrent(session, timestamp()) || !isUser(session.user)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("user", session.user);
    await next();
  };

  return { routes, middleware };
}
