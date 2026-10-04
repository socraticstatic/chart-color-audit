// The MCP face, exercised in-process. The registry card and the server an
// agent connects to must tell the same story: same version, instructions that
// say what the tools are for, two read-only tools.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp.js";

const card = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));

async function connect() {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

describe("MCP server", () => {
  it("reports the card's version and tells agents what it is for", async () => {
    const client = await connect();
    expect(client.getServerVersion()?.version).toBe(card.version);
    expect(client.getInstructions()).toMatch(/colorblind|palette/i);
    expect(client.getInstructions()).toMatch(/audit_palette/);
  });

  it("exposes exactly two read-only tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["audit_palette", "audit_tokens"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
  });

  it("audits a palette and returns the engine's verdict", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "audit_palette", arguments: { colors: ["#4E79A7", "#F28E2B", "#E15759"], background: "#fff" } });
    const [first] = r.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(first?.text ?? "{}");
    expect(parsed.verdict).toBe("fail"); // the orange is 2.42:1 on white, below 3:1
    expect(parsed.failures.length).toBeGreaterThan(0);
  });
});

describe("server.json registry card", () => {
  it("carries a title and a website within the registry's limits", () => {
    expect(card.title.length).toBeGreaterThan(0);
    expect(card.title.length).toBeLessThanOrEqual(100);
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.websiteUrl).toMatch(/^https:\/\//);
  });
});
