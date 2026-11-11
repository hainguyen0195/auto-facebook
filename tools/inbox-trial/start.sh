#!/bin/bash
set -euo pipefail
umask 077
exec 9>/data/monitor.lock
flock -n 9 || { echo 'Another inbox trial owns this profile'; exit 1; }
children=()
cleanup() {
  trap '' TERM INT
  if [[ -n "${monitor_pid:-}" ]]; then
    kill -TERM "$monitor_pid" 2>/dev/null || true
    wait "$monitor_pid" 2>/dev/null || true
  fi
  for child in "${children[@]}"; do kill -TERM "$child" 2>/dev/null || true; done
  wait || true
}
trap cleanup EXIT
trap 'exit 0' TERM INT
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
children+=("$!")
for attempt in $(seq 1 30); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
  sleep 0.2
done
xdpyinfo -display :99 >/dev/null
# Host ports are loopback-only; access this private viewer through SSH forwarding.
x11vnc -display :99 -listen 127.0.0.1 -rfbport 5900 -nopw -forever -shared -quiet >/dev/null 2>&1 &
children+=("$!")
websockify --web=/usr/share/novnc/ 0.0.0.0:6080 127.0.0.1:5900 >/dev/null 2>&1 &
children+=("$!")
node --import tsx scripts/inbox-trial.ts &
monitor_pid=$!
wait "$monitor_pid"
