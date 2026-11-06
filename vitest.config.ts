import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests use explicit fakes and must not load local service credentials.
  envDir: false,
  test: { include: ["packages/*/src/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.{ts,tsx}"] },
});
