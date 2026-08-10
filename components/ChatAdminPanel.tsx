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

import { useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Laptop, Smartphone as PhoneIcon, BadgeCheck, BadgeX, Download, Lock, LockOpen, Ban, Undo2, KeySquare, UserMinus } from "lucide-react";
import { store, patchStore, sendAdminCommand, resetAdminState, getApi, type AdminDevice } from "@/context/chatstore";

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

  // ── Coffre chiffré (D.3) ──────────────────────────────────────────
  // Clé d'identification du salon : son identifiant si on l'héberge,
  // sinon son adresse réseau. Le code enregistré est repris du coffre et
  // rempli dans le champ, comme le ferait un gestionnaire de mots de
  // passe (voir la note d'exception dans public/vault-ipc.js).
  const roomKey = store.joinedRoomIsHosted && store.hosting
    ? store.hosting.roomId
    : store.selectedSession
      ? `${store.selectedSession.address}:${store.selectedSession.wsPort}`
      : null;
  const [vaultHasPin, setVaultHasPin] = useState(false);
  const [vaultSaved, setVaultSaved] = useState(false);
  const [pinFilledFromVault, setPinFilledFromVault] = useState(false);

  // Remplissage automatique : si un code est enregistré pour ce salon, il
  // est saisi tout seul (comme un gestionnaire de mots de passe). Ne
  // remplace jamais un code déjà présent (celui de l'hôte).
  useEffect(() => {
    if (!roomKey) return;
    getApi()?.invoke?.("chat-session-get", roomKey)
      .then((sess: { adminPin?: string } | null) => {
        const pin = sess?.adminPin;
        if (pin && /^\d{6}$/.test(pin)) {
          setVaultHasPin(true);
          setAdminPin((cur) => (cur ? cur : pin));
          setPinFilledFromVault((prev) => prev || !store.adminPin);
        }
      })
      .catch(() => setVaultHasPin(false));
  }, [roomKey]);

  // Toute commande admin part avec le PIN saisi OU la clé de coffre
  const admin = (params: Record<string, unknown>) =>
    sendAdminCommand({ adminPin, ...params } as any);

  const saveToVault = async () => {
    if (!roomKey || !/^\d{6}$/.test(adminPin)) return;
    const res = await getApi()?.invoke?.("chat-session-save", {
      roomKey,
      roomName: store.sessionName || "Salon",
      adminPin,
    });
    if (res?.ok) { setVaultHasPin(true); setVaultSaved(true); }
  };
  const [tab, setTab] = useState<"devices" | "history" | "settings">("devices");
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [author, setAuthor] = useState("");
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null);
  const [newAdminPin, setNewAdminPin] = useState("");

  const authenticate = () => {
    if (!/^\d{6}$/.test(adminPin)) return;
    sendAdminCommand({ adminPin, action: "devices" });
    sendAdminCommand({ adminPin, action: "room-info" });
    sendAdminCommand({ adminPin, action: "bans" });
    // Étape I — places de licence occupées. Sans ce chiffre, l'admin ne
    // sait pas s'il lui reste de la marge avant d'atteindre le plafond.
    sendAdminCommand({ adminPin, action: "licence-places" });
  };


  const runSearch = () => {
    const filters: Record<string, unknown> = { limit: 200 };
    if (q.trim()) filters.q = q.trim();
    if (author.trim()) filters.from = author.trim();
    admin({ action: "search", filters });
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
        {/* D.3 — code repris du coffre chiffré : rempli automatiquement
            ci-dessus, il suffit de valider */}
        {pinFilledFromVault && (
          <div style={{ fontSize: 10, color: "#00c853", display: "flex", alignItems: "center", gap: 5 }}>
            <KeySquare size={11} /> {t("Chat.pinFromVault")}
          </div>
        )}
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
        <div style={{ fontSize: 10.5, color: "#ff5252", flexShrink: 0, lineHeight: 1.45 }}>
          {/* Les codes de l'hôte sont traduits ici ; ceux qu'on ne connaît
              pas sont affichés bruts plutôt qu'avalés. */}
          {store.adminError === "device-online" ? t("Chat.adminErrDeviceOnline")
            : store.adminError === "device-unknown" ? t("Chat.adminErrDeviceUnknown")
            : store.adminError === "licence-device-limit" ? t("Chat.adminErrLicenceFull")
            : store.adminError}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* ── Registre des appareils ── */}
        {/* Étape I — marge restante sur le plafond de licence. Affiché
            uniquement quand il y a un plafond : le salon éphémère du
            navigateur n'en a pas. */}
        {tab === "devices" && store.adminPlaces?.maximum != null && (
          <div style={{
            fontSize: 10.5, color: muted, padding: "6px 8px", borderRadius: 6,
            border: `1px solid ${border}`, background: inputBg, flexShrink: 0,
          }}>
            {t("Chat.adminLicencePlaces")} : <strong style={{ color: "inherit" }}>
              {store.adminPlaces.occupees} / {store.adminPlaces.maximum}
            </strong>
          </div>
        )}
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
                {/* Étape L — trace d'appairage. Le jeton ne peut pas
                    couvrir la clé du nouvel appareil (elle n'existe pas
                    encore quand l'ancien signe) : un jeton intercepté
                    resterait utilisable. On ne peut donc pas tout prévenir,
                    mais on rend le fait CONSTATABLE — qui a été rattaché,
                    quand, et par quel appareil. */}
                {d.pairedAt && (
                  <>
                    <br />
                    <span style={{ color: accent }}>
                      {t("Chat.adminPairedWith")} {deviceName(d.pairedBy ?? null) || d.pairedBy?.slice(0, 8)}
                      {" · "}{new Date(d.pairedAt).toLocaleString()}
                    </span>
                  </>
                )}
              </div>
              {/* Étape F — FONCTION dans l'organisation (DRH, DGA…). Elle
                  décrit la PERSONNE et apparaît dans l'annuaire, là où
                  l'étiquette ci-dessous nomme l'APPAREIL. */}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "5px 8px" }}
                  placeholder={t("Chat.adminRolePlaceholder")}
                  value={roleDrafts[d.fingerprint] ?? d.role ?? ""}
                  onChange={(e) => setRoleDrafts((s) => ({ ...s, [d.fingerprint]: e.target.value }))}
                />
                <button
                  onClick={() => admin({ action: "role", fingerprint: d.fingerprint, role: (roleDrafts[d.fingerprint] ?? d.role ?? "").trim() || null })}
                  style={{ ...btnStyle(true), padding: "5px 10px", fontSize: 10.5 }}
                >
                  {t("Chat.adminSave")}
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  style={{ ...inputStyle, flex: 1, fontSize: 11, padding: "5px 8px" }}
                  placeholder={t("Chat.adminLabelPlaceholder")}
                  value={labelDrafts[d.fingerprint] ?? d.label ?? ""}
                  onChange={(e) => setLabelDrafts((s) => ({ ...s, [d.fingerprint]: e.target.value }))}
                />
                <button
                  onClick={() => admin({ action: "label", fingerprint: d.fingerprint, label: (labelDrafts[d.fingerprint] ?? d.label ?? "").trim() || null })}
                  style={{ ...btnStyle(true), padding: "5px 10px", fontSize: 10.5 }}
                >
                  {t("Chat.adminSave")}
                </button>
                {/* D.2 — blocage : expulsion immédiate + refus au retour ;
                    outil d'exception (le verrou gère le quotidien) */}
                {store.adminBans.includes(d.fingerprint) ? (
                  <button
                    onClick={() => admin({ action: "unban", fingerprint: d.fingerprint })}
                    style={{ ...btnStyle(), padding: "5px 8px", fontSize: 10.5, display: "flex", alignItems: "center", gap: 3 }}
                    title={t("Chat.adminUnban")}
                  >
                    <Undo2 size={11} /> {t("Chat.adminUnban")}
                  </button>
                ) : (
                  <button
                    onClick={() => admin({ action: "ban", fingerprint: d.fingerprint })}
                    style={{ ...btnStyle(), padding: "5px 8px", fontSize: 10.5, color: "#ff5252", borderColor: "#ff525260", display: "flex", alignItems: "center", gap: 3 }}
                    title={t("Chat.adminBan")}
                  >
                    <Ban size={11} /> {t("Chat.adminBan")}
                  </button>
                )}
              </div>
              {store.adminBans.includes(d.fingerprint) && (
                <div style={{ fontSize: 9.5, color: "#ff5252", marginTop: 3 }}>{t("Chat.adminBannedTag")}</div>
              )}
              {/* Étape I — place de licence. « Retirer » n'exclut personne :
                  il rend la place d'un appareil qui n'existe plus (poste
                  réinstallé, téléphone remplacé). Pour écarter quelqu'un,
                  c'est « Bloquer », juste au-dessus. */}
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                {d.retiredAt ? (
                  <>
                    <span style={{ fontSize: 9.5, color: muted, flex: 1 }}>
                      {t("Chat.adminRetiredTag")} — {new Date(d.retiredAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => admin({ action: "restore-device", fingerprint: d.fingerprint })}
                      style={{ ...btnStyle(), padding: "5px 8px", fontSize: 10.5, display: "flex", alignItems: "center", gap: 3 }}
                    >
                      <Undo2 size={11} /> {t("Chat.adminRestoreDevice")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => admin({ action: "retire-device", fingerprint: d.fingerprint })}
                    style={{ ...btnStyle(), padding: "5px 8px", fontSize: 10.5, display: "flex", alignItems: "center", gap: 3 }}
                    title={t("Chat.adminRetireDeviceHelp")}
                  >
                    <UserMinus size={11} /> {t("Chat.adminRetireDevice")}
                  </button>
                )}
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
            {/* D.2 — VERROU du salon : cycle « créer → tout le monde
                rejoint → verrouiller ». Verrouillé = membres connus
                libres d'entrer/sortir, aucun nouvel appareil accepté
                (même avec le bon PIN). */}
            <div style={{
              border: `1px solid ${store.adminLocked ? "#ffb300" : border}`,
              background: store.adminLocked ? "rgba(255,179,0,0.08)" : "transparent",
              borderRadius: 6, padding: 8, display: "flex", alignItems: "center", gap: 8,
            }}>
              {store.adminLocked ? <Lock size={14} color="#ffb300" /> : <LockOpen size={14} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>
                  {store.adminLocked ? t("Chat.adminLockedState") : t("Chat.adminUnlockedState")}
                </div>
                <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.45 }}>{t("Chat.adminLockHint")}</div>
              </div>
              <button
                onClick={() => admin({ action: "set-locked", locked: !store.adminLocked })}
                style={{ ...btnStyle(!store.adminLocked), padding: "5px 10px", fontSize: 10.5, flexShrink: 0 }}
              >
                {store.adminLocked ? t("Chat.adminUnlock") : t("Chat.adminLock")}
              </button>
            </div>

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
                onClick={() => { admin({ action: "config-set", key: "retention_days", value: Number(retentionDraft ?? store.adminRetention ?? 90) }); setRetentionDraft(null); }}
                style={btnStyle(true)}
              >
                {t("Chat.adminSave")}
              </button>
            </div>
            {/* D.2 — changer le PIN admin (l'admin authentifié choisit) */}
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>{t("Chat.adminChangePin")}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...inputStyle, flex: 1, direction: "ltr", textAlign: "start" }}
                value={newAdminPin}
                onChange={(e) => setNewAdminPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                inputMode="numeric"
              />
              <button
                onClick={() => {
                  if (!/^\d{6}$/.test(newAdminPin)) return;
                  admin({ action: "set-admin-pin", newPin: newAdminPin });
                  setAdminPin(newAdminPin); // les prochaines actions utilisent le nouveau
                  // Synchroniser aussi le pré-remplissage de l'hôte (bloc
                  // PINs + prochaine ouverture du panneau) — sinon
                  // l'ancien PIN resterait proposé
                  if (store.isHost) {
                    patchStore({
                      adminPin: newAdminPin,
                      hosting: store.hosting ? { ...store.hosting, adminPin: newAdminPin } : null,
                    });
                  }
                  setNewAdminPin("");
                }}
                disabled={!/^\d{6}$/.test(newAdminPin)}
                style={btnStyle(true, !/^\d{6}$/.test(newAdminPin))}
              >
                {t("Chat.adminSave")}
              </button>
            </div>
            {/* Confirmation du serveur — sans elle, le clic semblait mort
                (retour terrain) */}
            {store.adminPinChanged && (
              <div style={{ fontSize: 11, color: "#00c853" }}>{t("Chat.adminPinChangedOk")}</div>
            )}

            {/* D.3 — enregistrer le code dans le coffre chiffré de Hnaya :
                plus besoin de le mémoriser, il se saisit tout seul à la
                prochaine ouverture (proposé seulement si le code est connu
                de cet écran, c'est-à-dire saisi ou affiché à l'hôte) */}
            {roomKey && /^\d{6}$/.test(adminPin) && (
              <div style={{ marginTop: 8, borderTop: `1px solid ${border}`, paddingTop: 8 }}>
                <div style={{ fontSize: 9.5, color: muted, lineHeight: 1.5, marginBottom: 6 }}>
                  {t("Chat.adminVaultHint")}
                </div>
                <button
                  onClick={saveToVault}
                  style={{ ...btnStyle(), width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <KeySquare size={13} />
                  {vaultHasPin ? t("Chat.adminVaultUpdate") : t("Chat.adminVaultSave")}
                </button>
                {vaultSaved && (
                  <div style={{ fontSize: 10.5, color: "#00c853", marginTop: 5 }}>{t("Chat.adminVaultSaved")}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
