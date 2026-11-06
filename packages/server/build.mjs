import { build } from "esbuild";

await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  plugins: [{
    name: "external-dependencies",
    setup(builder) {
      // Compile workspace TypeScript together; keep installed runtime dependencies external.
      builder.onResolve({ filter: /^[^./]/ }, ({ path }) => {
        if (!path.startsWith("@fpm/")) return { path, external: true };
      });
    },
  }],
});
