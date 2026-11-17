#!/usr/bin/env bash
# Runs the audit for the GitHub Action: the human report goes to the log, the
# JSON result feeds the annotations, the job summary and the outputs.
set -uo pipefail

if [ -n "${INPUT_CLI:-}" ]; then
  read -r -a CLI <<< "$INPUT_CLI"
else
  CLI=(npx --yes "chart-color-audit@${INPUT_VERSION}")
fi

ARGS=()
if [ -n "${INPUT_COLORS:-}" ]; then
  ARGS+=(--colors "$INPUT_COLORS" --bg "${INPUT_BACKGROUND:-}")
else
  ARGS+=(--config "${INPUT_CONFIG:-chartaudit.config.json}")
fi
if [ -n "${INPUT_MODE:-}" ]; then
  ARGS+=(--mode "$INPUT_MODE")
fi

RESULT="${RUNNER_TEMP:-/tmp}/chart-color-audit-result.json"

"${CLI[@]}" "${ARGS[@]}"
code=$?
# 0 pass, 1 findings, anything else is a usage or input error already printed.
if [ "$code" -ne 0 ] && [ "$code" -ne 1 ]; then
  exit "$code"
fi

"${CLI[@]}" "${ARGS[@]}" --json > "$RESULT"
node "$GITHUB_ACTION_PATH/action/summary.mjs" "$RESULT" || exit 2

if [ "$code" -eq 1 ] && [ "${INPUT_FAIL:-true}" = "false" ]; then
  echo "Findings reported. fail-on-findings is false, so the job continues."
  exit 0
fi
exit "$code"
