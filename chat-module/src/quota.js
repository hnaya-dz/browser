// ═══════════════════════════════════════════════════════════════
// Quota de téléversement par appareil (étape E)
// ═══════════════════════════════════════════════════════════════
// POURQUOI : le README signalait depuis le MVP l'absence de limite de
// débit (« à ajouter avant un déploiement en administration/école »).
// Tant que seul du texte circulait, la nuisance restait modeste. Avec des
// pièces jointes de 25 Mio, un poste — malveillant ou simplement doté
// d'un script maladroit — peut remplir le disque de l'hôte en quelques
// minutes. Le quota est donc indissociable de la fonctionnalité.
//
// CE QUE ÇA N'EST PAS : une protection contre un attaquant déterminé qui
// contrôle déjà une machine du réseau (il peut changer d'identité). C'est
// un garde-fou proportionné au modèle de menace du LAN — cohérent avec le
// reste du module (voir la section « modèle de sécurité » du README).
//
// FENÊTRE GLISSANTE, EN MÉMOIRE : rien n'est persisté. Un redémarrage de
// l'hôte remet les compteurs à zéro, ce qui est acceptable — le but est
// d'empêcher un emballement continu, pas de tenir une comptabilité.

// Par appareil et par heure glissante.
export const QUOTA_WINDOW_MS = 60 * 60 * 1000;
export const QUOTA_MAX_BYTES = 200 * 1024 * 1024; // 200 Mio/h
export const QUOTA_MAX_FILES = 60;                // 60 fichiers/h

export function createQuota({
  windowMs = QUOTA_WINDOW_MS,
  maxBytes = QUOTA_MAX_BYTES,
  maxFiles = QUOTA_MAX_FILES,
  now = () => Date.now(),
} = {}) {
  // clé (empreinte d'appareil, ou pseudo à défaut) -> [{ ts, bytes }]
  const entries = new Map();

  const prune = (key, t) => {
    const list = entries.get(key);
    if (!list) return [];
    const cutoff = t - windowMs;
    // Les entrées sont ajoutées dans l'ordre chronologique : on coupe en tête.
    let i = 0;
    while (i < list.length && list[i].ts <= cutoff) i++;
    const kept = i ? list.slice(i) : list;
    if (kept.length) entries.set(key, kept);
    else entries.delete(key);
    return kept;
  };

  return {
    /**
     * Ce téléversement tient-il dans le quota ? Appelé AVANT d'accepter le
     * moindre octet (sur l'annonce de taille, donc).
     * @returns {null | "quota-bytes" | "quota-files"}
     */
    check(key, bytes) {
      const t = now();
      const list = prune(key, t);
      if (list.length + 1 > maxFiles) return "quota-files";
      const total = list.reduce((s, e) => s + e.bytes, 0);
      if (total + bytes > maxBytes) return "quota-bytes";
      return null;
    },

    /** Comptabilise un téléversement accepté. */
    record(key, bytes) {
      const t = now();
      const list = prune(key, t);
      list.push({ ts: t, bytes });
      entries.set(key, list);
    },

    /** État courant — utile aux tests et à un futur affichage admin. */
    usage(key) {
      const list = prune(key, now());
      return { files: list.length, bytes: list.reduce((s, e) => s + e.bytes, 0) };
    },

    /** Ménage périodique : évite que la table enfle avec des appareils
     *  partis depuis longtemps. */
    sweep() {
      const t = now();
      for (const key of [...entries.keys()]) prune(key, t);
      return entries.size;
    },
  };
}
