#!/bin/bash
# Setup completo do VPS para o canal Tech Ofertas
# Ubuntu 22.04 LTS — rodar como root
# Uso: bash setup-vps.sh

set -e
echo "=== Tech Ofertas — Setup VPS ==="

# ─── 1. Sistema base ──────────────────────────────────────────────────────────
apt update && apt upgrade -y
apt install -y curl git build-essential nginx certbot python3-certbot-nginx \
               postgresql postgresql-contrib ufw

# ─── 2. Node.js 20 ───────────────────────────────────────────────────────────
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo "Node: $(node -v) | npm: $(npm -v)"

# ─── 3. Usuário da aplicação ──────────────────────────────────────────────────
useradd -m -s /bin/bash techmidia || true
mkdir -p /opt/techmidia /var/log/techmidia
chown techmidia:techmidia /opt/techmidia /var/log/techmidia

# ─── 4. PostgreSQL ────────────────────────────────────────────────────────────
systemctl enable --now postgresql

sudo -u postgres psql <<SQL
  CREATE USER techmidia WITH PASSWORD 'TROQUE_ESTA_SENHA';
  CREATE DATABASE openclaw OWNER techmidia;
  GRANT ALL PRIVILEGES ON DATABASE openclaw TO techmidia;
SQL

echo "PostgreSQL configurado. Banco: openclaw | Usuário: techmidia"

# ─── 5. Clonar repositório ───────────────────────────────────────────────────
sudo -u techmidia git clone https://github.com/techmidia/ofertas-tech.git \
     /opt/techmidia 2>/dev/null || \
sudo -u techmidia git -C /opt/techmidia pull

# ─── 6. Arquivo .env ─────────────────────────────────────────────────────────
if [ ! -f /opt/techmidia/.env ]; then
  cp /opt/techmidia/.env.example /opt/techmidia/.env
  echo ""
  echo "⚠️  EDITE /opt/techmidia/.env antes de continuar!"
  echo "   Preencha PG_DSN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID etc."
  echo ""
fi

# ─── 7. Migration do banco ────────────────────────────────────────────────────
echo "Aplicando migration SQL..."
sudo -u techmidia bash -c '
  source /opt/techmidia/.env
  psql "$PG_DSN" < /opt/techmidia/migrations/001_affiliate_schema.sql
'
echo "Migration aplicada."

# ─── 8. affiliate-link-builder ───────────────────────────────────────────────
cd /opt/techmidia/services/affiliate-link-builder
sudo -u techmidia npm ci
sudo -u techmidia npm run build

cp /opt/techmidia/deploy/systemd-affiliate-link-builder.service \
   /etc/systemd/system/affiliate-link-builder.service

systemctl daemon-reload
systemctl enable --now affiliate-link-builder
echo "affiliate-link-builder: $(systemctl is-active affiliate-link-builder)"

# ─── 9. telegram-poster (build) ───────────────────────────────────────────────
cd /opt/techmidia/services/telegram-poster
sudo -u techmidia npm ci
sudo -u techmidia npm run build

# ─── 10. tech-deals-curator (build) ──────────────────────────────────────────
cd /opt/techmidia/services/tech-deals-curator
sudo -u techmidia npm ci
sudo -u techmidia npx tsc

# ─── 11. n8n ─────────────────────────────────────────────────────────────────
npm install -g n8n
cat > /etc/systemd/system/n8n.service <<EOF
[Unit]
Description=n8n workflow automation
After=network.target

[Service]
Type=simple
User=techmidia
WorkingDirectory=/opt/techmidia
EnvironmentFile=/opt/techmidia/.env
Environment=N8N_PORT=5678
Environment=N8N_BASIC_AUTH_ACTIVE=true
Environment=N8N_BASIC_AUTH_USER=admin
Environment=N8N_BASIC_AUTH_PASSWORD=TROQUE_ESTA_SENHA_N8N
Environment=N8N_HOST=0.0.0.0
ExecStart=$(which n8n) start
Restart=on-failure
RestartSec=10s
StandardOutput=append:/var/log/techmidia/n8n.log
StandardError=append:/var/log/techmidia/n8n.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now n8n
echo "n8n: $(systemctl is-active n8n)"

# ─── 12. Nginx ───────────────────────────────────────────────────────────────
cp /opt/techmidia/deploy/nginx-shortlink.conf \
   /etc/nginx/sites-available/go.techmidia.com
ln -sf /etc/nginx/sites-available/go.techmidia.com \
        /etc/nginx/sites-enabled/go.techmidia.com

nginx -t && systemctl reload nginx
echo "Nginx configurado para go.techmidia.com"

# ─── 13. SSL (go.techmidia.com) ───────────────────────────────────────────────
# Certifique-se de que o DNS A go.techmidia.com → IP desta VPS antes de rodar
# certbot --nginx -d go.techmidia.com --non-interactive --agree-tos -m SEU@EMAIL.COM

# ─── 14. Cron ────────────────────────────────────────────────────────────────
(crontab -u techmidia -l 2>/dev/null; cat /opt/techmidia/deploy/crontab.txt) \
  | crontab -u techmidia -
echo "Cron instalado"

# ─── 15. Firewall ────────────────────────────────────────────────────────────
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 5678/tcp   # n8n
ufw --force enable
echo "Firewall configurado"

echo ""
echo "=== Setup concluído ==="
echo ""
echo "Próximos passos:"
echo "  1. Edite /opt/techmidia/.env com as credenciais reais"
echo "  2. Rode: certbot --nginx -d go.techmidia.com -m SEU@EMAIL.COM --agree-tos"
echo "  3. Acesse o n8n em http://IP_DO_VPS:5678 e importe os flows de /opt/techmidia/n8n-flows/"
echo "  4. Teste o poster: cd /opt/techmidia/services/telegram-poster && node dist/src/scheduler.js"
echo ""
