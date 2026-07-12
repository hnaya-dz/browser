// shared/supportedHosts.ts
// ══════════════════════════════════════════════════════════════════
// Source unique de vérité pour la liste des hôtes supportés par yt-dlp.
// Importé par :
//   - urlbar.tsx via @/shared/supportedHosts (Next.js/TypeScript)
//   - electron.js via ../shared/supportedHosts.js (Node ESM)
//
// ⚠️ TOUJOURS modifier les deux fichiers en même temps :
//    shared/supportedHosts.ts  ← ce fichier (TypeScript)
//    shared/supportedHosts.js  ← version JS pure (même logique, sans types)
//
// Sources : https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
// ══════════════════════════════════════════════════════════════════

export const SUPPORTED_HOSTS: string[] = [
  // ── Plateformes vidéo généralistes ──────────────────────────────
  "youtube.com", "youtu.be",
  "dailymotion.com",
  "vimeo.com",
  "twitch.tv",
  "reddit.com",

  // ── Réseaux sociaux ─────────────────────────────────────────────
  "facebook.com", "fb.watch",
  "instagram.com",
  "tiktok.com",
  "twitter.com", "x.com",

  // ── Médias internationaux (confirmés yt-dlp) ────────────────────
  "aljazeera.com",
  "bbc.com", "bbc.co.uk",
  "cnn.com",
  "foxnews.com",
  "nbc.com",
  "cbs.com",
  "bloomberg.com",
  "reuters.com",
  "nytimes.com",

  // ── Médias francophones (confirmés yt-dlp) ──────────────────────
  "france24.com",
  "bfmtv.com",
  "tf1info.fr",
  "lcp.fr",
  "lemonde.fr",
  "lefigaro.fr",

  // ── Médias arabes / islamiques (confirmés yt-dlp) ───────────────
  "awaan.ae",
  "shahid.mbc.net",
  "islamchannel.tv",
  "presstv.ir",

  // ── Médias italiens (confirmés yt-dlp) ──────────────────────────
  "rainews.it",

  // ── Sites algériens (à tester — extracteur générique) ───────────
  "elkhabar.com",
  "ennahar.com",
  "dzairdaily.com",
];

