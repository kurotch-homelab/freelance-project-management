import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";
import { startScheduler } from "./scheduler.ts";

const SECRET = "x".repeat(32);

/** 必須の項目がそろった環境変数(client secret の方式・SQLite) */
const base: Record<string, string> = {
  SOLIDTIME_BASE_URL: "https://solidtime.example.com",
  SOLIDTIME_ORGANIZATION_ID: "org-1",
  SOLIDTIME_API_TOKEN: "st-token-value",
  GOOGLE_CALENDAR_ID: "me@example.com",
  GOOGLE_DRIVE_ID: "shared-drive-1",
  GOOGLE_DRIVE_ROOT_FOLDER_ID: "root-folder",
  OIDC_ISSUER: "https://idp.example.com",
  OIDC_CLIENT_ID: "fpm",
  OIDC_CLIENT_SECRET: "oidc-secret-value",
  OIDC_REDIRECT_URI: "https://fpm.example.com/auth/callback",
  ALLOWED_EMAIL: "me@example.com",
  SESSION_SECRET: SECRET,
  DB_KIND: "sqlite",
  SQLITE_PATH: "/data/fpm.sqlite",
};

describe("loadConfig: 環境変数から設定を読む", () => {
  it("必須の項目と既定値", () => {
    expect(loadConfig(base)).toEqual({
      port: 3000,
      timeZone: "Asia/Tokyo",
      forecast: { weeks: 8, months: 3 },
      syncIntervalMinutes: 1_440,
      database: { kind: "sqlite", filename: "/data/fpm.sqlite" },
      solidtime: {
        baseUrl: "https://solidtime.example.com",
        organizationId: "org-1",
        token: "st-token-value",
      },
      google: { calendarId: "me@example.com", driveId: "shared-drive-1", driveRootFolderId: "root-folder" },
      oidc: {
        issuer: "https://idp.example.com",
        clientId: "fpm",
        clientAuth: { kind: "secret", clientSecret: "oidc-secret-value" },
        redirectUri: "https://fpm.example.com/auth/callback",
        allowed: { email: "me@example.com" },
      },
      session: { secret: SECRET, ttlSeconds: 43_200, secureCookies: true },
      staticDir: null,
    });
  });

  it("PostgreSQL は DATABASE_URL", () => {
    const env = { ...base, DB_KIND: "postgres", DATABASE_URL: "postgres://u:p@db/fpm" };
    delete (env as Record<string, string | undefined>).SQLITE_PATH;
    expect(loadConfig(env).database).toEqual({ kind: "postgres", connectionString: "postgres://u:p@db/fpm" });
  });

  it("OIDC_CLIENT_ASSERTION_FILE なら WIF の方式(Kubernetes の ServiceAccount トークン)", () => {
    const env: Record<string, string | undefined> = { ...base, OIDC_CLIENT_ASSERTION_FILE: "/var/run/secrets/tokens/oidc" };
    delete env.OIDC_CLIENT_SECRET;
    expect(loadConfig(env).oidc.clientAuth).toEqual({ kind: "federated", assertionFile: "/var/run/secrets/tokens/oidc" });
  });

  it("client secret と assertion ファイルの両方があれば、どちらを使うか分からないのでエラー", () => {
    expect(() => loadConfig({ ...base, OIDC_CLIENT_ASSERTION_FILE: "/x" })).toThrow(ConfigError);
  });

  it("任意の項目を上書きできる", () => {
    const c = loadConfig({
      ...base,
      PORT: "8080",
      TIME_ZONE: "UTC",
      FORECAST_WEEKS: "12",
      FORECAST_MONTHS: "6",
      SYNC_INTERVAL_MINUTES: "60",
      SESSION_TTL_SECONDS: "3600",
      SECURE_COOKIES: "false",
      ALLOWED_SUB: "user-1",
      STATIC_DIR: "/app/web",
    });
    expect(c).toMatchObject({
      port: 8080,
      timeZone: "UTC",
      forecast: { weeks: 12, months: 6 },
      syncIntervalMinutes: 60,
      session: { ttlSeconds: 3_600, secureCookies: false },
      oidc: { allowed: { email: "me@example.com", sub: "user-1" } },
      staticDir: "/app/web",
    });
  });

  it("足りない必須の項目は、名前を全部まとめて知らせる", () => {
    const error = (() => {
      try {
        loadConfig({});
      } catch (e) {
        return e;
      }
    })() as ConfigError;
    expect(error).toBeInstanceOf(ConfigError);
    for (const key of ["SOLIDTIME_BASE_URL", "SOLIDTIME_API_TOKEN", "OIDC_ISSUER", "SESSION_SECRET", "DB_KIND"]) {
      expect(error.message).toContain(key);
    }
  });

  it("ALLOWED_EMAIL も ALLOWED_SUB もなければエラー", () => {
    const env: Record<string, string | undefined> = { ...base };
    delete env.ALLOWED_EMAIL;
    expect(() => loadConfig(env)).toThrow(/ALLOWED_EMAIL|ALLOWED_SUB/);
  });

  it.each([
    ["PORT", "abc"],
    ["PORT", "70000"],
    ["FORECAST_WEEKS", "0"],
    ["FORECAST_MONTHS", "1.5"],
    ["SECURE_COOKIES", "yes"],
    ["DB_KIND", "mysql"],
    ["TIME_ZONE", "Mars/Olympus"],
    ["SOLIDTIME_BASE_URL", "not a url"],
  ])("%s=%s は不正としてエラー", (key, value) => {
    expect(() => loadConfig({ ...base, [key]: value })).toThrow(ConfigError);
  });

  it("SESSION_SECRET が 32 文字未満ならエラー", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(ConfigError);
  });

  it("エラーのメッセージに秘密の値を出さない", () => {
    try {
      loadConfig({ ...base, SESSION_SECRET: "short-secret-value", PORT: "abc" });
    } catch (e) {
      const message = String((e as Error).message);
      expect(message).not.toContain("short-secret-value");
      expect(message).not.toContain("st-token-value");
      expect(message).not.toContain("oidc-secret-value");
      return;
    }
    throw new Error("expected loadConfig to throw");
  });
});

