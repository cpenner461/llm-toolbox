#!/usr/bin/env bash
# Run the Codex reviewer read-only against WORKDIR/packet.md.
#
#   codex-review.sh [--deep] WORKDIR
#
# --deep uses CODEX_REVIEW_DEEP_MODEL and CODEX_REVIEW_DEEP_EXTRA_CONFIG from config.env.
#
# Exit 0: findings written to WORKDIR/codex-findings.json.
# Exit 3: skipped (disabled, not installed, or not logged in); a one-line reason is printed.
# Other:  Codex failed or timed out; see WORKDIR/codex.log.
set -uo pipefail

skill_dir=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=../config.env
source "$skill_dir/config.env"

if [[ "${1:-}" == --deep ]]; then
  shift
  CODEX_REVIEW_MODEL=${CODEX_REVIEW_DEEP_MODEL:-$CODEX_REVIEW_MODEL}
  CODEX_REVIEW_EXTRA_CONFIG=${CODEX_REVIEW_DEEP_EXTRA_CONFIG:-$CODEX_REVIEW_EXTRA_CONFIG}
fi

wd=${1:?usage: codex-review.sh [--deep] WORKDIR}
[[ -s "$wd/packet.md" ]] || { echo "error: $wd/packet.md missing; run scope.sh packet first" >&2; exit 1; }
repo=$(cd "$wd" && git rev-parse --show-toplevel)

if [[ "${CODEX_REVIEW_ENABLED:-1}" != 1 ]]; then
  echo "codex reviewer skipped: disabled in config.env"; exit 3
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "codex reviewer skipped: codex CLI not installed"; exit 3
fi
if ! codex login status >/dev/null 2>&1; then
  echo "codex reviewer skipped: codex CLI not logged in (run 'codex login')"; exit 3
fi

prompt="$wd/codex-prompt.md"
{ cat "$wd/packet.md"; echo; cat "$skill_dir/codex-focus.md"; } > "$prompt"

args=(exec --sandbox read-only --color never -C "$repo"
      --output-schema "$skill_dir/findings.schema.json"
      -o "$wd/codex-findings.json")
[[ "${CODEX_REVIEW_EPHEMERAL:-0}" == 1 ]] && args+=(--ephemeral)
[[ -n "${CODEX_REVIEW_MODEL:-}" ]] && args+=(-m "$CODEX_REVIEW_MODEL")
for kv in ${CODEX_REVIEW_EXTRA_CONFIG:-}; do args+=(-c "$kv"); done

codex "${args[@]}" - < "$prompt" > "$wd/codex.log" 2>&1 &
pid=$!
( sleep "${CODEX_REVIEW_TIMEOUT:-900}"; kill "$pid" 2>/dev/null ) &
watchdog=$!
wait "$pid"; rc=$?
kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null

if [[ $rc -ne 0 ]]; then
  echo "codex reviewer failed (exit $rc; 143 means it hit the ${CODEX_REVIEW_TIMEOUT:-900}s timeout); see $wd/codex.log"
  exit "$rc"
fi
if [[ ! -s "$wd/codex-findings.json" ]]; then
  echo "codex reviewer produced no findings file; see $wd/codex.log"; exit 1
fi
echo "$wd/codex-findings.json"
