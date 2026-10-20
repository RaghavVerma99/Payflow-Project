import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/seed.ts", "src/worker-cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  skipNodeModulesBundle: true,
});
