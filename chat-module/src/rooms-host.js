// ═══════════════════════════════════════════════════════════════
// Façade multi-salons — un service, un port, plusieurs salons
// ═══════════════════════════════════════════════════════════════
// Jusqu'ici, un salon = une paire de ports. Trois salons sur une machine
// (Global, Direction, DRH) demandaient trois services, trois répertoires
// de données, trois règles de pare-feu et trois adresses mobiles à
// communiquer aux utilisateurs. Avec, au passage, une conséquence que rien
// ne signalait : le plafond d'appareils de la licence se compte PAR BASE
// (countDevices), donc trois bases donnaient trois plafonds indépendants —
// une licence de 50 postes en autorisait 150.
//
// Ici : une seule écoute, une seule base, un seul décompte.
//
// ⚠️ POURQUOI L'AIGUILLAGE SE FAIT PAR LE CHEMIN, ET PAS DANS LE PROTOCOLE.
// Le code d'accès d'un salon n'est pas seulement vérifié : il CHIFFRE le
// transport (deriveKeyFromPin, server.js). La toute première trame est
// déjà chiffrée avec la clé du salon. Impossible, donc, de lire un
// « à quel salon vas-tu ? » à l'intérieur : il faudrait la clé pour lire
// le message qui dit quelle clé employer.
// L'aiguillage se fait donc AVANT le chiffrement, au raccordement HTTP :
//   ws://hôte:4802/r/<roomId>
// Chaque salon conserve alors intégralement sa clé, son état et sa
// logique — le protocole signé, l'historique, les votes et les réunions
// ne sont pas touchés d'une ligne.
//
// Connaître un roomId ne donne rien : il faut le code d'accès du salon
// pour que la moindre trame soit déchiffrable. Un chemin inconnu est
// refermé sans réponse utile.
//
// Compatibilité : un client d'une version antérieure se raccorde sur « / »
// et tombe sur le salon PRINCIPAL (le premier de la liste). Rien de ce qui
// existe ne cesse de fonctionner.

import http from "node:http";
import { WebSocketServer } from "ws";
import { startHost } from "./server.js";
import { startMobileServer } from "./mobile-server.js";
import { startBeacon } from "./discovery.js";

const WS_PORT = 4802;

/** Chemin d'un salon. Exporté : le client compose la même chose. */
export function cheminSalon(roomId) {
  return roomId ? `/r/${encodeURIComponent(roomId)}` : "/";
}

