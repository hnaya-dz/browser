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
    const host = new URL(url).hostname.replace("www.", "");
    return SUPPORTED_HOSTS.some(h => host === h || host.endsWith("." + h));
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
