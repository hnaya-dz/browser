// ═══════════════════════════════════════════════════════════════
// Étape M — photo de profil, par PERSONNE
// ═══════════════════════════════════════════════════════════════
// Trois propriétés à tenir :
//
//  1. La photo appartient à la PERSONNE, pas à l'appareil. Depuis
//     l'appairage, quelqu'un qui a un téléphone n'a plus qu'une entrée
//     d'annuaire ; lui demander de déposer sa photo deux fois serait
//     absurde, et l'annuaire montrerait deux visages pour une personne.
//  2. On ne change QUE la sienne. Le serveur part de l'appareil connecté,
//     jamais d'un identifiant venu du réseau — sinon on remplacerait la
//     photo du Directeur.
//  3. Le ménage des fichiers orphelins ne doit PAS effacer les photos.
//     Elles vivent dans le magasin de pièces jointes mais ne sont
//     référencées par aucun message : sans précaution, la première purge
//     les emportait toutes, sans explication pour personne.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import {
  closeStore, listRoster, personIdOf, getPersonAvatar, setPersonAvatar,
  listReferencedMedia, saveMessage,
} from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-avatar-"));
const PORT = 14952, HTTP = 14953, PIN = "717273";

const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "818283",
  dataDir, wsPort: PORT, httpPort: HTTP,
});
await dodo(600);

const sac = () => ({ roster: [], moi: null, majAvatars: 0 });
const brancher = async (nom, dossier, s, pairing) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom,
    dataDir: path.join(dataDir, dossier), groups: ["all"], pairing,
    onMessage: () => {}, onPresence: () => {},
    onRoster: (r) => { s.roster = r.people; s.moi = r.me; },
    onAvatarsChanged: () => { s.majAvatars += 1; },
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const sPoste = sac(), sKarim = sac();
const poste = await brancher("Directeur", "id-poste", sPoste);
const karim = await brancher("Karim", "id-karim", sKarim);
await dodo(700);
poste.requestRoster();
await dodo(600);
const fpPoste = sPoste.moi;

// ── 1. Sans photo, l'annuaire le dit clairement ────────────────────────
// L'interface affichera alors des initiales sur une couleur dérivée de
// l'identifiant — aucun fichier, aucun réseau, toujours quelque chose à
// montrer.
assert.equal(sPoste.roster.find((p) => p.isMe).avatarSha, null,
  "sans photo, l'annuaire renvoie null et non une chaîne vide");

// ── 2. La photo se pose au niveau de la PERSONNE ───────────────────────
// On écrit directement en base : le chemin réseau exige un vrai fichier
// téléversé, vérifié séparément par le contrôle d'existence du serveur.
const personne = personIdOf(fpPoste);
setPersonAvatar(personne, "a".repeat(64));
assert.equal(getPersonAvatar(personne), "a".repeat(64));

poste.requestRoster();
await dodo(700);
assert.equal(sPoste.roster.find((p) => p.isMe).avatarSha, "a".repeat(64),
  "l'annuaire doit porter l'empreinte de la photo, pas la photo elle-même");

// ── 3. Un appareil appairé HÉRITE de la photo de sa personne ───────────
const jeton = poste.makePairingToken();
const sMobile = sac();
const mobile = await brancher("Directeur", "id-mobile", sMobile, jeton);
await dodo(900);
mobile.requestRoster();
await dodo(700);
const vuDuMobile = sMobile.roster.find((p) => p.isMe);
assert.ok(vuDuMobile, "le téléphone appairé se reconnaît");
assert.equal(vuDuMobile.avatarSha, "a".repeat(64),
  "le téléphone hérite de la photo de la personne : on ne la dépose pas deux fois");
assert.equal(sMobile.roster.filter((p) => p.name === "Directeur").length, 1,
  "et il n'y a toujours qu'une entrée, donc un seul visage");

// ── 4. Un serveur ne laisse pas déclarer un fichier ABSENT ─────────────
// Sinon l'annuaire pointerait vers un vide, et chaque client réessaierait
// indéfiniment de le télécharger.
karim.setAvatar("b".repeat(64));
await dodo(700);
const personneKarim = personIdOf(sKarim.moi || "");
assert.equal(getPersonAvatar(personneKarim), null,
  "déclarer une photo jamais téléversée ne doit rien enregistrer");

// ── 5. Chacun ne change que la SIENNE ──────────────────────────────────
// Karim n'a aucun moyen de désigner la personne du Directeur : le serveur
// part de l'appareil connecté. On vérifie que la photo du Directeur est
// intacte après la tentative de Karim.
assert.equal(getPersonAvatar(personne), "a".repeat(64),
  "la photo du Directeur ne doit pas avoir bougé");

// ── 6. Le salon est prévenu d'un changement ────────────────────────────
setPersonAvatar(personne, "c".repeat(64));
poste.setAvatar(null);   // retrait : aucun fichier à vérifier
await dodo(800);
assert.equal(getPersonAvatar(personne), null, "on doit pouvoir retirer sa photo");
assert.ok(sKarim.majAvatars >= 1,
  "les autres doivent être prévenus, sinon leur annuaire reste périmé");

// ── 7. La purge des orphelins ÉPARGNE les photos ───────────────────────
// C'est le piège : une photo n'est référencée par aucun message.
setPersonAvatar(personne, "d".repeat(64));
saveMessage({
  id: "msg_avec_piece", roomId: host.roomId, groupId: "all", from: "Karim",
  text: "avec pièce jointe", ts: Date.now(),
  media: { kind: "image", mime: "image/jpeg", sha256: "e".repeat(64), size: 1 },
});
const references = listReferencedMedia();
assert.ok(references.has("e".repeat(64)), "la pièce jointe d'un message est référencée");
assert.ok(references.has("d".repeat(64)),
  "la photo de profil doit l'être aussi — sinon la purge l'efface sans explication");

poste.close(); karim.close(); mobile.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ avatar.test.mjs : 11 assertions PASSÉES (photo par personne, héritée à l'appairage, épargnée par la purge)");
process.exit(0);
