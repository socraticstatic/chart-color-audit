# chart-color-audit

Accessibility audit for chart color palettes. Answers one question with math:
**can everyone still tell your data series apart?**

Plenty of tools check text contrast. This one checks the thing dashboards
actually break: whether your palette survives colorblindness. It simulates
deuteranopia, protanopia, and tritanopia with the published
[Machado, Oliveira & Fernandes 2009](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)
matrices (applied in linear RGB, as the paper specifies), measures pairwise
perceptual separation in OKLab, checks
[WCAG 2.2 SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
non-text contrast against your background — and fails your build when a
change quietly breaks any of it.

One engine, four faces: **typed API · CLI · CI gate · MCP server**.

## Ten seconds

```bash
npx chart-color-audit --colors "#4E79A7,#F28E2B,#E15759,#76B7B2,#59A14F,#EDC948,#B07AA1,#FF9DA7,#9C755F,#BAB0AC" --bg "#fff"
```

That's Tableau 10 — one of the most-shipped chart palettes on earth — on a
white dashboard:

```
  vision          min ΔE   closest pair   reading
  · normal           8.4   4 ↔ 10       distinguishable
  ✗ deutan           0.7   3 ↔ 5        COLLISION
  ✗ protan           0.9   4 ↔ 10       COLLISION
  · tritan           5.2   7 ↔ 9        distinguishable
  ✗ achromatopsia    1.6   2 ↔ 4        COLLISION

  contrast vs background: worst 1.61:1 (slot 6, needs ≥ 3:1)
  ...
  FAIL — 8 findings
```

Its red and green sit ΔE 0.66 apart under deuteranopia simulation —
indistinguishable. Roughly 1 in 12 men has red-green color vision
deficiency; for most of them, series 3 and series 5 on that chart are the
same color. Nothing in code review catches this. Math does.

## The four faces

### API

```ts
import { audit } from "chart-color-audit";

const result = audit({
  colors: ["#4E79A7", "#F28E2B", "#E15759"],
  background: "#ffffff",
});

result.verdict;      // "pass" | "fail"
result.failures;     // human-readable reasons, empty on pass
result.perVision;    // per-simulation: minDeltaE, closestPair, band
// bands: "clearly-distinct" | "distinguishable"
//      | "patterns-carry-identity" | "collision"
```

Fully typed, two data dependencies ([culori](https://culorijs.org/) for color
math, the MCP SDK for the server face), no DOM, no network.

### CLI

Any CSS color syntax works — hex, `hsl()`, `rgb()`, named, `oklch()`, and raw
shadcn-style triples (`"222 47% 6%"`).

```bash
npx chart-color-audit --colors "#2456A4,#B03A2E" --bg "#fff"          # audit
npx chart-color-audit --colors "..." --bg "#fff" --json               # machines
npx chart-color-audit --colors "..." --bg "#fff" --mode strict        # tougher floors
```

### CI gate

Point a `chartaudit.config.json` at the tokens you already have — CSS custom
properties or W3C design-tokens JSON:

```json
{
  "tokens": "src/index.css",
  "categorical": ["--chart-cat-1", "--chart-cat-2", "--chart-cat-3"],
  "background": "--chart-bg",
  "semantic": { "positive": "--chart-positive", "muted": "--chart-muted" },
  "mode": "perceptual"
}
```

```yaml
# .github/workflows/chart-colors.yml
on: [push, pull_request]
jobs:
  chart-colors:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx chart-color-audit
```

Exit 1 with named findings when a token edit breaks a floor. Semantic roles
are also checked for collisions against the palette — the classic silent
failure where a "positive" green KPI becomes a data series for deutan viewers.

### MCP server

Let an agent audit colors mid-conversation:

```bash
claude mcp add chart-color-audit -- npx chart-color-audit mcp
```

Two tools: `audit_palette` (paste colors) and `audit_tokens` (point at a
config). Ask Claude "is this palette colorblind-safe on white?" and it can
answer with measurements instead of vibes.

## Floors

| mode | fails when | for |
|---|---|---|
| `perceptual` (default) | any pair lands below ΔE 2 — the edge of human perception — under any simulation, or contrast < 3:1 | palettes where color alone carries identity |
| `redundant-encodings` | outright collision only (ΔE < 1 normal / < 0.1 CVD) | design systems pairing every color with a dash/decal/shape channel |
| `strict` | below ΔE 10 normal / ΔE 4 CVD | when it must survive a projector and a hallway glance |

Changing default floors is a **major version**, always — a CI gate that
tightens defaults in a patch release breaks builds and trust.

## Honest scope

Tokens in, findings out. This audits declared palette colors — it does not
render charts, screenshot pixels, or crawl pages. Contrast checkers for
text exist in plenty; what this adds is the part I couldn't find anywhere
else: CVD-simulated *series separation*, as a build gate and an MCP tool.

## Where this came from

The engine was extracted from a chart color system whose own history proves
the point: an "accuracy fix" commit once replaced the correct deuteranopia
matrix with confident, plausible, fabricated values — and review passed it.
Only a pinned regression test would have caught it, so this package pins the
matrices against the published paper in its test suite, permanently.

**The full story: [docs/POSTMORTEM.md](docs/POSTMORTEM.md)** — nine weeks of
a wrong matrix, the AI-co-authored commit that forged it, and why the math
now checks the math.

## Consulting

I audit dashboards and design systems for exactly these failures —
30 years of UX practice, and the math above to prove findings instead of
argue them. **micah@conscious-shell.com**.

MIT © [Micah Boswell](https://conscious-shell.com)
