import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOidcAuth, type OidcAuthOptions } from "../src/index.ts";

// 偽の IdP(MSW)。ID トークンは jose で本当に署名し、openid-client に検証させる
const ISSUER = "https://idp.test";
const APP = "https://app.test";
const CLIENT_ID = "fpm";

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;
let idTokenClaims: Record<string, unknown>;
let tokenRequests: { headers: Headers; body: URLSearchParams }[];
/** 直前の認可リクエストの nonce。本物の IdP と同じく ID トークンに入れて返す */
let currentNonce: string | null = null;

const server = setupServer(
  http.get(`${ISSUER}/.well-known/openid-configuration`, () =>
    HttpResponse.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
      end_session_endpoint: `${ISSUER}/logout`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    }),
  ),
  http.get(`${ISSUER}/jwks`, () => HttpResponse.json({ keys: [publicJwk] })),
  http.post(`${ISSUER}/token`, async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    tokenRequests.push({ headers: request.headers, body });
    const idToken = await new SignJWT({ ...idTokenClaims, ...(currentNonce ? { nonce: currentNonce } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return HttpResponse.json({ access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken });
  }),
);

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  tokenRequests = [];
  currentNonce = null;
  idTokenClaims = { sub: "user-1", email: "me@example.com", email_verified: true };
});

const baseOptions: OidcAuthOptions = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientAuth: { kind: "secret", clientSecret: "s3cret" },
  redirectUri: `${APP}/auth/callback`,
  allowed: { email: "me@example.com" },
  sessionSecret: "a".repeat(32),
  sessionTtlSeconds: 60 * 60 * 12,
  secureCookies: true,
};

/** 認証つきの小さなアプリを作る。now を差し替えられる */
const build = async (over: Partial<OidcAuthOptions> = {}, now = () => new Date("2026-11-15T03:00:00Z")) => {
  const auth = await createOidcAuth({ ...baseOptions, ...over, now });
  const app = new Hono();
  app.route("/auth", auth.routes);
  app.use("/api/*", auth.middleware);
  app.get("/api/me", (c) => c.json(c.get("user" as never)));
  return app;
};

/** Set-Cookie から name=value の組を取り出し、Cookie ヘッダの値にする */
const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** ログインを最後まで通し、セッションの Cookie を返す */
const login = async (app: Hono) => {
  const start = await app.request("/auth/login");
  const location = new URL(start.headers.get("location")!);
  const state = location.searchParams.get("state")!;
  currentNonce = location.searchParams.get("nonce");
  const callback = await app.request(`/auth/callback?code=abc&state=${state}`, {
    headers: { cookie: cookiesFrom(start) },
  });
  return { start, location, callback, cookie: cookiesFrom(callback) };
};

