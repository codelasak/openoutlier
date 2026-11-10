#!/bin/sh
# Remove the OpenOutlier LaunchAgents (and the former dev.reelscope.* ones). Your data in ~/.openoutlier stays.
for l in dev.openoutlier.bridge dev.openoutlier.backup dev.reelscope.bridge dev.reelscope.backup; do
  [ -f "$HOME/Library/LaunchAgents/$l.plist" ] || launchctl print "gui/$(id -u)/$l" >/dev/null 2>&1 || continue
  launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$l.plist"
  echo "removed $l"
done
