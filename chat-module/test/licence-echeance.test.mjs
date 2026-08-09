// ═══════════════════════════════════════════════════════════════
// Étape I — l'échéance de licence doit être OPPOSABLE
// ═══════════════════════════════════════════════════════════════
// Le défaut : la licence n'était lue qu'au démarrage. Une tâche planifiée
// lancée une fois pouvait tourner des mois après l'échéance sans que rien
// ne s'y oppose — une licence de 6 mois n'était opposable qu'à celui qui
// redémarrait son serveur.
//
// Et la contrainte inverse, tout aussi importante : une licence échue ne
// doit RIEN effacer ni rendre l'historique inaccessible. Elle fait taire
// le salon, elle ne le ferme pas.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { verifyLicence, canonicalPayload, GRACE_DAYS, CONTACT_HNAYA } from "../src/licence.js";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
const JOUR = 86400000;

// ── Une licence de test, signée par une clé de test ────────────────────
// La clé privée de Hnaya DZ n'est PAS dans ce dépôt (et ne doit jamais
// l'être). verifyLicence accepte une clé publique en paramètre : on signe
// donc avec une paire jetable, ce qui teste exactement le même chemin.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

function licencePour(expires) {
  const payload = {
    format: "hnaya-chat-server-licence", version: 1,
    id: "test-0001", org: "Direction des essais",
    issued: "2026-01-01", expires, maxDevices: 50,
  };
  const signature = cryptoSign(null, canonicalPayload(payload), privateKey).toString("base64");
  return JSON.stringify({ payload, signature });
}
const dateISO = (ts) => new Date(ts).toISOString().slice(0, 10);
const verif = (expires, now) => verifyLicence(licencePour(expires), { now, publicKeyB64 });

// Minuit UTC, comme les dates d'échéance (`expires` est une date sans
// heure) : le décompte de jours est alors exact, sans demi-journée qui
// décalerait les paliers d'une unité et rendrait le test illisible.
const maintenant = Date.parse("2026-08-09T00:00:00Z");

// ── 1. Avant l'échéance : tout fonctionne ──────────────────────────────
const loin = verif(dateISO(maintenant + 200 * JOUR), maintenant);
assert.equal(loin.ok, true);
assert.equal(loin.mode, "active", "une licence en cours doit être active");
assert.equal(loin.notice, null, "pas de bandeau permanent : on ne le lirait plus");

// ── 2. Dernier mois : préavis, AVANT la coupure ────────────────────────
const bientot = verif(dateISO(maintenant + 10 * JOUR), maintenant);
assert.equal(bientot.mode, "active", "un préavis ne suspend rien");
assert.ok(bientot.notice, "le dernier mois doit prévenir");
assert.ok(bientot.notice.includes(CONTACT_HNAYA.tel),
  "l'avertissement doit dire qui appeler");
assert.ok(bientot.notice.includes(CONTACT_HNAYA.email));

// ── 3. Échue depuis 5 jours : délai de grâce, rien n'est coupé ─────────
const grace = verif(dateISO(maintenant - 5 * JOUR), maintenant);
assert.equal(grace.ok, true, "une licence échue reste SIGNÉE : elle doit démarrer");
assert.equal(grace.mode, "grace");
assert.equal(grace.graceDaysLeft, GRACE_DAYS - 5,
  "le décompte doit annoncer la date réelle de suspension");
assert.ok(grace.notice.includes("suspendu"), "il faut annoncer ce qui va arriver");

// ── 4. La veille du 30e jour : encore en grâce ─────────────────────────
assert.equal(verif(dateISO(maintenant - 29 * JOUR), maintenant).mode, "grace",
  "le 29e jour appartient encore au délai de grâce");

// ── 5. Au 30e jour : lecture seule ─────────────────────────────────────
const stop = verif(dateISO(maintenant - GRACE_DAYS * JOUR), maintenant);
assert.equal(stop.ok, true, "même suspendue, la licence reste valide et démarre");
assert.equal(stop.mode, "readonly");
assert.ok(stop.notice.includes("historique"),
  "il faut dire que rien n'est perdu, sinon le client croit à une purge");
