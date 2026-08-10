// ═══════════════════════════════════════════════════════════════
// Signal sonore d'un message entrant — étape J
// ═══════════════════════════════════════════════════════════════
// Le son est SYNTHÉTISÉ, pas joué depuis un fichier. Trois raisons :
//
//  1. Aucune dépendance ni ressource ajoutée au paquet — la règle de ce
//     module depuis le début (les images passent par Canvas, l'audio par
//     MediaRecorder, rien n'est importé).
//  2. Un .mp3 embarqué serait décodé par Chromium, donc soumis à sa
//     politique de lecture automatique ET à la latence du décodage. Un
//     oscillateur démarre immédiatement.
//  3. Deux timbres distincts se règlent ici en une ligne, là où il
//     faudrait deux fichiers.
//
// ⚠️ Deux timbres, et c'est délibéré : un message du salon et un message
// PRIVÉ ne doivent pas sonner pareil. Le privé est celui qu'on ne doit pas
// rater — il monte, il est plus long, on l'entend d'une autre pièce.

const CLE_ACTIF = "hnaya-chat-son";

let ctx: AudioContext | null = null;

/** Le contexte audio n'est créé qu'au premier besoin, et repris s'il a été
 *  suspendu. Chromium suspend tout contexte créé hors geste utilisateur :
 *  sans ce resume, le premier message d'une session était muet — et comme
 *  les suivants passaient, le défaut aurait été mis sur le compte du
 *  hasard plutôt que sur la politique de lecture automatique. */
function contexte(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try { ctx = new Ctor(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => { /* refusé : on reste muet */ });
  return ctx;
}

/** À appeler sur un vrai geste (ouverture du panneau, connexion à un
 *  salon) : c'est le seul moment où Chromium autorise à débloquer l'audio.
 *  Sans cet amorçage, le premier message reçu ne sonnerait pas. */
export function amorcerSon() {
  if (!estActif()) return;
  contexte();
}

export function estActif(): boolean {
  if (typeof window === "undefined") return false;
  // Actif par défaut : une messagerie de service qui ne fait aucun bruit
  // rate sa fonction. L'utilisateur coupe s'il veut le calme.
  return localStorage.getItem(CLE_ACTIF) !== "0";
}

export function definirActif(actif: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CLE_ACTIF, actif ? "1" : "0");
  if (actif) contexte(); // le clic sur l'interrupteur EST le geste utilisateur
}

/** Une note : fréquence, départ (s après maintenant), durée, volume. */
function note(ac: AudioContext, freq: number, depart: number, duree: number, gain: number) {
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  // Sinus : pas d'harmoniques agressives. Un carré ou une dent de scie
  // ferait « alarme », ce qui est exactement ce qu'on ne veut pas dans un
  // bureau où l'outil sonne toute la journée.
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = ac.currentTime + depart;
  // Enveloppe : montée de 12 ms puis extinction exponentielle. Sans
  // enveloppe, la coupure nette produit un clic audible.
  vol.gain.setValueAtTime(0.0001, t0);
  vol.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
  osc.connect(vol).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duree + 0.02);
}

export type GenreSon = "room" | "private";

/** Joue le signal correspondant. Silencieux si l'utilisateur a coupé le
 *  son, si le navigateur refuse l'audio, ou hors navigateur. Ne lève
 *  jamais : un signal sonore ne doit pas pouvoir casser la réception d'un
 *  message. */
export function jouerSon(genre: GenreSon) {
  if (!estActif()) return;
  const ac = contexte();
  if (!ac) return;
  try {
    if (genre === "private") {
      // Deux notes montantes : plus long, plus haut, on ne le confond pas
      // avec le salon et on l'entend depuis le couloir.
      note(ac, 660, 0, 0.16, 0.16);
      note(ac, 990, 0.13, 0.26, 0.16);
    } else {
      // Salon : une note brève et discrète. Elle sonnera souvent.
      note(ac, 620, 0, 0.14, 0.09);
    }
  } catch { /* contexte fermé entre-temps */ }
}
