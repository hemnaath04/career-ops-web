#!/usr/bin/env bash
# One-shot bootstrap for career-ops-web on a fresh-ish Ubuntu droplet.
#
# Usage (as root on the droplet):
#     sudo bash deploy/setup.sh careerops.hemnaath.tech <basic-auth-username>
#
# What this does:
#   1. Installs Node 20 + nginx + certbot + apache2-utils (htpasswd)
#   2. Creates the 'careerops' system user and the app dirs
#   3. Clones santifer/career-ops into /opt/career-ops (used by the app)
#   4. Installs npm deps for the app
#   5. Installs the systemd unit + nginx vhost (with htpasswd gate)
#   6. Prompts for a basic-auth password
#   7. Reminds you to add DNS, then run certbot
#
# Idempotent — safe to re-run.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "must be run as root (use sudo)" >&2
    exit 1
fi

DOMAIN="${1:-}"
BASIC_USER="${2:-}"
if [[ -z "$DOMAIN" || -z "$BASIC_USER" ]]; then
    echo "usage: sudo bash deploy/setup.sh <domain> <basic-auth-username>" >&2
    exit 2
fi

APP_USER="careerops"
APP_DIR="/opt/career-ops-web"
ENGINE_DIR="/opt/career-ops"
HTPASSWD_FILE="/etc/nginx/.careerops.htpasswd"

echo ">>> [1/7] apt deps"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx certbot \
    python3-certbot-nginx apache2-utils git

# Node 20 via NodeSource (skip if already present)
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* && "$(node -v)" != v21* && "$(node -v)" != v22* ]]; then
    echo ">>> [2/7] installing Node 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
else
    echo ">>> [2/7] Node already present: $(node -v)"
fi

echo ">>> [3/7] system user + dirs"
# npm needs a writable HOME for its cache + logs, so the careerops user
# gets a real home dir (no shell, still no-login). System user, system uid.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/home/$APP_USER" \
            --shell /usr/sbin/nologin "$APP_USER"
elif [[ ! -d "/home/$APP_USER" ]]; then
    # User exists from a previous run that used --no-create-home — give
    # them a home now so npm install doesn't EACCES.
    install -d -m 0755 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER"
fi
mkdir -p "$APP_DIR" "$ENGINE_DIR"

# We assume you've already rsync'd or git-cloned career-ops-web into
# $APP_DIR before running this. Bail clearly if not.
if [[ ! -f "$APP_DIR/package.json" ]]; then
    echo "expected $APP_DIR/package.json — clone or rsync career-ops-web there first" >&2
    exit 3
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo ">>> [4/7] cloning santifer/career-ops engine"
if [[ ! -d "$ENGINE_DIR/.git" ]]; then
    rm -rf "$ENGINE_DIR"
    git clone --depth 1 https://github.com/santifer/career-ops.git "$ENGINE_DIR"
else
    git -C "$ENGINE_DIR" pull --ff-only || echo "(career-ops pull failed, continuing with existing checkout)"
fi
chown -R "$APP_USER":"$APP_USER" "$ENGINE_DIR"

echo ">>> [5/7] npm install"
# If a previous run left a broken node_modules behind (e.g. from when
# the user had no home dir and npm aborted mid-extract), clear it.
rm -rf "$APP_DIR/node_modules" "$APP_DIR/package-lock.json"
sudo -u "$APP_USER" --preserve-env=PATH bash -c "cd $APP_DIR && npm install --no-audit --no-fund --omit=dev"

# Playwright needs Chromium + system fonts/libs for the PDF tailoring
# feature. ~250 MB on disk, one-time install. Skip if you don't want
# PDF generation (the /api/pdf endpoint will simply fail at request time).
echo ">>> [5b/7] Installing Playwright Chromium + system libs (this can take a couple minutes)..."
sudo -u "$APP_USER" --preserve-env=PATH bash -c "cd $APP_DIR && npx --yes playwright install --with-deps chromium" \
    || echo "!! playwright install failed — PDF tailoring won't work until you re-run this step"

echo ">>> [6/7] systemd unit + nginx vhost"
install -m 0644 "$APP_DIR/deploy/careerops.service" /etc/systemd/system/careerops.service
systemctl daemon-reload

# Stamp the domain into the nginx config and install it.
sed "s/careerops.hemnaath.tech/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf" \
    > /etc/nginx/sites-available/careerops
ln -sf /etc/nginx/sites-available/careerops /etc/nginx/sites-enabled/careerops

# Htpasswd — prompts for a password.
if [[ ! -f "$HTPASSWD_FILE" ]]; then
    htpasswd -c "$HTPASSWD_FILE" "$BASIC_USER"
else
    echo "htpasswd file exists; adding/updating user $BASIC_USER"
    htpasswd "$HTPASSWD_FILE" "$BASIC_USER"
fi
chmod 0640 "$HTPASSWD_FILE"
chown root:www-data "$HTPASSWD_FILE"

# .env stub if missing.
if [[ ! -f "$APP_DIR/.env" ]]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
    chmod 0600 "$APP_DIR/.env"
    echo "!! created $APP_DIR/.env from example — edit it BEFORE starting the service"
fi

echo ">>> [7/7] nginx test + reload"
nginx -t
systemctl reload nginx

cat <<EOF

============================================================
career-ops-web bootstrapped at $APP_DIR
============================================================

Next steps:

  1. Point DNS:
       Add an A record:    $DOMAIN  ->  $(hostname -I | awk '{print $1}')
       (or a CNAME pointing at your existing droplet record)

  2. Fill in the .env file:
       sudo nano $APP_DIR/.env
       # set OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL — same as
       # the values in /opt/job-searcher/.env on this droplet
     Then:
       sudo systemctl enable --now careerops

  3. Once DNS resolves to this droplet, provision TLS:
       sudo certbot --nginx -d $DOMAIN

  4. Visit https://$DOMAIN — browser will prompt for the basic auth
     user '$BASIC_USER' you just set up.

Logs:
  sudo journalctl -u careerops -f
EOF
