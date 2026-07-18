// ═══════════════════════════════════════════════════════════════
// Découverte automatique sur le réseau local (UDP multicast)
// ═══════════════════════════════════════════════════════════════
// Objectif : qu'un utilisateur non technique (famille, PME, école) n'ait
// jamais à taper une adresse IP à la main. L'hôte annonce périodiquement
// "un salon Hnaya Chat existe ici", les clients écoutent et affichent la
// liste des salons trouvés.
//
// ⚠️ Le beacon annonce UNIQUEMENT le nom du salon et le port — jamais le
// PIN. Découvrir un salon ne permet pas d'y entrer ; il faut connaître
// le PIN affiché par l'hôte pour que les messages deviennent lisibles
// (voir crypto.js). La découverte est donc volontairement "publique" sur
// le réseau local, mais le contenu reste protégé.
//
// setMulticastTTL(1) garantit que le paquet ne traverse aucun routeur —
// il reste strictement sur le segment réseau local, jamais sur internet.

import dgram from "node:dgram";
import os from "node:os";

const MULTICAST_ADDR = "239.255.250.1"; // plage multicast locale (administratively scoped)
const MULTICAST_PORT = 41234;
const BEACON_INTERVAL_MS = 2000;

/**
 * Côté hôte : diffuse périodiquement l'existence du salon sur le réseau.
 * Retourne une fonction stop() à appeler quand le salon est fermé.
 */
export function startBeacon({ sessionName, wsPort, httpPort }) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("error", (err) => {
    console.error("[hnaya-chat] Erreur beacon découverte :", err.message);
  });

  socket.bind(() => {
    socket.setBroadcast(true);
    socket.setMulticastTTL(1); // ne sort JAMAIS du réseau local
    try { socket.addMembership(MULTICAST_ADDR); } catch { /* déjà membre */ }
  });

  const message = Buffer.from(JSON.stringify({
    type: "hnaya-chat-beacon",
    v: 1,
    sessionName,
    wsPort,
    // Port de la page mobile (accès téléphone) — optionnel : les vieux
    // hôtes ne l'annoncent pas, les clients prévoient un repli
    httpPort: httpPort || null,
    hostname: os.hostname(),
  }));

  const interval = setInterval(() => {
    socket.send(message, MULTICAST_PORT, MULTICAST_ADDR);
  }, BEACON_INTERVAL_MS);

  // ⚠️ stop() DOIT être idempotent : fermer un socket dgram déjà fermé
  // jette ERR_SOCKET_DGRAM_NOT_RUNNING — voir le commentaire détaillé
  // dans listenForSessions() ci-dessous.
  let stopped = false;
  return function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    try { socket.close(); } catch { /* déjà fermé */ }
  };
}

/**
 * Côté client : écoute les salons annoncés sur le réseau local.
 * onSessionFound(session) est appelé à chaque beacon reçu, avec
 * l'adresse IP de l'hôte ajoutée automatiquement (rinfo.address).
 * Retourne une fonction stop() pour arrêter l'écoute.
 */
export function listenForSessions(onSessionFound) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === "hnaya-chat-beacon") {
        onSessionFound({ ...data, address: rinfo.address });
      }
    } catch {
      // paquet non reconnu (pas un beacon Hnaya) — ignoré silencieusement
    }
  });

  socket.on("error", (err) => {
    console.error("[hnaya-chat] Erreur écoute découverte :", err.message);
  });

  socket.bind(MULTICAST_PORT, () => {
    try { socket.addMembership(MULTICAST_ADDR); } catch { /* déjà membre */ }
  });

  // ⚠️ stop() DOIT être idempotent. Il peut être appelé DEUX fois : par le
  // minuteur de fin d'écoute (discoverSessions) ET par l'annulation
  // manuelle au lancement d'une nouvelle recherche. Fermer un socket déjà
  // fermé jette ERR_SOCKET_DGRAM_NOT_RUNNING, ce qui interrompait la mise
  // en place de la nouvelle écoute — la découverte restait morte jusqu'au
  // redémarrage complet de l'application (bug observé en test terrain :
  // « il faut relancer le navigateur pour retrouver le salon »).
  let stopped = false;
  return function stop() {
    if (stopped) return;
    stopped = true;
    try { socket.close(); } catch { /* déjà fermé */ }
  };
}
