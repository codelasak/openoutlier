#!/bin/sh
# Install two macOS LaunchAgents for OpenOutlier (current user only, no sudo):
#   dev.reelscope.bridge  – always-on bridge: the extension's data → ~/.reelscope/reelscope.db
#   dev.reelscope.backup  – daily 03:30 (and at login if missed): backup → REELSCOPE_BACKUP_REMOTE
#                           (host:/path over SSH; unset = local copies only)
# Uninstall with: sh mcp/launchd/uninstall.sh
set -eu
MCP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-$(command -v node)}"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/.reelscope/logs"
# Backup target: $REELSCOPE_BACKUP_REMOTE, else the one an earlier install saved, else none.
REMOTE="${REELSCOPE_BACKUP_REMOTE:-$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:REELSCOPE_BACKUP_REMOTE' "$HOME/Library/LaunchAgents/dev.reelscope.backup.plist" 2>/dev/null || true)}"
[ -x "$NODE" ] || { echo "node not found; set NODE=/path/to/node" >&2; exit 1; }
"$NODE" -e "require('node:sqlite')" 2>/dev/null || { echo "Node with node:sqlite needed (22.13+); $NODE is $("$NODE" --version)" >&2; exit 1; }
mkdir -p "$AGENTS" "$LOGS"
PATHS="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:$(dirname "$NODE")"

write_plist() { # label script extra-xml
  cat > "$AGENTS/$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$MCP_DIR/$2</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATHS</string>
    <key>REELSCOPE_BACKUP_REMOTE</key><string>$REMOTE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/$1.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$1.log</string>
$3
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$1.plist"
  echo "installed $1"
}

write_plist dev.reelscope.bridge bridge-daemon.mjs "  <key>KeepAlive</key><true/>"
write_plist dev.reelscope.backup backup.mjs "  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>"
echo "logs: $LOGS"
[ -n "$REMOTE" ] && echo "backups upload to: $REMOTE" || echo "no REELSCOPE_BACKUP_REMOTE set: backups stay in ~/.reelscope/backups"
