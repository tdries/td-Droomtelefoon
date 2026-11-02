#!/bin/sh
# Power-user start script (the double-click launchers are simpler). Key from the environment, from .env, or from 1Password (OP_REF).
#   ./start.sh             → (re)start the game server (stops a running one; asks first during a game)
#   ./start.sh check [model ...]  → test call + sms with timings per model
#   ./start.sh portretten  → profile photos for co-players + drawn portraits (also runs after each setup)
set -e
cd "$(dirname "$0")"
REF="${OP_REF:-op://Private/Claude API KEY/username}"

# ./start.sh = (re)start: a Droomtelefoon server already on this port is stopped first; during a game you are asked.
if [ "${1:-server}" = "server" ]; then
  PORT="${PORT:-3000}"
  PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
  if [ -n "$PID" ]; then
    if lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | grep -q "^n$(pwd)$" && ps -o command= -p "$PID" | grep -q "node server.js"; then
      PHASE=$(curl -s -N --max-time 2 "http://localhost:$PORT/events?role=host" 2>/dev/null | head -1 | grep -o '"phase":"[a-z]*"' | cut -d'"' -f4)
      if [ "$PHASE" = "playing" ]; then
        printf "Er loopt nog een spel op poort %s. Toch herstarten? [j/N] " "$PORT"; read -r ANS
        case "$ANS" in j|J|ja|Ja|JA) ;; *) echo "Niets gedaan, de server draait verder."; exit 0 ;; esac
      fi
      echo "Draaiende Droomtelefoon-server stoppen (PID $PID)..."
      kill "$PID"; i=0
      while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 && [ $i -lt 20 ]; do sleep 0.25; i=$((i + 1)); done
    else
      echo "Poort $PORT is in gebruik door een ander programma. Kies een andere poort: PORT=3001 ./start.sh"; exit 1
    fi
  fi
fi

# no key yet, none in .env (the double-click launchers write that) and 1Password is installed: ask 1Password
if [ -z "$ANTHROPIC_API_KEY" ] && ! grep -q '^ANTHROPIC_API_KEY=.' .env 2>/dev/null && command -v op >/dev/null 2>&1; then
  ERR=$(mktemp)
  # ponytail: tries every signed-in account, since the reference doesn't name one
  for acct in $(op account list --format json 2>/dev/null | python3 -c 'import sys,json;print(" ".join(a["url"] for a in json.load(sys.stdin)))'); do
    ANTHROPIC_API_KEY=$(op read --account "$acct" "$REF" 2>>"$ERR" || true)
    if [ -n "$ANTHROPIC_API_KEY" ]; then
      echo "API key: geladen uit 1Password ($acct)"
      case "$ANTHROPIC_API_KEY" in sk-ant-*) ;; *) echo "  let op: waarde begint niet met sk-ant-, is dit wel een Anthropic-key?" ;; esac
      break
    fi
  done
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "API key: NIET gevonden in $REF, scripted fallback. 1Password zei:"
    sed 's/^/  /' "$ERR"
  fi
  rm -f "$ERR"
  export ANTHROPIC_API_KEY
fi

# HTTPS for the Droomtelefoon microphone: a mkcert certificate for this Mac's current LAN address.
# The iPhone installs certs/rootCA.pem once (http://<mac>:3000/ca.pem); the leaf cert is remade whenever the IP changes.
if [ "${1:-server}" = "server" ] && command -v mkcert >/dev/null 2>&1; then
  IP=$(node -e 'const os=require("os");for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==="IPv4"&&!i.internal){console.log(i.address);process.exit(0)}')
  if [ -n "$IP" ] && ! openssl x509 -in certs/cert.pem -noout -ext subjectAltName 2>/dev/null | grep -qE "IP Address:$IP(,|$)"; then
    mkdir -p certs && mkcert -cert-file certs/cert.pem -key-file certs/key.pem "$IP" localhost 127.0.0.1 >/dev/null 2>&1 \
      && cp "$(mkcert -CAROOT)/rootCA.pem" certs/rootCA.pem && echo "HTTPS-certificaat gemaakt voor $IP"
  fi
fi

case "$1" in
  check) shift; exec node check.js "$@" ;;
  portretten) exec node portraits.js ;;
  server|"") exec node server.js ;;
  *) echo "gebruik: ./start.sh [server|check|portretten]"; exit 1 ;;
esac
