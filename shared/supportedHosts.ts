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
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    // YouTube — toujours téléchargeable
    if (host === "youtube.com" || host === "youtu.be") return true;

    // ✅ TikTok — seulement les pages vidéo (/@user/video/ID), pas la page d'accueil
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      return u.pathname.includes("/video/");
    }

    // Dailymotion — toujours téléchargeable
    if (host === "dailymotion.com") return true;

    // Vimeo — toujours téléchargeable
    if (host === "vimeo.com") return true;

    // Twitch — toujours téléchargeable
    if (host === "twitch.tv") return true;

    // Facebook — seulement les pages vidéo
    if (host === "facebook.com" || host === "fb.watch") {
      return (
        u.pathname.includes("/watch") ||
        u.pathname.includes("/videos") ||
        u.pathname.includes("/reel") ||
        host === "fb.watch"
      );
    }

    // Instagram — seulement les reels et posts
    if (host === "instagram.com") {
      return (
        u.pathname.includes("/reel") ||
        u.pathname.includes("/p/") ||
        u.pathname.includes("/tv/")
      );
    }

    // Twitter/X — seulement les tweets avec vidéo
    if (host === "twitter.com" || host === "x.com") {
      return u.pathname.includes("/status/");
    }

    // Reddit — seulement les posts vidéo
    if (host === "reddit.com") {
      return u.pathname.includes("/r/") && u.pathname.includes("/comments/");
    }

    return false;
  } catch { return false; }
}

// Retourne le nom lisible du site pour l'affichage dans le bouton ⬇️
export function getSiteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    const match = SUPPORTED_HOSTS.find(h => host === h || host.endsWith("." + h));
    if (!match) return "MP4";
    const base = match.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return "MP4"; }
}
