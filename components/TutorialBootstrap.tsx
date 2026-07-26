"use client";
import { useEffect, useRef } from "react";
import { setTutorialActive } from "@/context/tutorialStore";

// Clé localStorage pour tracer si le tutoriel a déjà été montré
const TUTORIAL_SEEN_KEY = "hnaya-tutorial-seen";

export default function TutorialBootstrap() {
  const initialized = useRef(false);

  useEffect(() => {
    // Exécuter une seule fois au premier rendu
    if (initialized.current) return;
    initialized.current = true;

    // Vérifier si c'est la première visite (jamais vu le tutoriel)
    const hasSeenTutorial = localStorage.getItem(TUTORIAL_SEEN_KEY);
    if (!hasSeenTutorial) {
      // Première visite : activer le tutoriel après 800ms (pour laisser le temps au rendu)
      const timer = setTimeout(() => {
        setTutorialActive(true);
        localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

  return null;
}
