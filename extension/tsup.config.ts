import { defineConfig } from "tsup";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  format: ["cjs"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  external: ["vscode"],
  sourcemap: true,
  clean: true,
  dts: false,
  treeshake: true,
  noExternal: ["prompt-compressor"],
});
