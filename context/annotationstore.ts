"use client";
// ═══════════════════════════════════════════════════════════════
// État de l'annotation de pages — même patron que context/chatstore.ts
// (objet de module + jeu d'abonnés), et pour la même raison : l'état doit
// survivre au démontage de la surface, et être lisible par la barre
// d'adresse sans la faire dépendre du composant lourd.
// ═══════════════════════════════════════════════════════════════
// Voir docs/ANNOTATION-CADRAGE.md pour le cadrage complet.
import { useEffect, useState } from "react";

/** La capture brute rendue par le process principal. Les octets sont ceux
 *  du PNG d'origine : la surface les dessine, mais ne les modifie jamais —
 *  l'export repart d'eux à chaque fois. */
export interface Capture {
  bytes: Uint8Array;
  w: number;
  h: number;
  url: string;
  title: string;
  capturedAt: number;
}

export interface AnnotationStore {
  /** La surface est-elle montée ? Pilotée UNIQUEMENT par ouvrir()/fermer()
   *  — comme panelOpen côté messagerie, pour qu'il n'existe qu'une seule
   *  source de vérité et jamais deux surfaces à la fois. */
  ouverte: boolean;
  /** "capture" : on attend le PNG du process principal. */
  etat: "idle" | "capture" | "prete" | "erreur";
  capture: Capture | null;
  /** Clé i18n d'erreur (Annotation.*), jamais un message en dur. */
  erreur: string | null;
}

export const annotationStore: AnnotationStore = {
  ouverte: false,
  etat: "idle",
  capture: null,
  erreur: null,
};

const listeners = new Set<() => void>();
function notify() { listeners.forEach((fn) => fn()); }

export function patchAnnotation(patch: Partial<AnnotationStore>) {
  Object.assign(annotationStore, patch);
  notify();
}

function getApi() {
  return typeof window !== "undefined" ? (window as any).electronAPI : null;
}

/**
 * Capture la vue active puis ouvre la surface.
 *
 * ⚠️ ORDRE IMPORTANT : on capture AVANT de masquer la vue. `capturePage()`
 * photographie ce qui est rendu ; sur une vue déjà retirée de la fenêtre,
 * on récupère une image vide ou l'appel échoue. Le masquage n'intervient
 * qu'une fois les octets en main.
 */
export async function ouvrirAnnotation() {
  if (annotationStore.ouverte) return;
  const api = getApi();
  if (!api?.invoke) return;

  patchAnnotation({ ouverte: true, etat: "capture", capture: null, erreur: null });
  try {
    const res = await api.invoke("annotate-capture");
    if (!res?.ok) {
      // Trois causes bien distinctes, trois messages : « aucune page
      // ouverte », « la page ne s'affiche pas encore » et l'échec
      // technique. Les confondre laissait l'utilisateur sans recours
      // alors que, dans le cas courant, il lui suffit d'attendre.
      const messages: Record<string, string> = {
        "no-view": "erreurPasDePage",
        empty: "erreurPageNonAffichee",
      };
      patchAnnotation({ etat: "erreur", erreur: messages[res?.error] || "erreurCapture" });
      return;
    }
    // La vue est masquée MAINTENANT : la surface va s'afficher par-dessus,
    // et sans ce masquage la WebContentsView la recouvrirait entièrement
    // (voir docs/DEV-INVARIANTS.md — panneaux modaux).
    await api.invoke("hide-active-view-sync");
    patchAnnotation({
      etat: "prete",
      capture: {
        bytes: res.bytes, w: res.w, h: res.h,
        url: res.url || "", title: res.title || "",
        capturedAt: Date.now(),
      },
    });
  } catch {
    patchAnnotation({ etat: "erreur", erreur: "erreurCapture" });
  }
}

export function fermerAnnotation() {
  const etaitPrete = annotationStore.etat === "prete";
  patchAnnotation({ ouverte: false, etat: "idle", capture: null, erreur: null });
  // On ne redonne la vue que si on l'avait masquée : sur une erreur de
  // capture, `hide-active-view-sync` n'a jamais été appelé, et un
  // `show-active-view` de trop réaffiche une vue au mauvais moment.
  if (etaitPrete) getApi()?.send?.("show-active-view");
}

export function useAnnotationSnapshot(): AnnotationStore {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return annotationStore;
}
