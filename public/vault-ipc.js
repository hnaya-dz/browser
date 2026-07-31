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
import { randomBytes } from "crypto";
import {
  vaultRead, vaultUpsert, vaultDelete, vaultWrite,
  vaultFindByDomain, vaultIsAvailable
} from "./vault.js";
import { exportPortable, importPortable } from "./vault-portable.js";

// ⚠️ Les codes de la Messagerie locale NE VIVENT PAS ICI. Un code de
// salon est un secret PARTAGÉ par un service entier, pas un identifiant
// personnel : le mêler aux comptes de l'utilisateur brouillait sa propre
// liste. Ils ont leur propre stockage chiffré — voir public/chat-session.js.
// Le nettoyage ci-dessous efface les entrées laissées par cette approche
// abandonnée (schéma hnaya-chat://), une seule fois.
const LEGACY_CHAT_SCHEME = "hnaya-chat://";

function purgeLegacyChatEntries() {
  const legacy = vaultRead().filter((e) => String(e.url || "").startsWith(LEGACY_CHAT_SCHEME));
  for (const entry of legacy) vaultDelete(entry.id);
  if (legacy.length) {
    console.log(`[vault] ${legacy.length} code(s) de salon retiré(s) des mots de passe (déplacés vers chat-session).`);
  }
}

export function registerVaultIpc(getMainWindow, getBrowserViews, getActiveTabId) {
  purgeLegacyChatEntries();

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

  // Sauvegarder le vault dans un fichier TRANSPORTABLE
  //
  // ⚠️ L'ancienne version copiait simplement userData/vault.enc. Ce
  // fichier était inexploitable : sa clé vit dans vault.key, elle-même
  // scellée par DPAPI pour le compte Windows de ce poste. La sauvegarde
  // ne pouvait donc être relue ni sur une autre machine, ni après une
  // réinstallation — alors que le bouton promet « Sauvegarder ».
  // La clé dérive désormais d'une phrase secrète fournie par
  // l'utilisateur (voir vault-portable.js).
  ipcMain.handle("vault-export", async (event, { passphrase } = {}) => {
    const entries = vaultRead();
    if (!entries.length) return { ok: false, error: "empty" };
    let contenu;
    try {
      contenu = exportPortable(entries, passphrase);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const mainWindow = getMainWindow();
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: "Sauvegarder les mots de passe Hnaya DZ",
      defaultPath: `hnaya-mots-de-passe-${new Date().toISOString().slice(0, 10)}.hnaya`,
      filters: [{ name: "Sauvegarde Hnaya", extensions: ["hnaya"] }],
    });
    if (canceled || !filePath) return { ok: false, error: "canceled" };
    try {
      const { writeFileSync } = await import("fs");
      writeFileSync(filePath, contenu, "utf8");
      return { ok: true, count: entries.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Restaurer depuis une sauvegarde transportable.
  // Les entrées sont fusionnées : une même paire (site, identifiant) est
  // mise à jour plutôt que dupliquée, et les identifiants internes sont
  // régénérés pour ne pas heurter ceux du poste d'accueil.
  ipcMain.handle("vault-import", async (event, { passphrase } = {}) => {
    const mainWindow = getMainWindow();
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: "Restaurer des mots de passe Hnaya DZ",
      filters: [{ name: "Sauvegarde Hnaya", extensions: ["hnaya"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths[0]) return { ok: false, error: "canceled" };
    try {
      const { readFileSync } = await import("fs");
      const importees = importPortable(readFileSync(filePaths[0], "utf8"), passphrase);

      const entries = vaultRead();
      let ajoutes = 0, misAJour = 0;
      for (const e of importees) {
        if (!e || !e.site || !e.password) continue; // entrée inutilisable
        const i = entries.findIndex(
          (x) => x.site === e.site && (x.login || "") === (e.login || ""),
        );
        if (i >= 0) {
          entries[i] = { ...entries[i], password: e.password, url: e.url || entries[i].url };
          misAJour++;
        } else {
          entries.push({
            site: e.site, login: e.login || "", password: e.password, url: e.url || "",
            id: randomBytes(8).toString("hex"), createdAt: Date.now(),
          });
          ajoutes++;
        }
      }
      if (!vaultWrite(entries)) return { ok: false, error: "write" };
      return { ok: true, added: ajoutes, updated: misAJour };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
