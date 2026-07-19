// ═══════════════════════════════════════════════════════════════
// Serveur HTTP mobile — page d'accès pour smartphones (C-bis, Marche 1)
// ═══════════════════════════════════════════════════════════════
// Démarré à côté du salon (server.js) : sert une petite page web autonome
// (mobile/index.html + bundle crypto) sur le LAN. Un téléphone sur le même
// wifi scanne le QR affiché par le dock → ouvre http://<ip-hôte>:4803 →
// saisit le PIN → rejoint le salon via le MÊME protocole WebSocket chiffré
// que les postes (aucun changement côté server.js).
//
// Choix de conception (voir aussi mobile/crypto-src.mjs) :
// - HTTP simple, pas de TLS : impossible d'avoir un certificat valide sur
//   une IP privée ; la confidentialité vient du chiffrement applicatif
//   AES-256-GCM par PIN, comme pour les postes.
// - AUCUNE découverte multicast côté téléphone (iOS la restreint) : le QR
//   transporte l'adresse — c'est tout l'intérêt de la Marche 1.
// - Port fixe 4803, voisin du WebSocket 4802 — ajouté au même mécanisme
//   d'autorisation pare-feu (electron.js, chat-network-setup).

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const MOBILE_HTTP_PORT = 4803;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = join(__dirname, "../mobile");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

/**
 * Démarre le serveur de la page mobile.
 * @param {object} opts
 * @param {string} opts.sessionName nom du salon (affiché par la page via /info.json)
 * @param {number} opts.wsPort port WebSocket du salon (la page s'y connecte)
 * @returns {{ httpPort: number, stop: () => void }}
 */
export function startMobileServer({ sessionName = "Hnaya", wsPort = 4802, httpPort = MOBILE_HTTP_PORT } = {}) {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || "/").split("?")[0];

    // Infos dynamiques pour la page (nom du salon, port WS)
    if (urlPath === "/info.json") {
      // CORS ouvert sur CE endpoint uniquement : le dock (origine
      // localhost:47823/3000) l'interroge pour afficher le VRAI nom du
      // salon lors d'une connexion par IP manuelle (étape D). Contenu
      // non sensible : nom public + port — déjà diffusés par le beacon.
      res.writeHead(200, {
        "Content-Type": MIME[".json"],
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ sessionName, wsPort }));
      return;
    }

    // Fichiers statiques de mobile/ — garde-fou anti-traversée de répertoire
    const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const filePath = normalize(join(MOBILE_ROOT, rel));
    if (!filePath.startsWith(normalize(MOBILE_ROOT)) || !existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    try {
      const body = readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
        // no-store : la page évolue avec l'application — un téléphone ne
        // doit jamais garder une vieille version incompatible en cache
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("500");
    }
  });

  // 0.0.0.0 : accessible depuis les autres appareils du LAN (contrairement
  // au serveur statique de l'application, volontairement limité à 127.0.0.1)
  server.listen(httpPort, "0.0.0.0", () => {
    console.log(`[hnaya-chat] Page mobile servie sur le port ${httpPort}`);
  });
  server.on("error", (e) => {
    // Port occupé (autre salon déjà hôte sur ce poste ?) — le salon reste
    // fonctionnel pour les postes ; seul l'accès mobile est indisponible.
    console.warn(`[hnaya-chat] Serveur mobile indisponible : ${e?.message}`);
  });

  let stopped = false; // stop() idempotent — règle du module (voir TECHNIQUES §11)
  return {
    httpPort,
    stop() {
      // Retourne une promesse résolue quand le port est réellement rendu
      // au système — permet d'enchaîner un stop puis un start sans course
      // de libération (EADDRINUSE aléatoire, surtout sous Windows)
      if (stopped) return Promise.resolve();
      stopped = true;
      return new Promise((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
    },
  };
}
