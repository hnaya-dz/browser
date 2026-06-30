// public/update-check.js
// ══════════════════════════════════════════════════════════════════
// Vérification de mise à jour — Option A (notification manuelle)
//
// AUCUNE dépendance à un service tiers de mise à jour automatique.
// Compare app.getVersion() à un fichier JSON distant, au maximum
// une fois par semaine (throttle stocké dans userData).
//
// ⚠️ Pour basculer de GitHub vers hnaya.dz : changer UNIQUEMENT
// la constante VERSION_CHECK_URL ci-dessous. Rien d'autre à toucher.
// ══════════════════════════════════════════════════════════════════

import { app } from "electron";
import https from "https";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

// ── Source de vérité pour la version disponible ──────────────────────────────
const VERSION_CHECK_URL = "https://raw.githubusercontent.com/hnaya-dz/browser/main/version.json";
// const VERSION_CHECK_URL = "https://hnaya.dz/updates/version.json"; // à activer plus tard

// ── Throttle : une vérification réseau au maximum par semaine ───────────────
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const throttleFilePath = () => join(app.getPath("userData"), "last-update-check.json");

function getLastCheckTimestamp() {
  try {
    const raw = readFileSync(throttleFilePath(), "utf8");
    return JSON.parse(raw).lastCheck || 0;
  } catch { return 0; }
}

function setLastCheckTimestamp() {
  try {
    writeFileSync(throttleFilePath(), JSON.stringify({ lastCheck: Date.now() }), "utf8");
  } catch {}
}

function shouldCheckNow() {
  return (Date.now() - getLastCheckTimestamp()) >= CHECK_INTERVAL_MS;
}

// ── Comparaison sémantique simple (X.Y.Z) ────────────────────────────────────
function isNewerVersion(remote, current) {
  const r = remote.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true;
    if ((r[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

// ── Téléchargement JSON simple ────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject).on("timeout", function () {
      this.destroy();
      reject(new Error("timeout"));
    });
  });
}

// ── Extraire les notes dans la langue demandée, avec repli sur le français ──
function pickNotes(notes, lang) {
  if (typeof notes === "string") return notes; // ancien format — compatibilité
  if (notes && typeof notes === "object") {
    return notes[lang] || notes.fr || notes.en || "";
  }
  return "";
}

// ── Vérification principale ───────────────────────────────────────────────────
// lang: "ar" | "fr" | "en" — langue actuellement sélectionnée dans l'app
// force: ignore le throttle (utile pour un bouton "vérifier maintenant" futur)
export async function checkForUpdate(lang = "fr", force = false) {
  if (!force && !shouldCheckNow()) {
    return { available: false, throttled: true };
  }

  try {
    const remote = await fetchJson(VERSION_CHECK_URL);
    setLastCheckTimestamp(); // ✅ on marque la vérification, succès ou non, pour éviter de spammer un serveur en panne

    const currentVersion = app.getVersion();
    if (!remote.version || !remote.url) {
      return { available: false, error: "Format version.json invalide" };
    }

    if (isNewerVersion(remote.version, currentVersion)) {
      return {
        available: true,
        currentVersion,
        newVersion: remote.version,
        url: remote.url,
        notes: pickNotes(remote.notes, lang),
      };
    }
    return { available: false, currentVersion };
  } catch (e) {
    return { available: false, error: e.message };
  }
}
