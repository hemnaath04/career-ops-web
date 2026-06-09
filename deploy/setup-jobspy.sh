#!/usr/bin/env bash
# Bootstrap jobspy-service on the droplet.
#
# Usage (from the career-ops-web repo root, as root):
#     sudo bash deploy/setup-jobspy.sh
#
# Idempotent. Assumes the 'careerops' user already exists from the
# main setup.sh.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "must be run as root (use sudo)" >&2
    exit 1
fi

APP_USER="careerops"
APP_DIR="/opt/jobspy-service"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! id -u "$APP_USER" >/dev/null 2>&1; then
    echo "user '$APP_USER' missing — run deploy/setup.sh first" >&2
    exit 1
fi

echo ">>> [1/4] apt deps (python3-venv)"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip build-essential

echo ">>> [2/4] copying source to $APP_DIR"
mkdir -p "$APP_DIR"
cp "$SRC_DIR/jobspy-service/main.py"          "$APP_DIR/main.py"
cp "$SRC_DIR/jobspy-service/requirements.txt" "$APP_DIR/requirements.txt"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo ">>> [3/4] python venv + deps (this can take 1-2 minutes)"
if [[ ! -d "$APP_DIR/venv" ]]; then
    sudo -u "$APP_USER" -H python3 -m venv "$APP_DIR/venv"
fi
sudo -u "$APP_USER" -H "$APP_DIR/venv/bin/pip" install --quiet --upgrade pip wheel
sudo -u "$APP_USER" -H "$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

echo ">>> [4/4] systemd unit"
install -m 0644 "$SRC_DIR/deploy/jobspy.service" /etc/systemd/system/jobspy.service
systemctl daemon-reload
systemctl enable --now jobspy

sleep 2
systemctl status jobspy --no-pager | head -10 || true

cat <<EOF

============================================================
jobspy-service installed at $APP_DIR
============================================================

Verify:
    curl -s http://127.0.0.1:8002/healthz
    # expect: {"ok":true,"version":"0.1.0"}

Enable in career-ops-web by appending to /opt/career-ops-web/.env:

    ENABLE_JOBSPY=1
    JOBSPY_URL=http://127.0.0.1:8002
    JOBSPY_SITES=linkedin,indeed,glassdoor,google
    JOBSPY_RESULTS_PER_SITE=20
    JOBSPY_HOURS_OLD=72

Then: sudo systemctl restart careerops

Logs: sudo journalctl -u jobspy -f
EOF