assert.ok(stop.notice.includes(CONTACT_HNAYA.tel));

// ── 6. Une licence trafiquée reste refusée, échue ou non ───────────────
const trafiquee = JSON.parse(licencePour(dateISO(maintenant + 100 * JOUR)));
trafiquee.payload.maxDevices = 5000;
assert.equal(verifyLicence(JSON.stringify(trafiquee), { now: maintenant, publicKeyB64 }).ok,
  false, "modifier le nombre de postes doit casser la signature");

// ═══ Partie serveur : ce que la lecture seule change réellement ═══════
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-lic-ech-"));
const PORT = 14902, HTTP = 14903, PIN = "451236";

// L'état est piloté par le test — c'est exactement ce que fait serve.js,
// qui relit le fichier toutes les heures.
let mode = "active";
const host = startHost({
  sessionName: "Direction", pin: PIN, adminPin: "778899",
  dataDir, wsPort: PORT, httpPort: HTTP,
  licenceState: () => ({
    mode,
    notice: mode === "readonly" ? "Licence expirée. L'envoi est suspendu ; l'historique reste consultable." : null,
  }),
});
await dodo(600);

const recus = [];
const avis = [];
const brancher = async (nom, dossier, lastSeenTs = 0) => {
  const c = joinSession({
    address: "127.0.0.1", wsPort: PORT, pin: PIN, userId: nom, lastSeenTs,
    dataDir: path.join(dataDir, dossier), groups: ["all"],
    onMessage: (m) => recus.push(m),
    onPresence: () => {},
    onLicenceNotice: (n) => avis.push(n),
  });
  await new Promise((r) => c.raw.on("open", r));
  return c;
};

const nacib = await brancher("Nacib", "id-1");
await dodo(500);

// Licence active : aucun bandeau, l'envoi passe.
assert.equal(avis.length, 0, "rien à signaler tant que la licence court");
nacib.send("Avant l'échéance", "all");
await dodo(600);
assert.equal(recus.filter((m) => m.text === "Avant l'échéance").length, 1);

// ── L'échéance tombe pendant que le serveur tourne ────────────────────
// C'est LE cas que le défaut laissait passer : personne ne redémarre.
mode = "readonly";
host.notifyLicence();
await dodo(500);
assert.ok(avis.some((a) => a.readOnly), "le salon ouvert doit être prévenu sans reconnexion");

const avant = recus.length;
nacib.send("Apres l'echeance", "all");
await dodo(700);
assert.equal(recus.length, avant, "plus aucun message ne doit passer");
assert.ok(avis.some((a) => a.refused === "message"),
  "le refus doit être EXPLIQUÉ : un silence ferait accuser le réseau");

// Le vote est un envoi comme un autre.
nacib.openVote({ question: "Budget", options: ["Oui", "Non"], nominatif: true });
await dodo(600);
assert.equal(recus.filter((m) => m.type === "vote").length, 0,
  "ouvrir un vote est un envoi : suspendu aussi");

// ── Et surtout : l'historique reste servi ─────────────────────────────
const amina = await brancher("Amina", "id-2");
await dodo(800);
assert.ok(recus.some((m) => m.text === "Avant l'échéance"),
  "un arrivant doit recevoir l'historique : une licence échue ne retient rien en otage");
assert.ok(avis.some((a) => a.readOnly), "et il doit voir pourquoi il ne peut pas écrire");

// ── Le renouvellement rétablit tout, toujours sans redémarrage ────────
mode = "active";
host.notifyLicence();
await dodo(400);
const avantRenouv = recus.length;
nacib.send("Apres renouvellement", "all");
await dodo(700);
assert.equal(recus.length, avantRenouv + 2,
  "renouveler doit rendre la parole immédiatement (reçu par les deux clients)");

nacib.close(); amina.close();
await dodo(300);
await host.stop();
closeStore();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log("✅ licence-echeance.test.mjs : 20 assertions PASSÉES (préavis, grâce 30 j, lecture seule, historique préservé, renouvellement à chaud)");
process.exit(0);
