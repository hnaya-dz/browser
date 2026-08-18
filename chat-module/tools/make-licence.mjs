// ═══════════════════════════════════════════════════════════════
// Émission d'une licence de serveur permanent — outil INTERNE Hnaya DZ
// ═══════════════════════════════════════════════════════════════
// Cet outil n'est jamais livré aux clients : il exige la clé privée de
// signature, conservée hors dépôt (Documents/HNAYA/hnaya-licences/).
//
// Émettre une licence — l'échéance s'exprime AU CHOIX en durée ou en date :
//   node tools/make-licence.mjs --org "CNAS Alger" --months 12 --devices 50
//   node tools/make-licence.mjs --org "HCN" --until 2026-12-31 --devices 50
//   [--from <AAAA-MM-JJ>]       date d'émission portée au fichier
//   [--key <clé privée .pem>]   défaut : Documents/HNAYA/hnaya-licences/licence-signing-key.pem
//   [--out <fichier>]           défaut : <org>-<échéance>.hnaya-lic à côté de la clé
//
// POURQUOI --until : un contrat institutionnel se termine sur une DATE
// (« jusqu'au 31 décembre »), jamais sur un compte de mois. Avec --months
// seul, l'échéance tombait à la date d'émission décalée de N mois : émise
// le 18 août, aucune valeur entière ne donnait le 31 décembre. On était
// contraint de rogner ou de déborder sur ce que le client avait signé.
//
// ⚠️ --from est DOCUMENTAIRE. Le champ `issued` n'est pas opposé à
// l'horloge par verifyLicence() : une licence est active dès son
// installation, même remise en avance. Seul `expires` gouverne. Ne
// promettez donc pas à un client qu'elle « ne s'ouvrira pas avant ».
//
// (Ré)générer une paire de clés — UNIQUEMENT à la toute première mise en
// place ou après compromission (toutes les licences émises sont à réémettre,
// et HNAYA_PUBLIC_KEY_B64 dans src/licence.js est à remplacer) :
//   node tools/make-licence.mjs --gen-keys

import { generateKeyPairSync, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { canonicalPayload, LICENCE_FORMAT, LICENCE_VERSION } from "../src/licence.js";

const DEFAULT_KEY_DIR = path.join(os.homedir(), "Documents", "HNAYA", "hnaya-licences");
const DEFAULT_KEY = path.join(DEFAULT_KEY_DIR, "licence-signing-key.pem");

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--org") args.org = argv[++i];
  else if (argv[i] === "--months") args.months = Number(argv[++i]);
  else if (argv[i] === "--until") args.until = argv[++i];
  else if (argv[i] === "--from") args.from = argv[++i];
  else if (argv[i] === "--devices") args.devices = Number(argv[++i]);
  else if (argv[i] === "--key") args.key = argv[++i];
  else if (argv[i] === "--out") args.out = argv[++i];
  else if (argv[i] === "--gen-keys") args.genKeys = true;
  else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
}

if (args.help || (!args.genKeys && !args.org)) {
  console.log(`Usage :
  node tools/make-licence.mjs --org "Nom de l'organisation" --months 12 --devices 50
  node tools/make-licence.mjs --org "HCN" --until 2026-12-31 --devices 50
  node tools/make-licence.mjs --gen-keys        (première mise en place uniquement)

  --months N        durée en mois à compter d'aujourd'hui (1 à 120)
  --until  DATE     échéance à date fixe, AAAA-MM-JJ, valable toute la journée
  --from   DATE     date d'émission portée au fichier (documentaire)
  --devices N       plafond d'appareils (1 à 100000)`);
  process.exit(args.help ? 0 : 1);
}

