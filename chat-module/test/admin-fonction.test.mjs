// ═══════════════════════════════════════════════════════════════
// Non-régression — la FONCTION d'une personne ne doit pas s'évaporer
// Lancer : node test/admin-fonction.test.mjs
// ═══════════════════════════════════════════════════════════════
// Défaut constaté en usage réel : « dans ADMIN/Appareils, le changement du
// champ Fonction n'est pas enregistré ; seule l'étiquette l'est ».
//
// Deux moitiés, et il fallait les deux pour que le champ disparaisse :
//
//   1. worker.js recopiait les champs de la commande admin UN PAR UN, et
//      `role` manquait à l'appel. Le champ n'arrivait jamais au serveur.
//   2. le serveur écrivait alors `undefined` — c'est-à-dire NULL. La
//      fonction précédente était donc EFFACÉE, pas seulement ignorée.
//
// La correction porte sur les deux : la liste des champs transportés est
// devenue une constante unique (CHAMPS_ADMIN), et le serveur refuse une
// demande dont le champ est absent au lieu de la traiter comme un
// effacement. Ce test vérifie le second point, plus un aller-retour
// complet ; le premier est couvert par la vérification statique en fin de
// fichier, qui compare la constante aux champs que le serveur lit.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "../src/server.js";
import { joinSession } from "../src/client.js";
import { closeStore } from "../src/store.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const PIN = "606060";
const host = startHost({
  sessionName: "Test fonction", pin: PIN,
  dataDir: tmp("hnaya-fonction-host-"), wsPort: 14872, httpPort: 14873,
});

try {
  const results = [];
  const alice = joinSession({
    address: "127.0.0.1", wsPort: 14872, pin: PIN, userId: "Amina",
    dataDir: tmp("hnaya-fonction-cli-"),
    onAdminResult: (r) => results.push(r),
  });
  await sleep(700);

  const attendre = async (reqId) => {
    for (let i = 0; i < 20; i++) {
      const r = results.find((x) => x.reqId === reqId);
      if (r) return r;
      await sleep(100);
    }
    throw new Error("Pas de réponse admin pour " + reqId);
  };

  alice.sendAdmin({ adminPin: host.adminPin, action: "devices", reqId: "d" });
  const fp = (await attendre("d")).data[0].fingerprint;

  // 1) La fonction s'enregistre et REVIENT dans le registre
  alice.sendAdmin({ adminPin: host.adminPin, action: "role", fingerprint: fp, role: "Directrice des ressources humaines", reqId: "f1" });
  const f1 = await attendre("f1");
  assert.equal(f1.ok, true);
  assert.equal(f1.data[0].role, "Directrice des ressources humaines",
    "la fonction est enregistrée et relue");

  // 2) Une étiquette posée ensuite ne touche pas la fonction — ce sont deux
  //    champs distincts : l'un nomme l'APPAREIL, l'autre décrit la PERSONNE
  alice.sendAdmin({ adminPin: host.adminPin, action: "label", fingerprint: fp, label: "Poste 12 — RH", reqId: "f2" });
  const f2 = await attendre("f2");
  assert.equal(f2.data[0].label, "Poste 12 — RH");
  assert.equal(f2.data[0].role, "Directrice des ressources humaines",
    "poser une étiquette ne doit pas effacer la fonction");

  // 3) ⚠️ LE CŒUR DU DÉFAUT — champ absent ≠ champ vide.
  //    Une demande sans `role` est refusée ; la valeur en place est
  //    conservée. C'est ce refus qui aurait fait remonter le défaut au lieu
  //    de le laisser détruire la donnée en silence.
  alice.sendAdmin({ adminPin: host.adminPin, action: "role", fingerprint: fp, reqId: "f3" });
  const f3 = await attendre("f3");
  assert.equal(f3.ok, false, "une demande sans le champ est refusée");
  assert.equal(f3.error, "champ-absent");

  alice.sendAdmin({ adminPin: host.adminPin, action: "devices", reqId: "f4" });
  assert.equal((await attendre("f4")).data[0].role, "Directrice des ressources humaines",
    "après le refus, la fonction est INTACTE");

  // Idem pour l'étiquette, exposée au même mécanisme
  alice.sendAdmin({ adminPin: host.adminPin, action: "label", fingerprint: fp, reqId: "f5" });
  assert.equal((await attendre("f5")).ok, false, "une étiquette sans le champ est refusée");
  alice.sendAdmin({ adminPin: host.adminPin, action: "devices", reqId: "f6" });
  assert.equal((await attendre("f6")).data[0].label, "Poste 12 — RH",
    "après le refus, l'étiquette est INTACTE");

  // 4) L'effacement VOULU reste possible : il se demande avec null
  alice.sendAdmin({ adminPin: host.adminPin, action: "role", fingerprint: fp, role: null, reqId: "f7" });
  const f7 = await attendre("f7");
  assert.equal(f7.ok, true);
  assert.equal(f7.data[0].role, null, "null efface bel et bien la fonction");

  alice.close?.();
} finally {
  await host.stop();
  closeStore();
}

