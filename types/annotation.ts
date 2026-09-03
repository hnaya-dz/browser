// ═══════════════════════════════════════════════════════════════
// Annotation de pages — modèle de données (phase 1)
// ═══════════════════════════════════════════════════════════════
// POURQUOI UN TABLEAU D'OPÉRATIONS PLUTÔT QU'UNE IMAGE APLATIE :
//   l'image annotée part comme pièce jointe ordinaire (canal média de la
//   messagerie), mais garder les `ops` À CÔTÉ permet au destinataire de
//   REPRENDRE l'annotation — retirer une flèche, répondre par une autre.
//   Une image aplatie ne se reprend pas.
//
// ⚠️ `v` EST OBLIGATOIRE dès le premier jour. Le protocole de messagerie
//    porte le même champ pour la même raison : il permet de faire évoluer
//    le format sans casser les postes restés en arrière. Ne jamais le
//    retirer, ne jamais réutiliser un numéro.

/** Une opération de dessin. `k` discrimine — jamais de champ optionnel
 *  pour distinguer deux formes, TypeScript ne sait pas rétrécir dessus. */
export type Op =
  | { k: "pen";     id: string; pts: [number, number][]; color: string; width: number }
  | { k: "rect";    id: string; a: [number, number]; b: [number, number]; color: string; width: number }
  | { k: "circle";  id: string; a: [number, number]; b: [number, number]; color: string; width: number }
  | { k: "line";    id: string; a: [number, number]; b: [number, number]; color: string; width: number; arrow?: boolean }
  | { k: "text";    id: string; at: [number, number]; text: string; size: number; color: string }
  // Caviardage. Choix de SOUVERAINETÉ, pas de confort : masquer un nom, un
  // montant, une adresse AVANT l'envoi, sans passer par un outil externe.
  // Rendu par un flou de la zone, appliqué sur les pixels — l'image
  // exportée ne contient plus l'information, elle n'est pas simplement
  // recouverte.
  | { k: "blur";    id: string; a: [number, number]; b: [number, number] }
  // Commentaire épinglé. `status` prépare la phase 3 (file de travail) ;
  // en phase 1 il vaut toujours "open".
  | { k: "comment"; id: string; at: [number, number]; body: string; status: "open" | "resolved" };

export type OpKind = Op["k"];

/** Le document complet. Sérialisé tel quel dans le champ `annotation`
 *  d'un message de la Messagerie locale. */
export interface AnnotationDoc {
  v: 1;
  id: string;
  page: {
    url: string;
    title: string;
    /** epoch ms — l'instant de la CAPTURE, pas celui de l'envoi. */
    capturedAt: number;
    /** Dimensions de l'image capturée, en pixels. Les coordonnées des
     *  `ops` sont exprimées dans ce repère : c'est ce qui permet de
     *  reprojeter chez un destinataire dont l'écran diffère. */
    viewport: { w: number; h: number };
  };
  ops: Op[];
  author: {
    name: string;
    /** Empreinte Ed25519 de l'appareil (chat-module/src/identity.js).
     *  Vide tant qu'aucun salon n'est rejoint — annoter hors salon est
     *  permis (décision produit, cadrage §9). */
    fp: string;
  };
}

/** Bornes de sûreté. Le renderer s'y tient, et l'hôte les revérifiera :
 *  ce qui vient d'un client n'est jamais cru sur parole. */
export const ANNOTATION_LIMITS = {
  /** Au-delà, le document alourdit le message sans servir personne. */
  MAX_OPS: 500,
  /** Un trait libre très long finit par peser plus que l'image. */
  MAX_POINTS_PAR_TRAIT: 4000,
  MAX_TEXTE: 500,
  MAX_COMMENTAIRE: 2000,
} as const;

/** Palette de l'annotation. Volontairement courte et contrastée : ces
 *  couleurs doivent rester lisibles sur une capture claire COMME sombre,
 *  et se distinguer les unes des autres pour qui voit mal les rouges. */
export const ANNOTATION_COULEURS = [
  "#ff3b30", // rouge
  "#ff9500", // ambre
  "#00c853", // vert (même vert que l'état « connecté » de la messagerie)
  "#0a84ff", // bleu
  "#ffffff", // blanc
  "#111111", // noir
] as const;

export const ANNOTATION_EPAISSEURS = [2, 4, 8] as const;
