/**
 * MCP face — the same engine as a Model Context Protocol server over stdio,
 * so any agent (Claude Code, Claude Desktop, anything MCP-capable) can audit
 * palettes mid-conversation.
 *
 *   claude mcp add chart-color-audit -- npx chart-color-audit mcp
 *
 * Two tools, deliberately no more:
 *   audit_palette — hex/CSS color list + background → findings
 *   audit_tokens  — chartaudit.config.json path → findings
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { audit } from "./engine/audit.js";
import { loadConfig } from "./config.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "chart-color-audit",
    version: "0.1.0",
  });

  server.registerTool(
    "audit_palette",
    {
      title: "Audit a chart color palette",
      description:
        "Audit chart colors for accessibility: pairwise OKLab ΔE separation under " +
        "normal vision, deuteranopia, protanopia, tritanopia (published Machado 2009 " +
        "matrices) and grayscale, plus WCAG 2.2 SC 1.4.11 non-text contrast (≥3:1) " +
        "against the background. Returns per-vision findings with human-word bands " +
        "and a pass/fail verdict with reasons.",
      inputSchema: {
        colors: z
          .array(z.string())
          .min(1)
          .describe("Palette colors in slot order — any CSS color syntax (#hex, hsl(), rgb(), named)."),
        background: z.string().describe("Background color the chart marks render on."),
        mode: z
          .enum(["perceptual", "redundant-encodings", "strict"])
          .optional()
          .describe(
            "Floors preset. perceptual (default) fails what an eye can't tell apart (ΔE<2); " +
              "redundant-encodings for palettes paired with dash/decal/shape channels; " +
              "strict demands clear separation."
          ),
      },
    },
    ({ colors, background, mode }) => {
      const result = audit({ colors, background, mode });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "audit_tokens",
    {
      title: "Audit chart tokens from a config file",
      description:
        "Run the same audit against a chartaudit.config.json on disk — the config " +
        "names a CSS or design-tokens file plus which tokens are the categorical " +
        "palette, background, and semantic roles.",
      inputSchema: {
        config_path: z
          .string()
          .describe("Absolute or cwd-relative path to chartaudit.config.json."),
      },
    },
    ({ config_path }) => {
      const resolved = loadConfig(config_path);
      const result = audit({
        colors: resolved.colors,
        background: resolved.background,
        semanticRoles: resolved.semanticRoles,
        mode: resolved.mode,
        floors: resolved.floors,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  await server.connect(new StdioServerTransport());
}
