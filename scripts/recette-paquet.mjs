// ═══════════════════════════════════════════════════════════════
// Recette d'acceptation de l'APPLICATION EMPAQUETÉE
// ═══════════════════════════════════════════════════════════════
//   yarn recette        après un « yarn dist », AVANT toute publication
//
// POURQUOI CE FICHIER EXISTE
//   La 0.8.0 a été publiée avec la Messagerie locale entièrement hors
//   service. Aucune ligne de son code n'avait changé : c'est la montée
//   d'electron-builder 25 → 26 qui avait cessé d'embarquer `ws`, et la
//   vérification d'alors ne regardait que les fonctions NOUVELLES de la
//   version. Deux personnes ont téléchargé ce paquet.
//
//   D'où la règle que ce script applique : une recette de paquet contrôle
//   les fonctions ANCIENNES autant que les nouvelles — en priorité quand
//   la chaîne de construction a changé.
//
// CE QU'ELLE NE COUVRE PAS, et qui reste à faire à la main :
//   l'installateur NSIS lui-même (double-clic, dossier, raccourcis), les
//   dialogues natifs d'enregistrement, et tout essai multi-machines.
//
// ⚠️ `ws` est emprunté à chat-module : la racine du projet n'en dépend
//    pas, et on ne l'y ajoutera pas pour un script de vérification.

import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(RACINE, "chat-module", "package.json"));
const WebSocket = require("ws");

const EXE = join(RACINE, "dist", "win-unpacked", "Hnaya DZ Browser.exe");
const RESSOURCES = join(RACINE, "dist", "win-unpacked", "resources");
const PORT = 9333;
const VERSION = JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8")).version;
const TUER = 'taskkill /F /IM "Hnaya DZ Browser.exe" /T';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = [], ko = [];
const V = (nom, cond, detail = "") => {
  const ligne = (cond ? "✔ " : "✘ ") + nom + (detail ? " — " + detail : "");
  (cond ? ok : ko).push(ligne);
  console.log(ligne);
};

// ── 1. Le paquet sur le disque, sans le lancer ───────────────────────
console.log("── Le paquet sur le disque ──");
if (!existsSync(EXE)) {
  console.error("✘ Aucun paquet : " + EXE + "\n  Lancez d'abord « yarn dist ».");
  process.exit(1);
}

// LE contrôle né de la régression 0.8.0. electron-builder 26 exclut
// node_modules d'extraResources : sans l'entrée dédiée du package.json,
// le worker meurt sur « Cannot find package 'ws' » et aucun salon ne
// peut s'ouvrir — sans le moindre message à l'écran.
V("chat-module embarque `ws`",
  existsSync(join(RESSOURCES, "chat-module", "node_modules", "ws", "package.json")),
  "sans lui, aucun salon ne s'ouvre");
V("chat-module est complet",
  existsSync(join(RESSOURCES, "chat-module", "src", "server.js")) &&
  existsSync(join(RESSOURCES, "chat-module", "mobile", "index.html")));

// Garde-fou de taille : l'asar ne contient que out/ et public/. S'il
// regonfle, c'est que node_modules y est revenu (44 Mo pour rien).
const asar = join(RESSOURCES, "app.asar");
const asarMo = existsSync(asar) ? statSync(asar).size / 1048576 : 0;
V("app.asar reste mince", asarMo < 12, asarMo.toFixed(2) + " Mo (alerte au-delà de 12)");

// Le worker doit démarrer hors de tout Electron, comme le fait le fork.
let workerOk = true, workerErr = "";
try {
  execSync('node "' + join(RESSOURCES, "chat-module", "src", "worker.js") + '"',
    { timeout: 6000, stdio: "pipe" });
} catch (e) {
  const sortie = String(e.stderr || "");
  if (sortie.includes("ERR_MODULE_NOT_FOUND") || sortie.includes("Cannot find")) {
    workerOk = false;
    workerErr = (sortie.split("\n").find((l) => /Error|Cannot/.test(l)) || "").trim().slice(0, 120);
  }
  // Un dépassement de délai est NORMAL : le worker attend des ordres.
}
V("Le worker de messagerie démarre depuis le paquet", workerOk, workerErr);

