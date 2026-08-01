// ═══════════════════════════════════════════════════════════════
// Pièces jointes (étape E) — stockage sur disque chez l'hôte
// ═══════════════════════════════════════════════════════════════
// POURQUOI DES FICHIERS ET NON LA BASE :
//   Le champ `media` du protocole était réservé depuis le MVP avec cet
//   avertissement (server.js) : « ne pas mettre de gros binaires ici tel
//   quel ». Une image de 2 Mo en base64 dans un message pèse 2,7 Mo, et
//   surtout l'historique renvoyé à CHAQUE connexion les recharrierait
//   tous. Le message ne transporte donc que des MÉTADONNÉES (+ une
//   vignette minuscule) ; le fichier voyage à part, en morceaux, et n'est
//   téléchargé que si le destinataire l'ouvre.
//
// NOM DE FICHIER = EMPREINTE DU CONTENU (sha256) :
//   deux envois du même fichier n'occupent qu'une place, et le
//   destinataire peut vérifier que l'octet reçu est bien celui annoncé.
//
// ⚠️ NE PAS MODIFIER sans relire :
//   - la validation d'empreinte à la fin du transfert (un fichier dont le
//     sha256 ne correspond pas est DÉTRUIT, jamais publié) ;
//   - MAX_MEDIA_BYTES : c'est ce qui empêche un poste du réseau de
//     saturer le disque de l'hôte ;
//   - le nom de fichier est dérivé du sha256 calculé PAR L'HÔTE, jamais
//     d'une chaîne fournie par le client (sinon : traversée de chemin).

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Plafonds. Volontairement modestes : on vise un partage de photos et de
// messages vocaux sur un réseau local, pas un service de fichiers.
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // 8 Mo par pièce jointe
export const MAX_THUMB_BYTES = 24 * 1024;       // vignette inline (base64)
export const CHUNK_BYTES = 64 * 1024;           // taille d'un morceau brut
export const MAX_CONCURRENT_UPLOADS = 4;        // par connexion

// Types acceptés — liste FERMÉE. Tout le reste est refusé : c'est ce qui
// évite qu'un « message vocal » soit en réalité un exécutable.
export const ALLOWED_MIME = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["audio/webm", "weba"],
  ["audio/ogg", "ogg"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
]);

export const KINDS = new Set(["image", "voice"]);

export function mediaDir(dataDir) {
  return path.join(dataDir, "media");
}

/** Chemin du fichier d'une pièce jointe. `sha256` et `mime` sont validés
 *  par l'appelant ; on ne construit JAMAIS un chemin depuis une chaîne
 *  arbitraire du réseau. */
export function mediaPath(dataDir, sha256, mime) {
  if (!/^[0-9a-f]{64}$/.test(String(sha256))) throw new Error("empreinte invalide");
  const ext = ALLOWED_MIME.get(mime);
  if (!ext) throw new Error("type non autorisé");
  return path.join(mediaDir(dataDir), `${sha256}.${ext}`);
}

/** Validation des métadonnées annoncées AVANT d'accepter le moindre octet. */
export function validateAnnounce({ kind, mime, size, thumb }) {
  if (!KINDS.has(kind)) return "kind";
  if (!ALLOWED_MIME.has(mime)) return "mime";
  // Cohérence type/nature : une « image » audio n'a pas de sens et
  // trahirait une tentative de contourner le filtre.
  if (kind === "image" && !mime.startsWith("image/")) return "mime";
  if (kind === "voice" && !mime.startsWith("audio/")) return "mime";
  if (!Number.isInteger(size) || size <= 0 || size > MAX_MEDIA_BYTES) return "size";
  if (thumb && Buffer.byteLength(String(thumb), "utf8") > MAX_THUMB_BYTES) return "thumb";
  return null;
}

/**
 * Réception d'une pièce jointe, morceau par morceau.
 * L'écriture va dans un fichier temporaire ; il n'est publié sous son nom
 * définitif QUE si la taille et l'empreinte correspondent à l'annonce.
 */
export function createUpload({ dataDir, kind, mime, size, thumb }) {
  const invalid = validateAnnounce({ kind, mime, size, thumb });
  if (invalid) throw new Error(invalid);

  fs.mkdirSync(mediaDir(dataDir), { recursive: true });
  const tmpPath = path.join(mediaDir(dataDir), `.tmp-${randomUUID()}`);
  const fd = fs.openSync(tmpPath, "w");
  const hash = createHash("sha256");
  let received = 0;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { fs.closeSync(fd); } catch { /* déjà fermé */ }
    try { fs.unlinkSync(tmpPath); } catch { /* déjà supprimé */ }
  };

  return {
    kind, mime, size, thumb: thumb || null,
    get received() { return received; },

    /** Ajoute un morceau. Lève si l'annonce est dépassée — un client qui
     *  annonce 100 Ko ne peut pas en écrire 10 Mo. */
    write(buf) {
      if (closed) throw new Error("transfert clos");
      received += buf.length;
      if (received > size) { cleanup(); throw new Error("size"); }
      fs.writeSync(fd, buf);
      hash.update(buf);
    },

    /** Clôt le transfert. Retourne { sha256, path, size } si tout
     *  concorde ; détruit le fichier et lève sinon. */
    finish() {
      if (closed) throw new Error("transfert clos");
      if (received !== size) { cleanup(); throw new Error("size"); }
      const sha256 = hash.digest("hex");
      try { fs.closeSync(fd); } catch { /* déjà fermé */ }
      closed = true;
      const finalPath = mediaPath(dataDir, sha256, mime);
      // Déjà présent (même contenu envoyé deux fois) : on garde l'existant
      // et on jette le doublon plutôt que de réécrire.
      if (fs.existsSync(finalPath)) {
        try { fs.unlinkSync(tmpPath); } catch { /* rien à jeter */ }
      } else {
        fs.renameSync(tmpPath, finalPath);
      }
      return { sha256, path: finalPath, size };
    },

    abort: cleanup,
  };
}

/** Lecture par morceaux pour l'envoi au destinataire. */
export function* readChunks(filePath, chunkBytes = CHUNK_BYTES) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(chunkBytes);
    let seq = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, chunkBytes, null);
      if (n <= 0) break;
      yield { seq: seq++, data: Buffer.from(buf.subarray(0, n)) };
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Ménage : supprime les fichiers qu'aucun message ne référence plus
 * (purge de rétention passée par là) et les temporaires abandonnés.
 * `referenced` = ensemble des sha256 encore cités en base.
 */
export function purgeOrphans(dataDir, referenced) {
  const dir = mediaDir(dataDir);
  if (!fs.existsSync(dir)) return { removed: 0, freed: 0 };
  let removed = 0, freed = 0;
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (!stat.isFile()) continue;
    // Temporaire abandonné (transfert interrompu) : au-delà d'une heure,
    // plus personne ne le reprendra.
    if (name.startsWith(".tmp-")) {
      if (now - stat.mtimeMs > 3600_000) {
        try { fs.unlinkSync(full); removed++; freed += stat.size; } catch { /* course */ }
      }
      continue;
    }
    const sha = name.split(".")[0];
    if (!referenced.has(sha)) {
      try { fs.unlinkSync(full); removed++; freed += stat.size; } catch { /* course */ }
    }
  }
  return { removed, freed };
}
