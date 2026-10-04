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
import pkg from "../package.json" with { type: "json" };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The server without a transport, so tests can connect in-process. */
export function buildMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "chart-color-audit",
      version: pkg.version,
    },
    {
      instructions:
        "chart-color-audit answers one question with math: can everyone still tell the data series apart? " +
        "Use audit_palette when the user has chart colors in hand (any CSS syntax) and a background; it returns " +
        "pairwise OKLab ΔE separation under normal vision, deuteranopia, protanopia, tritanopia and grayscale " +
        "(Machado 2009 matrices), WCAG 2.2 non-text contrast against the background, and a pass/fail verdict with reasons. " +
        "Use audit_tokens when the palette lives in a CSS or design-tokens file named by a chartaudit.config.json on disk. " +
        "Report the numbers, not vibes: ΔE below 2 is indistinguishable for that viewer, contrast below 3:1 fails SC 1.4.11. " +
        "This tool audits; it does not generate palettes.",
    }
  );

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
      annotations: READ_ONLY,
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
      annotations: READ_ONLY,
    },
    ({ config_path }) => {
      const resolved = loadConfig(config_path);
      const result = audit({
        colors: resolved.colors,
        background: resolved.background,
        semanticRoles: resolved.semanticRoles,
        textRoles: resolved.textRoles,
        mode: resolved.mode,
        floors: resolved.floors,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  await buildMcpServer().connect(new StdioServerTransport());
}
