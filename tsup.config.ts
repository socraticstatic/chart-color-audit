import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
    mcp: "src/mcp.ts",
  },
  format: ["esm", "cjs"],
  dts: { entry: { index: "src/index.ts" } },
  splitting: false,
  sourcemap: false,
  clean: true,
  // The CLI needs a shebang; tsup preserves it from the source file.
});