// ── 5) Vérification STATIQUE de l'acheminement ────────────────────────────
// L'aller-retour ci-dessus passe par le serveur en direct, sans le worker :
// il n'aurait donc PAS attrapé le défaut d'origine, qui vivait dans la
// recopie des champs du worker. On compare ici la liste des champs
// transportés à ceux que le switch admin du serveur lit réellement. Toute
// action future qui introduirait un champ sans l'ajouter à CHAMPS_ADMIN
// fera échouer ce test — c'est tout l'objet.
const worker = fs.readFileSync(path.join(SRC, "worker.js"), "utf8");
const serveur = fs.readFileSync(path.join(SRC, "server.js"), "utf8");

const bloc = worker.match(/const CHAMPS_ADMIN = \[([\s\S]*?)\];/);
assert.ok(bloc, "CHAMPS_ADMIN doit exister dans worker.js");
const transportes = new Set([...bloc[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

// Champs lus par le switch admin du serveur.
//
// ⚠️ SURTOUT PAS UNE FENÊTRE DE TAILLE FIXE.
// La première version de ce test lisait « les 6 000 caractères suivant le
// switch ». Le switch a grandi ; les actions ajoutées ensuite sont tombées
// au-delà, et le test a continué de passer au vert en ne contrôlant plus
// qu'une partie de ce qu'il prétendait couvrir. Un garde-fou qui rétrécit
// tout seul est pire que pas de garde-fou : il rassure.
// On délimite donc le bloc par ses ACCOLADES, et l'on vérifie ensuite que
// la dernière action du switch est bien dedans — sans quoi le découpage
// serait faux sans le dire.
const debut = serveur.indexOf("switch (payload.action)");
assert.ok(debut > 0, "le switch admin doit être repérable dans server.js");
const ouvrante = serveur.indexOf("{", debut);
let profondeur = 0, fin = -1;
for (let i = ouvrante; i < serveur.length; i++) {
  if (serveur[i] === "{") profondeur++;
  else if (serveur[i] === "}" && --profondeur === 0) { fin = i; break; }
}
assert.ok(fin > ouvrante, "le bloc du switch admin doit se refermer");
const zone = serveur.slice(debut, fin);

// Canari : la dernière action déclarée dans le switch doit se trouver dans
// la zone découpée. Si un jour elle n'y est plus, c'est le DÉCOUPAGE qui
// est cassé, et le test doit le dire au lieu de vérifier le vide.
const actions = [...zone.matchAll(/case "([a-z-]+)":/g)].map((m) => m[1]);
assert.ok(actions.length >= 10, `découpage suspect : seulement ${actions.length} actions vues`);
assert.ok(actions.includes("set-admin-pin"), "le découpage doit atteindre la fin du switch");

const lus = new Set([...zone.matchAll(/payload\.(\w+)/g)].map((m) => m[1]));

const manquants = [...lus].filter((c) => !transportes.has(c));
assert.deepEqual(manquants, [],
  `champs lus par le serveur mais NON transportés par le worker : ${manquants.join(", ")}`);

console.log("✅ admin-fonction : la fonction survit, un champ absent n'efface rien");
