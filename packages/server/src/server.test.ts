import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createApp } from "@fpm/app";
import { createOidcAuth } from "@fpm/auth";
import { createDatabase, createRepository, migrateToLatest } from "@fpm/db";
import { createDriveClient } from "@fpm/google";
import { createSolidtimeClient } from "@fpm/solidtime";
import { Hono } from "hono";
import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";
import { startServer } from "./runtime.ts";
import { buildServer, type ServerDeps } from "./server.ts";

const env = {
  DB_KIND: "sqlite", SQLITE_PATH: ":memory:",
  SOLIDTIME_BASE_URL: "https://solidtime.test", SOLIDTIME_ORGANIZATION_ID: "org",
  SOLIDTIME_API_TOKEN: "private-solidtime-token",
  GOOGLE_CALENDAR_ID: "calendar", GOOGLE_DRIVE_ID: "drive", GOOGLE_DRIVE_ROOT_FOLDER_ID: "root",
  OIDC_ISSUER: "https://idp.test", OIDC_CLIENT_ID: "fpm", OIDC_CLIENT_SECRET: "private-oidc-secret",
  OIDC_REDIRECT_URI: "https://app.test/auth/callback", ALLOWED_SUB: "owner",
  SESSION_SECRET: "private-session-secret".repeat(2),
};
const config = loadConfig(env);
const INDEX = "<!doctype html><html><body>FPM test app</body></html>";

// Exercise real auth/session middleware with only discovery served by a fake IdP.
const network = setupServer(http.get(`${env.OIDC_ISSUER}/.well-known/openid-configuration`, () =>
  HttpResponse.json({
    issuer: env.OIDC_ISSUER,
    authorization_endpoint: `${env.OIDC_ISSUER}/authorize`,
    token_endpoint: `${env.OIDC_ISSUER}/token`,
    jwks_uri: `${env.OIDC_ISSUER}/jwks`,
    response_types_supported: ["code"], subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"],
  }),
));
beforeAll(() => network.listen({ onUnhandledRequest: "error" }));
afterAll(() => network.close());

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  network.resetHandlers();
  vi.restoreAllMocks();
});

function dependencies() {
  const getAccessToken = vi.fn(async () => "test-access-token");
  const listTimeEntriesWithRates = vi.fn(async () => []);
  const listOutOfOffice = vi.fn(async () => []);
  return {
    createDatabase: vi.fn(createDatabase),
    migrateToLatest: vi.fn(migrateToLatest),
    createRepository: vi.fn(createRepository),
    createSolidtimeClient: vi.fn((options: Parameters<typeof createSolidtimeClient>[0]) => ({
      ...createSolidtimeClient(options), listTimeEntriesWithRates,
      listClients: vi.fn(async () => []), listProjectsWithRates: vi.fn(async () => []),
    })),
    createAdcTokenProvider: vi.fn(() => getAccessToken),
    createCalendarClient: vi.fn(() => ({ listOutOfOffice })),
    createDriveClient: vi.fn(createDriveClient),
    createApp: vi.fn(createApp),
    createOidcAuth: vi.fn(createOidcAuth),
    clock: { now: () => new Date("2026-11-06T12:00:00Z") },
    logger: { info: vi.fn(), error: vi.fn() },
  } satisfies ServerDeps;
}

async function build(options: { staticDir?: string; deps?: ServerDeps } = {}) {
  const built = await buildServer({ ...config, staticDir: options.staticDir ?? null }, options.deps ?? dependencies());
  cleanups.push(built.close);
  return built;
}

async function staticDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "fpm-server-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await mkdir(join(directory, "api"));
  await mkdir(join(directory, "auth"));
  await Promise.all([
    writeFile(join(directory, "index.html"), INDEX),
    writeFile(join(directory, "assets", "app.js"), "console.log('FPM');"),
    writeFile(join(directory, "api", "unknown"), INDEX),
    writeFile(join(directory, "auth", "unknown"), INDEX),
  ]);
  return directory;
}

