// shared/supportedHosts.ts
// Source unique de vérité pour la liste des hôtes supportés par yt-dlp.
// Importé par electron.js (import .js — Node ESM) et urlbar.tsx (import @/shared/supportedHosts).

export const SUPPORTED_HOSTS = [
  "youtube.com", "youtu.be",
  "facebook.com", "fb.watch",
  "instagram.com",
  "tiktok.com",
  "dailymotion.com",
  "twitter.com", "x.com",
  "vimeo.com",
  "twitch.tv",
  "reddit.com",
];

export function isDownloadableUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return SUPPORTED_HOSTS.some(h => host === h || host.endsWith("." + h));
  } catch { return false; }
}

// Retourne le nom lisible du site (ex: "YouTube", "TikTok") pour l'affichage dans le bouton ⬇️
export function getSiteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    const match = SUPPORTED_HOSTS.find(h => host === h || host.endsWith("." + h));
    if (!match) return "MP4";
    const base = match.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return "MP4"; }
}
