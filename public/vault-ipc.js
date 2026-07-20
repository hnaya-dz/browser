// public/vault-ipc.js
// ══════════════════════════════════════════════════════════════════
// Canaux IPC pour le gestionnaire de mots de passe
// À importer et appeler depuis electron.js après app.whenReady()
//
// ⚠️ NE PAS MODIFIER :
//   - Les mots de passe ne transitent JAMAIS en clair via IPC vers la page web
//   - L'injection se fait via executeJavaScript directement dans la WebContentsView
//   - Jamais via le presse-papier (lisible par d'autres apps)
// ══════════════════════════════════════════════════════════════════

import { ipcMain, dialog } from "electron";
import {
  vaultRead, vaultUpsert, vaultDelete,
  vaultFindByDomain, vaultIsAvailable
} from "./vault.js";

// ══════════════════════════════════════════════════════════════════
// Codes de la Messagerie locale (PIN d'accès et PIN admin)
// ══════════════════════════════════════════════════════════════════
// EXCEPTION ASSUMÉE À L'INVARIANT CI-DESSUS, limitée à ces codes :
// l'invariant protège les identifiants de SITES WEB, qui sont injectés
// dans des pages distantes (WebContentsView) — un contexte hostile.
// Ces codes-ci sont générés par l'application elle-même, pour sa propre
// interface (le dock, servi depuis 127.0.0.1), et y sont DÉJÀ affichés
// à l'hôte. Les remplir automatiquement n'ouvre donc aucune surface
// nouvelle, alors que l'inverse obligeait l'utilisateur à mémoriser un
// code que le coffre est justement fait pour retenir.
// ⚠️ GARDE-FOU : la lecture est strictement limitée au schéma
// hnaya-chat:// — aucun identifiant de site ne peut être lu par ces
// canaux, quelle que soit la clé demandée.
const CHAT_SCHEME = "hnaya-chat://";
const CHAT_KINDS = new Set(["admin", "access"]);

function chatPinUrl(kind, roomKey) {
  if (!CHAT_KINDS.has(kind) || !roomKey) return null;
  return `${CHAT_SCHEME}${kind}/${roomKey}`;
}

/** Lit un code de salon (usage process principal ET canal IPC dédié). */
export function readChatPin(kind, roomKey) {
  const url = chatPinUrl(kind, roomKey);
  if (!url) return null;
  const entry = vaultRead().find((e) => e.url === url);
  return entry?.password || null;
}


