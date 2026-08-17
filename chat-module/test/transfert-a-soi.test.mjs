// ═══════════════════════════════════════════════════════════════
// Transfert vers soi-même — du poste au téléphone, et retour
// Lancer : node test/transfert-a-soi.test.mjs
// ═══════════════════════════════════════════════════════════════
// « Pouvoir connecter son mobile à la messagerie doit permettre d'envoyer
// ses fichiers à soi-même » — service additionnel, et argument de vente.
//
// ⚠️ CE QUE CE TEST ÉTABLIT AVANT TOUT : aucun protocole nouveau n'est
// nécessaire. Un fil privé se route par empreinte d'APPAREIL ; or le poste
// et le téléphone d'une même personne ont deux empreintes distinctes, et
// ne partagent que leur personId. Le fil poste↔téléphone est donc un fil
// privé ordinaire, déjà pris en charge de bout en bout.
//
// directGroupId refuse en revanche un fil d'un appareil vers LUI-MÊME
// (« fil avec soi-même ») : le cas est vérifié ici, car s'il passait, un
// même appareil pourrait s'ouvrir un fil dont l'identifiant ne désigne
// qu'une seule empreinte — et la règle d'appartenance perdrait son sens.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";
import { directGroupId, isMemberOfDirect } from "../src/direct.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-soi-"));
const PIN = "707070";

const hote = startHost({
  sessionName: "Transfert", pin: PIN, dataDir, wsPort: 15201, httpPort: 15202,
});
await dodo(500);

try {
  const recus = { poste: [], mobile: [] };
  const rosters = { poste: [], mobile: [] };
  const brancher = async (nom, dossier, sac, sacRoster, pairing) => {
    const c = joinSession({
      address: "127.0.0.1", wsPort: 15201, pin: PIN, userId: nom,
      dataDir: path.join(dataDir, dossier), groups: ["all"], pairing,
      onMessage: (m) => { if (!m.backlog) sac.push(m); },
      onPresence: () => {},
      onRoster: (r) => sacRoster.push(r),
    });
    await new Promise((r) => c.raw.on("open", r));
    return c;
  };

  // Le poste, puis SON téléphone — rattaché par un jeton d'appairage,
  // ce qui leur donne le même personId sans partager d'empreinte.
  const poste = await brancher("Amina", "id-poste", recus.poste, rosters.poste);
  await dodo(500);
  const jeton = poste.makePairingToken();
  const mobile = await brancher("Amina", "id-mobile", recus.mobile, rosters.mobile, jeton);
  await dodo(700);

  // ── 1. Deux appareils, une seule personne ───────────────────────────
  poste.requestRoster();
  await dodo(400);
  const annuaire = rosters.poste.at(-1);
  assert.ok(annuaire, "l'annuaire répond");
  const moi = annuaire.people.find((p) => p.isMe);
  assert.ok(moi, "on se trouve dans l'annuaire");
  assert.ok(Array.isArray(moi.appareils), "ses propres appareils sont listés");
  assert.equal(moi.appareils.length, 2, "poste + téléphone, une seule personne");
  assert.equal(annuaire.people.length, 1,
    "une seule entrée : l'annuaire compte des PERSONNES, pas des appareils");

  // ⚠️ Et les appareils des AUTRES ne sont pas divulgués. On le vérifie en
  // faisant entrer un tiers, puis en relisant l'annuaire de son côté.
  const tiers = await brancher("Karim", "id-tiers", [], []);
  await dodo(600);
  poste.requestRoster();
  await dodo(400);
  const vuDuPoste = rosters.poste.at(-1).people;
  const karimVuDuPoste = vuDuPoste.find((p) => !p.isMe);
  assert.ok(karimVuDuPoste, "le tiers apparaît");
  assert.equal(karimVuDuPoste.appareils, undefined,
    "⚠️ les appareils d'autrui ne sont PAS divulgués");

  // ── 2. Le fil poste ↔ téléphone est un fil privé ordinaire ──────────
  const fpPoste = moi.appareils.find((f) => f !== undefined && f === annuaire.me) || annuaire.me;
  const fpMobile = moi.appareils.find((f) => f !== fpPoste);
  assert.ok(fpMobile && fpMobile !== fpPoste, "deux empreintes distinctes");
  const fil = directGroupId(fpPoste, fpMobile);
  assert.equal(isMemberOfDirect(fil, fpPoste), true);
  assert.equal(isMemberOfDirect(fil, fpMobile), true);
  // Et le tiers n'y a aucun droit, bien qu'il soit du même salon.
  const fpTiers = vuDuPoste.find((p) => !p.isMe).fingerprint;
  assert.equal(isMemberOfDirect(fil, fpTiers), false,
    "⚠️ un tiers du même salon n'entre pas dans ce fil");

  // ── 3. Aller : du poste vers le téléphone ───────────────────────────
  poste.send("Note pour moi-même", fil);
  await dodo(700);
  assert.ok(recus.mobile.some((m) => m.text === "Note pour moi-même" && m.groupId === fil),
    "le téléphone reçoit ce que le poste s'envoie");
  assert.equal(recus.mobile.at(-1).signatureValid, true, "et c'est signé");

  // ── 4. Retour : du téléphone vers le poste ──────────────────────────
  mobile.send("Reçu, merci", fil);
  await dodo(700);
  assert.ok(recus.poste.some((m) => m.text === "Reçu, merci" && m.groupId === fil),
    "le poste reçoit la réponse de son téléphone");

  // ── 5. Un appareil ne peut pas s'ouvrir un fil avec LUI-MÊME ────────
  // Sinon l'identifiant ne désignerait qu'une empreinte, et la règle
  // d'appartenance — « ton empreinte figure dans l'identifiant » —
  // deviendrait creuse.
  assert.throws(() => directGroupId(fpPoste, fpPoste), /soi-même/,
    "un fil d'un appareil vers lui-même est refusé");

  poste.close?.(); mobile.close?.(); tiers.close?.();
  console.log("✅ transfert-a-soi : poste ↔ téléphone d'une même personne, sans protocole nouveau");
} finally {
  await hote.stop();
  closeStore();
}
