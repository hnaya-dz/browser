"use client";
import { FC, useState } from "react";
import { useTheme } from "next-themes";
import { useIsSSR } from "@react-aria/ssr";
import { useCustomTheme } from "@/context/customthemecontext";
import dynamic from "next/dynamic";

const CustomThemePanel = dynamic(() => import("./CustomThemePanel"), { ssr: false });

export interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const { theme, setTheme } = useTheme();
  const isSSR = useIsSSR();
  const { customBg } = useCustomTheme();
  const [showPanel, setShowPanel] = useState(false);

  const currentTheme = isSSR ? "dark" : (theme ?? "dark");

  const cycleTheme = () => {
    if (currentTheme === "dark")        setTheme("light");
    else if (currentTheme === "light")  setTheme("sunset");
    else if (currentTheme === "sunset") setShowPanel(true);
    else if (currentTheme === "custom") setShowPanel(true);
    else setTheme("dark");
  };

  // ✅ L'icône indique le thème ACTUEL (pas le suivant)
  // Logique originale restaurée : on montre où on est, pas où on va
  const icon  = currentTheme === "light"  ? "☀️"
              : currentTheme === "sunset" ? "🌅"
              : currentTheme === "custom" ? (customBg ? "🖼️" : "🎨")
              : "🌙"; // dark par défaut

  const label = currentTheme === "dark"   ? "Mode sombre"
              : currentTheme === "light"  ? "Mode clair"
              : currentTheme === "sunset" ? "Coucher de soleil"
              : "Fond personnalisé";

  return (
    <>
      <button
        onClick={cycleTheme}
        title={label}
        className={`
          text-lg w-8 h-8 flex items-center justify-center rounded-lg
          hover:bg-white/10 transition-all duration-200 hover:scale-110
          ${className ?? ""}
        `}
        aria-label={label}
      >
        {icon}
      </button>

      {showPanel && (
        <CustomThemePanel onClose={() => setShowPanel(false)} />
      )}
    </>
  );
};
