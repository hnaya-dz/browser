"use client";
import { FC } from "react";
import { useTheme } from "next-themes";
import { useIsSSR } from "@react-aria/ssr";

export interface ThemeSwitchProps {
  className?: string;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const { theme, setTheme } = useTheme();
  const isSSR = useIsSSR();

  const currentTheme = isSSR ? "dark" : (theme ?? "dark");

  const cycleTheme = () => {
    if (currentTheme === "dark") setTheme("light");
    else if (currentTheme === "light") setTheme("sunset");
    else setTheme("dark");
  };

  const icon = currentTheme === "dark"
    ? "🌙"
    : currentTheme === "light"
    ? "☀️"
    : "🌅";

  const label = currentTheme === "dark"
    ? "Mode sombre"
    : currentTheme === "light"
    ? "Mode clair"
    : "Coucher de soleil";

  return (
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
  );
};
