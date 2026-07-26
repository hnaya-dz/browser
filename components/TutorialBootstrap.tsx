"use client";
import { useEffect } from "react";
import { startTutorialFromLaunch } from "@/context/tutorialStore";

// Le guide ne se lance tout seul qu'une fois, à la première installation.
const TUTORIAL_SEEN_KEY = "hnaya-tutorial-seen";

export default function TutorialBootstrap() {
  useEffect(() => {
    // ⚠️ Pas de garde par useRef ici : en développement React monte les
    // effets deux fois (montage → nettoyage → remontage). Un drapeau de
    // ref ferait annuler le minuteur au nettoyage sans jamais le relancer,
    // et le guide ne démarrerait plus du tout. C'est le drapeau
    // localStorage, écrit au déclenchement, qui garantit l'unicité.
    if (localStorage.getItem(TUTORIAL_SEEN_KEY)) return;
    // Court délai : les barres (onglets, navigation) doivent être montées
    // pour que les cibles du projecteur soient mesurables.
    const timer = setTimeout(() => {
      localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
      startTutorialFromLaunch();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
