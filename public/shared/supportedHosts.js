// shared/supportedHosts.js
// ══════════════════════════════════════════════════════════════════
// Version JavaScript pure — importée par public/electron.js (Node ESM)
// ⚠️ Toujours synchroniser avec shared/supportedHosts.ts
// ══════════════════════════════════════════════════════════════════

export const SUPPORTED_HOSTS = [
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

export function isDownloadableUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    const path = u.pathname;

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

    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      return path.includes("/video/");
    }

    if (host === "dailymotion.com") {
      return path.startsWith("/video/") || path.startsWith("/embed/");
    }

    if (host === "vimeo.com") {
      return /^\/\d+/.test(path) ||
        path.includes("/channels/") ||
        path.includes("/groups/");
    }

    if (host === "twitch.tv") {
      return path.includes("/videos/") ||
        path.includes("/clip/") ||
        path.includes("/clips/") ||
        (!path.includes("/directory") && path.length > 1);
    }

    if (host === "facebook.com" || host === "fb.watch") {
      if (host === "fb.watch") return true;
      return (
        path.includes("/watch") ||
        path.includes("/videos/") ||
        path.includes("/reel/") ||
        path.includes("/reels/")
      );
    }

    if (host === "instagram.com") {
      return (
        path.includes("/reel/") ||
        path.includes("/p/") ||
        path.includes("/tv/")
      );
    }

    if (host === "twitter.com" || host === "x.com") {
      return path.includes("/status/");
    }

    if (host === "reddit.com") {
      return path.includes("/r/") && path.includes("/comments/");
    }

    if (host === "aljazeera.com") {
      return (
        path.includes("/videos/") ||
        path.includes("/program/") ||
        path.includes("/features/") ||
        path.includes("/news/")
      );
    }

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

    if (host === "cnn.com") {
      return path.includes("/videos/") || path.includes("/video/");
    }

    if (host === "foxnews.com") {
      return path.includes("/video/") || path.includes("/v/");
    }

    if (host === "nbc.com") {
      return path.includes("/video/") || path.includes("/watch/");
    }

    if (host === "cbs.com") {
      return path.includes("/video/") || path.includes("/live/");
    }

    if (host === "france24.com") {
      return (
        path.includes("/video/") ||
        path.includes("/en/") ||
        path.includes("/fr/") ||
        path.includes("/ar/")
      );
    }

    if (host === "bfmtv.com") {
      return (
        path.includes("/videos/") ||
        path.includes("/replay/") ||
        path.includes("/live/")
      );
    }

    if (host === "tf1info.fr") {
      return path.includes("/videos/") || path.includes("/lci/");
    }

    if (host === "lcp.fr") {
      return path.includes("/video/") || path.includes("/emission/");
    }

    if (host === "lemonde.fr") {
      return path.includes("/video/") || path.includes("/videos/");
    }

    if (host === "lefigaro.fr") {
      return path.includes("/video/") || path.includes("/videos/");
    }

    if (host === "bloomberg.com") {
      return path.includes("/video/") || path.includes("/news/videos/");
    }

    if (host === "reuters.com") {
      return path.includes("/video/") || path.includes("/videos/");
    }

    if (host === "nytimes.com") {
      return path.includes("/video/") || /\/\d{4}\/\d{2}\/\d{2}\//.test(path);
    }

    if (host === "awaan.ae") {
      return (
        path.includes("/video/") ||
        path.includes("/live/") ||
        path.includes("/season/")
      );
    }

    if (host === "shahid.mbc.net") {
      return (
        path.includes("/series/") ||
        path.includes("/movie/") ||
        path.includes("/show/")
      );
    }

    if (host === "islamchannel.tv") {
      return (
        path.includes("/video/") ||
        path.includes("/watch/") ||
        path.includes("/series/")
      );
    }

    if (host === "presstv.ir") {
      return path.includes("/Detail/") || path.includes("/detail/");
    }

    if (host === "rainews.it") {
      return path.includes("/video/") || path.includes("/dl/");
    }

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

export function getSiteName(url) {
  const nameMap = {
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