describe("createOidcAuth: OIDC でログインするだけ(権限管理はしない)", () => {
  it("/auth/login は IdP の認可エンドポイントへ PKCE つきでリダイレクトする", async () => {
    const { start, location } = await login(await build());
    expect(start.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/authorize`);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/auth/callback`);
    expect(location.searchParams.get("scope")).toBe("openid email");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();
  });

  it("ログイン途中の値を入れる Cookie は HttpOnly・Secure・SameSite=Lax", async () => {
    const start = await (await build()).request("/auth/login");
    const cookie = start.headers.getSetCookie().join("\n");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("コールバックでトークンを取り、許可したユーザーならセッションを作って / へ戻す", async () => {
    const app = await build();
    const { callback, cookie } = await login(app);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    const me = await app.request("/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toEqual({ sub: "user-1", email: "me@example.com" });
  });

  it("client_secret の方式: トークンのリクエストに Basic 認証を付ける", async () => {
    await login(await build());
    const auth = tokenRequests[0]!.headers.get("authorization")!;
    expect(auth).toMatch(/^Basic /);
    expect(Buffer.from(auth.slice(6), "base64").toString()).toBe(`${CLIENT_ID}:s3cret`);
    expect(tokenRequests[0]!.body.get("code_verifier")).toBeTruthy();
  });

  it("WIF の方式: ファイルのトークン(Kubernetes の ServiceAccount トークン)を client_assertion として送る", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fpm-auth-"));
    const file = join(dir, "token");
    writeFileSync(file, "k8s-sa-token-1\n");
    const app = await build({ clientAuth: { kind: "federated", assertionFile: file } });
    await login(app);
    const body = tokenRequests[0]!.body;
    expect(body.get("client_assertion")).toBe("k8s-sa-token-1");
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(tokenRequests[0]!.headers.get("authorization")).toBeNull();

    // トークンは更新されるので、毎回ファイルを読み直す
    writeFileSync(file, "k8s-sa-token-2\n");
    await login(app);
    expect(tokenRequests[1]!.body.get("client_assertion")).toBe("k8s-sa-token-2");
  });

  it("許可していないユーザーは 403、セッションを作らない", async () => {
    idTokenClaims = { sub: "someone", email: "other@example.com", email_verified: true };
    const app = await build();
    const { callback, cookie } = await login(app);
    expect(callback.status).toBe(403);
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("メールアドレスが確認済みでなければ、メールで許可しない", async () => {
    idTokenClaims = { sub: "user-1", email: "me@example.com", email_verified: false };
    const { callback } = await login(await build());
    expect(callback.status).toBe(403);
  });

  it("sub で許可することもできる", async () => {
    idTokenClaims = { sub: "user-1" };
    const { callback } = await login(await build({ allowed: { sub: "user-1" } }));
    expect(callback.status).toBe(302);
  });

  it("ID トークンの nonce が合わなければ、セッションを作らない", async () => {
    const app = await build();
    const start = await app.request("/auth/login");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    currentNonce = "attacker-nonce";
    const callback = await app.request(`/auth/callback?code=abc&state=${state}`, { headers: { cookie: cookiesFrom(start) } });
    expect(callback.status).toBeGreaterThanOrEqual(400);
    expect(callback.headers.getSetCookie().join("\n")).not.toMatch(/session/i);
  });

  it("state が合わなければ 400", async () => {
    const app = await build();
    const start = await app.request("/auth/login");
    const res = await app.request("/auth/callback?code=abc&state=wrong", { headers: { cookie: cookiesFrom(start) } });
    expect(res.status).toBe(400);
    expect(tokenRequests).toHaveLength(0);
  });

  it("ログインを始めていない(Cookie がない)コールバックは 400", async () => {
    expect((await (await build()).request("/auth/callback?code=abc&state=x")).status).toBe(400);
  });

  describe("セッション", () => {
    it("セッションがなければ /api は 401", async () => {
      expect((await (await build()).request("/api/me")).status).toBe(401);
    });

    it("改ざんした Cookie は 401", async () => {
      const app = await build();
      const { cookie } = await login(app);
      const tampered = cookie.replace(/=([^;]*)/, (_m, v: string) => `=${v.slice(0, -2)}xx`);
      expect((await app.request("/api/me", { headers: { cookie: tampered } })).status).toBe(401);
    });

    it("期限を過ぎたセッションは 401", async () => {
      let now = new Date("2026-11-15T03:00:00Z");
      const app = await build({ sessionTtlSeconds: 60 }, () => now);
      const { cookie } = await login(app);
      now = new Date("2026-11-15T03:02:00Z");
      expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(401);
    });

    it("/auth/logout でセッションを消して / へ戻す", async () => {
      const app = await build();
      const { cookie } = await login(app);
      const res = await app.request("/auth/logout", { method: "POST", headers: { cookie } });
      expect(res.status).toBe(302);
      const cleared = res.headers.getSetCookie().join("\n");
      expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    });
  });

  describe("設定のチェック", () => {
    it("セッションの秘密鍵が 32 文字未満なら起動しない", async () => {
      await expect(createOidcAuth({ ...baseOptions, sessionSecret: "short" })).rejects.toThrow();
    });

    it("許可するユーザー(email か sub)の指定がなければ起動しない", async () => {
      await expect(createOidcAuth({ ...baseOptions, allowed: {} })).rejects.toThrow();
    });
  });
});
