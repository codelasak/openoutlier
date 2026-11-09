#!/bin/sh
# Remove the OpenOutlier LaunchAgents. Your data in ~/.reelscope stays.
for l in dev.reelscope.bridge dev.reelscope.backup; do
  launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$l.plist"
  echo "removed $l"
done
