"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { setPanelOpen, useChatSnapshot, getApi } from "@/context/chatstore";

const ChatPanel = dynamic(() => import("./ChatPanel"), { ssr: false });

// Délai avant préchauffage. Assez long pour ne pas disputer le démarrage
// du navigateur, assez court pour être fini avant qu'on ouvre le dock.
const DELAI_PRECHAUFFAGE_MS = 4000;

// ═══════════════════════════════════════════════════════════════
// Point de montage UNIQUE du dock de messagerie, piloté par le store
// global (store.panelOpen). Monté une seule fois dans le layout racine :
// les boutons de la navbar et de la barre d'adresse ne font que basculer
// setPanelOpen — jamais monter leur propre panneau. Sans ce point unique,
// deux panneaux pouvaient coexister (un par bouton), chacun envoyant son
// propre "chat-dock" au process principal → largeurs de vue incohérentes.
// ═══════════════════════════════════════════════════════════════
export default function ChatDockMount() {
  const chat = useChatSnapshot();

  // ⚠️ LE PRÉCHAUFFAGE DOIT AVOIR LIEU AVANT L'OUVERTURE DU PANNEAU.
  // Il vivait dans ChatPanel, donc au MONTAGE du panneau — c'est-à-dire à
  // l'instant précis où l'utilisateur ouvre la messagerie et commence à
  // agir. Trois coûts se cumulaient alors : le chargement du module
  // JavaScript du panneau, le montage du composant, et le démarrage du
  // processus de messagerie (fork + chargement de ws et node:sqlite).
  // Rejoindre un salon, révéler les codes ou ouvrir « Ajouter un mobile »
  // attendaient un processus qui démarrait en même temps qu'eux.
  // Signalé en usage réel : « le temps de connexion est devenu plus lent ».
  //
  // Ici, le point de montage vit en permanence dans la mise en page : le
  // processus est prêt bien avant qu'on ouvre le dock. Différé de quelques
  // secondes pour ne pas alourdir le démarrage du navigateur de ceux qui
  // ne se serviront jamais de la messagerie.
  useEffect(() => {
    const t = setTimeout(() => { getApi()?.send?.("chat-warmup"); }, DELAI_PRECHAUFFAGE_MS);
    return () => clearTimeout(t);
  }, []);

  if (!chat.panelOpen) return null;
  return <ChatPanel onClose={() => setPanelOpen(false)} />;
}
