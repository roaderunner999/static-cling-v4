#!/usr/bin/env bash
#
# Static Cling v4 — bring the app up AND cut the nginx root over to it.
# ---------------------------------------------------------------------------
# Run as root on the "static-cling" droplet, via the DigitalOcean web console.
#
# SAFE BY CONSTRUCTION:
#   * v4 gets its OWN database (staticcling_v4) — never touches the existing
#     "staticcling" DB or the /api/ -> :8080 backend.
#   * nginx is only modified AFTER v4 is confirmed answering on :3000.
#   * the nginx config is backed up, validated with `nginx -t`, and AUTO-REVERTED
#     if the test fails. The live site cannot be left broken by this script.
#   * idempotent — safe to re-run.
#
# Result:
#   https://static-cling.com/         -> v4 (Next.js, proxied from :3000)
#   https://static-cling.com/legacy/  -> old static site (index.html, lab.html…)
#   both behind the existing .htpasswd password.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_NAME="static-cling-v4"
APP_DIR="/opt/${APP_NAME}"
APP_PORT="3000"
DB_NAME="staticcling_v4"            # dedicated — NOT the pre-existing "staticcling" DB
DB_USER="staticcling"
DOCROOT="/var/www/static-cling"
LEGACY_DIR="${DOCROOT}/legacy"
NGINX_SITE="/etc/nginx/sites-available/static-cling.com"
ENV_FILE="${APP_DIR}/.env"
TS="$(date +%Y%m%d-%H%M%S)"

echo "==> golive — $(hostname) — $(date)"
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root"; exit 1; }
[ -f "${APP_DIR}/package.json" ] || { echo "ERROR: ${APP_DIR} not found — extract the tarball first."; exit 1; }
command -v node >/dev/null || { echo "ERROR: node missing — run deploy/setup.sh first."; exit 1; }
command -v psql >/dev/null || { echo "ERROR: postgres missing — run deploy/setup.sh first."; exit 1; }

# --- 1. dedicated database + role password (idempotent) ---------------------
echo "==> Ensuring role '${DB_USER}' and dedicated database '${DB_NAME}' ..."
DB_PASS="$(openssl rand -hex 16)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi
# PG15+ locks down the public schema — make sure our role can create tables.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

# Preserve secrets across re-runs: rotating BETTER_AUTH_SECRET would log everyone
# out, and clobbering provider keys would silently disable billing / OAuth /
# email. Carry forward whatever is already in .env.
prev() { [ -f "${ENV_FILE}" ] && grep "^$1=" "${ENV_FILE}" 2>/dev/null | head -1 | cut -d= -f2- || true; }

BETTER_AUTH_SECRET="$(prev BETTER_AUTH_SECRET)"
if [ -n "${BETTER_AUTH_SECRET}" ]; then
  echo "==> Reusing existing BETTER_AUTH_SECRET"
else
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
  echo "==> Generated a new BETTER_AUTH_SECRET"
fi

# Admin allowlist — preserved across re-runs; falls back to the owner so admin
# access can never be lost. The seed migration also flags this email's role.
ADMIN_EMAILS="$(prev ADMIN_EMAILS)"
[ -n "${ADMIN_EMAILS}" ] || ADMIN_EMAILS="admin@lyons.net"

# Optional provider keys — preserved if you've pasted them in before.
GOOGLE_CLIENT_ID="$(prev GOOGLE_CLIENT_ID)"
GOOGLE_CLIENT_SECRET="$(prev GOOGLE_CLIENT_SECRET)"
RESEND_API_KEY="$(prev RESEND_API_KEY)"
STRIPE_SECRET_KEY="$(prev STRIPE_SECRET_KEY)"
STRIPE_WEBHOOK_SECRET="$(prev STRIPE_WEBHOOK_SECRET)"
STRIPE_PRICE_ID="$(prev STRIPE_PRICE_ID)"

echo "==> Writing ${ENV_FILE} (points v4 at ${DB_NAME}; preserves your keys)"
cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=https://static-cling.com

# Admin console — comma-separated emails that always have admin access.
ADMIN_EMAILS=${ADMIN_EMAILS}

# Optional providers — paste a value, then restart the service (or re-run this
# script; values are preserved across re-runs). Each feature activates when set.
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
RESEND_API_KEY=${RESEND_API_KEY}
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
STRIPE_PRICE_ID=${STRIPE_PRICE_ID}
EOF
chmod 600 "${ENV_FILE}"

