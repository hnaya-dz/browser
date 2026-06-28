// shared/supportedHosts.js
// Version JavaScript pure — importée par public/electron.js (Node ESM ne peut pas importer du .ts)
// Le fichier .ts est importé par Next.js/TypeScript (urlbar.tsx via @/shared/supportedHosts)

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

export function isDownloadableUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    if (host === "youtube.com" || host === "youtu.be") return true;
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return true;
    if (host === "dailymotion.com") return true;
    if (host === "vimeo.com") return true;
    if (host === "twitch.tv") return true;

    if (host === "facebook.com" || host === "fb.watch") {
      return (
        u.pathname.includes("/watch") ||
        u.pathname.includes("/videos") ||
        u.pathname.includes("/reel") ||
        host === "fb.watch"
      );
    }

    if (host === "instagram.com") {
      return (
        u.pathname.includes("/reel") ||
        u.pathname.includes("/p/") ||
        u.pathname.includes("/tv/")
      );
    }

    if (host === "twitter.com" || host === "x.com") {
      return u.pathname.includes("/status/");
    }

    if (host === "reddit.com") {
      return u.pathname.includes("/r/") && u.pathname.includes("/comments/");
    }

    return false;
  } catch { return false; }
}

export function getSiteName(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    const match = SUPPORTED_HOSTS.find(h => host === h || host.endsWith("." + h));
    if (!match) return "MP4";
    const base = match.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return "MP4"; }
}