// ── 2. Lancement ─────────────────────────────────────────────────────
console.log("\n── Lancement de l'application empaquetée ──");
try { execSync(TUER, { stdio: "ignore" }); } catch { /* rien à tuer */ }
await dormir(1500);
const app = spawn(EXE, ["--remote-debugging-port=" + PORT], { stdio: "ignore" });
const arreter = () => {
  try { app.kill(); } catch { /* déjà mort */ }
  try { execSync(TUER, { stdio: "ignore" }); } catch { /* déjà mort */ }
};
process.on("exit", arreter);

const gj = (chemin) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: PORT, path: chemin }, (r) => {
    let d = ""; r.on("data", (c) => (d += c));
    r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on("error", rej);
});

let cible = null;
for (let i = 0; i < 45 && !cible; i++) {
  await dormir(1000);
  try { cible = (await gj("/json")).find((t) => t.type === "page" && /47823/.test(t.url)); } catch { /* pas prêt */ }
}
if (!cible) { V("L'application démarre", false, "aucune fenêtre en 45 s"); process.exit(1); }

const ws = new WebSocket(cible.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.once("open", r));

let id = 0;
const attente = new Map();
const erreurs = [];
ws.on("message", (m) => {
  const o = JSON.parse(m);
  if (o.id && attente.has(o.id)) { attente.get(o.id)(o); attente.delete(o.id); }
  if (o.method === "Runtime.consoleAPICalled" && o.params.type === "error")
    erreurs.push((o.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 110));
  if (o.method === "Runtime.exceptionThrown")
    erreurs.push("EXCEPTION " + ((o.params.exceptionDetails || {}).text || "").slice(0, 110));
});
const cmd = (methode, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  attente.set(i, (x) => (x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)));
  ws.send(JSON.stringify({ id: i, method: methode, params }));
  setTimeout(() => { if (attente.has(i)) { attente.delete(i); rej(new Error("délai dépassé : " + methode)); } }, 45000);
});
const ev = async (expr) => {
  const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200));
  return r.result.value;
};

// ⚠️ Un Uint8Array qui traverse CDP perd sa nature et devient un objet
// aux clés numériques : on le mesure DANS la page, jamais après.
const inv = (canal, arg) => ev(
  "window.electronAPI.invoke(" + JSON.stringify(canal) +
  (arg !== undefined ? "," + JSON.stringify(arg) : "") + ")" +
  ".then(v => JSON.stringify(v, (k, x) => x instanceof Uint8Array ? '[' + x.length + ' octets]' : x))" +
  ".catch(e => 'REJET:' + e.message)");

const attendreQue = async (expr, n = 30) => {
  for (let i = 0; i < n; i++) { if (await ev(expr)) return true; await dormir(700); }
  return false;
};

await cmd("Runtime.enable");
await attendreQue('!!document.querySelector("button")', 40);

console.log("\n── Socle ──");
const origine = await ev("location.origin");
V("Servi par le serveur statique interne", /127\.0\.0\.1:47823/.test(origine), origine);
const version = await inv("get-app-version");
V("Version empaquetée = " + VERSION, version.includes(VERSION), version);
const nbBoutons = await ev('document.querySelectorAll("button").length');
V("Interface rendue (export Next autonome)", nbBoutons > 10, nbBoutons + " boutons");

// Français : les sélecteurs de la suite dépendent des libellés.
await ev('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="FR");if(b)b.click();return 1})()');
await dormir(1500);
V("Aucune icône bitmap dans les barres", !/BITMAP/.test(await ev(
  '(()=>{const b=[...document.querySelectorAll("button")].find(x=>/Achat|Buy/.test(x.textContent));' +
  'return b ? (b.querySelector("svg")?.getAttribute("class")||"") + (b.querySelector("img")?" BITMAP":"") : "absent"})()')));

