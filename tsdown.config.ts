import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
  },
  outDir: "dist",
  platform: "node",
  format: "esm",
  target: "node20",
  /** With `"type": "module"`, emit `cli.js` instead of `cli.mjs` for the bin path in package.json */
  fixedExtension: false,
  clean: true,
  sourcemap: true,
  dts: false,
});
