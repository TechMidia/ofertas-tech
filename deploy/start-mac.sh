#!/bin/bash
# Inicia todos os serviços do canal Tech Ofertas no Mac
# Uso: bash deploy/start-mac.sh

ROOT="$HOME/ofertas-tech"
LOGS="$HOME/Library/Logs/techmidia"
PIDS="$ROOT/deploy/.pids"

mkdir -p "$LOGS" "$ROOT/deploy"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Tech Ofertas — Iniciando serviços      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Garante que variáveis de ambiente estão disponíveis
set -a; source "$ROOT/.env"; set +a

# ─── PostgreSQL ───────────────────────────────────────────────────────────────
brew services start postgresql@15 2>/dev/null || \
brew services start postgresql    2>/dev/null || true
echo "✓ PostgreSQL"

# ─── Deepseek proxy (:18789) ─────────────────────────────────────────────────
if lsof -i :18789 -t &>/dev/null; then
  echo "✓ Deepseek gateway já rodando em :18789"
else
  node "$ROOT/deploy/deepseek-proxy.js" >> "$LOGS/deepseek-proxy.log" 2>&1 &
  echo $! > "$PIDS/deepseek-proxy.pid"
  sleep 1
  if lsof -i :18789 -t &>/dev/null; then
    echo "✓ Deepseek proxy iniciado em :18789"
  else
    echo "⚠ Deepseek proxy falhou — verifique DEEPSEEK_API_KEY no .env"
    echo "  Logs: $LOGS/deepseek-proxy.log"
  fi
fi

# ─── affiliate-link-builder (:18790) ─────────────────────────────────────────
if lsof -i :18790 -t &>/dev/null; then
  echo "✓ affiliate-link-builder já rodando em :18790"
else
  cd "$ROOT/services/affiliate-link-builder"
  node dist/index.js >> "$LOGS/affiliate-link-builder.log" 2>&1 &
  echo $! > "$PIDS/affiliate-link-builder.pid"
  sleep 1
  if lsof -i :18790 -t &>/dev/null; then
    echo "✓ affiliate-link-builder iniciado em :18790"
  else
    echo "⚠ affiliate-link-builder falhou — veja $LOGS/affiliate-link-builder.log"
  fi
fi

cd "$ROOT"

# ─── n8n (:5678) ──────────────────────────────────────────────────────────────
if lsof -i :5678 -t &>/dev/null; then
  echo "✓ n8n já rodando em :5678"
else
  N8N_PORT=5678 n8n start >> "$LOGS/n8n.log" 2>&1 &
  echo $! > "$PIDS/n8n.pid"
  sleep 3
  if lsof -i :5678 -t &>/dev/null; then
    echo "✓ n8n iniciado em :5678"
  else
    echo "⚠ n8n falhou — veja $LOGS/n8n.log"
  fi
fi

# ─── Crontab ─────────────────────────────────────────────────────────────────
# Instala cron jobs se ainda não estiverem configurados
if ! crontab -l 2>/dev/null | grep -q "telegram-poster"; then
  CRON_TMP=$(mktemp)
  crontab -l 2>/dev/null > "$CRON_TMP" || true
  # Substitui $HOME pelo caminho real
  sed "s|\$HOME|$HOME|g" "$ROOT/deploy/crontab-mac.txt" >> "$CRON_TMP"
  crontab "$CRON_TMP"
  rm "$CRON_TMP"
  echo "✓ Cron jobs instalados (poster: 1x/hora | curador: a cada 30min)"
else
  echo "✓ Cron jobs já configurados"
fi

echo ""
echo "════════════════════════════════════════════"
echo "  Serviços ativos:"
echo "  • affiliate-link-builder → http://localhost:18790"
echo "  • Deepseek proxy         → http://localhost:18789"
echo "  • n8n                    → http://localhost:5678"
echo ""
echo "  Próximos passos:"
echo "  1. Acesse http://localhost:5678"
echo "     Importe n8n-flows/collector-promobit.json"
echo "     Ative o flow"
echo ""
echo "  2. Aguarde 15min para as primeiras ofertas chegarem"
echo "     psql openclaw -c \"SELECT count(*) FROM affiliate.offers_raw;\""
echo ""
echo "  3. Rode o curador manualmente:"
echo "     cd $ROOT/services/tech-deals-curator && node dist/agent.js"
echo ""
echo "  4. Poste manualmente a primeira oferta:"
echo "     cd $ROOT/services/telegram-poster && node dist/src/scheduler.js"
echo "════════════════════════════════════════════"
echo ""
