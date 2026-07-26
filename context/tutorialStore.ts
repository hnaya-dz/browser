"use client";
import { useState, useEffect } from "react";

// État global du tutoriel — store module (pub/sub) et non état React :
// le survol du tutoriel doit survivre au remontage des barres (la barre
// d'adresse se remonte au changement d'onglet, cf. ExternalOpenNotice).
interface TutorialStore {
  isActive: boolean;
  currentStep: number;
  hasCompleted: boolean;
  // true uniquement quand le tutoriel démarre tout seul à la première
  // installation : dans ce cas seulement on affiche l'écran de choix de
  // langue (l'utilisateur ne maîtrise pas forcément la langue système).
  fromLaunch: boolean;
}

const store: TutorialStore = {
  isActive: false,
  currentStep: 0,
  hasCompleted: false,
  fromLaunch: false,
};

const listeners = new Set<() => void>();

const notifyListeners = () => {
  listeners.forEach((fn) => fn());
};

export const getTutorialSnapshot = (): TutorialStore => ({ ...store });

/** Ouverture manuelle (icône Livre) : pas d'écran de langue. */
export const setTutorialActive = (active: boolean) => {
  store.isActive = active;
  store.fromLaunch = false;
  store.currentStep = 0;
  notifyListeners();
};

/** Ouverture automatique au premier lancement : avec écran de langue. */
export const startTutorialFromLaunch = () => {
  store.isActive = true;
  store.fromLaunch = true;
  store.currentStep = 0;
  notifyListeners();
};

export const nextTutorialStep = () => {
  store.currentStep += 1;
  notifyListeners();
};

export const prevTutorialStep = () => {
  store.currentStep = Math.max(0, store.currentStep - 1);
  notifyListeners();
};

export const closeTutorial = () => {
  store.hasCompleted = true;
  store.isActive = false;
  store.currentStep = 0;
  notifyListeners();
};

export const useTutorialSnapshot = () => {
  const [state, setState] = useState(getTutorialSnapshot());

  useEffect(() => {
    const handleUpdate = () => {
      setState(getTutorialSnapshot());
    };
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  return state;
};
