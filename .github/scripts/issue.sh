#!/usr/bin/env bash
# Keeps one open issue per title: creates or updates it with the body file, or closes it
# when the body file is empty (the problem is gone).
#
#   .github/scripts/issue.sh <title> <body file> [label]
#
# Needs GH_TOKEN with issues: write and GH_REPO.
set -euo pipefail
title="$1"
body_file="$2"
label="${3:-maintenance}"
gh label create "$label" --color c5def5 --description "Opened by the repository's own automation" 2>/dev/null || true
# Titles come from the workflows themselves (no quotes in them).
number="$(TITLE="$title" gh issue list --state open --label "$label" --limit 200 --json number,title \
  --jq '[.[] | select(.title == env.TITLE)][0].number // empty')"
if [ -s "$body_file" ]; then
  if [ -n "$number" ]; then
    gh issue edit "$number" --body-file "$body_file"
    echo "Updated issue #$number."
  else
    gh issue create --title "$title" --body-file "$body_file" --label "$label"
  fi
elif [ -n "$number" ]; then
  gh issue close "$number" --comment "Resolved: the latest run found nothing to report."
  echo "Closed issue #$number."
else
  echo "Nothing to report."
fi