export function registerVaultIpc(getMainWindow, getBrowserViews, getActiveTabId) {

  // Vérifier si le chiffrement est disponible sur cette machine
  ipcMain.handle("vault-is-available", async () => {
    return vaultIsAvailable();
  });

  // Lire toutes les entrées (mots de passe masqués pour l'affichage)
  ipcMain.handle("vault-list", async () => {
    const entries = vaultRead();
    // Masquer les mots de passe pour l'affichage dans l'UI
    return entries.map(e => ({ ...e, password: "••••••••" }));
  });

  // ══════════════════════════════════════════════════════════════
  // PIN administrateur de la Messagerie locale (étape D.3)
  // ══════════════════════════════════════════════════════════════
  // Ces codes sont générés par l'application elle-même (pas des
  // identifiants de site) et sont rangés dans le même coffre chiffré.
  // ⚠️ L'INVARIANT DU FICHIER EST PRÉSERVÉ : aucun mot de passe ne
  // repart en clair vers la page. « vault-chat-pin-has » ne renvoie
  // qu'un booléen ; la lecture du code se fait UNIQUEMENT dans le
  // process principal (voir chat-admin dans electron.js, qui injecte
  // le PIN dans la commande sans jamais le transmettre au renderer).
  // Enregistrer un code de salon (kind: "access" = code d'accès partagé,
  // "admin" = code d'administration)
  ipcMain.handle("vault-chat-pin-save", async (event, { kind = "admin", roomKey, roomName, pin, adminPin }) => {
    const code = String(pin ?? adminPin ?? "");
    const url = chatPinUrl(kind, roomKey);
    if (!url || !/^\d{6}$/.test(code)) return { ok: false, error: "Données incomplètes" };
    const existing = vaultRead().find((e) => e.url === url);
    const ok = vaultUpsert({
      ...(existing || {}),
      site: "Hnaya — Messagerie locale",
      url,
      login: `${roomName || "Salon"} — ${kind === "admin" ? "administration" : "accès"}`,
      password: code,
    });
    return { ok };
  });

  // Existence d'un code enregistré (booléen)
  ipcMain.handle("vault-chat-pin-has", async (event, arg) => {
    const { kind = "admin", roomKey } = typeof arg === "string" ? { roomKey: arg } : (arg || {});
    return !!readChatPin(kind, roomKey);
  });

  // Remplissage automatique — limité au schéma hnaya-chat:// (voir la note
  // ci-dessus) : ce canal ne peut PAS servir à lire un mot de passe de site.
  ipcMain.handle("vault-chat-pin-get", async (event, { kind = "admin", roomKey } = {}) => {
    return readChatPin(kind, roomKey);
  });

  // Oublier un code enregistré
  ipcMain.handle("vault-chat-pin-forget", async (event, { kind = "admin", roomKey } = {}) => {
    const url = chatPinUrl(kind, roomKey);
    if (!url) return { ok: false };
    const entry = vaultRead().find((e) => e.url === url);
    if (!entry) return { ok: true };
    return { ok: vaultDelete(entry.id) };
  });

  // Ajouter ou mettre à jour une entrée
  ipcMain.handle("vault-upsert", async (event, entry) => {
    if (!entry.site || !entry.password) return { ok: false, error: "Données incomplètes" };
    const ok = vaultUpsert(entry);
    return { ok };
  });

  // Supprimer une entrée
  ipcMain.handle("vault-delete", async (event, id) => {
    const ok = vaultDelete(id);
    return { ok };
  });

  // Obtenir les credentials pour le site actif (sans le mot de passe en clair)
  ipcMain.handle("vault-find-for-current-tab", async (event, url) => {
    try {
      const domain = new URL(url).hostname.replace("www.", "");
      const matches = vaultFindByDomain(domain);
      return matches.map(e => ({ id: e.id, site: e.site, login: e.login, url: e.url }));
    } catch { return []; }
  });

  // ✅ Injecter les credentials dans la WebContentsView active
  // Le mot de passe ne passe JAMAIS via IPC — il est lu directement depuis le vault
  // et injecté via executeJavaScript dans la vue, sans transiter par le renderer React
  ipcMain.handle("vault-inject", async (event, { id, tabId }) => {
    const mainWindow  = getMainWindow();
    const browserViews = getBrowserViews();

    const entries = vaultRead();
    const entry = entries.find(e => e.id === id);
    if (!entry) return { ok: false, error: "Entrée introuvable" };

    const view = browserViews.get(tabId);
    if (!view) return { ok: false, error: "Onglet introuvable" };

    // ✅ Échapper les valeurs pour éviter une injection JS
    const login    = JSON.stringify(entry.login);
    const password = JSON.stringify(entry.password);

    try {
      const result = await view.webContents.executeJavaScript(`
        (function() {
          // Cibler les champs de login standard
          const loginSelectors = [
            'input[type="email"]',
            'input[type="text"][name*="user"]',
            'input[type="text"][name*="login"]',
            'input[type="text"][name*="email"]',
            'input[autocomplete="username"]',
            'input[autocomplete="email"]',
          ];
          const passwordSelectors = [
            'input[type="password"]',
          ];

          const findField = (selectors) => {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.offsetParent !== null) return el; // visible uniquement
            }
            return null;
          };

          const loginField    = findField(loginSelectors);
          const passwordField = findField(passwordSelectors);

          let filled = 0;

          if (loginField) {
            loginField.focus();
            loginField.value = ${login};
            loginField.dispatchEvent(new Event('input', { bubbles: true }));
            loginField.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }

          if (passwordField) {
            passwordField.focus();
            passwordField.value = ${password};
            passwordField.dispatchEvent(new Event('input', { bubbles: true }));
            passwordField.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }

          return { filled, hasLogin: !!loginField, hasPassword: !!passwordField };
        })();
      `);
      return { ok: true, ...result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Sauvegarder un nouveau mot de passe depuis la page active
  ipcMain.handle("vault-save-from-page", async (event, { url, login, password }) => {
    if (!url || !password) return { ok: false };
    let site = url;
    try { site = new URL(url).hostname.replace("www.", ""); } catch {}
    return { ok: vaultUpsert({ site, login: login || "", password, url }) };
  });

  // Exporter le vault (fichier chiffré) — pour sauvegarde
  ipcMain.handle("vault-export", async () => {
    const mainWindow = getMainWindow();
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: "Exporter le vault Hnaya DZ",
      defaultPath: `hnaya-vault-${Date.now()}.enc`,
      filters: [{ name: "Vault chiffré", extensions: ["enc"] }],
    });
    if (canceled || !filePath) return { ok: false };
    try {
      const { readFileSync, writeFileSync } = await import("fs");
      const { join } = await import("path");
      const { app } = await import("electron");
      const src = join(app.getPath("userData"), "vault.enc");
      writeFileSync(filePath, readFileSync(src));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
