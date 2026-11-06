import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { Config } from "./config.ts";
import { startScheduler } from "./scheduler.ts";
import { buildServer, type ServerDeps } from "./server.ts";

function closeHttp(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

export async function startServer(config: Config, deps: ServerDeps = {}) {
  const logger = deps.logger ?? console;
  const built = await buildServer(config, deps);
  let server: Server | undefined;
  try {
    server = createServer(getRequestListener(built.app.fetch, {
      overrideGlobalObjects: false,
      errorHandler: () => {
        logger.error("HTTP adapter failed");
        return new Response("Internal Server Error", { status: 500 });
      },
    }));
    server.listen(config.port);
    await once(server, "listening");
  } catch (error) {
    if (server?.listening) await closeHttp(server);
    await built.close();
    throw error;
  }
  const httpServer = server;

  const stopScheduler = startScheduler({
    intervalMinutes: config.syncIntervalMinutes,
    run: built.sync,
    onError: () => logger.error("Scheduled sync failed"),
  });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    const drained = stopScheduler();
    stopping = (async () => {
      try {
        // Close HTTP and finish in-flight syncs before destroying their database.
        const results = await Promise.allSettled([closeHttp(httpServer), drained]);
        await built.close();
        if (results.some((result) => result.status === "rejected")) throw new Error("Shutdown failed");
      } finally {
        process.off("SIGTERM", onSignal);
        process.off("SIGINT", onSignal);
      }
    })();
    return stopping;
  };
  const onSignal = () => {
    void stop().catch(() => {
      logger.error("Shutdown failed");
      process.exitCode = 1;
    });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  server.on("error", () => {
    logger.error("HTTP server failed");
    process.exitCode = 1;
    onSignal();
  });
  logger.info("Server listening");
  return { app: built.app, server, stop };
}