describe("startScheduler: 定期的に同期する", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("起動してすぐに 1 回、そのあと間隔ごとに実行する", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const stop = startScheduler({ intervalMinutes: 60, run });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("実行が失敗しても止まらない", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const stop = startScheduler({ intervalMinutes: 1, run, onError });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });

  it("前の実行が終わっていなければ、次は飛ばす", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const stop = startScheduler({ intervalMinutes: 1, run });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("loadConfig: レビューを受けて足した検証", () => {
  it.each([
    ["SOLIDTIME_BASE_URL", "ftp://solidtime.example.com"],
    ["SOLIDTIME_BASE_URL", "https://solidtime.example.com/#fragment"],
    ["SOLIDTIME_BASE_URL", "https://solidtime.example.com/?q=1"],
    ["SOLIDTIME_BASE_URL", "https://user:pass@solidtime.example.com"],
    ["OIDC_ISSUER", "ftp://idp.example.com"],
    ["OIDC_REDIRECT_URI", "https://fpm.example.com/auth/callback#x"],
  ])("%s=%s は使えない URL としてエラー(値はメッセージに出さない)", (key, value) => {
    expect(() => loadConfig({ ...base, [key]: value })).toThrow(ConfigError);
    try {
      loadConfig({ ...base, [key]: value });
    } catch (e) {
      expect((e as Error).message).toContain(key);
      expect((e as Error).message).not.toContain(value);
    }
  });

  it("パスつきのベース URL は使える(サブパスに置いた solidtime)", () => {
    expect(loadConfig({ ...base, SOLIDTIME_BASE_URL: "https://example.com/solidtime" }).solidtime.baseUrl).toBe(
      "https://example.com/solidtime",
    );
  });

  it.each([
    ["FORECAST_WEEKS", "52", true],
    ["FORECAST_WEEKS", "53", false],
    ["FORECAST_MONTHS", "24", true],
    ["FORECAST_MONTHS", "25", false],
  ])("%s=%s の上限(使えるなら %s)", (key, value, ok) => {
    const load = () => loadConfig({ ...base, [key]: value });
    if (ok) expect(load).not.toThrow();
    else expect(load).toThrow(ConfigError);
  });
});
