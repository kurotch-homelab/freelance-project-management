import { ConfigError, loadConfig } from "./config.ts";
import { startServer } from "./runtime.ts";

try {
  await startServer(loadConfig(process.env));
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : "Server startup failed");
  process.exitCode = 1;
}
