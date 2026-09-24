#!/bin/bash
set -e

# Resolve project directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# Ensure standard environment PATH on macOS (Homebrew, MacPorts, etc.)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Ensure log directory
mkdir -p logs

# Check if Vite is already running on port 5173
if lsof -i :5173 >/dev/null 2>&1 || curl -s http://127.0.0.1:5173 >/dev/null 2>&1; then
  echo "EditMap is already running. Opening browser..."
  open "http://127.0.0.1:5173"
  exit 0
fi

echo "Starting EditMap and local AI services..."

# Start EditMap via npm in the background with nohup
nohup npm run dev > logs/editmap.log 2>&1 &
APP_PID=$!
echo $APP_PID > logs/editmap.pid

# Wait up to 15 seconds for Vite to come online
for i in {1..15}; do
  if curl -s http://127.0.0.1:5173 >/dev/null 2>&1; then
    echo "EditMap is ready! Opening in browser..."
    open "http://127.0.0.1:5173"
    exit 0
  fi
  sleep 1
done

# Fallback open
open "http://127.0.0.1:5173"