if (args.genKeys) {
  if (existsSync(DEFAULT_KEY)) {
    console.error(`REFUS : une clé existe déjà (${DEFAULT_KEY}).
La remplacer invaliderait TOUTES les licences déjà émises. Supprimez-la
d'abord manuellement si c'est vraiment l'intention.`);
    process.exit(1);
  }
  mkdirSync(DEFAULT_KEY_DIR, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(DEFAULT_KEY, privateKey.export({ type: "pkcs8", format: "pem" }));
  const pubB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  writeFileSync(path.join(DEFAULT_KEY_DIR, "PUBLIC-KEY.txt"), pubB64);
  console.log("Clé privée écrite :", DEFAULT_KEY);
  console.log("Clé publique (à coller dans src/licence.js → HNAYA_PUBLIC_KEY_B64) :");
  console.log(pubB64);
  process.exit(0);
}

// ── Émission ───────────────────────────────────────────────────────────
// Une échéance, exprimée d'UNE seule façon. Accepter les deux à la fois
// laisserait deviner laquelle l'emporte — sur un contrat signé, un doute
// de cette nature n'est pas acceptable : on refuse.
if (args.months !== undefined && args.until !== undefined) {
  console.error("--months et --until sont exclusifs : choisissez une durée OU une date d'échéance");
  process.exit(1);
}
if (args.months === undefined && args.until === undefined) {
  console.error("Échéance manquante : --months <N> ou --until <AAAA-MM-JJ>");
  process.exit(1);
}
if (args.months !== undefined && (!Number.isInteger(args.months) || args.months < 1 || args.months > 120)) {
  console.error("--months : durée en mois entière entre 1 et 120 requise");
  process.exit(1);
}
// Date stricte : « 2026-13-01 » et « 2026-02-30 » sont rejetés, car Date()
// les reporterait silencieusement sur un autre mois. Une licence datée d'un
// mois que le client n'a pas signé serait pire qu'une erreur bruyante.
function jourExact(texte, option) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte || "");
  if (!m) {
    console.error(`${option} : date attendue au format AAAA-MM-JJ (reçu : ${texte})`);
    process.exit(1);
  }
  const [, a, mo, j] = m.map(Number);
  const d = new Date(a, mo - 1, j);
  if (d.getFullYear() !== a || d.getMonth() !== mo - 1 || d.getDate() !== j) {
    console.error(`${option} : ${texte} n'est pas une date réelle`);
    process.exit(1);
  }
  return d;
}
if (!Number.isInteger(args.devices) || args.devices < 1 || args.devices > 100000) {
  console.error("--devices : nombre d'appareils entier entre 1 et 100000 requis");
  process.exit(1);
}

const keyPath = args.key || DEFAULT_KEY;
if (!existsSync(keyPath)) {
  console.error(`Clé privée introuvable : ${keyPath}
Première mise en place ? → node tools/make-licence.mjs --gen-keys`);
  process.exit(1);
}
const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));

const issued = args.from ? jourExact(args.from, "--from") : new Date();

let expires;
if (args.until !== undefined) {
  // Fin de la journée indiquée, et non son début : « valable jusqu'au
  // 31/12 » comprend le 31/12. Poser minuit ferait expirer la licence au
  // premier instant du dernier jour — le client perdrait la journée qu'il
  // a payée, et s'en apercevrait en pleine activité.
  expires = jourExact(args.until, "--until");
  expires.setHours(23, 59, 59, 999);
} else {
  expires = new Date();
  expires.setMonth(expires.getMonth() + args.months);
}

if (expires.getTime() <= Date.now()) {
  console.error(`REFUS : échéance déjà passée (${expires.toLocaleDateString("fr-FR")}).
Une licence expirée à l'émission placerait le client en lecture seule dès
l'installation.`);
  process.exit(1);
}

const payload = {
  format: LICENCE_FORMAT,
  version: LICENCE_VERSION,
  id: randomBytes(8).toString("hex"),
  org: args.org,
  issued: issued.toISOString(),
  expires: expires.toISOString(),
  maxDevices: args.devices,
};
const signature = cryptoSign(null, canonicalPayload(payload), privateKey).toString("base64");

const slug = args.org.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "licence";
// Date LOCALE dans le nom de fichier, pas toISOString() : une échéance
// posée à 23:59 locale bascule au lendemain en UTC dès que la machine est
// à l'ouest de Greenwich. Le fichier porterait alors une date que le
// contrat ne mentionne pas.
const jourLocal = `${expires.getFullYear()}-${String(expires.getMonth() + 1).padStart(2, "0")}-${String(expires.getDate()).padStart(2, "0")}`;
const outPath = args.out || path.join(path.dirname(keyPath), `${slug}-${jourLocal}.hnaya-lic`);
writeFileSync(outPath, JSON.stringify({ payload, signature }, null, 2) + "\n", "utf8");

// Relecture stricte depuis le disque — on ne remet jamais un fichier non vérifié.
const { verifyLicence } = await import("../src/licence.js");
const check = verifyLicence(readFileSync(outPath, "utf8"));
if (!check.ok) {
  console.error("AUTO-VÉRIFICATION ÉCHOUÉE :", check.error);
  process.exit(1);
}
const { GRACE_DAYS } = await import("../src/licence.js");
const finGrace = new Date(expires.getTime() + GRACE_DAYS * 86400000);
console.log(`Licence émise et vérifiée :
  Organisation : ${payload.org}
  Émission     : ${issued.toLocaleDateString("fr-FR")}
  Échéance     : ${expires.toLocaleDateString("fr-FR")} (${check.daysLeft} jours)
  Lecture seule: ${finGrace.toLocaleDateString("fr-FR")} — après ${GRACE_DAYS} jours de grâce
  Appareils    : ${payload.maxDevices}
  Fichier      : ${outPath}
À remettre au client avec l'installation — ce fichier SEUL, jamais la clé .pem.`);