function roomIdDuChemin(url) {
  const chemin = String(url || "/").split("?")[0];
  const m = /^\/r\/([^/]+)\/?$/.exec(chemin);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Ouvre plusieurs salons derrière une seule écoute.
 *
 * @param {Array<{name?, pin?, adminPin?, roomId?}>} salons — dans l'ordre ;
 *        le PREMIER est le salon principal, servi aussi sur « / ».
 * @returns handle { wsPort, httpPort, rooms, get(roomId), notifyLicence(), stop() }
 */
export function startRoomsHost({
  salons = [], dataDir, wsPort = WS_PORT, httpPort,
  onError, maxDevices = null, licenceState = null,
} = {}) {
  if (!Array.isArray(salons) || salons.length === 0) {
    throw new Error("startRoomsHost : au moins un salon est requis.");
  }

  // L'écoute est à NOUS ; les serveurs WebSocket des salons sont en mode
  // « noServer » : ils ne touchent aucun port, on leur remet les
  // raccordements déjà aiguillés.
  const serveurHttp = http.createServer((req, res) => {
    // Ce port ne sert que le protocole WebSocket. La page mobile vit sur
    // httpPort. Répondre clairement évite de laisser croire à une panne.
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Hnaya — ce port attend une connexion WebSocket.\n");
  });

  const hotes = new Map();     // roomId -> handle de startHost
  const serveursWs = new Map(); // roomId -> WebSocketServer (noServer)
  let principal = null;

  let erreurRemontee = false;
  serveurHttp.on("error", (err) => {
    // Une seule remontée, quel que soit le nombre de salons : l'appelant
    // n'a pas à recevoir la même panne de port autant de fois.
    if (erreurRemontee) return;
    erreurRemontee = true;
    const lisible = err?.code === "EADDRINUSE"
      ? `Le port ${wsPort} est déjà utilisé — un serveur Hnaya tourne probablement déjà sur cette machine.`
      : (err?.message || String(err));
    if (onError) onError(lisible, err);
    else console.error(`[hnaya-chat] Erreur serveur : ${lisible}`);
  });

  // Déclaré AVANT la boucle, et non plus après : la capacité ci-dessous le
  // référence, et une dépendance en avant ne tient que tant que personne
  // ne l'appelle trop tôt. Ce projet a déjà payé deux fois ce genre de
  // pari (applyLang, sonActif) — on supprime le piège au lieu de compter
  // dessus. `hotes` est vide ici et se remplit au fil de la boucle : la
  // liste est donc lue à l'appel, jamais figée.
  const listeSalons = () => [...hotes.values()].map((h) => ({
    roomId: h.roomId, name: h.name, path: cheminSalon(h.roomId),
  }));

  // Capacité d'affectation, remise au SEUL salon principal (le premier).
  // C'est lui, et lui seul, qui peut composer les autres salons : voir le
  // bloc « affectation » du switch admin de server.js. Les admins de
  // service gardent leur cloisonnement.
  // Fonction et non liste figée : les salons se déclarent au fil de la
  // boucle, et le premier est construit avant les suivants.
  const porteePrincipale = { estPrincipal: true, listerSalons: () => listeSalons() };

  for (const salon of salons) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    const estLePremier = !principal;
    const hote = startHost({
      portee: estLePremier ? porteePrincipale : null,
      sessionName: salon.name ?? undefined,
      pin: salon.pin,
      adminPin: salon.adminPin,
      roomId: salon.roomId || undefined,
      dataDir, wsPort, httpPort,
      maxDevices, licenceState, onError,
      wss, servicesPartages: true,
    });
    hotes.set(hote.roomId, hote);
    serveursWs.set(hote.roomId, wss);
    if (!principal) principal = hote.roomId;
    console.log(`[hnaya-chat] Salon "${hote.name}" — ${cheminSalon(hote.roomId)} — code : ${hote.pin}`);
  }

  serveurHttp.on("upgrade", (req, socket, head) => {
    // « / » → salon principal : un client d'une version antérieure ne
    // connaît pas les chemins et doit continuer de fonctionner.
    const demande = roomIdDuChemin(req.url);
    const cible = demande === null ? principal : demande;
    const wss = serveursWs.get(cible);
    if (!wss) {
      // Chemin inconnu. On referme sans dire si le salon existe ailleurs :
      // le raccordement n'apprend rien à qui sonde au hasard.
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  serveurHttp.listen(wsPort, "0.0.0.0");

  // Page mobile et signal de découverte : UN pour l'ensemble. Le nom
  // annoncé est celui du salon principal ; la liste complète accompagne
  // l'annonce pour que les postes puissent choisir.
  const nomPrincipal = hotes.get(principal).name;
  const mobileServer = startMobileServer({
    sessionName: nomPrincipal, wsPort, httpPort, rooms: listeSalons(),
  });
  const stopBeacon = startBeacon({
    sessionName: nomPrincipal, wsPort, httpPort: mobileServer.httpPort,
    rooms: listeSalons(),
  });

  return {
    wsPort,
    httpPort: mobileServer.httpPort,
    get rooms() { return listeSalons(); },
    /** Handle d'un salon (son PIN admin, son nom…) — sans argument : le principal. */
    get(roomId) { return hotes.get(roomId || principal) || null; },
    notifyLicence() { for (const h of hotes.values()) h.notifyLicence(); },
    async stop() {
      // Les salons d'abord (ils ferment leurs connexions), l'écoute
      // ensuite : l'inverse laisserait des sockets orphelines.
      stopBeacon();
      await Promise.all([...hotes.values()].map((h) => h.stop().catch(() => {})));
      await mobileServer.stop();
      await new Promise((resolve) => {
        try { serveurHttp.close(() => resolve()); } catch { resolve(); }
      });
      console.log(`[hnaya-chat] ${hotes.size} salon(s) fermé(s) — port ${wsPort} libéré.`);
    },
  };
}
