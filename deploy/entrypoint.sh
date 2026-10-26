#!/bin/bash
set -eu
mkdir -p /data
Xvfb :99 -screen 0 1920x1080x24 -ac -nolisten tcp >/tmp/xvfb.log 2>&1 &
ready=0
for attempt in $(seq 1 60); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.2
done
if [ "$ready" != 1 ]; then echo 'Xvfb failed to start' >&2; exit 1; fi
fluxbox >/tmp/fluxbox.log 2>&1 &
pulseaudio --system --daemonize=no --disallow-exit --exit-idle-time=-1 -nF /app/deploy/pulse.pa >/tmp/pulse.log 2>&1 &
exec node dist/src/server/main.js