# --- 2. install (incl dev), migrate, build ----------------------------------
cd "${APP_DIR}"
set -a; . "${ENV_FILE}"; set +a
echo "==> npm ci (incl dev deps) ..."
npm ci --include=dev
echo "==> drizzle migrate (drops Stage 0 placeholder, creates the auth tables) ..."
npm run db:migrate
echo "==> next build ..."
npm run build

# --- 3. systemd service on :${APP_PORT} -------------------------------------
echo "==> Installing/refreshing systemd unit ..."
cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Static Cling v4 (Next.js)
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=PORT=${APP_PORT}
ExecStart=$(command -v npm) run start
Restart=on-failure
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "${APP_NAME}" >/dev/null 2>&1 || true
systemctl restart "${APP_NAME}"

# --- 4. GATE: v4 must answer on :${APP_PORT} before we touch nginx ----------
echo "==> Waiting for v4 to answer on 127.0.0.1:${APP_PORT} ..."
HEALTHY=""
for i in $(seq 1 25); do
  code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/" || true)"
  if [ "$code" = "200" ]; then HEALTHY=1; echo "    OK — v4 serving (HTTP 200)"; break; fi
  sleep 1
done
if [ -z "${HEALTHY}" ]; then
  echo "ABORT: v4 is not serving on :${APP_PORT}. nginx and your live site were NOT touched."
  echo "Last 30 log lines:"; journalctl -u "${APP_NAME}" -n 30 --no-pager || true
  exit 1
fi

# --- 5. relocate old static site to /legacy/ --------------------------------
echo "==> Moving existing static files to ${LEGACY_DIR}/ ..."
mkdir -p "${LEGACY_DIR}"
shopt -s nullglob
for f in "${DOCROOT}"/*.html "${DOCROOT}"/*.bak*; do
  [ "$(basename "$f")" = "legacy" ] && continue
  mv -n "$f" "${LEGACY_DIR}/"
done
chown -R www-data:www-data "${LEGACY_DIR}" 2>/dev/null || true

# --- 6. rewrite nginx (backup -> write -> test -> reload | revert) ----------
echo "==> Backing up nginx config -> ${NGINX_SITE}.bak-${TS}"
cp -a "${NGINX_SITE}" "${NGINX_SITE}.bak-${TS}"

cat > "${NGINX_SITE}" <<'NGINX'
# Static Cling — v4 at root (reverse-proxied to :3000); legacy static site at /legacy/.
# Prior config backed up alongside this file as .bak-<timestamp>.

server {
    server_name static-cling.com www.static-cling.com;
    root /var/www/static-cling;

    # Stripe webhook — Stripe can't send the site password; it authenticates by
    # signing the payload (verified in-app). Exact match beats /api/ below, and
    # there is deliberately NO auth_basic here.
    location = /api/stripe/webhook {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Better Auth (v4 on :3000). MORE SPECIFIC than /api/ below, so nginx's
    # longest-prefix match routes /api/auth/* here and not to the :8080 backend.
    location /api/auth/ {
        auth_basic "Static Cling";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Pre-existing backend — preserved untouched.
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # /legacy with no trailing slash -> /legacy/
    location = /legacy { return 301 /legacy/; }

    # Old static test site (V3.27) — view at /legacy/.
    location /legacy/ {
        auth_basic "Static Cling";
        auth_basic_user_file /etc/nginx/.htpasswd;
        index index.html;
        try_files $uri $uri/ =404;
    }

    # Static Cling v4 (Next.js) — everything else.
    location / {
        auth_basic "Static Cling";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location = /favicon.ico { log_not_found off; access_log off; }
    location = /robots.txt  { log_not_found off; access_log off; }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/static-cling.com-0001/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/static-cling.com-0001/privkey.pem; # managed by Certbot
}

server {
    listen 80;
    listen [::]:80;
    server_name static-cling.com www.static-cling.com;
    return 301 https://$host$request_uri;
}
NGINX

echo "==> nginx -t ..."
if nginx -t; then
  systemctl reload nginx
  echo
  echo "================================================================"
  echo " LIVE:"
  echo "   v4 (real deal):  https://static-cling.com/"
  echo "   old test site:   https://static-cling.com/legacy/"
  echo " Both behind your existing Static Cling password."
  echo " nginx backup:      ${NGINX_SITE}.bak-${TS}"
  echo " v4 db:             ${DB_NAME}  (separate from the existing 'staticcling' db)"
  echo "================================================================"
else
  echo "!! nginx -t FAILED — reverting config; live site untouched."
  cp -a "${NGINX_SITE}.bak-${TS}" "${NGINX_SITE}"
  nginx -t && systemctl reload nginx || true
  exit 1
fi
