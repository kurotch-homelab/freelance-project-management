import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createApi } from "@fpm/api";
import { createApp, type AppDeps } from "@fpm/app";
import { createOidcAuth } from "@fpm/auth";
import { createDatabase, createRepository, migrateToLatest } from "@fpm/db";
import { createAdcTokenProvider, createCalendarClient, createDriveClient } from "@fpm/google";
import { createSolidtimeClient } from "@fpm/solidtime";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Config } from "./config.ts";

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

const defaults = {
  createDatabase, migrateToLatest, createRepository, createSolidtimeClient,
  createAdcTokenProvider, createCalendarClient, createDriveClient, createApp, createOidcAuth, createApi,
  clock: { now: () => new Date() } satisfies AppDeps["clock"],
  logger: console as Logger,
};
export type ServerDeps = Partial<typeof defaults>;

const reservedPath = (path: string) => /^\/(?:api|auth)(?:\/|$)/.test(path);

/** Builds the application without listening or scheduling; factories avoid network access in tests. */
export async function buildServer(config: Config, deps: ServerDeps = {}) {
  const d = { ...defaults, ...deps };
  const db = d.createDatabase(config.database);
  try {
    await d.migrateToLatest(db);
    const repo = d.createRepository(db);
    const solidtime = d.createSolidtimeClient({
      baseUrl: config.solidtime.baseUrl,
      organizationId: config.solidtime.organizationId,
      token: config.solidtime.token,
      timeZone: config.timeZone,
      ...(config.solidtime.memberId === null ? {} : { memberId: config.solidtime.memberId }),
    });
    const getAccessToken = d.createAdcTokenProvider([
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/drive",
    ]);
    const calendar = d.createCalendarClient({ getAccessToken, calendarId: config.google.calendarId });
    const drive = d.createDriveClient({ getAccessToken, driveId: config.google.driveId });
    const useCases = d.createApp({
      repo, solidtime, calendar, drive, clock: d.clock,
      config: {
        timeZone: config.timeZone,
        forecastWeeks: config.forecast.weeks,
        forecastMonths: config.forecast.months,
        driveRootFolderId: config.google.driveRootFolderId,
      },
    });
    const auth = await d.createOidcAuth({
      ...config.oidc,
      sessionSecret: config.session.secret,
      sessionTtlSeconds: config.session.ttlSeconds,
      secureCookies: config.session.secureCookies,
      now: () => d.clock.now(),
    });
    const app = new Hono();
    app.onError((_error, c) => {
      d.logger.error("HTTP request failed");
      return c.json({ error: "internal error" }, 500);
    });
    app.route("/auth", auth.routes);
    // createApi already includes the /api prefix and the health/auth ordering.
    app.route("/", d.createApi({ repo, app: useCases, auth: auth.middleware }));
    if (config.staticDir !== null) {
      const root = resolve(config.staticDir);
      // Fail at startup instead of allowing serveStatic to log a configured path.
      if (!(await stat(root)).isDirectory() || !(await stat(join(root, "index.html"))).isFile()) {
        throw new Error("Invalid STATIC_DIR");
      }
      const files = serveStatic({ root });
      const index = serveStatic({ root, path: "index.html" });
      app.use("*", async (c, next) => reservedPath(c.req.path) ? c.notFound() : next(), files, index);
    }
    app.notFound((c) => c.json({ error: "not found" }, 404));

    let closing: Promise<void> | undefined;
    return {
      app,
      async sync() {
        for (const [source, run] of [
          ["solidtime", useCases.syncSolidtime], ["calendar", useCases.syncCalendar],
        ] as const) {
          try {
            const result = await run();
            // Upstream errors may contain credentials; only log the operation name.
            if (!result.ok) d.logger.error(`Sync failed: ${source}`);
          } catch {
            d.logger.error(`Sync failed: ${source}`);
          }
        }
      },
      close: () => closing ??= db.destroy(),
    };
  } catch (error) {
    await db.destroy().catch(() => d.logger.error("Database cleanup failed"));
    throw error;
  }
}
