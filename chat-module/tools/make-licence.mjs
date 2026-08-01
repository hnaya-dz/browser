// ═══════════════════════════════════════════════════════════════
// Émission d'une licence de serveur permanent — outil INTERNE Hnaya DZ
// ═══════════════════════════════════════════════════════════════
// Cet outil n'est jamais livré aux clients : il exige la clé privée de
// signature, conservée hors dépôt (Documents/HNAYA/hnaya-licences/).
//
// Émettre une licence :
//   node tools/make-licence.mjs --org "CNAS Alger" --months 12 --devices 50
//   [--key <clé privée .pem>]   défaut : Documents/HNAYA/hnaya-licences/licence-signing-key.pem
//   [--out <fichier>]           défaut : <org>-<échéance>.hnaya-lic à côté de la clé
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
  else if (argv[i] === "--devices") args.devices = Number(argv[++i]);
  else if (argv[i] === "--key") args.key = argv[++i];
  else if (argv[i] === "--out") args.out = argv[++i];
  else if (argv[i] === "--gen-keys") args.genKeys = true;
  else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
}

if (args.help || (!args.genKeys && !args.org)) {
  console.log(`Usage :
  node tools/make-licence.mjs --org "Nom de l'organisation" --months 12 --devices 50
  node tools/make-licence.mjs --gen-keys        (première mise en place uniquement)`);
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
if (!Number.isInteger(args.months) || args.months < 1 || args.months > 120) {
  console.error("--months : durée en mois entière entre 1 et 120 requise");
  process.exit(1);
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

const issued = new Date();
const expires = new Date(issued);
expires.setMonth(expires.getMonth() + args.months);

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
const outPath = args.out || path.join(path.dirname(keyPath), `${slug}-${expires.toISOString().slice(0, 10)}.hnaya-lic`);
writeFileSync(outPath, JSON.stringify({ payload, signature }, null, 2) + "\n", "utf8");

// Relecture stricte depuis le disque — on ne remet jamais un fichier non vérifié.
const { verifyLicence } = await import("../src/licence.js");
const check = verifyLicence(readFileSync(outPath, "utf8"));
if (!check.ok) {
  console.error("AUTO-VÉRIFICATION ÉCHOUÉE :", check.error);
  process.exit(1);
}
console.log(`Licence émise et vérifiée :
  Organisation : ${payload.org}
  Échéance     : ${expires.toLocaleDateString("fr-FR")} (${check.daysLeft} jours)
  Appareils    : ${payload.maxDevices}
  Fichier      : ${outPath}
À remettre au client avec l'installation.`);
