"use client";
import { FC, useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "next-themes";
import { useIsSSR } from "@react-aria/ssr";
import { useCustomTheme } from "@/context/customthemecontext";
import { useTranslation } from "@/hooks/useTranslation";
import { Moon, Sun, Sunset, Gem, Circle, Image as ImageIcon, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";

const CustomThemePanel = dynamic(() => import("./CustomThemePanel"), { ssr: false });

// ═══════════════════════════════════════════════════════════════
// Sélecteur de thème
// ═══════════════════════════════════════════════════════════════
// ⚠️ CE BOUTON N'EST PLUS UN CYCLE, ET C'EST UNE CORRECTION DE PANNE.
// L'ancienne version faisait défiler sombre → clair → coucher de soleil →
// personnalisé. Mais elle OUVRAIT LE PANNEAU d'image aussi bien depuis
// « coucher de soleil » que depuis « personnalisé » : une fois arrivé au
// thème personnalisé, chaque clic rouvrait ce panneau et l'on ne pouvait
// PLUS JAMAIS revenir aux autres thèmes. L'utilisateur restait enfermé.
//
// Une liste supprime la panne par construction : tous les thèmes sont
// atteignables en un clic depuis n'importe lequel, y compris pour sortir
// du personnalisé. Elle rend aussi inutile la question de l'icône « du
// thème suivant » — dans un cycle, il fallait deviner où l'on allait ;
// ici on voit toute la liste, et l'icône du bouton indique donc où l'on
// EST, avec une coche sur la ligne active.
//
// ⚠️ Les icônes sont VECTORIELLES (lucide), jamais des emoji. Ce bouton
// portait ☀️ 🌅 🖼️ 🎨 🌙 : leur dessin change entre Windows 10 et 11, et
// la palette 🎨 n'était reconnue par personne — signalé en usage réel.

const CLE_TEINTE = "hnaya-theme-tint";

type Teinte = "emeraude" | "gris" | "blanc" | null;

interface Entree {
  id: string;
  base: string;      // thème next-themes qui porte tout le style
  teinte: Teinte;    // fond posé par-dessus, voir styles/globals.css
  cle: string;       // clé de traduction, section Theme des locales
  icone: LucideIcon;
  pastille: string;  // couleur montrée dans la liste
}

// ⚠️ Les libellés sont TRADUITS, jamais écrits ici. Une première version
// les portait en dur en français : sur l'interface arabe, le menu
// s'affichait en français au milieu d'un écran de droite à gauche.
//
// L'ordre est celui de la liste. Les deux familles sont groupées :
// fonds sombres d'abord, fonds clairs ensuite.
const ENTREES: Entree[] = [
  { id: "dark",     base: "dark",   teinte: null,       cle: "dark",        icone: Moon,      pastille: "#001208" },
  { id: "emeraude", base: "dark",   teinte: "emeraude", cle: "emerald",     icone: Gem,       pastille: "#04261d" },
  { id: "gris",     base: "dark",   teinte: "gris",     cle: "grey",        icone: Circle,    pastille: "#17191b" },
  { id: "sunset",   base: "sunset", teinte: null,       cle: "sunset",      icone: Sunset,    pastille: "#1a0005" },
  { id: "light",    base: "light",  teinte: null,       cle: "light",       icone: Sun,       pastille: "#f0f7f4" },
  { id: "blanc",    base: "light",  teinte: "blanc",    cle: "white",       icone: Sun,       pastille: "#ffffff" },
  { id: "custom",   base: "custom", teinte: null,       cle: "customImage", icone: ImageIcon, pastille: "#2a2a2a" },
];

function appliquerTeinte(t: Teinte) {
  const html = document.documentElement;
  if (t) html.setAttribute("data-tint", t);
  else html.removeAttribute("data-tint");
  try {
    if (t) localStorage.setItem(CLE_TEINTE, t);
    else localStorage.removeItem(CLE_TEINTE);
  } catch { /* navigation privée : la teinte ne survivra pas, sans gravité */ }
}

export interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const isSSR = useIsSSR();
  const { customBg } = useCustomTheme();
  const [ouvert, setOuvert] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [teinte, setTeinte] = useState<Teinte>(null);
  const boite = useRef<HTMLDivElement>(null);

  // Restaurer la teinte enregistrée. next-themes ne connaît que le thème
  // de base ; la teinte est portée à part, sur data-tint.
  useEffect(() => {
    try {
      const t = localStorage.getItem(CLE_TEINTE) as Teinte;
      if (t === "emeraude" || t === "gris" || t === "blanc") {
        setTeinte(t);
        appliquerTeinte(t);
      }
    } catch { /* ignoré */ }
  }, []);

  // Fermer la liste au clic extérieur et à Échap : sans cela, elle reste
  // ouverte derrière les panneaux et masque la barre.
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const base = isSSR ? "dark" : (theme ?? "dark");
  const actif =
    ENTREES.find((e) => e.base === base && e.teinte === teinte) ??
    ENTREES.find((e) => e.base === base) ??
    ENTREES[0];

  const choisir = useCallback((e: Entree) => {
    setTeinte(e.teinte);
    appliquerTeinte(e.teinte);
    setTheme(e.base);
    setOuvert(false);
    // Le thème « image personnalisée » a besoin qu'on choisisse une image.
    // On n'ouvre le panneau QUE s'il n'y en a pas déjà une : sinon, revenir
    // à son fond habituel rouvrirait le sélecteur de fichier à chaque fois.
    //
    // ⚠️ Et l'on REFERME le panneau dès qu'un autre thème est choisi.
    // Sans cette ligne, il restait affiché par-dessus l'interface après un
    // changement de thème — constaté à l'essai : on quittait le fond
    // personnalisé, le fond changeait bien, mais la boîte de choix d'image
    // demeurait, laissant croire qu'on n'en était pas sorti.
    setShowPanel(e.base === "custom" && !customBg);
  }, [setTheme, customBg]);

  const Icone = actif.icone;
  const nom = (e: Entree) => t(`Theme.${e.cle}`);
  const titre = `${t("Theme.title")} : ${nom(actif)}`;

  return (
    <div ref={boite} style={{ position: "relative", display: "inline-flex" }}>
      {/* Le menu suit le thème, comme les autres panneaux du produit
          (cf. .tuto-card dans TutorialOverlay.tsx). Une première version
          posait #0d1512 en dur : le menu restait sombre sur les thèmes
          clairs, plaque étrangère au milieu de l'écran. */}
      <style>{`
        .theme-menu{background:#0d1512;border:1px solid rgba(255,255,255,0.14);
          color:rgba(255,255,255,0.72)}
        .theme-menu .theme-row{color:rgba(255,255,255,0.72)}
        .theme-menu .theme-row:hover{background:rgba(255,255,255,0.07)}
        .theme-menu .theme-row[data-actif="1"]{background:rgba(255,255,255,0.09);color:#fff}
        .light .theme-menu{background:#ffffff;border-color:rgba(0,99,65,0.2);color:#12211a}
        .light .theme-menu .theme-row{color:rgba(12,26,19,0.78)}
        .light .theme-menu .theme-row:hover{background:rgba(0,99,65,0.08)}
        .light .theme-menu .theme-row[data-actif="1"]{background:rgba(0,99,65,0.12);color:#08150f}
        /* Le contour de la pastille doit CONTRASTER AVEC LE MENU, pas avec
           la couleur montrée : sur le menu blanc, un contour blanc faisait
           disparaître les pastilles « Clair » et « Blanc », les deux seules
           qu'il fallait justement distinguer l'une de l'autre. */
        .theme-pastille{border:1px solid rgba(255,255,255,0.28)}
        .light .theme-pastille{border-color:rgba(0,40,25,0.35)}
        .sunset .theme-menu{background:#1c0206;border-color:rgba(255,120,60,0.22)}
        .sunset .theme-menu .theme-row:hover{background:rgba(255,120,60,0.12)}
        .sunset .theme-menu .theme-row[data-actif="1"]{background:rgba(255,120,60,0.18);color:#fff}
      `}</style>
      {/* ⚠️ text-white/70 EST NÉCESSAIRE, ce n'est pas de la décoration.
          La barre est `bg-black/40` sur TOUS les thèmes, et tous les boutons
          voisins portent cette couleur. L'emoji qui occupait cette place
          avait ses couleurs propres et restait visible sans rien demander ;
          une icône vectorielle suit `currentColor` et héritait donc d'une
          teinte invisible — l'icône avait disparu sur « coucher de soleil »,
          signalé en usage réel. La couleur est posée ici, et non au point
          d'appel, pour qu'on ne puisse pas l'oublier.

          ⚠️ Et ce commentaire est un commentaire JSX, PAS un « // ». Un
          commentaire JavaScript glissé entre les attributs d'une balise JSX
          est une erreur de syntaxe : elle passe `tsc --noEmit` et fait
          tomber le serveur de développement en 500. Vécu ici même. */}
      <button
        onClick={() => setOuvert((v) => !v)}
        title={titre}
        aria-label={titre}
        aria-haspopup="menu"
        aria-expanded={ouvert}
        className={`w-8 h-8 flex items-center justify-center rounded-lg
          text-white/70 hover:text-white
          hover:bg-white/10 transition-all duration-200 hover:scale-110
          ${className ?? ""}`}
      >
        <Icone size={16} />
      </button>

      {ouvert && (
        <div
          role="menu"
          className="theme-menu"
          style={{
            position: "absolute", top: "calc(100% + 6px)", insetInlineEnd: 0,
            minWidth: 208, padding: 5, zIndex: 1000,
            borderRadius: 8,
            boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
          }}
        >
          {ENTREES.map((e) => {
            const Ico = e.icone;
            const estActif = e.id === actif.id;
            return (
              <button
                key={e.id}
                role="menuitem"
                className="theme-row"
                data-actif={estActif ? "1" : "0"}
                onClick={() => choisir(e)}
                style={{
                  display: "flex", alignItems: "center", gap: 9, width: "100%",
                  padding: "7px 9px", borderRadius: 6, border: "none",
                  background: "transparent",
                  fontSize: 12.5, textAlign: "start", cursor: "pointer",
                }}
              >
                {/* La pastille montre le fond réel : le nom d'une couleur
                    se discute, sa vue non. */}
                <span
                  aria-hidden="true"
                  className="theme-pastille"
                  style={{
                    width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                    background: e.pastille,
                  }}
                />
                <Ico size={14} style={{ flexShrink: 0, opacity: 0.85 }} />
                <span style={{ flex: 1 }}>{nom(e)}</span>
                {estActif && <Check size={13} style={{ flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
      )}

      {showPanel && <CustomThemePanel onClose={() => setShowPanel(false)} />}
    </div>
  );
};