console.log("\n── Fonctions déjà livrées ──");
V("Coffre-fort disponible", /true|false/.test(await inv("vault-is-available")));
V("Coffre-fort lisible", !/REJET/.test(await inv("vault-list")));
V("Favoris lisibles", !/REJET/.test(await inv("favorites-list")));
V("Groupes d'onglets lisibles", !/REJET/.test(await inv("tabgroups-list")));
const priv = await inv("privacy-get-settings");
V("Réglages de confidentialité", /blockTrackers/.test(priv), priv);
V("Sessions de messagerie lisibles", !/REJET/.test(await inv("chat-session-list")));

console.log("\n── Messagerie locale ──");
await ev('window.__e=[];window.electronAPI.receive("chat-event",x=>window.__e.push(x));1');
await ev('window.electronAPI.invoke("chat-start-host","Recette")');
let evts = [];
for (let i = 0; i < 25 && !evts.length; i++) {
  await dormir(800);
  evts = JSON.parse(await ev("JSON.stringify(window.__e)"));
}
const hote = evts.find((e) => e.event === "host-started");
V("Un salon s'ouvre", !!hote,
  hote ? "PIN " + hote.pin + " · ws " + hote.wsPort + " · http " + hote.httpPort : "aucun événement en 20 s");
if (hote) {
  V("PIN à six chiffres", /^[0-9]{6}$/.test(String(hote.pin)));
  V("Adresse d'invitation mobile composée", !!hote.inviteUrl, hote.inviteUrl);
}
await ev('window.electronAPI.send("chat-stop-host")');
await dormir(1200);

console.log("\n── Annotation et PDF ──");
await ev('document.querySelectorAll("button")[0]?.click()');
await attendreQue('!!document.querySelector(".urlbar-input")');
await ev('(()=>{const i=document.querySelector(".urlbar-input");if(!i)return 0;' +
  'const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;' +
  's.call(i,"https://example.com");i.dispatchEvent(new Event("input",{bubbles:true}));' +
  'i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));return 1})()');
for (let i = 0; i < 30; i++) {
  await dormir(900);
  try { if ((await gj("/json")).some((x) => /example\.com/.test(x.url))) break; } catch { /* pas prêt */ }
}
// ⚠️ Laisser la page PEINDRE. Capturer trop tôt rend une image de taille
// nulle : le handler répond alors {ok:false, error:"empty"}, ce qui est
// son travail, mais fait échouer la recette pour une mauvaise raison.
await dormir(3000);
V("Bouton « Annoter la page » présent", await ev(`!!document.querySelector('[data-tutorial="annotate-btn"]')`));
const cap = JSON.parse(await inv("annotate-capture"));
V("Capture d'annotation", cap.ok === true,
  cap.ok ? cap.w + "×" + cap.h + ", " + cap.bytes : "erreur : " + cap.error);
await ev('window.electronAPI.send("show-active-view")');
const pdf = JSON.parse(await inv("page-to-pdf"));
V("Export PDF de la page", pdf.ok === true,
  pdf.ok ? pdf.name + ", " + pdf.bytes : "erreur : " + pdf.error);

await dormir(1500);
V("Aucune erreur de console", erreurs.length === 0, erreurs.slice(0, 2).join(" | "));

console.log("\n════════ BILAN ════════");
[...ok, ...ko].forEach((l) => console.log(l));
console.log("\n" + ok.length + " réussis, " + ko.length + " échoués");
if (ko.length) console.log("\n⚠️ NE PAS PUBLIER tant qu'un contrôle échoue.");
try { ws.close(); } catch { /* déjà fermé */ }
process.exit(ko.length ? 1 : 0);
