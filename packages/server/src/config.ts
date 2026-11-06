import type { DatabaseOptions } from "@fpm/db";
import type { OidcAuthOptions } from "@fpm/auth";

export interface Config {
  readonly port: number;
  readonly timeZone: string;
  readonly forecast: { readonly weeks: number; readonly months: number };
  readonly syncIntervalMinutes: number;
  readonly database: Exclude<DatabaseOptions, { kind: "pglite" }>;
  readonly solidtime: {
    readonly baseUrl: string;
    readonly organizationId: string;
    readonly token: string;
    readonly memberId: string | null;
  };
  readonly google: { readonly calendarId: string; readonly driveId: string; readonly driveRootFolderId: string };
  readonly oidc: Pick<OidcAuthOptions, "issuer" | "clientId" | "clientAuth" | "redirectUri" | "allowed">;
  readonly session: { readonly secret: string; readonly ttlSeconds: number; readonly secureCookies: boolean };
  readonly staticDir: string | null;
}

export class ConfigError extends Error {
  constructor(keys: Iterable<string>) {
    // Never retain the environment, invalid values, or parsing exceptions.
    super(`Invalid configuration: ${[...new Set(keys)].join(", ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const errors = new Set<string>();
  const optional = (key: string): string | undefined => {
    const value = env[key];
    return value?.trim() ? value : undefined;
  };
  const required = (key: string): string => {
    const value = optional(key);
    if (value === undefined) errors.add(key);
    return value ?? "";
  };
  const integer = (key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!raw.trim() || !Number.isSafeInteger(value) || value < 1 || value > max) errors.add(key);
    return value;
  };
  const url = (key: string): string => {
    const value = required(key);
    try {
      const parsed = new URL(value);
      // Check delimiters too: empty query/fragment/userinfo are still forbidden.
      const authority = value.trim().replace(/[\t\n\r]/g, "").match(/^[^:]+:[/\\]*([^/\\?#]*)/)?.[1];
      if (!["http:", "https:"].includes(parsed.protocol)
        || parsed.username || parsed.password || authority?.includes("@") || /[?#]/.test(parsed.href)) errors.add(key);
    } catch { errors.add(key); }
    return value;
  };

  const port = integer("PORT", 3000, 65_535);
  const timeZone = env.TIME_ZONE ?? "Asia/Tokyo";
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { errors.add("TIME_ZONE"); }
  const forecast = { weeks: integer("FORECAST_WEEKS", 8, 52), months: integer("FORECAST_MONTHS", 3, 24) };
  // Node timers clamp delays above a signed 32-bit integer to 1 ms.
  const syncIntervalMinutes = integer("SYNC_INTERVAL_MINUTES", 1_440, Math.floor(2_147_483_647 / 60_000));
  const dbKind = required("DB_KIND");
  let database: Config["database"] = { kind: "sqlite", filename: "" };
  if (dbKind === "sqlite") database = { kind: "sqlite", filename: required("SQLITE_PATH") };
  else if (dbKind === "postgres") database = { kind: "postgres", connectionString: required("DATABASE_URL") };
  else errors.add("DB_KIND");

  const solidtime = {
    baseUrl: url("SOLIDTIME_BASE_URL"),
    organizationId: required("SOLIDTIME_ORGANIZATION_ID"),
    token: required("SOLIDTIME_API_TOKEN"),
    memberId: optional("SOLIDTIME_MEMBER_ID") ?? null,
  };
  const google = {
    calendarId: required("GOOGLE_CALENDAR_ID"),
    driveId: required("GOOGLE_DRIVE_ID"),
    driveRootFolderId: required("GOOGLE_DRIVE_ROOT_FOLDER_ID"),
  };
  const clientSecret = optional("OIDC_CLIENT_SECRET");
  const assertionFile = optional("OIDC_CLIENT_ASSERTION_FILE");
  if ((clientSecret === undefined) === (assertionFile === undefined)) {
    errors.add("OIDC_CLIENT_SECRET");
    errors.add("OIDC_CLIENT_ASSERTION_FILE");
  }
  const email = optional("ALLOWED_EMAIL");
  const sub = optional("ALLOWED_SUB");
  if (email === undefined && sub === undefined) {
    errors.add("ALLOWED_EMAIL");
    errors.add("ALLOWED_SUB");
  }
  const oidc: Config["oidc"] = {
    issuer: url("OIDC_ISSUER"),
    clientId: required("OIDC_CLIENT_ID"),
    clientAuth: clientSecret !== undefined
      ? { kind: "secret", clientSecret }
      : { kind: "federated", assertionFile: assertionFile ?? "" },
    redirectUri: url("OIDC_REDIRECT_URI"),
    allowed: { ...(email === undefined ? {} : { email }), ...(sub === undefined ? {} : { sub }) },
  };
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) errors.add("SESSION_SECRET");
  const ttlSeconds = integer("SESSION_TTL_SECONDS", 43_200, 400 * 24 * 60 * 60);
  const secure = env.SECURE_COOKIES ?? "true";
  if (secure !== "true" && secure !== "false") errors.add("SECURE_COOKIES");

  if (errors.size > 0) throw new ConfigError(errors);
  return {
    port, timeZone, forecast, syncIntervalMinutes, database, solidtime, google, oidc,
    session: { secret, ttlSeconds, secureCookies: secure === "true" },
    staticDir: optional("STATIC_DIR") ?? null,
  };
}
