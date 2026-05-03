#!/bin/bash
# Setup completo do Mac para o canal Tech Ofertas
# Roda do zero — instala Homebrew, Node, PostgreSQL, n8n e sobe tudo
# Uso: bash deploy/setup-mac.sh

set -e
ROOT="$HOME/ofertas-tech"
LOGS="$HOME/Library/Logs/techmidia"

cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Tech Ofertas — Setup Mac               ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── 1. Homebrew ─────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "→ Instalando Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
else
  echo "✓ Homebrew já instalado"
fi

# ─── 2. Node.js 20 ───────────────────────────────────────────────────────────
if ! node --version 2>/dev/null | grep -q "v20"; then
  echo "→ Instalando Node.js 20..."
  brew install node@20
  brew link --force --overwrite node@20 2>/dev/null || true
  export PATH="/opt/homebrew/opt/node@20/bin:/usr/local/opt/node@20/bin:$PATH"
else
  echo "✓ Node.js $(node -v) já instalado"
fi

# ─── 3. PostgreSQL 15 ────────────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  echo "→ Instalando PostgreSQL 15..."
  brew install postgresql@15
  export PATH="/opt/homebrew/opt/postgresql@15/bin:/usr/local/opt/postgresql@15/bin:$PATH"
  echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> "$HOME/.zprofile"
else
  echo "✓ PostgreSQL $(psql --version | awk '{print $3}') já instalado"
fi

echo "→ Iniciando PostgreSQL..."
brew services start postgresql@15 2>/dev/null || brew services start postgresql 2>/dev/null || true
sleep 3

# Cria usuário e banco (ignora se já existir)
echo "→ Configurando banco openclaw..."
createuser techmidia 2>/dev/null || true
createdb -O techmidia openclaw 2>/dev/null || true
psql openclaw -c "GRANT ALL ON SCHEMA public TO techmidia;" 2>/dev/null || true

PG_DSN="postgresql://techmidia@localhost:5432/openclaw"

# ─── 4. Migration SQL ────────────────────────────────────────────────────────
echo "→ Aplicando migration do schema affiliate..."
psql "$PG_DSN" < "$ROOT/migrations/001_affiliate_schema.sql" 2>/dev/null && \
  echo "✓ Migration aplicada" || echo "⚠ Migration já aplicada ou erro (ignorando)"

# ─── 5. Diretório de logs ─────────────────────────────────────────────────────
mkdir -p "$LOGS"
echo "✓ Logs em $LOGS"

# ─── 6. .env ─────────────────────────────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

# Preenche credenciais já conhecidas
set_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=$" "$ROOT/.env" 2>/dev/null; then
    sed -i '' "s|^${key}=.*|${key}=${val}|" "$ROOT/.env"
  fi
}

set_env "TELEGRAM_BOT_TOKEN"  "8492088896:AAFI9v6nSxQR4B4M1Sl-QdRRuyo-YFWHWI0"
set_env "TELEGRAM_CHANNEL_ID" "-1003966051055"
set_env "ML_APP_ID"           "8137208544094626"
set_env "ML_CLIENT_SECRET"    "LQSqAEXew169MS1RPAr95L5SXgBvcUVK"
set_env "ML_ACCESS_TOKEN"     "APP_USR-8137208544094626-050311-f5f6558168df01ba140444f0430288b3-151742367"
set_env "ML_REFRESH_TOKEN"    "TG-69f769048b009600019572c2-151742367"
set_env "ML_AFFILIATE_TAG"    "midiatech20221014084627"
set_env "ML_AFFILIATE_TOOL"   "36683616"
set_env "SHORTLINK_DOMAIN"    "go.techmidia.com"
set_env "SHORTLINK_BASE_URL"  "https://go.techmidia.com/d"
set_env "DEEPSEEK_GATEWAY"    "http://localhost:18789"

# PG_DSN — substitui o valor genérico
sed -i '' "s|^PG_DSN=.*|PG_DSN=${PG_DSN}|" "$ROOT/.env"

echo "✓ .env configurado"

# ─── 7. Verifica chave Deepseek ───────────────────────────────────────────────
if ! grep -q "^DEEPSEEK_API_KEY=.\+" "$ROOT/.env" 2>/dev/null; then
  echo ""
  echo "⚠  DEEPSEEK_API_KEY não encontrada no .env"
  echo "   Acesse https://platform.deepseek.com → API Keys → Create"
  read -p "   Cole sua chave Deepseek aqui (Enter para pular): " DS_KEY
  if [ -n "$DS_KEY" ]; then
    grep -q "^DEEPSEEK_API_KEY=" "$ROOT/.env" && \
      sed -i '' "s|^DEEPSEEK_API_KEY=.*|DEEPSEEK_API_KEY=${DS_KEY}|" "$ROOT/.env" || \
      echo "DEEPSEEK_API_KEY=${DS_KEY}" >> "$ROOT/.env"
    echo "✓ Chave Deepseek salva"
  else
    echo "   Proxy Deepseek não funcionará até adicionar a chave no .env"
  fi
fi

# ─── 8. Build dos serviços ───────────────────────────────────────────────────
echo ""
echo "→ Instalando dependências e compilando serviços..."

for svc in affiliate-link-builder tech-deals-curator telegram-poster; do
  echo "  [$svc]"
  cd "$ROOT/services/$svc"
  npm ci --silent
  npm run build --silent
  echo "  ✓ $svc compilado"
done

cd "$ROOT"

# ─── 9. n8n ──────────────────────────────────────────────────────────────────
if ! command -v n8n &>/dev/null; then
  echo "→ Instalando n8n..."
  npm install -g n8n --silent
  echo "✓ n8n instalado"
else
  echo "✓ n8n já instalado"
fi

# ─── 10. LaunchAgent para affiliate-link-builder ──────────────────────────────
PLIST="$HOME/Library/LaunchAgents/com.techmidia.affiliate-link-builder.plist"
if [ ! -f "$PLIST" ]; then
  cp "$ROOT/deploy/launchagents/com.techmidia.affiliate-link-builder.plist" "$PLIST"
  # Substitui $HOME pelo caminho real
  sed -i '' "s|\$HOME|$HOME|g" "$PLIST"
  launchctl load "$PLIST" 2>/dev/null || true
  echo "✓ LaunchAgent instalado (affiliate-link-builder reinicia automaticamente)"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setup concluído!                       ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Próximo passo — iniciar todos os serviços:"
echo "  bash $ROOT/deploy/start-mac.sh"
echo ""
