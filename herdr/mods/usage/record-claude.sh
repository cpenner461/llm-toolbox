#!/bin/sh
# Saves Claude Code's statusline JSON, one file per session, for Herdr's usage
# panel (mods/usage). Call it from the statusline command with the JSON on stdin.
# Adds `terminal` (the Herdr terminal it runs in, if any) and `at` (when).
dir="$HOME/.cache/herdr-usage/claude"
input=$(cat)
id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$id" ] || exit 0
mkdir -p "$dir"
printf '%s' "$input" | jq -c --arg t "${HC_TERMINAL_ID:-}" --argjson now "$(date +%s)" '. + {terminal: $t, at: $now}' \
  > "$dir/$id.json.tmp" 2>/dev/null && mv "$dir/$id.json.tmp" "$dir/$id.json"
# Drop sessions untouched for 8 days.
find "$dir" -name '*.json' -mtime +8 -delete 2>/dev/null
exit 0
