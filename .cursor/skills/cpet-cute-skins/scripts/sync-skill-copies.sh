#!/usr/bin/env bash
# Mirror this skill into every agent's skills dir.
#
#   <skill>/scripts/sync-skill-copies.sh              # → all default targets below
#   <skill>/scripts/sync-skill-copies.sh /some/dir    # → only that dir
#
# Source of truth is the copy inside the cursor-pet repo (it is version controlled).
# Run this after editing the repo copy so every copy stays byte-identical.
#
# Real copies, not symlinks: some skill scanners list dir entries without following
# symlinks, so a linked skill can go silently undiscovered.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$#" -gt 0 ]; then
  DESTS=("$@")
else
  DESTS=(
    "$HOME/.cursor/skills/cpet-cute-skins" # Cursor, user level
    "$HOME/.agents/skills/cpet-cute-skins" # Claude Code and other agents
    "$HOME/.codex/skills/cpet-cute-skins"  # Codex
  )
fi

status=0
for DEST in "${DESTS[@]}"; do
  parent="$(dirname "$DEST")"
  if [ ! -d "$parent" ]; then
    echo "skip (no $parent): $DEST"
    continue
  fi
  [ -L "$DEST" ] && rm "$DEST"
  if [ "$SRC" = "$(cd "$DEST" 2>/dev/null && pwd || echo '')" ]; then
    echo "skip (same dir as source): $DEST"
    continue
  fi

  mkdir -p "$DEST"
  rsync -a --delete \
    --exclude '.env.local' \
    --exclude '__pycache__/' \
    --exclude '.DS_Store' \
    "$SRC/" "$DEST/"
  chmod +x "$DEST/bin/cpet" "$DEST"/scripts/*.sh 2>/dev/null || true
  if diff -rq "$SRC" "$DEST" --exclude __pycache__ --exclude .DS_Store >/dev/null; then
    echo "synced + verified: $DEST"
  else
    echo "SYNC MISMATCH: $DEST" >&2
    status=1
  fi
done
exit $status
