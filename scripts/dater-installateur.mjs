// ═══════════════════════════════════════════════════════════════
// Remettre à l'heure la date de CRÉATION de l'installateur
// ═══════════════════════════════════════════════════════════════
// Windows conserve la date de création d'un fichier réécrit au même
// emplacement. L'info-bulle de l'explorateur affiche cette date-là : un
// installateur reconstruit le 6 août s'annonçait donc encore « 4 août »,
// et vérifier « la date du fichier » avant de le déployer ne voulait
// plus rien dire.
//
// On aligne donc la création sur la dernière écriture, APRÈS une
// construction réussie. Ne jamais faire l'inverse (supprimer l'ancien
// installateur AVANT de construire) : une construction qui échoue
// laisserait alors la machine sans aucun binaire installable.
//
// Node ne sait pas écrire la date de création — seul Windows le peut,
// d'où le passage par PowerShell. Sans dépendance ajoutée.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
if (!existsSync(dist)) process.exit(0);

const installateurs = readdirSync(dist).filter((f) => f.endsWith(".exe"));
if (!installateurs.length) process.exit(0);

for (const nom of installateurs) {
  const chemin = join(dist, nom);
  const avant = statSync(chemin);
  try {
    execFileSync("powershell.exe", [
      "-NoProfile", "-Command",
      `$f = Get-Item -LiteralPath '${chemin.replace(/'/g, "''")}'; $f.CreationTime = $f.LastWriteTime`,
    ], { stdio: "ignore" });
    const apres = statSync(chemin);
    const corrige = avant.birthtimeMs !== apres.birthtimeMs;
    console.log(`  ${nom} — création ${corrige ? "corrigée" : "déjà juste"} : ${apres.birthtime.toLocaleString("fr-FR")}`);
  } catch {
    // Purement cosmétique : jamais de quoi faire échouer une construction.
    console.log(`  ${nom} — date de création non modifiable (sans conséquence)`);
  }
}
