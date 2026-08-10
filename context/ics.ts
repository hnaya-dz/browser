"use client";
// ═══════════════════════════════════════════════════════════════
// Fichier .ics — le lien avec Outlook passe par le FORMAT
// ═══════════════════════════════════════════════════════════════
// Pas d'API, pas de Microsoft Graph, pas d'enregistrement Azure, pas
// d'OAuth, pas de compte Microsoft, pas de connexion Internet. Un fichier
// iCalendar standard, qu'Outlook, Thunderbird et Google Calendar savent
// tous ouvrir — cohérent avec un produit vendu sur la souveraineté et qui
// doit fonctionner hors ligne.
//
// Ce que cela ne fait PAS, et qu'il faut assumer : un .ics dit « ajoutez
// ceci à votre agenda », il ne synchronise rien. Si la réunion se déplace,
// on renvoie un fichier.

/** Horodatage iCalendar en UTC : 20260810T140000Z.
 *  UTC et non l'heure locale, faute de quoi un participant dans un autre
 *  fuseau verrait une heure fausse — et un poste mal réglé exporterait
 *  une heure que personne n'a annoncée. */
function horodatageUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Échappement iCalendar (RFC 5545) : la virgule, le point-virgule et la
 *  contre-oblique sont des séparateurs dans ce format. Un titre contenant
 *  « Budget 2027, révision » couperait le champ en deux sans cela. */
function echapper(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export interface Reunion {
  id: string;
  title: string;
  startsAt: number;
  durationMin: number;
  location?: string | null;
  description?: string | null;
  organisateur?: string | null;
}

/** Compose un .ics d'un seul événement.
 *  ⚠️ Les lignes se terminent par CRLF : la RFC l'exige, et Outlook rejette
 *  purement et simplement un fichier en LF seuls. */
export function composerIcs(r: Reunion): string {
  const fin = r.startsAt + Math.max(1, r.durationMin) * 60000;
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hnaya DZ//Messagerie locale//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${echapper(r.id)}@hnaya.dz`,
    `DTSTAMP:${horodatageUtc(Date.now())}`,
    `DTSTART:${horodatageUtc(r.startsAt)}`,
    `DTEND:${horodatageUtc(fin)}`,
    `SUMMARY:${echapper(r.title)}`,
  ];
  if (r.location) lignes.push(`LOCATION:${echapper(r.location)}`);
  const desc = [r.description, r.organisateur ? `Annoncée par ${r.organisateur}` : null]
    .filter(Boolean).join("\n");
  if (desc) lignes.push(`DESCRIPTION:${echapper(desc)}`);
  lignes.push("END:VEVENT", "END:VCALENDAR");
  return lignes.join("\r\n") + "\r\n";
}

/** Nom de fichier sûr, dérivé du titre. Windows refuse \ / : * ? " < > | */
export function nomFichierIcs(titre: string): string {
  const base = String(titre || "reunion")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return (base || "reunion") + ".ics";
}
