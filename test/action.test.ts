import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { audit } from "../src/engine/audit.js";
// @ts-expect-error plain ESM script shipped with the GitHub Action, no types
import { annotations, markdown, outputs, escapeCommand, escapeCell } from "../action/summary.mjs";

const TABLEAU10 = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
  "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
];
// The summary reads the CLI's --json output, so round-trip through JSON.
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("GitHub Action summary", () => {
  it("writes one error annotation per finding", () => {
    const r = roundTrip(audit({ colors: TABLEAU10, background: "#fff" }));
    const lines: string[] = annotations(r);
    expect(lines).toHaveLength(r.failures.length);
    for (const l of lines) expect(l.startsWith("::error title=chart-color-audit::")).toBe(true);
  });

  it("a passing palette has no annotations and says pass", () => {
    const r = roundTrip(audit({ colors: ["#2456A4", "#B03A2E"], background: "#fff" }));
    expect(annotations(r)).toEqual([]);
    expect(markdown(r)).toContain("### Chart color audit: pass");
    expect(outputs(r)).toEqual(["verdict=pass", "findings=0"]);
  });

  it("a failing palette names the pair, the hexes and the count", () => {
    const r = roundTrip(audit({ colors: TABLEAU10, background: "#fff" }));
    const md: string = markdown(r);
    expect(md).toContain("### Chart color audit: fail");
    expect(md).toContain("| deutan | 0.7 | 3 (`#e15759`) and 5 (`#59a14f`) | 2 | FAIL |");
    expect(md).toContain("| 6 | `#edc948` | 1.61:1 | 3:1 |");
    expect(outputs(r)).toEqual(["verdict=fail", `findings=${r.failures.length}`]);
  });

  it("a single color has no pair and does not print Infinity or null", () => {
    const md: string = markdown(roundTrip(audit({ colors: ["#000"], background: "#fff" })));
    expect(md).toContain("| normal | n/a | n/a | 2 | pass |");
    expect(md).not.toMatch(/Infinity|null|undefined/);
  });

  it("escapes workflow commands and table cells", () => {
    expect(escapeCommand("50% off\nnext")).toBe("50%25 off%0Anext");
    expect(escapeCell("a|b\nc")).toBe("a\\|b c");
  });
});

describe("action.yml stays in step with the package", () => {
  it("defaults to the package version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const yml = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
    const m = /\n {2}version:\n(?: {4}.*\n)*? {4}default: "([^"]+)"/.exec(yml);
    expect(m?.[1]).toBe(pkg.version);
  });
});
