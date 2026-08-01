// ═══════════════════════════════════════════════════════════════
// Conversations privées entre deux personnes (étape F)
// ═══════════════════════════════════════════════════════════════
// Un fil privé n'est pas un salon : il n'a ni PIN, ni création, ni
// invitation. Il EXISTE dès que deux appareils du même salon se parlent,
// et son identifiant se déduit des deux empreintes — les deux côtés
// calculent donc le même sans rien négocier.
//
// ⚠️ L'APPARTENANCE EST DANS L'IDENTIFIANT, ce qui est le point de
// sécurité de ce fichier : le serveur n'a pas à tenir un registre de
// membres, il lui suffit de vérifier que l'empreinte du demandeur figure
// dans l'identifiant du fil. Sans cette vérification, n'importe quel
// participant pourrait s'abonner au fil de deux collègues et en recevoir
// tout l'historique.
//
// ⚠️ NE PAS MODIFIER sans relire :
//   - le tri des empreintes (sans lui, A→B et B→A donneraient deux fils
//     distincts et chacun ne verrait que la moitié de la conversation) ;
//   - isMemberOfDirect, appelé AVANT toute lecture comme toute écriture.

export const DIRECT_PREFIX = "dm:";

const FP = /^[0-9a-f]{16}$/;

/** Identifiant du fil entre deux empreintes. Ordre indifférent. */
export function directGroupId(fpA, fpB) {
  const a = String(fpA || "").toLowerCase();
  const b = String(fpB || "").toLowerCase();
  if (!FP.test(a) || !FP.test(b)) throw new Error("empreinte invalide");
  if (a === b) throw new Error("fil avec soi-même");
  return DIRECT_PREFIX + [a, b].sort().join("+");
}

export function isDirectGroup(groupId) {
  return typeof groupId === "string" && groupId.startsWith(DIRECT_PREFIX);
}

/** Les deux empreintes d'un fil privé, ou null si l'identifiant est
 *  malformé — on ne fait JAMAIS confiance à une chaîne venue du réseau. */
export function directMembers(groupId) {
  if (!isDirectGroup(groupId)) return null;
  const parts = groupId.slice(DIRECT_PREFIX.length).split("+");
  if (parts.length !== 2) return null;
  if (!parts.every((p) => FP.test(p))) return null;
  // Un identifiant non trié serait accepté puis produirait un second fil
  // pour la même paire : on l'écarte.
  if (parts[0] >= parts[1]) return null;
  return parts;
}

/** Cet appareil a-t-il le droit de lire et d'écrire dans ce fil ? */
export function isMemberOfDirect(groupId, fingerprint) {
  const members = directMembers(groupId);
  if (!members) return false;
  return members.includes(String(fingerprint || "").toLowerCase());
}

/** L'autre participant, vu depuis une empreinte donnée. */
export function otherMember(groupId, fingerprint) {
  const members = directMembers(groupId);
  if (!members) return null;
  const me = String(fingerprint || "").toLowerCase();
  return members.find((m) => m !== me) || null;
}
