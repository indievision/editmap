#!/bin/bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "Stopping EditMap and background AI services..."

# If PID file exists, kill it
if [ -f logs/editmap.pid ]; then
  kill $(cat logs/editmap.pid) 2>/dev/null || true
  rm -f logs/editmap.pid
fi

# Kill any lingering processes on ports 5173/5174 (Vite), 8000 (Python CV), and 3000 (DUET)
lsof -ti :5173 | xargs kill -9 2>/dev/null || true
lsof -ti :5174 | xargs kill -9 2>/dev/null || true
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

echo "EditMap has stopped."
