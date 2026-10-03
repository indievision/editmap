#!/bin/bash
set -e

# Resolve project directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# Ensure standard environment PATH on macOS (Homebrew, MacPorts, etc.)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Ensure log directory
mkdir -p logs

# Check if EditMap process is already running via PID file
if [ -f logs/editmap.pid ] && kill -0 $(cat logs/editmap.pid) 2>/dev/null; then
  echo "EditMap is already running (PID $(cat logs/editmap.pid))."
  # Find port from log or default to 5174/5173
  PORT=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' logs/editmap.log | tail -n 1)
  if [ -n "$PORT" ]; then
    open "$PORT"
  else
    open "http://127.0.0.1:5173"
  fi
  exit 0
fi

echo "Starting EditMap and local AI / screening services..."

# Guests in the screening room get a read-only Studio and Explore; build it once if it is missing.
if [ ! -f public/guest/guest.html ]; then
  echo "Building the guest view for Wi-Fi screening..."
  npm run build:guest >> logs/guest-build.log 2>&1 || echo "Guest view build failed (see logs/guest-build.log); guests will see a plain panel instead."
fi

# Start EditMap via python subprocess with a completely detached new session
python3 -c "import subprocess; p = subprocess.Popen(['npm', 'run', 'dev'], stdout=open('logs/editmap.log', 'w'), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True); open('logs/editmap.pid', 'w').write(str(p.pid))"

# Wait up to 15 seconds for Vite to output its Local URL
for i in {1..15}; do
  PORT=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' logs/editmap.log | tail -n 1)
  if [ -n "$PORT" ]; then
    echo "EditMap is ready at $PORT!"
    exit 0
  fi
  sleep 1
done

echo "EditMap launched in background. Check logs/editmap.log for details."
