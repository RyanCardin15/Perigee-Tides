#!/usr/bin/env bash
set -euo pipefail

TO="${CODEX_IMESSAGE_TO:-832-212-1341}"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

if [[ $# -gt 0 ]]; then
  MESSAGE="$*"
else
  MESSAGE="$(cat)"
fi

if [[ -z "${MESSAGE// }" ]]; then
  echo "Usage: scripts/codex-imessage.sh [--dry-run] \"message text\"" >&2
  exit 2
fi

if [[ "$DRY_RUN" == "1" ]]; then
  printf 'Codex iMessage dry run to %s:\n%s\n' "$TO" "$MESSAGE"
  exit 0
fi

osascript - "$TO" "$MESSAGE" <<'APPLESCRIPT'
on run argv
  set targetPhone to item 1 of argv
  set targetMessage to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetPhone of targetService
    send targetMessage to targetBuddy
  end tell
end run
APPLESCRIPT
