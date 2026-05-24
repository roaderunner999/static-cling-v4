#!/usr/bin/env bash
#
# Static Cling v4 — droplet provisioning + deploy (NON-DESTRUCTIVE)
# ---------------------------------------------------------------------------
# Run as root on the DigitalOcean "static-cling" droplet (Ubuntu 24.04), via
# the DigitalOcean web console:  Droplet -> Access -> Launch Console.
#
# It installs Node 20 + PostgreSQL, creates an app database, builds the app,
# and runs it under systemd on PORT 3000. It does NOT touch nginx, port 80, or
# any existing site on the box — so it is safe to run even if the live
# static-cling.com is already served from this droplet. A domain / reverse
# proxy is a separate, deliberate step for later.
#
# Idempotent: safe to re-run after re-uploading new code.
# ---------------------------------------------------------------------------
set -euo pipefail

APP_NAME="static-cling-v4"
APP_DIR="/opt/${APP_NAME}"
APP_PORT="3000"
DB_NAME="staticcling"
DB_USER="staticcling"
NODE_MAJOR="20"
ENV_FILE="${APP_DIR}/.env"
SERVICE="/etc/systemd/system/${APP_NAME}.service"

echo "==> Static Cling v4 deploy — $(hostname) — $(date)"

# --- 0. preconditions -------------------------------------------------------
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root (sudo -i)"; exit 1; }
if [ ! -f "${APP_DIR}/package.json" ]; then
  echo "ERROR: ${APP_DIR}/package.json not found."
  echo "       Upload the app to ${APP_DIR} via FileZilla first, then re-run."
  exit 1
fi

echo "==> Current box state (nothing changed yet):"
echo "    node:  $(command -v node >/dev/null && node -v || echo 'not installed')"
echo "    psql:  $(command -v psql >/dev/null && psql --version || echo 'not installed')"
echo "    :80 :  $(ss -tlnp 2>/dev/null | awk '/:80 /{print $NF; f=1} END{if(!f)print "free"}' | head -1)"
echo "    :${APP_PORT}:  $(ss -tlnp 2>/dev/null | awk -v p=":${APP_PORT} " '$0 ~ p {print $NF; f=1} END{if(!f)print "free"}' | head -1)"

# --- 0b. HARD STOP if our port is taken (protect the live test site) --------
if ss -tln 2>/dev/null | grep -q ":${APP_PORT} "; then
  echo
  echo "ABORTING — port ${APP_PORT} is already in use on this box (possibly your"
  echo "live test site). Nothing has been changed. To deploy without touching it,"
  echo "edit APP_PORT at the top of this script to a free port (e.g. 3100) and"
  echo "re-run. I'd rather stop than risk your running site."
  exit 1
fi

# --- 1. Node 20 -------------------------------------------------------------
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" != "${NODE_MAJOR}" ]; then
  echo "==> Installing Node ${NODE_MAJOR}.x (NodeSource) ..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

# --- 2. PostgreSQL ----------------------------------------------------------
if ! command -v psql >/dev/null; then
  echo "==> Installing PostgreSQL ..."
  apt-get update -y && apt-get install -y postgresql postgresql-contrib
fi
systemctl enable --now postgresql

DB_PASS=""
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  DB_PASS="$(openssl rand -hex 16)"
  echo "==> Creating DB role '${DB_USER}' ..."
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
else
  echo "==> DB role '${DB_USER}' already exists (reusing .env credentials)."
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "==> Creating database '${DB_NAME}' owned by '${DB_USER}' ..."
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

# --- 3. .env (DATABASE_URL) -------------------------------------------------
if [ ! -f "${ENV_FILE}" ]; then
  [ -n "${DB_PASS}" ] || { echo "ERROR: role existed but no ${ENV_FILE}; set DATABASE_URL there by hand, then re-run."; exit 1; }
  echo "==> Writing ${ENV_FILE} (chmod 600)"
  cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
EOF
  chmod 600 "${ENV_FILE}"
fi

# --- 4. deps, migrate, build ------------------------------------------------
cd "${APP_DIR}"
set -a; . "${ENV_FILE}"; set +a
echo "==> npm ci (incl dev deps — drizzle-kit/typescript/tailwind are needed to migrate + build) ..."
npm ci --include=dev
echo "==> drizzle migrate ..."
npm run db:migrate
echo "==> next build ..."
npm run build

# --- 5. systemd service on PORT ${APP_PORT} ---------------------------------
echo "==> Installing systemd unit ${SERVICE}"
cat > "${SERVICE}" <<EOF
[Unit]
Description=Static Cling v4 (Next.js)
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=PORT=${APP_PORT}
Environment=HOSTNAME=0.0.0.0
ExecStart=$(command -v npm) run start
Restart=on-failure
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "${APP_NAME}"
systemctl restart "${APP_NAME}"

# --- 6. firewall (only if ufw is active) ------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> ufw active — allowing ${APP_PORT}/tcp"
  ufw allow "${APP_PORT}/tcp" || true
fi

sleep 2
IP="$(curl -fsS --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "================================================================"
echo " DONE.  Test it at:   http://${IP}:${APP_PORT}/"
echo "   status:  systemctl status ${APP_NAME}"
echo "   logs:    journalctl -u ${APP_NAME} -f"
echo " (If unreachable: check for a DigitalOcean Cloud Firewall on the"
echo "  droplet and allow inbound TCP ${APP_PORT}.)"
echo "================================================================"
