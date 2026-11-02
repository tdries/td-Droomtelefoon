#!/bin/bash
# Droomtelefoon: double-click to play (macOS).
# The first time it puts Node.js in this folder if your Mac has none (~50 MB), installs the game's parts and asks for your
# Claude API key once (kept in .env, readable only by you). Then it starts the game, keeps the Mac awake while it runs,
# and opens the TV board and the Droomtelefoon in your browser. Close this window to stop the game.
cd "$(dirname "$0")" || exit 1
NODE_V=22.23.2
PORT="${PORT:-3000}"
say() { printf '\n\033[1;35m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n' "$*"; read -r -p "Druk op Enter om te sluiten (press Enter to close). " _; exit 1; }
say "📞 Droomtelefoon"

# 1. Node.js 18+: this folder's own copy first, else one already on the Mac (installer, Homebrew, nvm), else download one
node_ok() { [ -n "$1" ] && [ -x "$1" ] && "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null; }
NODE=""
for c in "$PWD/.runtime/node/bin/node" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node \
         "$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"; do
  if node_ok "$c"; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
  say "Eenmalig: Node.js $NODE_V downloaden (± 50 MB). One-time download…"
  mkdir -p .runtime && curl -fL --progress-bar "https://nodejs.org/dist/v$NODE_V/node-v$NODE_V-darwin-$ARCH.tar.gz" | tar -xz -C .runtime \
    && rm -rf .runtime/node && mv ".runtime/node-v$NODE_V-darwin-$ARCH" .runtime/node || fail "Download mislukt. Is er internet? (Download failed.)"
  NODE="$PWD/.runtime/node/bin/node"
fi
export PATH="$(dirname "$NODE"):$PATH"

# 2. the game's own packages, once
if [ ! -d node_modules/@anthropic-ai/sdk ] || [ ! -d node_modules/exceljs ]; then
  say "Eenmalig: onderdelen installeren. Installing…"
  npm install --omit=dev --no-audit --no-fund || fail "Installeren mislukt. (Install failed.)"
fi

# 3. the Claude API key, asked once
if [ -z "$ANTHROPIC_API_KEY" ] && ! grep -q '^ANTHROPIC_API_KEY=.' .env 2>/dev/null; then
  say "Je Claude API-sleutel (your Claude API key)"
  echo "Maak er een op https://platform.claude.com/settings/keys en plak hem hieronder (je ziet niets verschijnen, dat is normaal)."
  echo "Leeg laten + Enter = demo zonder AI. (Leave empty for a demo without AI.)"
  read -r -s -p "Sleutel / key: " KEY; echo
  if [ -n "$KEY" ]; then (umask 077; printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" > .env); echo "Bewaard in .env (saved)."; fi
fi

# 4. already running? then just open it again
if curl -s --max-time 2 "http://localhost:$PORT/play" | grep -q Droomtelefoon; then
  say "De Droomtelefoon draait al. (Already running.)"; [ -n "$NO_OPEN" ] || { open "http://localhost:$PORT/"; open "http://localhost:$PORT/phone"; }; exit 0
fi
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && fail "Poort $PORT is bezet door een ander programma. Sluit het, of start met PORT=3001. (Port in use.)"

# 5. open the TV board and the Droomtelefoon as soon as the game answers (localhost: the laptop's microphone works without certificates)
[ -n "$NO_OPEN" ] || ( for _ in $(seq 1 60); do curl -s --max-time 1 "http://localhost:$PORT/" >/dev/null && break; sleep 0.5; done
  open "http://localhost:$PORT/"; sleep 1; open "http://localhost:$PORT/phone" ) &
say "Het spel draait. Laat dit venster open: sluiten = stoppen. (Keep this window open; closing it stops the game.)"
exec caffeinate -dims "$NODE" server.js
