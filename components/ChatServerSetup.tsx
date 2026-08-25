"use client";
// ═══════════════════════════════════════════════════════════════
// Serveur permanent (tier premium) — installation depuis CE poste
// ═══════════════════════════════════════════════════════════════
// Section repliée en bas de l'écran d'accueil de la Messagerie. Elle
// s'adresse à l'IT/gérant d'une organisation, sur la machine toujours
// allumée : licence .hnaya-lic (vendue par Hnaya DZ) → PINs → un clic.
// L'installation crée une tâche Windows « Au démarrage » (compte SYSTEM)
// qui lance le module de chat embarqué en mode Node — voir le bloc
// « Serveur permanent » de public/electron.js pour la mécanique complète.
// Le mode poste (salon éphémère) reste libre et n'entre jamais ici.

import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Server, ChevronDown, ChevronUp, FileKey2, Trash2 } from "lucide-react";
import { getApi } from "@/context/chatstore";

interface Props {
  accent: string;
  muted: string;
  border: string;
  inputStyle: React.CSSProperties;
  btnStyle: (primary?: boolean, disabled?: boolean) => React.CSSProperties;
}

interface ServerInfo {
  // Une licence est deja deposee dans le repertoire du serveur : retirer
  // le serveur ne l'efface pas.
  licenceSurDisque?: boolean;
  supported: boolean;
  installed: boolean;
  running: boolean;
  dataDir: string;
  // Salon servi par le serveur permanent. Il ne figure PAS dans « ouvrir un
  // salon de ce poste » : cette liste-là ne montre que les salons du profil
  // utilisateur, alors que le service tient sa propre base. Sans ce rappel,
  // le salon créé à l'installation paraît avoir disparu.
  // null tant que le serveur n'a pas redémarré depuis la version qui publie
  // son état.
  salon?: { roomId: string; name: string; wsPort?: number; httpPort?: number } | null;
  licence: {
    org: string; expires: string; maxDevices: number; daysLeft: number;
    // `valid` = EN COURS DE VALIDITÉ (mode "active"), pas « bien signée ».
    valid: boolean; mode?: string | null; graceDaysLeft?: number | null; notice?: string | null;
  } | null;
}

interface PickedLicence {
  path: string; org: string; maxDevices: number; expires: string; daysLeft: number;
  // Étape I — "active" | "grace" | "readonly". Une licence échue reste
  // correctement signée : c'est `mode` qui dit ce qu'elle autorise encore.
  mode?: string; graceDaysLeft?: number | null; notice?: string | null;
}

