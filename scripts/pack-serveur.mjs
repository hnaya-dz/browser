// ═══════════════════════════════════════════════════════════════
// Empaquetage du serveur de messagerie — module autonome
// ═══════════════════════════════════════════════════════════════
// Produit deux archives dans dist/ :
//   hnaya-serveur-<version>.zip      pour un serveur Windows
//   hnaya-serveur-<version>.tar.gz   pour un serveur Linux
//
// Le module N'EMBARQUE PAS le navigateur : une organisation n'installe pas
// un navigateur sur son serveur. Voir docs/SERVEUR-MESSAGERIE.md.
//
//   node scripts/pack-serveur.mjs          construit les deux archives
//   node scripts/pack-serveur.mjs --lister  montre ce qui serait inclus
//
// Aucune dépendance ajoutée : `tar` est présent sous Windows 10+ comme
// sous Linux, et sait produire les deux formats.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, "..");
const MODULE = path.join(RACINE, "chat-module");
const SORTIE = path.join(RACINE, "dist");
const version = JSON.parse(fs.readFileSync(path.join(RACINE, "package.json"), "utf8")).version;
const lister = process.argv.includes("--lister");

// Ce qui part chez le client. Rien d'autre.
const INCLUS = [
  "src",
  "mobile",
  "service",
  "package.json",
  "README.md",
  path.join("node_modules", "ws"),
];

// ⚠️ CE QUI NE DOIT JAMAIS PARTIR — et pourquoi.
//   data/   les bases d'essai ; elles contiennent des pseudos, des adresses
//           IP privées et des codes saisis pendant les tests
//   tools/  make-licence.mjs, l'outil d'émission des licences. Il exige la
//           clé privée, mais le livrer montrerait au client comment les
//           licences sont fabriquées
//   test/   sans usage chez un client, et truffé de valeurs d'essai
const EXCLUS = ["data", "tools", "test", "yarn.lock", ".gitignore"];

// Filet de sécurité : on inspecte ce qu'on s'apprête à écrire, plutôt que
// de faire confiance à la liste ci-dessus. Un fichier oublié dans src/ ou
// une licence déposée à la racine du module passeraient sans cela.
const INTERDITS = [
  { motif: /\.hnaya-lic$/i, raison: "fichier de licence" },
  { motif: /\.pem$/i, raison: "clé privée" },
  { motif: /\.db($|-wal$|-shm$)/i, raison: "base de données d'essai" },
  { motif: /(^|[\\/])data[\\/]/i, raison: "répertoire de données" },
  { motif: /(^|[\\/])tools[\\/]/i, raison: "outillage interne" },
];

function fichiersDe(rel) {
  const abs = path.join(MODULE, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (EXCLUS.includes(e.name)) continue;
    out.push(...fichiersDe(path.join(rel, e.name)));
  }
  return out;
}

const fichiers = INCLUS.flatMap(fichiersDe);
if (!fichiers.length) {
  console.error("Aucun fichier à empaqueter — chat-module est-il installé ?");
  process.exit(1);
}

// Contrôle avant d'écrire quoi que ce soit.
const fautifs = [];
for (const f of fichiers) {
  for (const { motif, raison } of INTERDITS) {
    if (motif.test(f)) fautifs.push(`${f}  (${raison})`);
  }
}
if (fautifs.length) {
  console.error("REFUS : des fichiers qui ne doivent pas être distribués figurent dans l'archive :");
  for (const f of fautifs) console.error("  " + f);
  process.exit(1);
}

const octets = fichiers.reduce((n, f) => n + fs.statSync(path.join(MODULE, f)).size, 0);
console.log(`  ${fichiers.length} fichiers, ${(octets / 1024).toFixed(0)} Ko avant compression`);

if (lister) {
  const parDossier = {};
  for (const f of fichiers) {
    const d = f.split(/[\\/]/)[0];
    parDossier[d] = (parDossier[d] || 0) + 1;
  }
  for (const [d, n] of Object.entries(parDossier)) console.log(`    ${d} : ${n} fichier(s)`);
  console.log("\n  Rien n'a été écrit.");
  process.exit(0);
}

fs.mkdirSync(SORTIE, { recursive: true });

// ⚠️ QUEL `tar` ? Ce n'est pas indifférent.
// Sous Windows, `tar` dans un shell Git résout vers GNU tar, qui NE SAIT
// PAS écrire de zip, prend « C:\… » pour un hôte distant et refuse les
// antislashs. Windows 10+ livre bsdtar dans System32 : il produit les deux
// formats et accepte les lettres de lecteur. On le désigne explicitement.
const TAR = process.platform === "win32" &&
            fs.existsSync("C:\\Windows\\System32\\tar.exe")
  ? "C:\\Windows\\System32\\tar.exe"
  : "tar";

// L'arborescence est PRÉPARÉE dans un dossier temporaire portant le nom de
// la racine de l'archive, au lieu d'employer une option de renommage :
// GNU tar écrit « --transform », bsdtar écrit « -s », et cette divergence
// est exactement le genre de détail qui casse la construction sur une
// autre machine. Copier est lent de quelques dixièmes de seconde et
// fonctionne partout.
const racineArchive = `hnaya-serveur-${version}`;
const atelier = fs.mkdtempSync(path.join(os.tmpdir(), "hnaya-pack-"));
const base = path.join(atelier, racineArchive);

try {
  for (const f of fichiers) {
    const dest = path.join(base, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(MODULE, f), dest);
  }

  for (const { nom, args } of [
    { nom: `${racineArchive}.tar.gz`, args: ["-czf"] },
    { nom: `${racineArchive}.zip`, args: ["-a", "-cf"] },
  ]) {
    const dest = path.join(SORTIE, nom);
    fs.rmSync(dest, { force: true });
    execFileSync(TAR, [...args, dest, "-C", atelier, racineArchive], { stdio: "pipe" });
    const ko = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`  ✔ dist/${nom}  (${ko} Ko)`);
  }
} finally {
  fs.rmSync(atelier, { recursive: true, force: true });
}

console.log(`
  À remettre au client : l'archive SEULE, accompagnée de son fichier
  .hnaya-lic. Ne joignez jamais la clé de signature (.pem).
  Installation : voir docs/SERVEUR-MESSAGERIE.md`);