// ── Logique de détection URL par plateforme ──────────────────────────────────
export function isDownloadableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    const path = u.pathname;

    // ── YouTube ──────────────────────────────────────────────────────────────
    if (host === "youtube.com") {
      return (
        path.includes("/watch") ||
        path.includes("/shorts/") ||
        path.includes("/clip/") ||
        path.startsWith("/embed/") ||
        u.searchParams.has("v")
      );
    }
    if (host === "youtu.be") return true;

    // ── TikTok — seulement /video/ (pas la page d'accueil) ──────────────────
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      return path.includes("/video/");
    }

    // ── Dailymotion ──────────────────────────────────────────────────────────
    if (host === "dailymotion.com") {
      return path.startsWith("/video/") || path.startsWith("/embed/");
    }

    // ── Vimeo ────────────────────────────────────────────────────────────────
    if (host === "vimeo.com") {
      return /^\/\d+/.test(path) ||
        path.includes("/channels/") ||
        path.includes("/groups/");
    }

    // ── Twitch ───────────────────────────────────────────────────────────────
    if (host === "twitch.tv") {
      return path.includes("/videos/") ||
        path.includes("/clip/") ||
        path.includes("/clips/") ||
        (!path.includes("/directory") && path.length > 1);
    }

    // ── Facebook ─────────────────────────────────────────────────────────────
    if (host === "facebook.com" || host === "fb.watch") {
      if (host === "fb.watch") return true;
      return (
        path.includes("/watch") ||
        path.includes("/videos/") ||
        path.includes("/reel/") ||
        path.includes("/reels/")
      );
    }

    // ── Instagram ────────────────────────────────────────────────────────────
    if (host === "instagram.com") {
      return (
        path.includes("/reel/") ||
        path.includes("/p/") ||
        path.includes("/tv/")
      );
    }

    // ── Twitter / X ──────────────────────────────────────────────────────────
    if (host === "twitter.com" || host === "x.com") {
      return path.includes("/status/");
    }

    // ── Reddit ───────────────────────────────────────────────────────────────
    if (host === "reddit.com") {
      return path.includes("/r/") && path.includes("/comments/");
    }

    // ── Al Jazeera ───────────────────────────────────────────────────────────
    if (host === "aljazeera.com") {
      return (
        path.includes("/videos/") ||
        path.includes("/program/") ||
        path.includes("/features/") ||
        path.includes("/news/")
      );
    }

    // ── BBC ──────────────────────────────────────────────────────────────────
    if (host === "bbc.com" || host === "bbc.co.uk") {
      return (
        path.includes("/news/") ||
        path.includes("/sport/") ||
        path.includes("/programmes/") ||
        path.includes("/iplayer/") ||
        path.includes("/sounds/") ||
        path.includes("/reel/")
      );
    }

    // ── CNN ──────────────────────────────────────────────────────────────────
    if (host === "cnn.com") {
      return path.includes("/videos/") || path.includes("/video/");
    }

    // ── Fox News ─────────────────────────────────────────────────────────────
    if (host === "foxnews.com") {
      return path.includes("/video/") || path.includes("/v/");
    }

    // ── NBC ──────────────────────────────────────────────────────────────────
    if (host === "nbc.com") {
      return path.includes("/video/") || path.includes("/watch/");
    }

    // ── CBS ──────────────────────────────────────────────────────────────────
    if (host === "cbs.com") {
      return path.includes("/video/") || path.includes("/live/");
    }

    // ── France 24 ────────────────────────────────────────────────────────────
    if (host === "france24.com") {
      return (
        path.includes("/video/") ||
        path.includes("/en/") ||
        path.includes("/fr/") ||
        path.includes("/ar/")
      );
    }

    // ── BFM TV ───────────────────────────────────────────────────────────────
    if (host === "bfmtv.com") {
      return (
        path.includes("/videos/") ||
        path.includes("/replay/") ||
        path.includes("/live/")
      );
    }

    // ── LCI (tf1info.fr) ─────────────────────────────────────────────────────
    if (host === "tf1info.fr") {
      return path.includes("/videos/") || path.includes("/lci/");
    }

    // ── LCP ──────────────────────────────────────────────────────────────────
    if (host === "lcp.fr") {
      return path.includes("/video/") || path.includes("/emission/");
    }

    // ── Le Monde ─────────────────────────────────────────────────────────────
    if (host === "lemonde.fr") {
      return path.includes("/video/") || path.includes("/videos/");
    }

    // ── Le Figaro ────────────────────────────────────────────────────────────
    if (host === "lefigaro.fr") {
      return path.includes("/video/") || path.includes("/videos/");
    }

    // ── Bloomberg ────────────────────────────────────────────────────────────
    if (host === "bloomberg.com") {
      return path.includes("/video/") || path.includes("/news/videos/");
    }

    // ── Reuters ──────────────────────────────────────────────────────────────
    if (host === "reuters.com") {
      return path.includes("/video/") || path.includes("/videos/");
    }

    // ── NYTimes ──────────────────────────────────────────────────────────────
    if (host === "nytimes.com") {
      return path.includes("/video/") || /\/\d{4}\/\d{2}\/\d{2}\//.test(path);
    }

    // ── AWAAN ────────────────────────────────────────────────────────────────
    if (host === "awaan.ae") {
      return (
        path.includes("/video/") ||
        path.includes("/live/") ||
        path.includes("/season/")
      );
    }

    // ── Shahid ───────────────────────────────────────────────────────────────
    if (host === "shahid.mbc.net") {
      return (
        path.includes("/series/") ||
        path.includes("/movie/") ||
        path.includes("/show/")
      );
    }

    // ── Islam Channel ────────────────────────────────────────────────────────
    if (host === "islamchannel.tv") {
      return (
        path.includes("/video/") ||
        path.includes("/watch/") ||
        path.includes("/series/")
      );
    }

    // ── Press TV ─────────────────────────────────────────────────────────────
    if (host === "presstv.ir") {
      return path.includes("/Detail/") || path.includes("/detail/");
    }

    // ── Rai News ─────────────────────────────────────────────────────────────
    if (host === "rainews.it") {
      return path.includes("/video/") || path.includes("/dl/");
    }

    // ── Sites algériens ─────────────────────────────────────────────────────
    // Pas d'extracteur officiel — yt-dlp tentera l'extracteur générique
    // Le bouton s'affiche sur les pages qui ressemblent à du contenu vidéo
    if (host === "elkhabar.com" || host === "ennahar.com" || host === "dzairdaily.com") {
      return (
        path.includes("/video/") ||
        path.includes("/videos/") ||
        path.includes("/watch/") ||
        path.includes("/tv/") ||
        path.includes("/ar/") ||
        (path.length > 10 && !path.endsWith("/"))
      );
    }

    return false;
  } catch { return false; }
}

// ── Nom lisible du site pour le bouton ⬇️ ────────────────────────────────────
export function getSiteName(url: string): string {
  const nameMap: Record<string, string> = {
    "youtube.com": "YouTube", "youtu.be": "YouTube",
    "dailymotion.com": "Dailymotion",
    "vimeo.com": "Vimeo",
    "twitch.tv": "Twitch",
    "reddit.com": "Reddit",
    "facebook.com": "Facebook", "fb.watch": "Facebook",
    "instagram.com": "Instagram",
    "tiktok.com": "TikTok",
    "twitter.com": "Twitter", "x.com": "X",
    "aljazeera.com": "Al Jazeera",
    "bbc.com": "BBC", "bbc.co.uk": "BBC",
    "cnn.com": "CNN",
    "foxnews.com": "Fox News",
    "nbc.com": "NBC",
    "cbs.com": "CBS",
    "bloomberg.com": "Bloomberg",
    "reuters.com": "Reuters",
    "nytimes.com": "NY Times",
    "france24.com": "France 24",
    "bfmtv.com": "BFM TV",
    "tf1info.fr": "LCI",
    "lcp.fr": "LCP",
    "lemonde.fr": "Le Monde",
    "lefigaro.fr": "Le Figaro",
    "awaan.ae": "AWAAN",
    "shahid.mbc.net": "Shahid",
    "islamchannel.tv": "Islam Channel",
    "presstv.ir": "Press TV",
    "rainews.it": "Rai News",
    "elkhabar.com": "El Khabar",
    "ennahar.com": "Ennahar",
    "dzairdaily.com": "Dzair Daily",
  };

  try {
    const host = new URL(url).hostname.replace("www.", "");
    return nameMap[host] || (
      host.split(".")[0].charAt(0).toUpperCase() +
      host.split(".")[0].slice(1)
    );
  } catch { return "Vidéo"; }
}
