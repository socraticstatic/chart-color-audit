# Changelog

## Unreleased

Each of these made the audit give a wrong answer, or fail, on ordinary input.

### Fixed

- **Transparency was ignored.** `transparent` and `rgba(0,0,0,0.1)` on white
  were measured as solid black, 21:1, and passed. A translucent color is now
  composited over the background before any check, which is how it renders.
  `colors[].hex` is the composited color and `colors[].alpha` carries the
  input's opacity. A translucent background is an error.
- **The last CSS declaration in a block was dropped when it had no
  semicolon**, so a valid `--bg:#fff}` reported "--bg not found".
  `!important` is stripped from values.
- **Aliases were not followed.** CSS `var(--other)`, `var(--other, fallback)`
  and `hsl(var(--other))` now resolve, through chains, with a clear error for
  an undeclared variable or a cycle. Design-token aliases (`"{path.to.token}"`)
  resolve the same way.
- **Design-token colors in the object form were skipped silently.**
  `{ colorSpace, components, alpha, hex }` is now read for every color space
  in the Design Tokens format.
- **`--colors` split on every comma**, breaking `rgb(255, 0, 0)`. Commas
  inside a color function are left alone.
- **Floors were not validated.** A floor that is not a number of 0 or more,
  or an unknown floor name, is now an error.
- Config and token paths are resolved with `node:path`, so Windows paths work.
- A flag given without its value (`--colors` with nothing after it) is an
  error.

### Changed

- **An unknown key in `chartaudit.config.json` is an error.** A typo in an
  optional key used to drop its check without a word. Keys starting with `$`
  (`$schema`) are allowed.
- A selector other than `:root` is read on top of `:root`, as the cascade
  applies it, so a `.dark` block that overrides a few variables works.
- `ColorRecord` has a new `alpha` field.

### Added

- `perVision[].failingPairs`: every pair under the floor, closest first. The
  failure line and the CLI list them, so one run shows the whole repair. The
  number of findings is unchanged.
- `compositeOver`, `resolveCssValue`, `tokenColorToCss` and `splitColors` are
  exported.

## 0.2.6

- Contrast is measured on the reported hex for wide-gamut and out-of-range
  colors (#1, reported by trackoor, credit https://ucsbplse.github.io/).
- GitHub Action: `uses: socraticstatic/chart-color-audit@v0.2.6`.
- The release workflow can be run by hand from `main`.