describe("buildServer", () => {
  it("/api/health is public and /api/clients requires a session", async () => {
    const { app } = await build();
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });
    const clients = await app.request("/api/clients");
    expect(clients.status).toBe(401);
    await expect(clients.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("mounts OIDC routes under /auth", async () => {
    const { app } = await build();
    const response = await app.request("/auth/login");
    expect(response.status).toBe(302);
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.origin).toBe(env.OIDC_ISSUER);
    expect(redirect.pathname).toBe("/authorize");
    expect(redirect.searchParams.get("redirect_uri")).toBe(env.OIDC_REDIRECT_URI);
  });

  it.each([false, true])("serves assets and SPA routes (relative STATIC_DIR: %s)", async (relativePath) => {
    const directory = await staticDirectory();
    const { app } = await build({ staticDir: relativePath ? relative(process.cwd(), directory) : directory });
    for (const path of ["/", "/projects/example", "/unknown?query=1", "/apiary", "/authors"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      await expect(response.text()).resolves.toBe(INDEX);
    }
    const asset = await app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    await expect(asset.text()).resolves.toBe("console.log('FPM');");
    const head = await app.request("/unknown", { method: "HEAD" });
    expect(head.status).toBe(200);
    await expect(head.text()).resolves.toBe("");
    expect((await app.request("/unknown", { method: "POST" })).status).toBe(404);
  });

  it("never serves static files or index.html for /api and /auth", async () => {
    const directory = await staticDirectory();
    for (const authenticated of [false, true]) {
      const deps = dependencies();
      if (authenticated) deps.createOidcAuth.mockImplementation(async () => ({
        routes: new Hono(), middleware: async (_c, next) => next(),
      }));
      const { app } = await build({ staticDir: directory, deps });
      for (const path of ["/api", "/api/unknown", "/auth", "/auth/unknown"]) {
        const response = await app.request(path);
        expect([401, 404]).toContain(response.status);
        expect(await response.text()).not.toContain(INDEX);
      }
      expect((await app.request("/api/unknown")).status).toBe(authenticated ? 404 : 401);
    }
  });

  it("returns 404 without STATIC_DIR", async () => {
    const { app } = await build();
    expect((await app.request("/")).status).toBe(404);
  });

  it("wires package options, migrates SQLite, and runs both syncs in order", async () => {
    const deps = dependencies();
    const built = await build({ deps });
    expect(deps.createDatabase).toHaveBeenCalledWith(config.database);
    expect(deps.migrateToLatest).toHaveBeenCalledOnce();
    expect(deps.createSolidtimeClient).toHaveBeenCalledWith({
      ...config.solidtime, timeZone: config.timeZone,
    });
    const tokenProvider = deps.createAdcTokenProvider.mock.results[0]!.value;
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(deps.createAdcTokenProvider).toHaveBeenCalledWith([
      "https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/drive",
    ]);
    expect(deps.createCalendarClient).toHaveBeenCalledWith({ getAccessToken: tokenProvider, calendarId: "calendar" });
    expect(deps.createDriveClient).toHaveBeenCalledWith({ getAccessToken: tokenProvider, driveId: "drive" });
    expect(deps.createApp.mock.calls[0]![0].config).toEqual({
      timeZone: "Asia/Tokyo", forecastWeeks: 8, forecastMonths: 3, driveRootFolderId: "root",
    });
    expect(deps.createOidcAuth).toHaveBeenCalledWith(expect.objectContaining({
      ...config.oidc, sessionSecret: config.session.secret,
      sessionTtlSeconds: 43_200, secureCookies: true,
    }));
    await built.sync();
    const repo = deps.createRepository.mock.results[0]!.value;
    expect(await repo.getSyncStatus("solidtime")).toEqual({ lastSuccessAt: deps.clock.now().toISOString(), lastFailure: null });
    expect(await repo.getSyncStatus("calendar")).toEqual({ lastSuccessAt: deps.clock.now().toISOString(), lastFailure: null });
    const solidtime = deps.createSolidtimeClient.mock.results[0]!.value;
    const calendar = deps.createCalendarClient.mock.results[0]!.value;
    expect(solidtime.listClients.mock.invocationCallOrder[0]).toBeLessThan(solidtime.listTimeEntriesWithRates.mock.invocationCallOrder[0]!);
    expect(solidtime.listTimeEntriesWithRates.mock.invocationCallOrder[0]).toBeLessThan(solidtime.listProjectsWithRates.mock.invocationCallOrder[0]!);
    expect(solidtime.listProjectsWithRates.mock.invocationCallOrder[0]).toBeLessThan(calendar.listOutOfOffice.mock.invocationCallOrder[0]!);
  });

  it("logs failed syncs without secrets and continues with calendar", async () => {
    const deps = dependencies();
    const built = await build({ deps });
    const useCases = deps.createApp.mock.results[0]!.value;
    vi.spyOn(useCases, "syncSolidtime").mockResolvedValue({ ok: false, error: env.SOLIDTIME_API_TOKEN });
    const calendar = vi.spyOn(useCases, "syncCalendar").mockRejectedValue(new Error(env.OIDC_CLIENT_SECRET));
    await built.sync();
    expect(calendar).toHaveBeenCalledOnce();
    expect(deps.logger.error.mock.calls).toEqual([["Sync failed: solidtime"], ["Sync failed: calendar"]]);
  });

  it("destroys the database if discovery fails", async () => {
    const deps = dependencies();
    const db = createDatabase(config.database);
    const destroy = vi.spyOn(db, "destroy");
    deps.createDatabase.mockReturnValue(db);
    deps.createOidcAuth.mockRejectedValue(new Error(env.OIDC_CLIENT_SECRET));
    await expect(buildServer(config, deps)).rejects.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
    expect(deps.logger.error).not.toHaveBeenCalled();
  });

  it("destroys the database if migration fails", async () => {
    const deps = dependencies();
    const db = createDatabase(config.database);
    const destroy = vi.spyOn(db, "destroy");
    deps.createDatabase.mockReturnValue(db);
    deps.migrateToLatest.mockRejectedValue(new Error("migration failed"));
    await expect(buildServer(config, deps)).rejects.toThrow("migration failed");
    expect(destroy).toHaveBeenCalledOnce();
    expect(deps.createOidcAuth).not.toHaveBeenCalled();
  });
});

describe("server lifecycle", () => {
  it("listens, stops accepting requests, waits for sync, then destroys the DB once", async () => {
    const deps = dependencies();
    const db = createDatabase(config.database);
    const destroy = vi.spyOn(db, "destroy");
    deps.createDatabase.mockReturnValue(db);
    const signalCounts = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    let release = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    deps.createApp.mockImplementation((options) => ({
      ...createApp(options),
      syncSolidtime: async () => { await pending; return { ok: true, unlinked: [] }; },
    }));
    const running = await startServer({ ...config, port: 0 }, deps);
    cleanups.push(running.stop);
    // Always release the job if an assertion fails so cleanup cannot hang.
    cleanups.push(async () => release());
    expect(running.server.listening).toBe(true);
    const stopping = running.stop();
    expect(running.stop()).toBe(stopping);
    expect(running.server.listening).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
    release();
    await stopping;
    expect(destroy).toHaveBeenCalledOnce();
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(signalCounts);
  });

  it.each(["SIGTERM", "SIGINT"] as const)("closes on %s", async (signal) => {
    const running = await startServer({ ...config, port: 0 }, dependencies());
    cleanups.push(running.stop);
    process.emit(signal, signal);
    await running.stop();
    expect(running.server.listening).toBe(false);
  });

  it("destroys the database when the port is already in use", async () => {
    const first = await startServer({ ...config, port: 0 }, dependencies());
    cleanups.push(first.stop);
    const address = first.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP port");
    const deps = dependencies();
    const db = createDatabase(config.database);
    const destroy = vi.spyOn(db, "destroy");
    deps.createDatabase.mockReturnValue(db);
    await expect(startServer({ ...config, port: address.port }, deps)).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe("additional configuration boundaries", () => {
  it.each([
    ["PORT", "0"], ["PORT", "-1"], ["PORT", "1.5"], ["PORT", ""],
    ["FORECAST_WEEKS", "NaN"], ["FORECAST_MONTHS", "Infinity"],
    ["FORECAST_WEEKS", "9007199254740992"], ["SYNC_INTERVAL_MINUTES", "0"],
    ["SYNC_INTERVAL_MINUTES", "35792"], ["SESSION_TTL_SECONDS", "0"],
    ["SESSION_TTL_SECONDS", "34560001"], ["SECURE_COOKIES", "TRUE"],
    ["OIDC_ISSUER", "secret-invalid-url"], ["OIDC_REDIRECT_URI", "secret-invalid-url"],
    ["SQLITE_PATH", " "],
  ])("rejects %s without disclosing its value", (key, value) => {
    try {
      loadConfig({ ...env, [key]: value });
      throw new Error("Expected ConfigError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toBe(`Invalid configuration: ${key}`);
    }
  });

  it("collects every missing unconditional field, including both alternatives", () => {
    expect(() => loadConfig({})).toThrow(new ConfigError([
      "DB_KIND", "SOLIDTIME_BASE_URL", "SOLIDTIME_ORGANIZATION_ID", "SOLIDTIME_API_TOKEN",
      "GOOGLE_CALENDAR_ID", "GOOGLE_DRIVE_ID", "GOOGLE_DRIVE_ROOT_FOLDER_ID",
      "OIDC_CLIENT_SECRET", "OIDC_CLIENT_ASSERTION_FILE", "ALLOWED_EMAIL", "ALLOWED_SUB",
      "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_REDIRECT_URI", "SESSION_SECRET",
    ]));
  });

  it("requires DATABASE_URL only for postgres", () => {
    expect(() => loadConfig({ ...env, DB_KIND: "postgres" })).toThrow("DATABASE_URL");
    expect(loadConfig({ ...env, DB_KIND: "postgres", DATABASE_URL: "postgres://db/fpm", SQLITE_PATH: undefined }).database)
      .toEqual({ kind: "postgres", connectionString: "postgres://db/fpm" });
  });
});

describe("レビューを受けて足した振る舞い", () => {
  it("見つからないアセット(拡張子つき、/assets 配下)は index.html ではなく 404", async () => {
    const { app } = await build({ staticDir: await staticDirectory() });
    for (const path of ["/assets/missing.js", "/favicon.ico", "/assets/nested/x"]) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });

  it("エンコードした区切りで /api や /auth を装うパスにも index.html を返さない", async () => {
    const { app } = await build({ staticDir: await staticDirectory() });
    for (const path of ["/api%2Fclients", "/auth%2Flogin"]) {
      const response = await app.request(path);
      expect(response.headers.get("content-type") ?? "", path).not.toContain("text/html");
    }
  });

  it("どの応答にも nosniff と frame-ancestors 'none' を付ける", async () => {
    const { app } = await build({ staticDir: await staticDirectory() });
    for (const path of ["/", "/assets/app.js", "/api/health", "/api/clients", "/auth/login"]) {
      const response = await app.request(path);
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(response.headers.get("content-security-policy") ?? "", path).toContain("frame-ancestors 'none'");
    }
  });

  it("/api と /auth の応答はキャッシュさせない", async () => {
    const { app } = await build();
    for (const path of ["/api/health", "/api/clients", "/auth/login"]) {
      expect((await app.request(path)).headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("/readyz は DB に問い合わせ、使えれば 200、閉じたあとは 503(認証なし)", async () => {
    const built = await build();
    const ready = await built.app.request("/readyz");
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ ok: true });
    await built.close();
    expect((await built.app.request("/readyz")).status).toBe(503);
  });

  it("クライアントが切断した処理中のリクエストも、終わるのを待ってから DB を閉じる", async () => {
    const deps = dependencies();
    const db = createDatabase(config.database);
    const destroy = vi.spyOn(db, "destroy");
    deps.createDatabase.mockReturnValue(db);
    let release = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let started = () => {};
    const handlerStarted = new Promise<void>((resolve) => { started = resolve; });
    const finished = vi.fn();
    const slow = new Hono();
    slow.post("/api/slow", async (c) => {
      started();
      await pending;
      finished();
      return c.json({ ok: true });
    });
    const running = await startServer({ ...config, port: 0 }, { ...deps, createApi: (() => slow) as never });
    cleanups.push(running.stop);
    cleanups.push(async () => release());
    const address = running.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP port");
    // 偽の IdP(MSW)はローカルのサーバーへのリクエストを止めるので、ここだけ素通しにする
    network.use(http.post(`http://127.0.0.1:${address.port}/api/slow`, () => passthrough()));
    const abort = new AbortController();
    const request = fetch(`http://127.0.0.1:${address.port}/api/slow`, { method: "POST", signal: abort.signal }).catch(() => null);
    await handlerStarted;
    abort.abort();
    await request;
    const stopping = running.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(destroy).not.toHaveBeenCalled();
    release();
    await stopping;
    expect(finished).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
