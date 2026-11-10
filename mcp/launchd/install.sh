#!/bin/sh
# Install two macOS LaunchAgents for OpenOutlier (current user only, no sudo):
#   dev.openoutlier.bridge  – always-on bridge: the extension's data → ~/.openoutlier/openoutlier.db
#   dev.openoutlier.backup  – daily 03:30 (and at login if missed): backup → OPENOUTLIER_BACKUP_REMOTE
#                             (host:/path over SSH; unset = local copies only)
# Replaces the former dev.reelscope.* agents if they are installed.
# Uninstall with: sh mcp/launchd/uninstall.sh
set -eu
MCP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NODE:-$(command -v node)}"
AGENTS="$HOME/Library/LaunchAgents"
# Same data folder the server picks: OPENOUTLIER_HOME, else ~/.openoutlier, else a not-yet-moved ~/.reelscope.
DATA="${OPENOUTLIER_HOME:-${REELSCOPE_HOME:-}}"
if [ -z "$DATA" ]; then
  if [ ! -d "$HOME/.openoutlier" ] && [ -d "$HOME/.reelscope" ]; then DATA="$HOME/.reelscope"; else DATA="$HOME/.openoutlier"; fi
fi
LOGS="$DATA/logs"
# Backup target: $OPENOUTLIER_BACKUP_REMOTE (or the former $REELSCOPE_BACKUP_REMOTE), else the one an
# earlier install saved (new or former agent), else none.
# (PlistBuddy prints "File Doesn't Exist…" on stdout for a missing file, so check first.)
saved() { [ -f "$HOME/Library/LaunchAgents/$1.plist" ] || return 0; /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$2" "$HOME/Library/LaunchAgents/$1.plist" 2>/dev/null || true; }
REMOTE="${OPENOUTLIER_BACKUP_REMOTE:-${REELSCOPE_BACKUP_REMOTE:-}}"
[ -n "$REMOTE" ] || REMOTE="$(saved dev.openoutlier.backup OPENOUTLIER_BACKUP_REMOTE)"
[ -n "$REMOTE" ] || REMOTE="$(saved dev.reelscope.backup REELSCOPE_BACKUP_REMOTE)"
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
    <key>OPENOUTLIER_BACKUP_REMOTE</key><string>$REMOTE</string>
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
  # bootout returns before the job is gone; bootstrapping too early fails with "5: Input/output error".
  i=0; while launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$1.plist"
  echo "installed $1"
}

# Retire the former agents first so two bridges never run at once.
for old in dev.reelscope.bridge dev.reelscope.backup; do
  if [ -f "$AGENTS/$old.plist" ]; then
    launchctl bootout "gui/$(id -u)/$old" 2>/dev/null || true
    rm -f "$AGENTS/$old.plist"
    echo "removed former $old"
  fi
done

write_plist dev.openoutlier.bridge bridge-daemon.mjs "  <key>KeepAlive</key><true/>"
write_plist dev.openoutlier.backup backup.mjs "  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>"
echo "logs: $LOGS"
[ -n "$REMOTE" ] && echo "backups upload to: $REMOTE" || echo "no OPENOUTLIER_BACKUP_REMOTE set: backups stay in $DATA/backups"
