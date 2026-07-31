"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";
import { useTabContext } from "@/context/tabcontext";

interface VaultEntry {
  id: string;
  site: string;
  login: string;
  password: string;
  url: string;
  createdAt?: number;
}

interface VaultPanelProps {
  onClose: () => void;
}

type VaultView = "list" | "add" | "unavailable" | "backup";

// Sauvegarde et restauration partagent le même écran : une phrase
// secrète, saisie deux fois lorsqu'il s'agit d'en créer une.
type BackupMode = "export" | "import";

const MIN_PASSPHRASE = 8; // doit rester aligné sur public/vault-portable.js

function getThemeName() {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

export default function VaultPanel({ onClose }: VaultPanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { activeTab, tabs } = useTabContext();
  const [view, setView] = useState<VaultView>("list");
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ site: "", login: "", password: "", url: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [injectStatus, setInjectStatus] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState("");
  const [backupMode, setBackupMode] = useState<BackupMode>("export");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [backupDone, setBackupDone] = useState("");

  const api = typeof window !== "undefined" ? (window as any).electronAPI : null;
  const currentTab = tabs.find(t => t.id === activeTab);
  const dir = isRTL ? "rtl" : "ltr";

  const theme = getThemeName();
  const isDark = theme === "dark";
  const bg     = isDark ? "#0d1a12" : theme === "light" ? "#fff" : "#1a0500";
  const border = isDark ? "rgba(255,255,255,0.1)" : theme === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text   = isDark ? "#fff" : theme === "light" ? "#1a2e22" : "#ffd4a0";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : theme === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = theme === "sunset" ? "#c83200" : "#006341";
  const inputBg = isDark ? "rgba(255,255,255,0.07)" : theme === "light" ? "rgba(0,99,65,0.05)" : "rgba(255,80,20,0.07)";

  // Charger les entrées
  const loadEntries = useCallback(async () => {
    if (!api?.invoke) return;
    setLoading(true);
    try {
      const available = await api.invoke("vault-is-available");
      if (!available) { setView("unavailable"); return; }
      const list = await api.invoke("vault-list");
      setEntries(list || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Pré-remplir le formulaire avec l'URL de l'onglet actif
  useEffect(() => {
    if (view === "add" && currentTab?.url) {
      try {
        const host = new URL(currentTab.url).hostname.replace("www.", "");
        setForm(f => ({ ...f, site: host, url: currentTab.url || "" }));
      } catch {}
    }
  }, [view, currentTab?.url]);

  const handleSave = async () => {
    if (!form.site || !form.password) return;
    setSaveStatus("saving");
    const res = await api?.invoke("vault-upsert", form);
    if (res?.ok) {
      setSaveStatus("ok");
      setForm({ site: "", login: "", password: "", url: "" });
      await loadEntries();
      setTimeout(() => { setSaveStatus(""); setView("list"); }, 800);
    } else {
      setSaveStatus("error");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("Vault.confirmDelete"))) return;
    await api?.invoke("vault-delete", id);
    await loadEntries();
  };

  const handleInject = async (id: string) => {
    if (!activeTab) return;
    setInjectStatus(s => ({ ...s, [id]: "loading" }));
    const res = await api?.invoke("vault-inject", { id, tabId: activeTab });
    setInjectStatus(s => ({ ...s, [id]: res?.ok ? "ok" : "error" }));
    setTimeout(() => setInjectStatus(s => ({ ...s, [id]: "" })), 2000);
    if (res?.ok) onClose();
  };

  const openBackup = (mode: BackupMode) => {
    setBackupMode(mode);
    setPass1(""); setPass2(""); setShowPass(false);
    setBackupError(""); setBackupDone("");
    setView("backup");
  };

  const handleBackup = async () => {
    setBackupError(""); setBackupDone("");
    if (pass1.length < MIN_PASSPHRASE) {
      setBackupError(t("Vault.passTooShort")); return;
    }
    if (backupMode === "export" && pass1 !== pass2) {
      setBackupError(t("Vault.passMismatch")); return;
    }
    setBackupBusy(true);
    try {
      const res = await api?.invoke(
        backupMode === "export" ? "vault-export" : "vault-import",
        { passphrase: pass1 },
      );
      if (res?.ok) {
        setBackupDone(
          backupMode === "export"
            ? t("Vault.exportDone")
            : `${t("Vault.importDone")} (+${res.added ?? 0} / ↻${res.updated ?? 0})`,
        );
        setPass1(""); setPass2("");
        if (backupMode === "import") await loadEntries();
      } else if (res?.error && res.error !== "canceled") {
        // « empty » et les échecs de déchiffrement remontent tels quels :
        // l'utilisateur doit savoir si sa phrase est refusée.
        setBackupError(res.error === "empty" ? t("Vault.empty") : res.error);
      }
    } catch (e: any) {
      setBackupError(e?.message || String(e));
    } finally {
      setBackupBusy(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: `1px solid ${border}`, background: inputBg,
    color: text, fontSize: 13, outline: "none",
  };

  const btnStyle = (primary = false): React.CSSProperties => ({
    padding: "9px 16px", borderRadius: 8, border: primary ? "none" : `1px solid ${border}`,
    background: primary ? `linear-gradient(135deg,${accent},${accent}cc)` : "transparent",
    color: primary ? "#fff" : text, fontWeight: 600, fontSize: 13,
    cursor: "pointer", transition: "all .15s",
  });

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "14vh", padding: "14vh 16px 16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div dir={dir} style={{
        width: 480, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto",
        background: bg, border: `1px solid ${border}`, borderRadius: 20,
        padding: 22, color: text, boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔐</span>
          <span style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t("Vault.title")}</span>
          {view === "list" && (
            <button onClick={() => setView("add")} style={{ ...btnStyle(true), padding: "6px 12px", fontSize: 12 }}>
              + {t("Vault.add")}
            </button>
          )}
          {view === "add" && (
            <button onClick={() => setView("list")} style={{ ...btnStyle(), padding: "6px 12px", fontSize: 12 }}>
              ← {t("Vault.back")}
            </button>
          )}
          <button onClick={onClose} style={{ background: "none", border: "none", color: muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {/* Indisponible */}
        {view === "unavailable" && (
          <div style={{ textAlign: "center", padding: "20px 0", color: muted, fontSize: 13 }}>
            ⚠️ {t("Vault.unavailable")}
          </div>
        )}

        {/* Liste */}
        {view === "list" && (
          <>
            {loading ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: muted, fontSize: 13 }}>
                {t("Vault.loading")}…
              </div>
            ) : entries.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0", color: muted, fontSize: 13 }}>
                🔑 {t("Vault.empty")}
              </div>
            ) : (
              entries.map(entry => (
                <div key={entry.id} style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 10,
                  border: `1px solid ${border}`, padding: "10px 14px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {/* Favicon lettre */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: `${accent}30`, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 16, fontWeight: 700, color: accent,
                  }}>
                    {entry.site.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.site}</div>
                    <div style={{ fontSize: 11, color: muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.login || t("Vault.noLogin")}
                    </div>
                  </div>
                  {/* Bouton injecter */}
                  <button
                    onClick={() => handleInject(entry.id)}
                    title={t("Vault.inject")}
                    style={{
                      padding: "6px 10px", borderRadius: 8, border: `1px solid ${border}`,
                      background: injectStatus[entry.id] === "ok" ? `${accent}40` : "transparent",
                      color: injectStatus[entry.id] === "error" ? "#ff6060" : text,
                      fontSize: 13, cursor: "pointer",
                    }}
                  >
                    {injectStatus[entry.id] === "loading" ? "…"
                     : injectStatus[entry.id] === "ok"    ? "✓"
                     : injectStatus[entry.id] === "error" ? "✗"
                     : "↓"}
                  </button>
                  {/* Bouton supprimer */}
                  <button
                    onClick={() => handleDelete(entry.id)}
                    title={t("Vault.delete")}
                    style={{ padding: "6px 8px", borderRadius: 8, border: "none", background: "transparent", color: "#ff8080", fontSize: 14, cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
            <div style={{ display: "flex", gap: 8, alignSelf: "flex-end", flexWrap: "wrap" }}>
              {entries.length > 0 && (
                <button onClick={() => openBackup("export")} style={{ ...btnStyle(), fontSize: 12 }}>
                  📦 {t("Vault.export")}
                </button>
              )}
              <button onClick={() => openBackup("import")} style={{ ...btnStyle(), fontSize: 12 }}>
                📥 {t("Vault.import")}
              </button>
            </div>
          </>
        )}

        {/* Formulaire ajout */}
        {view === "add" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Vault.site")} *</div>
                <input style={inputStyle} value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} placeholder="facebook.com" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Vault.url")}</div>
                <input style={inputStyle} value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://facebook.com/login" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Vault.login")}</div>
                <input style={inputStyle} value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="email@exemple.com" autoComplete="off" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>{t("Vault.password")} *</div>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 40 }}
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <button
                    onClick={() => setShowPassword(s => !s)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: muted, cursor: "pointer", fontSize: 14 }}
                  >
                    {showPassword ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setView("list")} style={{ ...btnStyle(), flex: 1 }}>
                {t("Vault.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={!form.site || !form.password}
                style={{ ...btnStyle(true), flex: 2, opacity: (!form.site || !form.password) ? 0.5 : 1 }}
              >
                {saveStatus === "saving" ? "…"
                 : saveStatus === "ok"   ? "✓ " + t("Vault.saved")
                 : t("Vault.save")}
              </button>
            </div>
          </>
        )}

        {/* Sauvegarde / restauration par phrase secrète */}
        {view === "backup" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 12.5, lineHeight: 1.6, color: muted, margin: 0 }}>
                {backupMode === "export" ? t("Vault.exportHelp") : t("Vault.importHelp")}
              </p>

              <div>
                <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
                  {t("Vault.passphrase")} *
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 40 }}
                    type={showPass ? "text" : "password"}
                    value={pass1}
                    onChange={e => setPass1(e.target.value)}
                    autoComplete="new-password"
                    dir="ltr"
                  />
                  <button
                    onClick={() => setShowPass(s => !s)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: muted, cursor: "pointer", fontSize: 14 }}
                  >
                    {showPass ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {backupMode === "export" && (
                <div>
                  <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
                    {t("Vault.passphraseConfirm")} *
                  </div>
                  <input
                    style={inputStyle}
                    type={showPass ? "text" : "password"}
                    value={pass2}
                    onChange={e => setPass2(e.target.value)}
                    autoComplete="new-password"
                    dir="ltr"
                  />
                </div>
              )}

              {backupMode === "export" && (
                <p style={{ fontSize: 11.5, lineHeight: 1.55, color: "#e0a030", margin: 0 }}>
                  ⚠️ {t("Vault.passWarning")}
                </p>
              )}

              {backupError && (
                <p style={{ fontSize: 12, color: "#ff8080", margin: 0 }}>{backupError}</p>
              )}
              {backupDone && (
                <p style={{ fontSize: 12, color: "#4ade80", margin: 0 }}>✓ {backupDone}</p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setView("list")} style={{ ...btnStyle(), flex: 1 }}>
                {t("Vault.cancel")}
              </button>
              <button
                onClick={handleBackup}
                disabled={backupBusy || pass1.length < MIN_PASSPHRASE}
                style={{ ...btnStyle(true), flex: 2, opacity: (backupBusy || pass1.length < MIN_PASSPHRASE) ? 0.5 : 1 }}
              >
                {backupBusy ? "…" : backupMode === "export" ? t("Vault.export") : t("Vault.import")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
