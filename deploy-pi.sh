#!/usr/bin/env bash
# Build locally and deploy OpenDots to the Raspberry Pi.
# The Pi's /opt/opendots/.env is managed on the Pi and never overwritten.
set -euo pipefail
PI="${PI:-pi@192.168.68.5}"
cd "$(dirname "$0")"
npm ci
npm run build
rsync -az --delete --exclude .env --exclude data --exclude node_modules \
  dist package.json package-lock.json deploy scripts compose.computers.yml \
  deployment "$PI:/tmp/opendots-release/"
ssh -t "$PI" 'set -e
  sudo rsync -a --delete --exclude .env --exclude data --exclude node_modules /tmp/opendots-release/ /opt/opendots/
  sudo cp /opt/opendots/deploy/*.service /etc/systemd/system/
  sudo chown -R opendots:opendots /opt/opendots
  cd /opt/opendots && sudo -u opendots npm ci --omit=dev --no-audit --no-fund
  sudo systemctl daemon-reload
  sudo systemctl enable --now piper-tts opendots
  sudo systemctl restart opendots
  systemctl --no-pager --lines=0 status piper-tts opendots'
