import { defineConfig } from "tsup";

export default defineConfig([
  // The typed API. culori stays an ordinary dependency.
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: { entry: { index: "src/index.ts" } },
    splitting: false,
    sourcemap: false,
    clean: true,
  },
  // The CLI and the MCP server. The MCP SDK and zod are devDependencies, so
  // tsup bundles them into these files: installing the package then pulls
  // culori alone, not the SDK's HTTP stack that a stdio server never loads.
  // The CLI needs a shebang; tsup preserves it from the source file.
  {
    entry: { cli: "src/cli.ts", mcp: "src/mcp.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    // Split, so an ordinary audit does not load the MCP server's code.
    splitting: true,
    sourcemap: false,
    clean: false,
    // scripts/third-party-licenses.mjs reads this to list what was bundled.
    metafile: true,
    // Bundled CommonJS dependencies call require(); ESM output has none.
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
    },
  },
]);
