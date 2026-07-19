"use client";
// ═══════════════════════════════════════════════════════════════
// Panneau d'administration du salon (étape D) — vit DANS le dock
// ═══════════════════════════════════════════════════════════════
// Accès : PIN admin (distinct du PIN du salon), demandé à CHAQUE ouverture
// et jamais persisté côté client. Trois onglets :
//   Appareils  — registre : pseudos vus, machine, IP, étiquette admin
//   Historique — recherche (mot-clé/auteur) + exports JSON/CSV
//   Réglages   — rétention des messages (0 = illimitée)
// Le serveur du salon reste l'unique autorité : chaque action repart par
// le canal chiffré (voir chat-module/src/server.js, type "admin").

import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Laptop, Smartphone as PhoneIcon, BadgeCheck, BadgeX, Download } from "lucide-react";
import { store, sendAdminCommand, resetAdminState, getApi, type AdminDevice } from "@/context/chatstore";

interface Props {
  accent: string;
  muted: string;
  border: string;
  inputBg: string;
  inputStyle: React.CSSProperties;
  btnStyle: (primary?: boolean, disabled?: boolean) => React.CSSProperties;
}

export default function ChatAdminPanel({ accent, muted, border, inputBg, inputStyle, btnStyle }: Props) {
  const { t } = useTranslation();
  // Le PIN vit UNIQUEMENT dans cet état local — jamais en localStorage.
  // Pré-rempli pour l'hôte (il vient de lui être affiché par host-started).
  const [adminPin, setAdminPin] = useState(store.isHost ? (store.adminPin || "") : "");
  const [tab, setTab] = useState<"devices" | "history" | "settings">("devices");
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);

  const authenticate = () => {
    if (!/^\d{6}$/.test(adminPin)) return;
    sendAdminCommand({ adminPin, action: "devices" });
    sendAdminCommand({ adminPin, action: "config-get" });
  };

  const runSearch = () => {
    const filters: Record<string, unknown> = { limit: 200 };
    if (q.trim()) filters.q = q.trim();
    if (author.trim()) filters.from = author.trim();
    sendAdminCommand({ adminPin, action: "search", filters });
  };

  const deviceName = (fp: string | null) => {
    if (!fp) return null;
    const d = store.adminDevices.find((x) => x.fingerprint === fp);
    return d?.label || d?.lastNickname || fp.slice(0, 8);
  };

  const exportHistory = async (format: "json" | "csv") => {
    const rows = store.adminSearch;
    let content: string;
    if (format === "json") {
      content = JSON.stringify(rows, null, 2);
    } else {
      // CSV : champs textuels entre guillemets doublés (règle RFC 4180)
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      content = [
        ["date", "auteur", "appareil", "etiquette", "signe", "texte"].join(","),
        ...rows.map((m) => [
          esc(new Date(m.ts).toISOString()),
          esc(m.from),
          esc((m as any).deviceFp || ""),
          esc(deviceName((m as any).deviceFp) || ""),
          (m as any).signatureValid ? "oui" : "non",
          esc(m.text),
        ].join(",")),
      ].join("\n");
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await getApi()?.invoke("chat-admin-export", {
      filename: `hnaya-messagerie-${stamp}.${format}`,
      content,
    });
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      style={{
        flex: 1, padding: "5px 0", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
        background: tab === id ? `${accent}25` : "transparent",
        border: `1px solid ${tab === id ? accent + "60" : border}`,
        borderRadius: 4, color: "inherit",
      }}
    >
      {label}
    </button>
  );

  // ── Écran de saisie du PIN admin ─────────────────────────────────────
  if (!store.adminAuthed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 11, color: muted, lineHeight: 1.5 }}>{t("Chat.adminPinPrompt")}</div>
        <input
          style={{ ...inputStyle, textAlign: "center", letterSpacing: 6, fontSize: 18 }}
          value={adminPin}
          onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && authenticate()}
          placeholder="••••••"
          type="password"
          inputMode="numeric"
          autoFocus
        />
        {store.adminError === "admin-pin" && (
          <div style={{ fontSize: 11, color: "#ff5252" }}>{t("Chat.adminWrongPin")}</div>
        )}
        <button onClick={authenticate} disabled={!/^\d{6}$/.test(adminPin)} style={btnStyle(true, !/^\d{6}$/.test(adminPin))}>
          {t("Chat.adminAccess")}
        </button>
      </div>
    );
  }

  // ── Panneau authentifié ──────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {tabBtn("devices", t("Chat.adminDevices"))}
        {tabBtn("history", t("Chat.adminHistory"))}
        {tabBtn("settings", t("Chat.adminSettings"))}
      </div>

      {store.adminError && store.adminError !== "admin-pin" && (
        <div style={{ fontSize: 10.5, color: "#ff5252", flexShrink: 0 }}>{store.adminError}</div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* ── Registre des appareils ── */}
        {tab === "devices" && (
          store.adminDevices.length === 0 ? (
            <div style={{ fontSize: 11, color: muted, textAlign: "center", padding: 12 }}>{t("Chat.adminNoResults")}</div>
          ) : store.adminDevices.map((d: AdminDevice) => (
            <div key={d.fingerprint} style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 8, background: inputBg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {(d.platform || "").startsWith("mobile-web") ? <PhoneIcon size={13} /> : <Laptop size={13} />}
                <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>
                  {d.label || d.lastNickname || t("Chat.adminUnnamed")}
                </span>
                <span style={{ fontSize: 9, color: muted, fontFamily: "monospace", direction: "ltr" }}>{d.fingerprint.slice(0, 8)}</span>
              </div>
              <div style={{ fontSize: 9.5, color: muted, marginTop: 3, lineHeight: 1.6, direction: "ltr", textAlign: "start" }}>
                {d.hostname && <>🖥 {d.hostname} · </>}{d.platform} · {d.lastIp?.replace("::ffff:", "")}
                <br />
                {t("Chat.adminNicknames")} : {d.nicknames.join(", ") || "—"}
                <br />
                {t("Chat.adminSeen")} : {new Date(d.lastSeen).toLocaleString()}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "5px 8px" }}
                  placeholder={t("Chat.adminLabelPlaceholder")}
                  value={labelDrafts[d.fingerprint] ?? d.label ?? ""}
                  onChange={(e) => setLabelDrafts((s) => ({ ...s, [d.fingerprint]: e.target.value }))}
                />
                <button
                  onClick={() => sendAdminCommand({ adminPin, action: "label", fingerprint: d.fingerprint, label: (labelDrafts[d.fingerprint] ?? d.label ?? "").trim() || null })}
                  style={{ ...btnStyle(true), padding: "5px 10px", fontSize: 10.5 }}
                >
                  {t("Chat.adminSave")}
                </button>
              </div>
            </div>
          ))
        )}

        {/* ── Historique ── */}
        {tab === "history" && (
          <>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <input style={{ ...inputStyle, flex: 1.4, fontSize: 11, padding: "6px 8px" }} placeholder={t("Chat.adminSearchPlaceholder")}
                value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
              <input style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "6px 8px" }} placeholder={t("Chat.adminAuthor")}
                value={author} onChange={(e) => setAuthor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
              <button onClick={runSearch} style={{ ...btnStyle(true), padding: "6px 10px", fontSize: 11 }}>{t("Chat.adminSearch")}</button>
            </div>
            {store.adminSearch.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => exportHistory("json")} style={{ ...btnStyle(), padding: "4px 8px", fontSize: 10, display: "flex", gap: 4, alignItems: "center" }}>
                  <Download size={11} /> JSON
                </button>
                <button onClick={() => exportHistory("csv")} style={{ ...btnStyle(), padding: "4px 8px", fontSize: 10, display: "flex", gap: 4, alignItems: "center" }}>
                  <Download size={11} /> CSV
                </button>
                <span style={{ fontSize: 10, color: muted, alignSelf: "center" }}>{store.adminSearch.length}</span>
              </div>
            )}
            {store.adminSearch.length === 0 ? (
              <div style={{ fontSize: 11, color: muted, textAlign: "center", padding: 12 }}>{t("Chat.adminNoResults")}</div>
            ) : store.adminSearch.map((m) => (
              <div key={m.id} style={{ border: `1px solid ${border}`, borderRadius: 6, padding: "5px 8px", fontSize: 11 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", color: muted, fontSize: 9.5 }}>
                  <span style={{ fontWeight: 700 }}>{m.from}</span>
                  {(m as any).deviceFp && <span>({deviceName((m as any).deviceFp)})</span>}
                  <span style={{ flex: 1 }} />
                  {/* Badge de signature : ✓ = message signé et vérifié par le
                      serveur (non-répudiation) ; ✗ = client ancien ou signature
                      invalide — à considérer comme non certifié */}
                  {(m as any).signatureValid
                    ? <BadgeCheck size={12} color="#00c853" aria-label={t("Chat.adminSigned")} />
                    : <BadgeX size={12} color={muted} aria-label={t("Chat.adminUnsigned")} />}
                  <span>{new Date(m.ts).toLocaleString()}</span>
                </div>
                <div style={{ marginTop: 2, wordBreak: "break-word" }}>{m.text}</div>
              </div>
            ))}
          </>
        )}

        {/* ── Réglages ── */}
        {tab === "settings" && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700 }}>{t("Chat.adminRetention")}</div>
            <div style={{ fontSize: 10, color: muted, lineHeight: 1.5 }}>{t("Chat.adminRetentionHint")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                type="number" min={0} max={3650}
                value={retentionDraft ?? String(store.adminRetention ?? 90)}
                onChange={(e) => setRetentionDraft(e.target.value)}
              />
              <button
                onClick={() => { sendAdminCommand({ adminPin, action: "config-set", key: "retention_days", value: Number(retentionDraft ?? store.adminRetention ?? 90) }); setRetentionDraft(null); }}
                style={btnStyle(true)}
              >
                {t("Chat.adminSave")}
              </button>
            </div>
            {store.isHost && store.adminPin && (
              <div style={{ marginTop: 8, border: `1px solid ${accent}40`, background: `${accent}12`, borderRadius: 6, padding: 8, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: muted }}>{t("Chat.adminPinYours")}</div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 4, color: accent }}>{store.adminPin}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
