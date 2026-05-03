#!/bin/bash
# Para todos os serviços do canal Tech Ofertas
# Uso: bash deploy/stop-mac.sh

ROOT="$HOME/ofertas-tech"
PIDS="$ROOT/deploy/.pids"

echo "→ Parando serviços Tech Ofertas..."

stop_pid() {
  local name="$1"
  local file="$PIDS/${name}.pid"
  if [ -f "$file" ]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "✓ $name parado"
    fi
    rm -f "$file"
  fi
}

stop_pid "affiliate-link-builder"
stop_pid "deepseek-proxy"
stop_pid "n8n"

# Mata pelo nome caso o PID não seja encontrado
pkill -f "affiliate-link-builder/dist/index.js" 2>/dev/null && echo "✓ affiliate-link-builder parado" || true
pkill -f "deepseek-proxy.js"                    2>/dev/null && echo "✓ deepseek-proxy parado"         || true
pkill -f "n8n start"                            2>/dev/null && echo "✓ n8n parado"                    || true

echo "✓ Todos os serviços parados"
