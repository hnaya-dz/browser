"use client";
// ═══════════════════════════════════════════════════════════════
// Centre de notifications — surface partagée du navigateur
// ═══════════════════════════════════════════════════════════════
// POURQUOI CE FICHIER EXISTE, et pourquoi maintenant :
//
// Trois signaux vivaient déjà séparément dans l'application — les non-lus
// de la messagerie, la vérification de mise à jour, les téléchargements —
// chacun avec sa propre présentation, inventée sur place. Ajouter le
// rappel de réunion dans le dock de messagerie en aurait fait un
// quatrième, à réécrire le jour où l'on voudrait une surface commune.
//
// On pose donc le MODÈLE d'abord : n'importe quel module publie ici, et
// une seule présentation s'en occupe. Les outils de productivité à venir
// s'y branchent sans rien redessiner.
//
// ⚠️ Ce centre ne remplace PAS les signaux propres à un module : la
// pastille de non-lus reste sur le bouton de messagerie, là où l'œil la
// cherche. Il rassemble ce qui mérite d'être RETROUVÉ plus tard — une
// demande de validation qui vous attend, une licence qui expire, une
// réunion qui approche — et non ce qui se consomme sur l'instant.

import { useEffect, useState } from "react";

/** Module d'origine. Sert au filtrage et à l'icône ; un module inconnu
 *  s'affiche quand même, avec une présentation neutre. */
export type SourceNotif = "messagerie" | "licence" | "agenda" | "systeme";

export interface Notification {
  id: string;
  source: SourceNotif;
  /** Une ligne, lisible seule : c'est souvent tout ce qu'on lira. */
  titre: string;
  /** Détail facultatif, deuxième ligne. */
  detail?: string | null;
  ts: number;
  lue: boolean;
  /** Ce qu'un clic doit faire. Défini par le module qui publie, exécuté
   *  par le centre — qui n'a pas à savoir ce que « ouvrir le fil » veut
   *  dire pour la messagerie. */
  action?: (() => void) | null;
  /** Deux notifications de même clé se REMPLACENT au lieu de s'empiler :
   *  une licence qui expire ne doit pas produire une ligne par heure. */
  cle?: string | null;
}

const MAX = 50;   // au-delà, on oublie les plus anciennes lues

let liste: Notification[] = [];
const abonnes = new Set<() => void>();

function prevenir() { abonnes.forEach((f) => f()); }

export function notifications(): Notification[] { return liste; }
export function nonLues(): number { return liste.filter((n) => !n.lue).length; }

/** Publie une notification. Retourne son identifiant. */
export function publier(n: Omit<Notification, "id" | "ts" | "lue"> & { ts?: number }): string {
  const id = "ntf_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const entree: Notification = {
    id, ts: n.ts ?? Date.now(), lue: false,
    source: n.source, titre: n.titre, detail: n.detail ?? null,
    action: n.action ?? null, cle: n.cle ?? null,
  };
  // Remplacement par clé : « validation attendue » ou « licence échue »
  // n'ont de sens qu'au singulier. Sans cela, une réévaluation horaire de
  // la licence remplirait le centre à elle seule.
  liste = n.cle ? liste.filter((x) => x.cle !== n.cle) : liste;
  liste = [entree, ...liste];
  if (liste.length > MAX) {
    // On ne coupe que dans les LUES : une purge aveugle ferait disparaître
    // ce qu'on n'a pas encore vu, c'est-à-dire précisément l'utile.
    const lues = liste.filter((x) => x.lue);
    const aRetirer = new Set(lues.slice(MAX - liste.filter((x) => !x.lue).length).map((x) => x.id));
    liste = liste.filter((x) => !aRetirer.has(x.id));
  }
  prevenir();
  return id;
}

export function marquerLue(id: string) {
  liste = liste.map((n) => (n.id === id ? { ...n, lue: true } : n));
  prevenir();
}

export function toutMarquerLu() {
  liste = liste.map((n) => (n.lue ? n : { ...n, lue: true }));
  prevenir();
}

export function retirer(id: string) {
  liste = liste.filter((n) => n.id !== id);
  prevenir();
}

/** Vide tout — appelé quand on quitte un salon : les notifications de la
 *  messagerie parlent d'un salon précis et n'ont plus de sens ailleurs. */
export function viderSource(source: SourceNotif) {
  liste = liste.filter((n) => n.source !== source);
  prevenir();
}

/** Abonnement React. Renvoie la liste ET le compte non lu, pour qu'un
 *  composant qui n'affiche que la pastille ne se re-rende pas pour rien. */
export function useNotifications() {
  const [, forcer] = useState(0);
  useEffect(() => {
    const f = () => forcer((n) => n + 1);
    abonnes.add(f);
    return () => { abonnes.delete(f); };
  }, []);
  return { liste, nonLues: liste.filter((n) => !n.lue).length };
}
