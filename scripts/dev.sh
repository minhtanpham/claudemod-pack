#!/usr/bin/env bash
# Development helpers for the mods in this pack. None of them calls a model.
#
#   scripts/dev.sh link        load every mod under plugins/ in every session
#   scripts/dev.sh unlink      undo that
#   scripts/dev.sh status      show whether the pack is linked
#   scripts/dev.sh test [mod]  run the tests of one mod, or of all
#   scripts/dev.sh watch <mod> rerun a mod's tests each time a file changes
#   scripts/dev.sh check [mod] tests, type-check and validate
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS="$ROOT/plugins"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

mods() {
  if [ -n "${1:-}" ]; then
    [ -d "$PLUGINS/$1" ] || { echo "No mod named $1 under plugins/." >&2; exit 1; }
    echo "$1"
  else
    for dir in "$PLUGINS"/*/; do basename "$dir"; done
  fi
}

# Adds or removes plugins/ in the `env` block of the user settings, which is
# where a session the Desktop app starts reads CLAUDE_CODE_PLUGIN_DIRS from.
settings() {
  python3 - "$1" "$SETTINGS" "$PLUGINS" <<'PY'
import json, os, shutil, sys

action, path, plugins = sys.argv[1:4]
data = {}
if os.path.exists(path):
    with open(path) as file:
        data = json.load(file)
env = data.get("env") or {}
dirs = [one for one in env.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(os.pathsep) if one]

if action == "status":
    linked = plugins in dirs
    print(f"{'Linked' if linked else 'Not linked'}: {plugins}")
    print(f"Settings file: {path}")
    sys.exit(0)

if action == "link" and plugins not in dirs:
    dirs.append(plugins)
if action == "unlink":
    dirs = [one for one in dirs if one != plugins]

if dirs:
    env["CLAUDE_CODE_PLUGIN_DIRS"] = os.pathsep.join(dirs)
    env["CLAUDE_CODE_PLUGIN_DIR_WATCH"] = "1"
else:
    env.pop("CLAUDE_CODE_PLUGIN_DIRS", None)
    env.pop("CLAUDE_CODE_PLUGIN_DIR_WATCH", None)
if env:
    data["env"] = env
else:
    data.pop("env", None)

if os.path.exists(path):
    shutil.copy(path, path + ".before-dev-link")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as file:
    json.dump(data, file, indent=2)
    file.write("\n")
print(f"{'Linked' if action == 'link' else 'Unlinked'}: {plugins}")
print("Sessions started from now on pick this up; open a new one.")
PY
}

run_tests() {
  for mod in $(mods "${1:-}"); do
    echo "── $mod"
    (cd "$PLUGINS/$mod" && claude plugin test)
  done
}

stamp() {
  find "$1" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' \) \
    -not -path '*/.claude-plugin/types/*' -exec stat -f '%m %N' {} + 2>/dev/null |
    sort | cksum
}

case "${1:-}" in
  link | unlink | status) settings "$1" ;;
  test) run_tests "${2:-}" ;;
  watch)
    mod="$(mods "${2:?Usage: scripts/dev.sh watch <mod>}")"
    last=""
    while true; do
      now="$(stamp "$PLUGINS/$mod")"
      if [ "$now" != "$last" ]; then
        last="$now"
        clear
        (cd "$PLUGINS/$mod" && claude plugin test) || true
        echo "Watching plugins/$mod; Ctrl+C stops."
      fi
      sleep 1
    done
    ;;
  check)
    for mod in $(mods "${2:-}"); do
      echo "── $mod"
      (cd "$PLUGINS/$mod" && claude plugin test)
      if [ -f "$PLUGINS/$mod/tsconfig.json" ]; then
        npx -y -p typescript tsc -p "$PLUGINS/$mod"
      fi
      claude plugin validate "$PLUGINS/$mod" | grep -E 'Validation|error' || true
    done
    ;;
  *)
    sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
