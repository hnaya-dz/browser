"use client";
import dynamic from "next/dynamic";
import { setPanelOpen, useChatSnapshot } from "@/context/chatstore";

const ChatPanel = dynamic(() => import("./ChatPanel"), { ssr: false });

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
  if (!chat.panelOpen) return null;
  return <ChatPanel onClose={() => setPanelOpen(false)} />;
}
