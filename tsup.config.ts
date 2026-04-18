import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "engine/index": "src/engine/index.ts",
    },
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    treeshake: true,
  },
  {
    entry: {
      server: "src/server.ts",
      cli: "src/cli.ts",
    },
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    clean: false,
    dts: false,
    treeshake: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