export default function ChatServerSetup({ accent, muted, border, inputStyle, btnStyle }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [licence, setLicence] = useState<PickedLicence | null>(null);
  const [pin, setPin] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const refresh = async () => {
    const r = await getApi()?.invoke?.("chat-server-get-info");
    if (r) setInfo(r);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { setError(""); setDone(false); refresh(); }
  };

  const pickLicence = async () => {
    setError("");
    const r = await getApi()?.invoke?.("chat-server-pick-licence");
    if (r?.ok) setLicence(r);
    else if (r?.error && r.error !== "canceled") setError(r.error);
  };

  // Retirer le serveur ne supprime pas la licence — c'est voulu. Sans ce
  // raccourci, il fallait retrouver le fichier d'origine pour réinstaller,
  // ce qui a fait croire à un utilisateur que sa licence avait été effacée.
  const useInstalledLicence = async () => {
    setError("");
    const r = await getApi()?.invoke?.("chat-server-installed-licence");
    if (r?.ok) setLicence(r);
    else setError(r?.error === "absente" ? t("Chat.serverLicenceGone") : (r?.error || t("Chat.genericError")));
  };

  const install = async () => {
    if (!licence) return;
    setBusy(true); setError(""); setDone(false);
    try {
      const r = await getApi()?.invoke?.("chat-server-install", {
        licencePath: licence.path, pin, adminPin, name,
      });
      if (r?.ok) { setDone(true); setLicence(null); setPin(""); setAdminPin(""); setName(""); await refresh(); }
      else if (r?.refused) setError(t("Chat.serverUacRefused"));
      else {
        // ⚠️ Les codes courts ("pin", "windows-only"…) sont des clés
        // internes, jamais du texte à montrer tel quel — un utilisateur a
        // vu "task-missing" brut à l'écran avant ce correctif.
        // Tout le reste est le message d'exception RÉEL remonté par le
        // script élevé (« Accès refusé », etc.). On l'encadre d'une phrase
        // au lieu de le jeter nu à l'écran : c'est précisément ce message
        // qui permet de comprendre ce qui bloque, là où l'ancien
        // « task-missing » ne disait rien à personne.
        const connues: Record<string, string> = {
          pin: "serverErrPin", adminPin: "serverErrAdminPin", name: "serverErrName",
          "windows-only": "serverErrWindowsOnly",
          // L'autre parcours d'installation occupe déjà la machine : on le
          // dit en clair plutôt que de laisser remonter un code brut.
          serverOtherInstall: "serverErrOtherInstall",
        };
        const cle = r?.error ? connues[r.error] : null;
        if (cle) setError(t(`Chat.${cle}`));
        else if (r?.error) setError(`${t("Chat.serverErrDetail")} ${r.error}`);
        else setError(t("Chat.genericError"));
      }
    } finally { setBusy(false); }
  };

  const uninstall = async () => {
    setBusy(true); setError(""); setDone(false);
    try {
      const r = await getApi()?.invoke?.("chat-server-uninstall");
      if (r?.ok) await refresh();
      else if (r?.refused) setError(t("Chat.serverUacRefused"));
      // Le message d'exception réel du script élevé, comme à l'installation :
      // « la tâche est toujours présente » en dit bien plus qu'un échec muet.
      else if (r?.error) setError(`${t("Chat.serverErrDetail")} ${r.error}`);
      else setError(t("Chat.genericError"));
    } finally { setBusy(false); }
  };

  // Le nom du salon traverse un fichier .cmd lu en page de codes OEM :
  // ASCII strict ici, renommage libre ensuite depuis l'espace admin.
  const nameOk = name === "" || /^[A-Za-z0-9 ._-]{1,40}$/.test(name);
  const pinOk = /^\d{6}$/.test(pin);
  const adminPinOk = adminPin === "" || /^\d{6}$/.test(adminPin);
  const canInstall = !!licence && pinOk && adminPinOk && nameOk && !busy;

  return (
    <div style={{ borderTop: `1px solid ${border}`, paddingTop: 10 }}>
      <button
        onClick={toggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", cursor: "pointer",
          color: muted, fontSize: 10.5, padding: "2px 0",
        }}
      >
        <Server size={12} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "start" }}>{t("Chat.serverTitle")}</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {info === null ? (
            <div style={{ fontSize: 10.5, color: muted }}>…</div>
          ) : !info.supported ? (
            <div style={{ fontSize: 10.5, color: muted }}>{t("Chat.serverWindowsOnly")}</div>
          ) : info.installed ? (
            <>
              {/* Déjà installé sur ce poste : état + licence + retrait */}
              <div style={{
                border: `1px solid ${accent}40`, background: `${accent}10`,
                borderRadius: 4, padding: 8, fontSize: 10.5, lineHeight: 1.55,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: info.running ? "#00c853" : "#e0a030",
                  }} />
                  <b>{info.running ? t("Chat.serverRunning") : t("Chat.serverInstalledNotRunning")}</b>
                </div>
                {info.salon && (
                  <div style={{ color: muted, marginTop: 3 }}>
                    {t("Chat.serverRoomServed")} <b style={{ color: "inherit" }}>{info.salon.name}</b>
                    <div style={{ fontSize: 9.5, marginTop: 2, lineHeight: 1.45 }}>
                      {t("Chat.serverRoomNotListed")}
                    </div>
                  </div>
                )}
                {info.licence && (
                  <div style={{ color: muted, marginTop: 3 }}>
                    {info.licence.org} — {info.licence.maxDevices} {t("Chat.serverDevices")} ·{" "}
                    {/* Une licence ÉCHUE n'est pas une licence INVALIDE : dire
                        « invalide » ferait chercher un fichier corrompu là où
                        il n'y a qu'un renouvellement à faire. Le message de
                        l'hôte distingue les deux. */}
                    {info.licence.mode
                      ? `${t("Chat.serverExpires")} ${new Date(info.licence.expires).toLocaleDateString()}`
                      : <span style={{ color: "#ff8080" }}>{t("Chat.serverLicenceInvalid")}</span>}
                    {info.licence.notice && (
                      <div style={{
                        marginTop: 3, color: info.licence.mode === "readonly" ? "#ff8080" : "#ffcf8a",
                      }}>
                        {info.licence.notice}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button onClick={uninstall} disabled={busy} style={{ ...btnStyle(false, busy), fontSize: 10.5, display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                <Trash2 size={11} /> {busy ? "…" : t("Chat.serverUninstall")}
              </button>
              <div style={{ fontSize: 10, color: muted }}>{t("Chat.serverUninstallNote")}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 10.5, color: muted, lineHeight: 1.55 }}>
                {t("Chat.serverIntro")}
              </div>
              {/* Une licence déjà sur ce poste : la réutiliser d'un clic
                  plutôt que d'aller la rechercher dans l'explorateur. */}
              {info.licenceSurDisque && !licence && (
                <button onClick={useInstalledLicence} disabled={busy} style={{ ...btnStyle(true, busy), fontSize: 10.5, display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                  <FileKey2 size={11} /> {t("Chat.serverLicenceReuse")}
                </button>
              )}
              <button onClick={pickLicence} disabled={busy} style={{ ...btnStyle(false, busy), fontSize: 10.5, display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                <FileKey2 size={11} /> {licence ? t("Chat.serverLicenceChange") : t("Chat.serverLicencePick")}
              </button>
              {licence && (
                <>
                  <div style={{
                    border: `1px solid ${accent}40`, background: `${accent}10`,
                    borderRadius: 4, padding: 8, fontSize: 10.5, lineHeight: 1.5,
                  }}>
                    <b>{licence.org}</b> — {licence.maxDevices} {t("Chat.serverDevices")} ·{" "}
                    {t("Chat.serverExpires")} {new Date(licence.expires).toLocaleDateString()}
                    {/* Étape I — préavis ou échéance dépassée : le dire ICI,
                        avant de saisir les PINs, plutôt qu'au moment où
                        l'installation échoue. */}
                    {licence.notice && (
                      <div style={{
                        marginTop: 5, color: licence.mode === "readonly" ? "#ff8080" : "#ffcf8a",
                      }}>
                        {licence.notice}
                      </div>
                    )}
                  </div>
                  <input
                    style={{ ...inputStyle, direction: "ltr", textAlign: "start" }}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={t("Chat.serverPinPlaceholder")}
                    inputMode="numeric"
                  />
                  <input
                    style={{ ...inputStyle, direction: "ltr", textAlign: "start" }}
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={t("Chat.adminPinOptional")}
                    inputMode="numeric"
                  />
                  <input
                    style={{ ...inputStyle, direction: "ltr", textAlign: "start", ...(nameOk ? {} : { border: "1px solid #ff8080" }) }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("Chat.serverNamePlaceholder")}
                  />
                  {!nameOk && (
                    <div style={{ fontSize: 10, color: "#ff8080" }}>{t("Chat.serverNameAscii")}</div>
                  )}
                  <button onClick={install} disabled={!canInstall} style={{ ...btnStyle(true, !canInstall), fontSize: 11 }}>
                    {busy ? "…" : t("Chat.serverInstall")}
                  </button>
                  <div style={{ fontSize: 10, color: muted, lineHeight: 1.5 }}>{t("Chat.serverUacNote")}</div>
                </>
              )}
            </>
          )}

          {done && <div style={{ fontSize: 10.5, color: "#4ade80" }}>✓ {t("Chat.serverInstalled")}</div>}
          {error && <div style={{ fontSize: 10.5, color: "#ff8080" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
