"use client";
import { useState, useEffect } from "react";

// Global tutorial state (module-level store, not React state, so it persists across mount/unmount)
interface TutorialStore {
  isActive: boolean;
  currentStep: number;
  hasCompleted: boolean;
}

const store: TutorialStore = {
  isActive: false,
  currentStep: 0,
  hasCompleted: false,
};

const listeners = new Set<() => void>();

export const getTutorialSnapshot = (): TutorialStore => ({ ...store });

export const setTutorialActive = (active: boolean) => {
  store.isActive = active;
  if (active && store.hasCompleted) {
    store.currentStep = 0; // Reset to start if re-opening
  }
  notifyListeners();
};

export const setTutorialStep = (step: number) => {
  store.currentStep = Math.max(0, step);
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

export const completeTutorial = () => {
  store.hasCompleted = true;
  store.isActive = false;
  notifyListeners();
};

export const resetTutorial = () => {
  store.currentStep = 0;
  store.hasCompleted = false;
  store.isActive = false;
  notifyListeners();
};

export const skipTutorial = () => {
  store.hasCompleted = true;
  store.isActive = false;
  notifyListeners();
};

const notifyListeners = () => {
  listeners.forEach((fn) => fn());
};

export const useTutorialSnapshot = (callback?: () => void) => {
  const [state, setState] = useState(getTutorialSnapshot());

  useEffect(() => {
    const handleUpdate = () => {
      setState(getTutorialSnapshot());
      callback?.();
    };
    listeners.add(handleUpdate);
    return () => listeners.delete(handleUpdate);
  }, [callback]);

  return state;
};
