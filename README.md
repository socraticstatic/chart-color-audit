# chart-color-audit

Accessibility audit for chart color palettes. Answers one question with math:
**can everyone still tell your data series apart?**

Plenty of tools check text contrast. This one checks the thing dashboards
actually break: whether your palette survives colorblindness. It simulates
deuteranopia, protanopia, and tritanopia with the published
[Machado, Oliveira & Fernandes 2009](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)
matrices, measures pairwise separation in OKLab, checks
[WCAG 2.2](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
contrast against your background, and fails your build when a change quietly
breaks any of it.

## Quick start

Nothing to install:

```bash
npx chart-color-audit --colors "#4E79A7,#F28E2B,#E15759" --bg "#fff"
```

```
chart-color-audit · 3 colors on #ffffff · mode: perceptual

  vision          min ΔE   closest pair   reading
  · normal          14.6   2 ↔ 3        clearly distinct
  · deutan          11.9   2 ↔ 3        clearly distinct
  · protan          11.9   1 ↔ 3        clearly distinct
  · tritan          10.3   2 ↔ 3        clearly distinct
  · achromatopsia    5.2   1 ↔ 3        distinguishable

  contrast vs background: worst 2.42:1 (slot 2, needs ≥ 3:1)
  ✗ slot 2 #f28e2b — 2.42:1

  FAIL — 1 finding:
    · contrast: slot 2 (#f28e2b) is 2.42:1 vs. background (needs ≥ 3:1, WCAG 2.2 SC 1.4.11).
```

Those three colors separate cleanly under every colorblind simulation. The
orange still fails: 2.42:1 against white, below the 3:1 floor for chart
marks. Pale bars on white is one of the oldest dashboard sins, and this is
it, caught in numbers.

**Exit codes: `0` pass, `1` fail, `2` bad input.** That is the whole CI
contract.

## Reading the output

ΔE is perceptual color distance (OKLab × 100). About 2 is the edge of what
a human eye can tell apart.

| reading | min ΔE | meaning |
|---|---|---|
| clearly distinct | ≥ 10 | survives a projector and a hallway glance |
| distinguishable | ≥ 2 | a careful reader separates the series |
| patterns carry identity | < 2 | color alone is not enough; dash/shape must carry it |
| COLLISION | ≈ 0–1 | two series are the same color for these viewers |

`closest pair` names the two slots (1-based) that came nearest. Fix those
two, re-run, repeat.

## CLI

```bash
npx chart-color-audit --colors <list> --bg <color> [options]
npx chart-color-audit [--config chartaudit.config.json]
npx chart-color-audit mcp
```

| flag | what it does |
|---|---|
| `--colors <list>` | comma-separated palette, any CSS color syntax: hex, `hsl()`, `rgb()`, `oklch()`, named, raw triples (`"222 47% 6%"`) |
| `--bg <color>` | background the marks render on |
| `--mode <mode>` | `perceptual` (default) · `redundant-encodings` · `strict` (see Floors) |
| `--config <path>` | config file, default `./chartaudit.config.json` |
| `--json` | full result as JSON: `verdict`, `failures[]`, `perVision[]`, `contrast[]`, `semantic[]`, `text[]` |
| `--version`, `--help` | the usual |

## CI: fail the build when a color change breaks accessibility

**1.** Put `chartaudit.config.json` next to your tokens:

```jsonc
{
  // Where your tokens live: a .css file (custom properties) or a
  // W3C design-tokens .json file. Optional; you can also write
  // literal colors directly in the fields below.
  "tokens": "src/index.css",

  // CSS selector whose block holds the variables. Optional, default ":root".
  "selector": ":root",

  // REQUIRED. Your data-series colors, in slot order.
  // Each entry is a literal ("#4E79A7"), a CSS variable name from the
  // tokens file ("--chart-cat-1"), or a dotted path into design-tokens
  // JSON ("chart.categorical.1").
  "categorical": ["--chart-cat-1", "--chart-cat-2", "--chart-cat-3"],

  // REQUIRED. The background your marks render on.
  "background": "--chart-bg",

  // Optional. Status colors, checked at 3:1 vs the background AND for
  // collisions against the palette: the classic silent failure where a
  // "positive" green KPI reads as data series 3 for deutan viewers.
  "semantic": { "positive": "--chart-positive", "muted": "--chart-muted" },

  // Optional. Tokens rendered as UI text (status labels, captions, table
  // numbers). Text needs 4.5:1 (SC 1.4.3), not the 3:1 mark floor.
  // Reusing mark tokens as text is the most common failure I have shipped:
  // one measured sweep found 111 instances of it in a single app.
  "text": { "positive": "--chart-positive-text" },

  // Optional. Floors preset, and per-floor overrides on top of it.
  "mode": "perceptual",
  "floors": { "minContrast": 3, "minTextContrast": 4.5 }
}
```

**2.** Add the workflow:

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

Done. A token edit that breaks a floor now exits 1 with named findings,
in the PR, before anyone screenshots anything.

Prefer a pinned dependency? `npm i -D chart-color-audit` and call it from a
package script. Same behavior.

## The famous-palette test

```bash
npx chart-color-audit --colors "#4E79A7,#F28E2B,#E15759,#76B7B2,#59A14F,#EDC948,#B07AA1,#FF9DA7,#9C755F,#BAB0AC" --bg "#fff"
```

That is Tableau 10, one of the most-shipped chart palettes on earth, on a
white dashboard:

```
  ✗ deutan           0.7   3 ↔ 5        COLLISION
  ✗ protan           0.9   4 ↔ 10       COLLISION
  ✗ achromatopsia    1.6   2 ↔ 4        COLLISION
  ...
  FAIL — 8 findings
```

Its red and green sit ΔE 0.7 apart under deuteranopia simulation.
Roughly 1 in 12 men has red-green color vision deficiency; for most of
them, series 3 and series 5 on that chart are the same color. Nothing in
code review catches this. Math does.

## API

```ts
import { audit } from "chart-color-audit";

const result = audit({
  colors: ["#4E79A7", "#F28E2B", "#E15759"],
  background: "#ffffff",
  // optional: semanticRoles, textRoles, mode, floors
});

result.verdict;   // "pass" | "fail"
result.failures;  // human-readable reasons, empty on pass
result.perVision; // per simulation: minDeltaE, closestPair, band
```

Fully typed. Two data dependencies ([culori](https://culorijs.org/) for
color math, the MCP SDK for the server). No DOM, no network.

## MCP server

Let an agent audit colors mid-conversation:

```bash
claude mcp add chart-color-audit -- npx chart-color-audit mcp
```

Two tools: `audit_palette` (paste colors) and `audit_tokens` (point at a
config). Ask "is this palette colorblind-safe on white?" and the answer
comes back with measurements instead of vibes.

## Floors

| mode | fails when | for |
|---|---|---|
| `perceptual` (default) | any pair lands below ΔE 2, the edge of human perception, under any simulation; or contrast < 3:1 | palettes where color alone carries identity |
| `redundant-encodings` | outright collision only (ΔE < 1 normal / < 0.1 CVD) | design systems pairing every color with a dash/decal/shape channel |
| `strict` | below ΔE 10 normal / ΔE 4 CVD | control rooms, projectors, hallway glances |

Text tokens are checked at 4.5:1 in every mode. Changing default floors is
a **major version**, always: a CI gate that tightens defaults in a patch
release breaks builds and trust.

## Honest scope

Tokens in, findings out. This audits declared palette colors. It does not
render charts, screenshot pixels, or crawl pages. Contrast checkers for
text exist in plenty; what this adds is the part I could not find anywhere
else: CVD-simulated *series separation*, as a build gate and an MCP tool.

## Where this came from

The engine was extracted from a
[chart color system](https://socraticstatic.github.io/Visualizations/)
whose own history proves the point: an "accuracy fix" commit once replaced
the correct deuteranopia matrix with confident, plausible, fabricated
values, and review passed it. Only a pinned regression test would have
caught it, so this package pins the matrices against the published paper in
its test suite, permanently.

**The full story: [docs/POSTMORTEM.md](docs/POSTMORTEM.md)**: nine weeks
of a wrong matrix, the AI-co-authored commit that forged it, and why the
math now checks the math.

## Consulting

I audit dashboards and design systems for exactly these failures.
30 years of UX practice, and the math above to prove findings instead of
arguing them. **micah@conscious-shell.com**

MIT © [Micah Boswell](https://conscious-shell.com)
