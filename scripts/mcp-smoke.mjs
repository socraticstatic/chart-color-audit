// Speaks MCP over stdio to a command and checks the audit tools answer.
// Usage: node scripts/mcp-smoke.mjs node dist/cli.js mcp
import { spawn } from "node:child_process";
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
let buf = ""; const waiters = new Map();
child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } });
let id = 0;
const send = (method, params) => new Promise((res, rej) => { const n = ++id; waiters.set(n, res); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); setTimeout(() => rej(new Error("timeout " + method)), 15000); });
try {
  const init = await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = await send("tools/list", {});
  const call = await send("tools/call", { name: "audit_palette", arguments: { colors: ["#2456A4", "#B03A2E"], background: "#fff" } });
  const bad = await send("tools/call", { name: "audit_palette", arguments: { colors: ["transparent"], background: "#fff" } });
  const verdict = JSON.parse(call.result.content[0].text).verdict, badVerdict = JSON.parse(bad.result.content[0].text).verdict;
  console.log("server", init.result.serverInfo.name, init.result.serverInfo.version, "| tools", tools.result.tools.map((t) => t.name).join(","), "| verdicts", verdict, badVerdict);
  if (verdict !== "pass" || badVerdict !== "fail" || tools.result.tools.length !== 2) process.exitCode = 1;
} catch (e) { console.error("FAILED", e.message); process.exitCode = 1; }
child.kill();
