#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# Installation du salon permanent Hnaya en service systemd (Linux)
# ═══════════════════════════════════════════════════════════════
# Usage (root) :  sh install-linux.sh "Salon RH" 482017 ./hcn.hnaya-lic
#   $1 = nom du salon (défaut "Salon Hnaya")
#   $2 = PIN d'accès à 6 chiffres (optionnel, généré sinon)
#   $3 = chemin du fichier .hnaya-lic (optionnel si un seul est déposé
#        à côté du module)
# Prérequis : Node.js 22+ (node dans le PATH), systemd.
set -e

NAME="${1:-Salon Hnaya}"
PIN="$2"
DATA_DIR="/var/lib/hnaya-chat"
MODULE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"

[ "$(id -u)" = "0" ] || { echo "À exécuter en root (sudo)."; exit 1; }
[ -n "$NODE_BIN" ] || {
  echo "Node.js introuvable dans le PATH."
  echo "  Téléchargement officiel : https://nodejs.org/en/download"
  echo "  Debian/Ubuntu, RHEL     : https://github.com/nodesource/distributions"
  exit 1
}

# ⚠️ CONTRÔLE DE VERSION, PAS SEULEMENT DE PRÉSENCE.
# Le stockage repose sur node:sqlite (DatabaseSync), apparu en Node 22.5 et
# SANS repli dans le code. Vérifier que « node » existe ne suffit donc pas :
# Debian 12 livre Node 18, l'installation passait, et le service s'effondrait
# au premier démarrage sur une erreur de module introuvable — illisible pour
# qui installe. Mieux vaut refuser ici, avec la marche à suivre.
# Le calcul est délégué à node lui-même : comparer des versions en shell est
# une source d'erreurs inutile.
NODE_VER="$("$NODE_BIN" -p 'process.versions.node' 2>/dev/null)"
NODE_OK="$("$NODE_BIN" -p 'const [a,b]=process.versions.node.split(".").map(Number); (a>22||(a===22&&b>=5))?"1":"0"' 2>/dev/null)"
[ "$NODE_OK" = "1" ] || {
  echo "Node.js ${NODE_VER:-inconnu} détecté — la version 22.5 ou plus est requise."
  echo "  Raison : la base de données interne (node:sqlite) n'existe pas avant."
  echo "  Téléchargement officiel : https://nodejs.org/en/download"
  echo "  Debian/Ubuntu, RHEL     : https://github.com/nodesource/distributions"
  exit 1
}

# ⚠️ LA LICENCE EST TROUVÉE AVANT DE TOUCHER AU SYSTÈME.
# Le script créait le compte, le répertoire et l'unité systemd, puis
# démarrait un service qui refusait de servir : la licence n'était jamais
# placée. Le premier contact d'un partenaire avec le produit était une
# panne. On la localise donc EN PREMIER, et l'on refuse tout net plutôt
# que de laisser derrière soi une installation à moitié faite.
#
#   $3, s'il est fourni : chemin du fichier .hnaya-lic
#   sinon : l'unique .hnaya-lic déposé à côté du module
LICENCE="$3"
if [ -z "$LICENCE" ]; then
  # « set -- » plutôt qu'un tableau : ce script est en /bin/sh, pas en bash.
  set -- "$MODULE_DIR"/*.hnaya-lic
  if [ -f "$1" ] && [ "$#" -eq 1 ]; then
    LICENCE="$1"
  elif [ "$#" -gt 1 ]; then
    echo "Plusieurs fichiers .hnaya-lic sont présents dans $MODULE_DIR."
    echo "  Indiquez lequel employer :  sh install-linux.sh \"Nom du salon\" <PIN> <licence.hnaya-lic>"
    exit 1
  fi
fi
if [ ! -f "$LICENCE" ]; then
  echo "Licence introuvable."
  echo "  Déposez le fichier .hnaya-lic remis par Hnaya DZ dans $MODULE_DIR,"
  echo "  ou indiquez son chemin :"
  echo "    sh install-linux.sh \"Nom du salon\" <PIN> /chemin/licence.hnaya-lic"
  echo "  Sans licence, le serveur permanent refuse de démarrer."
  echo "  Contact : +213 558 303 030 · contact@hnaya.dz"
  exit 1
fi

# Compte de service sans shell + répertoire de données
id hnaya-chat >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hnaya-chat
mkdir -p "$DATA_DIR"

# La licence est COPIÉE dans le répertoire de données, sous le nom exact
# attendu par serve.js. La copier plutôt que la déplacer laisse l'original
# à l'administrateur : il en aura besoin s'il réinstalle.
cp "$LICENCE" "$DATA_DIR/licence.hnaya-lic"
chown -R hnaya-chat:hnaya-chat "$DATA_DIR"
chmod 600 "$DATA_DIR/licence.hnaya-lic"

PIN_ARG=""
case "$PIN" in [0-9][0-9][0-9][0-9][0-9][0-9]) PIN_ARG=" --pin $PIN";; esac

sed -e "s|^WorkingDirectory=.*|WorkingDirectory=$MODULE_DIR|" \
    -e "s|^ExecStart=.*|ExecStart=$NODE_BIN src/serve.js --name \"$NAME\" --data $DATA_DIR$PIN_ARG|" \
    "$MODULE_DIR/service/hnaya-chat.service" > /etc/systemd/system/hnaya-chat.service

systemctl daemon-reload
systemctl enable --now hnaya-chat
echo "✔ Service hnaya-chat installé et démarré."
echo "  Licence     : $DATA_DIR/licence.hnaya-lic"
echo "  PIN d'accès : journalctl -u hnaya-chat | grep 'PIN'"
