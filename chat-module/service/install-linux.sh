#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# Installation du salon permanent Hnaya en service systemd (Linux)
# ═══════════════════════════════════════════════════════════════
# Usage (root) :  sh install-linux.sh "Salon RH" 123456
#   $1 = nom du salon (défaut "Salon Hnaya"), $2 = PIN 6 chiffres (optionnel)
# Prérequis : Node.js 22+ (node dans le PATH), systemd.
set -e

NAME="${1:-Salon Hnaya}"
PIN="$2"
DATA_DIR="/var/lib/hnaya-chat"
MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"

[ "$(id -u)" = "0" ] || { echo "À exécuter en root (sudo)."; exit 1; }
[ -n "$NODE_BIN" ] || { echo "Node.js introuvable dans le PATH."; exit 1; }

# Compte de service sans shell + répertoire de données
id hnaya-chat >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hnaya-chat
mkdir -p "$DATA_DIR"
chown hnaya-chat:hnaya-chat "$DATA_DIR"

PIN_ARG=""
case "$PIN" in [0-9][0-9][0-9][0-9][0-9][0-9]) PIN_ARG=" --pin $PIN";; esac

sed -e "s|^WorkingDirectory=.*|WorkingDirectory=$MODULE_DIR|" \
    -e "s|^ExecStart=.*|ExecStart=$NODE_BIN src/serve.js --name \"$NAME\" --data $DATA_DIR$PIN_ARG|" \
    "$MODULE_DIR/service/hnaya-chat.service" > /etc/systemd/system/hnaya-chat.service

systemctl daemon-reload
systemctl enable --now hnaya-chat
echo "✔ Service hnaya-chat installé et démarré."
echo "  PIN d'accès : journalctl -u hnaya-chat | grep 'PIN'"
