#!/bin/sh
# Summarises Codex sessions for Herdr's usage panel, as one JSON object:
#   { "limits": {at, primary, secondary, plan} | null,
#     "sessions": [ {file, id, cwd, model, at, usage, last, window} ] }
# Sessions: rollout files changed in the last 24 hours. Limits: the newest
# rate-limit report in the last 8 days.
root="$HOME/.codex/sessions"
[ -d "$root" ] || { echo '{"limits":null,"sessions":[]}'; exit 0; }
sessions=$(find "$root" -name 'rollout-*.jsonl' -mmin -1440 2>/dev/null | while read -r f; do
  meta=$(head -1 "$f" | jq -c '.payload | {id, cwd}' 2>/dev/null) || continue
  model=$(grep '"turn_context"' "$f" | tail -1 | jq -r '.payload.model // empty' 2>/dev/null)
  tok=$(grep '"token_count"' "$f" | grep -v '"info":null' | tail -1)
  [ -n "$tok" ] || continue
  printf '%s' "$tok" | jq -c --argjson meta "$meta" --arg model "$model" --arg file "$f" \
    '$meta + {file: $file, model: $model, at: .timestamp, usage: .payload.info.total_token_usage, last: .payload.info.last_token_usage, window: .payload.info.model_context_window}' 2>/dev/null
done | jq -s -c '.')
newest=""
for f in $(ls -t $(find "$root" -name 'rollout-*.jsonl' -mtime -8 2>/dev/null) 2>/dev/null | head -30); do
  newest=$(grep '"token_count"' "$f" | grep -v '"rate_limits":null' | tail -1)
  [ -n "$newest" ] && break
done
limits=$( [ -n "$newest" ] && printf '%s' "$newest" | jq -c '{at: .timestamp, primary: .payload.rate_limits.primary, secondary: .payload.rate_limits.secondary, plan: .payload.rate_limits.plan_type}' 2>/dev/null || echo null)
printf '{"limits":%s,"sessions":%s}\n' "${limits:-null}" "${sessions:-[]}"
