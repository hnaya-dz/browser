"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/context/langcontext";
import { useTabContext } from "@/context/tabcontext";

interface Favorite {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  folder: string;
  createdAt: number;
}

interface TabGroup {
  id: string;
  name: string;
  tabs: { url: string; title: string; favicon: string | null }[];
  createdAt: number;
}

type PanelView = "favorites" | "groups";

function getTheme(): "dark" | "light" | "sunset" {
  if (typeof document === "undefined") return "dark";
  const cls = document.documentElement.classList;
  if (cls.contains("sunset")) return "sunset";
  if (cls.contains("light")) return "light";
  return "dark";
}

interface FavoritesPanelProps {
  onClose: () => void;
}

export default function FavoritesPanel({ onClose }: FavoritesPanelProps) {
  const { t } = useTranslation();
  const { isRTL } = useLanguage();
  const { tabs, addTab } = useTabContext();
  const [view, setView] = useState<PanelView>("favorites");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [groups, setGroups] = useState<TabGroup[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [editFolder, setEditFolder] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState("");

  const api = typeof window !== "undefined" ? (window as any).electronAPI : null;
  const dir = isRTL ? "rtl" : "ltr";

  const themeName = getTheme();
  const isDark = themeName === "dark";
  const bg     = isDark ? "#0d1a12" : themeName === "light" ? "#fff" : "#1a0500";
  const border = isDark ? "rgba(255,255,255,0.1)" : themeName === "light" ? "rgba(0,99,65,0.2)" : "rgba(255,80,20,0.2)";
  const text   = isDark ? "#fff" : themeName === "light" ? "#1a2e22" : "#ffd4a0";
  const muted  = isDark ? "rgba(255,255,255,0.45)" : themeName === "light" ? "rgba(0,60,30,0.5)" : "rgba(255,150,80,0.6)";
  const accent = themeName === "sunset" ? "#c83200" : "#006341";
  const inputBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,99,65,0.05)";

  const loadData = useCallback(async () => {
    if (!api?.invoke) return;
    setLoading(true);
    try {
      const [favs, grps] = await Promise.all([
        api.invoke("favorites-list"),
        api.invoke("tabgroups-list"),
      ]);
      setFavorites(favs || []);
      setGroups(grps || []);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRemoveFav = async (id: string) => {
    await api?.invoke("favorites-remove", id);
    await loadData();
  };

  const handleOpenFav = (url: string) => {
    addTab(url);
    onClose();
  };

  const handleSaveGroup = async () => {
    const externalTabs = tabs.filter(t => !t.isHome && t.url);
    if (!externalTabs.length) return;
    setSavingGroup(true);
    await api?.invoke("tabgroups-save", {
      name: groupName || `Groupe ${new Date().toLocaleDateString()}`,
      tabs: externalTabs,
    });
    setGroupName("");
    setSavingGroup(false);
    await loadData();
  };

  const handleRestoreGroup = async (group: TabGroup) => {
    for (const tab of group.tabs) {
      addTab(tab.url);
      await new Promise(r => setTimeout(r, 100));
    }
    onClose();
  };

  const handleDeleteGroup = async (id: string) => {
    await api?.invoke("tabgroups-delete", id);
    await loadData();
  };

  const handleUpdateFolder = async (id: string) => {
    await api?.invoke("favorites-update", { id, updates: { folder: folderInput } });
    setEditFolder(null);
    await loadData();
  };

  const handleExport = async () => { await api?.invoke("favorites-export"); };
  const handleImport = async () => { await api?.invoke("favorites-import"); await loadData(); };

  // Filtrer et grouper par dossier
  const filtered = favorites.filter(f =>
    !search || f.title.toLowerCase().includes(search.toLowerCase()) || f.url.toLowerCase().includes(search.toLowerCase())
  );
  const folders = Array.from(new Set(filtered.map(f => f.folder || "Général")));

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 8,
    border: `1px solid ${border}`, background: inputBg,
    color: text, fontSize: 13, outline: "none",
  };

  const btnStyle = (primary = false, danger = false): React.CSSProperties => ({
    padding: "7px 14px", borderRadius: 8,
    border: danger ? "1px solid rgba(255,80,80,0.3)" : primary ? "none" : `1px solid ${border}`,
    background: danger ? "rgba(255,80,80,0.1)" : primary ? `linear-gradient(135deg,${accent},${accent}cc)` : "transparent",
    color: danger ? "#ff8080" : primary ? "#fff" : text,
    fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" as const,
  });

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "8px 0", border: "none", borderRadius: 8,
    background: active ? `${accent}30` : "transparent",
    color: active ? text : muted,
    fontWeight: active ? 700 : 500, fontSize: 13, cursor: "pointer",
    borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
    transition: "all .15s",
  });

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:9998, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)", display:"flex", alignItems:"flex-start", justifyContent:"center", padding:"14vh 16px 16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div dir={dir} style={{ width:480, maxWidth:"92vw", maxHeight:"80vh", overflowY:"auto", background:bg, border:`1px solid ${border}`, borderRadius:20, padding:22, color:text, boxShadow:"0 24px 80px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", gap:14 }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>⭐</span>
          <span style={{ fontSize:15, fontWeight:700, flex:1 }}>{t("Favorites.title")}</span>
          <button onClick={handleExport} style={{ ...btnStyle(), fontSize:11, padding:"5px 10px" }} title={t("Favorites.export")}>📦 {t("Favorites.export")}</button>
          <button onClick={handleImport} style={{ ...btnStyle(), fontSize:11, padding:"5px 10px" }} title={t("Favorites.import")}>📥 {t("Favorites.import")}</button>
          <button onClick={onClose} style={{ background:"none", border:"none", color:muted, fontSize:20, cursor:"pointer" }}>✕</button>
        </div>

        {/* Onglets Favoris / Groupes */}
        <div style={{ display:"flex", gap:4, background:inputBg, borderRadius:10, padding:3 }}>
          <button style={tabBtn(view === "favorites")} onClick={() => setView("favorites")}>
            ⭐ {t("Favorites.favorites")}
          </button>
          <button style={tabBtn(view === "groups")} onClick={() => setView("groups")}>
            📑 {t("Favorites.groups")}
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:"20px 0", color:muted }}>…</div>
        ) : view === "favorites" ? (
          <>
            {/* Recherche */}
            <input
              style={inputStyle}
              placeholder={t("Favorites.search")}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />

            {filtered.length === 0 ? (
              <div style={{ textAlign:"center", padding:"20px 0", color:muted, fontSize:13 }}>
                {search ? t("Favorites.noResults") : t("Favorites.empty")}
              </div>
            ) : (
              folders.map(folder => (
                <div key={folder}>
                  <div style={{ fontSize:11, fontWeight:600, color:muted, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>
                    📁 {folder}
                  </div>
                  {filtered.filter(f => (f.folder || "Général") === folder).map(fav => (
                    <div key={fav.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:10, border:`1px solid ${border}`, marginBottom:6, background:inputBg }}>
                      {fav.favicon
                        ? <img src={fav.favicon} alt="" style={{ width:16, height:16, borderRadius:3, flexShrink:0 }} onError={e => (e.currentTarget.style.display="none")} />
                        : <span style={{ width:16, height:16, borderRadius:3, background:`${accent}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, flexShrink:0 }}>🌐</span>
                      }
                      <div style={{ flex:1, minWidth:0 }}>
                        {editFolder === fav.id ? (
                          <div style={{ display:"flex", gap:6 }}>
                            <input
                              style={{ ...inputStyle, width:"auto", flex:1, padding:"4px 8px", fontSize:12 }}
                              value={folderInput}
                              onChange={e => setFolderInput(e.target.value)}
                              onKeyDown={e => e.key === "Enter" && handleUpdateFolder(fav.id)}
                              autoFocus
                            />
                            <button onClick={() => handleUpdateFolder(fav.id)} style={btnStyle(true)}>✓</button>
                            <button onClick={() => setEditFolder(null)} style={btnStyle()}>✕</button>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize:13, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fav.title}</div>
                            <div style={{ fontSize:11, color:muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fav.url}</div>
                          </>
                        )}
                      </div>
                      {editFolder !== fav.id && (
                        <>
                          <button onClick={() => handleOpenFav(fav.url)} style={btnStyle(true)} title={t("Favorites.open")}>↗</button>
                          <button onClick={() => { setEditFolder(fav.id); setFolderInput(fav.folder || "Général"); }} style={btnStyle()} title={t("Favorites.moveFolder")}>📁</button>
                          <button onClick={() => handleRemoveFav(fav.id)} style={btnStyle(false, true)} title={t("Favorites.remove")}>✕</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </>
        ) : (
          <>
            {/* Sauvegarder les onglets actuels */}
            <div style={{ background:inputBg, borderRadius:12, padding:12, border:`1px solid ${border}` }}>
              <div style={{ fontSize:12, color:muted, marginBottom:8 }}>
                {t("Favorites.saveCurrentTabs")} ({tabs.filter(t => !t.isHome && t.url).length} {t("Favorites.tabs")})
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <input
                  style={{ ...inputStyle, flex:1 }}
                  placeholder={t("Favorites.groupName")}
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSaveGroup()}
                />
                <button
                  onClick={handleSaveGroup}
                  disabled={savingGroup || !tabs.filter(t => !t.isHome && t.url).length}
                  style={{ ...btnStyle(true), opacity: savingGroup ? 0.6 : 1 }}
                >
                  {savingGroup ? "…" : t("Favorites.save")}
                </button>
              </div>
            </div>

            {/* Liste des groupes */}
            {groups.length === 0 ? (
              <div style={{ textAlign:"center", padding:"20px 0", color:muted, fontSize:13 }}>{t("Favorites.noGroups")}</div>
            ) : (
              groups.map(group => (
                <div key={group.id} style={{ borderRadius:12, border:`1px solid ${border}`, overflow:"hidden", marginBottom:6 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:inputBg }}>
                    <span style={{ fontSize:16 }}>📑</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{group.name}</div>
                      <div style={{ fontSize:11, color:muted }}>{group.tabs.length} {t("Favorites.tabs")} · {new Date(group.createdAt).toLocaleDateString()}</div>
                    </div>
                    <button onClick={() => handleRestoreGroup(group)} style={btnStyle(true)} title={t("Favorites.restore")}>▶ {t("Favorites.restore")}</button>
                    <button onClick={() => handleDeleteGroup(group.id)} style={btnStyle(false, true)} title={t("Favorites.delete")}>✕</button>
                  </div>
                  <div style={{ padding:"8px 12px", display:"flex", flexWrap:"wrap" as const, gap:6 }}>
                    {group.tabs.slice(0, 6).map((tab, i) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:4, background:`${accent}15`, borderRadius:6, padding:"3px 8px", fontSize:11, color:text }}>
                        {tab.favicon && <img src={tab.favicon} alt="" style={{ width:12, height:12 }} onError={e => (e.currentTarget.style.display="none")} />}
                        <span style={{ maxWidth:100, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{tab.title || tab.url}</span>
                      </div>
                    ))}
                    {group.tabs.length > 6 && <div style={{ fontSize:11, color:muted }}>+{group.tabs.length - 6}</div>}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
