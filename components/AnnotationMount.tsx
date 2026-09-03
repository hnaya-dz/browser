"use client";
import dynamic from "next/dynamic";
import { useAnnotationSnapshot } from "@/context/annotationstore";

// Chargé à la demande : la surface embarque tout le moteur de dessin, et
// la plupart des sessions n'annoteront jamais. Pas de préchargement au
// démarrage contrairement au dock de messagerie — l'annotation part d'un
// clic délibéré, pas d'une notification qui arrive.
const AnnotationSurface = dynamic(() => import("./AnnotationSurface"), { ssr: false });

// ═══════════════════════════════════════════════════════════════
// Point de montage UNIQUE de la surface d'annotation, piloté par le store
// (annotationStore.ouverte). Même raison que ChatDockMount : plusieurs
// boutons peuvent ouvrir l'annotation, aucun ne doit monter sa propre
// surface — deux surfaces superposées masqueraient et démasqueraient la
// vue web chacune de leur côté.
// ═══════════════════════════════════════════════════════════════
export default function AnnotationMount() {
  const snap = useAnnotationSnapshot();
  if (!snap.ouverte) return null;
  return <AnnotationSurface />;
}
