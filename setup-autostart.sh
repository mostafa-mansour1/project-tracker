#!/bin/bash
# Sets up project-tracker to run automatically at login.
# Safe to run multiple times — it will reload everything cleanly.
# Usage: bash setup-autostart.sh

set -e

PLIST="$HOME/Library/LaunchAgents/com.mostafa.project-tracker.plist"
PORT_DAEMON="/Library/LaunchDaemons/com.mostafa.tasks-portforward.plist"
PF_ANCHOR="/etc/pf.anchors/tasks"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔧 Setting up project-tracker..."

# ── 0. Find node & npm exact paths ──────────────────────────────────────────
NPM_PATH=$(which npm 2>/dev/null)
NODE_PATH=$(which node 2>/dev/null)
if [ -z "$NPM_PATH" ] || [ -z "$NODE_PATH" ]; then
    echo "❌ Cannot find node/npm. Make sure they are installed and try again."
    exit 1
fi
NODE_BIN_DIR=$(dirname "$NODE_PATH")
echo "✅ Found node at $NODE_PATH"
echo "✅ Found npm  at $NPM_PATH"

# ── 1. Unload any existing service ──────────────────────────────────────────
launchctl unload "$PLIST" 2>/dev/null || true

# ── 2. Free port 4321 if something is already using it ──────────────────────
PID=$(lsof -i TCP:4321 -t 2>/dev/null || true)
if [ -n "$PID" ]; then
    echo "⚠️  Port 4321 in use (PID $PID) — killing..."
    kill -9 $PID 2>/dev/null || true
fi

# ── 3. Write the launchd plist ───────────────────────────────────────────────
cat > "$PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mostafa.project-tracker</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NPM_PATH</string>
        <string>run</string>
        <string>dev</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$NODE_BIN_DIR:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/project-tracker.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/project-tracker.log</string>
</dict>
</plist>
PLIST

launchctl load "$PLIST"
echo "✅ Dev server service loaded (auto-starts on login, restarts on crash)"

# ── 4. Add 'tasks' to /etc/hosts ────────────────────────────────────────────
if grep -q " tasks" /etc/hosts 2>/dev/null; then
    echo "✅ 'tasks' already in /etc/hosts"
else
    echo "127.0.0.1  tasks" | sudo tee -a /etc/hosts > /dev/null
    echo "✅ Added 'tasks' to /etc/hosts"
fi

# ── 5. Port forward 80 → 4321 so http://tasks works without a port ───────────
sudo bash -c "echo 'rdr pass on lo0 proto tcp from any to any port 80 -> 127.0.0.1 port 4321' > $PF_ANCHOR"

sudo tee "$PORT_DAEMON" > /dev/null << DAEMON
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mostafa.tasks-portforward</string>
    <key>ProgramArguments</key>
    <array>
        <string>/sbin/pfctl</string>
        <string>-ef</string>
        <string>$PF_ANCHOR</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
DAEMON

sudo launchctl unload "$PORT_DAEMON" 2>/dev/null || true
sudo pfctl -ef "$PF_ANCHOR" 2>/dev/null || true
sudo launchctl load "$PORT_DAEMON"
echo "✅ Port forwarding active (80 → 4321, persists on reboot)"

# ── 6. Wait and confirm the server came up ───────────────────────────────────
echo ""
echo "⏳ Waiting for server to start (up to 30s)..."
READY=0
for i in {1..30}; do
    printf "."
    if curl -s http://localhost:4321 > /dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 1
done
echo ""

if [ "$READY" -eq 1 ]; then
    echo "✅ Server is up!"
else
    echo "❌ Server didn't start. Last log output:"
    echo "---"
    tail -20 "$HOME/Library/Logs/project-tracker.log" 2>/dev/null || echo "(log is empty)"
    echo "---"
    exit 1
fi

echo ""
echo "🎉 Done! Open http://tasks in your browser."
echo ""
echo "Useful commands:"
echo "  Logs:    tail -f ~/Library/Logs/project-tracker.log"
echo "  Stop:    launchctl unload ~/Library/LaunchAgents/com.mostafa.project-tracker.plist"
echo "  Start:   launchctl load ~/Library/LaunchAgents/com.mostafa.project-tracker.plist"
