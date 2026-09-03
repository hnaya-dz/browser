"use client";
// ═══════════════════════════════════════════════════════════════
// Surface d'annotation — phase 1 (voir docs/ANNOTATION-CADRAGE.md)
// ═══════════════════════════════════════════════════════════════
// On annote une CAPTURE FIGÉE, pas la page vivante : une surface React ne
// peut pas flotter au-dessus d'une WebContentsView. Le process principal
// a déjà photographié la vue (annotate-capture) et l'a masquée ; ce
// composant reçoit les octets et prend la main sur tout l'écran.
//
// L'image d'origine n'est JAMAIS modifiée : chaque rendu repart d'elle et
// rejoue les opérations. C'est ce qui permet d'annuler, et c'est ce qui
// rendra la reprise possible en phase 2.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pen, ArrowUpRight, Square, Circle, Type, EyeOff,
  Undo2, Trash2, Download, Send, X,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  ANNOTATION_COULEURS, ANNOTATION_EPAISSEURS, ANNOTATION_LIMITS,
  type Op,
} from "@/types/annotation";
import { annotationStore, fermerAnnotation, useAnnotationSnapshot } from "@/context/annotationstore";
import { deposerPieceJointe, useChatSnapshot } from "@/context/chatstore";
import type { PreparedMedia } from "./ChatComposerMedia";

type Outil = "pen" | "line" | "rect" | "circle" | "text" | "blur";

const OUTILS: { id: Outil; Icone: typeof Pen; cle: string }[] = [
  { id: "pen",    Icone: Pen,           cle: "outilCrayon" },
  { id: "line",   Icone: ArrowUpRight,  cle: "outilFleche" },
  { id: "rect",   Icone: Square,        cle: "outilRectangle" },
  { id: "circle", Icone: Circle,        cle: "outilCercle" },
  { id: "text",   Icone: Type,          cle: "outilTexte" },
  { id: "blur",   Icone: EyeOff,        cle: "outilCaviardage" },
];

const nouvelId = () => Math.random().toString(36).slice(2, 10);

// ── Rendu ────────────────────────────────────────────────────────────
// Fonction PURE : image de fond + opérations → pixels. Aucune dépendance
// à React, ce qui permet de l'appeler à chaque mouvement de souris sans
// passer par un rendu de composant (le trait libre serait saccadé).
function dessiner(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  w: number, h: number,
  ops: Op[],
) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  for (const op of ops) {
    // ⚠️ Le caviardage passe AVANT tout réglage de trait : il ne dessine
    // pas par-dessus, il REMPLACE les pixels par une version floutée de
    // l'image. L'information n'est pas recouverte, elle est détruite —
    // c'est la seule façon qu'un destinataire ne puisse pas la retrouver.
    if (op.k === "blur") {
      const [x, y, bw, bh] = boite(op.a, op.b);
      if (bw < 1 || bh < 1) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, bw, bh);
      ctx.clip();
      // Rayon proportionnel : un flou fixe laisse un texte lisible sur une
      // grande zone, et efface trop une petite.
      ctx.filter = `blur(${Math.max(6, Math.round(Math.min(bw, bh) / 6))}px)`;
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (op.k === "text") {
      ctx.font = `600 ${op.size}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      // Liseré sombre sous le texte : sans lui, une annotation blanche
      // disparaît sur un fond clair et l'inverse. Le texte reste lisible
      // quelle que soit la page annotée.
      ctx.lineWidth = Math.max(2, op.size / 6);
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(op.text, op.at[0], op.at[1]);
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.at[0], op.at[1]);
      ctx.restore();
      continue;
    }

    // `comment` existe dans le modèle mais n'est PAS produit en phase 1 :
    // une épingle numérotée n'a de sens qu'ancrée au DOM d'une page vivante
    // (phase 2). Sur une image aplatie, l'outil « Texte » écrit directement
    // ce qu'on veut dire — le destinataire le lit sans rien ouvrir.
    // Le rendu l'ignore donc, plutôt que de le dessiner à moitié.
    if (op.k === "comment") { ctx.restore(); continue; }

    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;

    if (op.k === "pen") {
      if (op.pts.length < 2) { ctx.restore(); continue; }
      ctx.beginPath();
      ctx.moveTo(op.pts[0][0], op.pts[0][1]);
      for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i][0], op.pts[i][1]);
      ctx.stroke();
    } else if (op.k === "rect") {
      const [x, y, bw, bh] = boite(op.a, op.b);
      ctx.strokeRect(x, y, bw, bh);
    } else if (op.k === "circle") {
      const [x, y, bw, bh] = boite(op.a, op.b);
      ctx.beginPath();
      ctx.ellipse(x + bw / 2, y + bh / 2, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (op.k === "line") {
      ctx.beginPath();
      ctx.moveTo(op.a[0], op.a[1]);
      ctx.lineTo(op.b[0], op.b[1]);
      ctx.stroke();
      if (op.arrow) pointeDeFleche(ctx, op.a, op.b, op.width);
    }
    ctx.restore();
  }
}

/** Coin haut-gauche + dimensions, quel que soit le sens du glissement. */
function boite(a: [number, number], b: [number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
}

function pointeDeFleche(
  ctx: CanvasRenderingContext2D,
  a: [number, number], b: [number, number], width: number,
) {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const taille = Math.max(10, width * 3.5);
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - taille * Math.cos(angle - Math.PI / 7), b[1] - taille * Math.sin(angle - Math.PI / 7));
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - taille * Math.cos(angle + Math.PI / 7), b[1] - taille * Math.sin(angle + Math.PI / 7));
  ctx.stroke();
}

// ── Vignette ─────────────────────────────────────────────────────────
// L'hôte refuse toute vignette au-delà de 24 Ko (chat-module/src/media.js),
// et elle voyage en base64 donc gonflée d'un tiers. Même prudence que
// ChatComposerMedia : on redescend la qualité plutôt que d'échouer.
const THUMB_MAX_BYTES = 24 * 1024;
function vignette(source: HTMLCanvasElement): string {
  const cote = 200;
  const ratio = Math.min(1, cote / Math.max(source.width, source.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(source.width * ratio));
  c.height = Math.max(1, Math.round(source.height * ratio));
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, c.width, c.height);
  for (const q of [0.6, 0.45, 0.3, 0.2]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length <= THUMB_MAX_BYTES) return url;
  }
  return c.toDataURL("image/jpeg", 0.15);
}

export default function AnnotationSurface() {
  const { t } = useTranslation();
  const snap = useAnnotationSnapshot();
  const capture = snap.capture;
  // ⚠️ ENVOYER N'A DE SENS QUE DANS UN SALON REJOINT. Le composeur — seul
  // endroit où la pièce jointe s'affiche — n'existe que dans la vue
  // « conversation » du dock. Hors salon, déposer l'image ouvrait la
  // messagerie sur l'écran d'accueil (« Créer un salon »), sans la moindre
  // trace de l'annotation : le travail paraissait perdu. Constaté en test.
  // On préfère un bouton franchement indisponible, et l'enregistrement en
  // PNG qui, lui, marche toujours.
  const chat = useChatSnapshot();
  const peutEnvoyer = chat.status === "joined";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Opération en cours de tracé. Dans un ref et NON dans l'état React :
  // un trait libre émet des dizaines de points par seconde, et un rendu
  // React par point rendrait le crayon inutilisable.
  const brouillonRef = useRef<Op | null>(null);
  const opsRef = useRef<Op[]>([]);
  // Point cliqué avec l'outil Texte, retenu entre l'enfoncement et le
  // relâchement (voir onPointerDown).
  const pointTexteRef = useRef<[number, number] | null>(null);
  const saisieRef = useRef<HTMLInputElement | null>(null);
  // Le champ a-t-il RÉELLEMENT reçu le focus ? Sans ce garde-fou, un
  // `blur` parasite survenant avant le premier focus validerait — et
  // refermerait — une saisie que l'utilisateur n'a pas encore vue.
  const saisieFocusee = useRef(false);

  const [ops, setOps] = useState<Op[]>([]);
  const [outil, setOutil] = useState<Outil>("pen");
  const [couleur, setCouleur] = useState<string>(ANNOTATION_COULEURS[0]);
  const [epaisseur, setEpaisseur] = useState<number>(ANNOTATION_EPAISSEURS[1]);
  const [pret, setPret] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Saisie de texte en place : position dans le repère de l'image, et
  // contenu. `null` = aucune saisie en cours.
  const [saisie, setSaisie] = useState<{ at: [number, number]; valeur: string } | null>(null);

  opsRef.current = ops;

  const tailleTexte = useMemo(() => Math.max(14, epaisseur * 6), [epaisseur]);

  // ── Chargement de l'image capturée ────────────────────────────────
  // ⚠️ NE PAS RÉVOQUER L'URL DANS LE NETTOYAGE DE L'EFFET.
  // C'était le cas, et ça produisait un faux message d'erreur, constaté à
  // l'écran : en développement React monte les effets DEUX fois, donc le
  // nettoyage révoquait l'URL pendant que la première image se chargeait
  // encore → `onerror` → bandeau « la capture a échoué », alors que le
  // second montage chargeait l'image et dessinait la toile. Les deux
  // s'affichaient ensemble. Hors développement, rouvrir la surface
  // rapidement rejouerait la même course.
  // La règle : l'URL vit jusqu'à ce que le chargement soit TRANCHÉ, et un
  // chargement dépassé n'écrit plus rien (drapeau `annule`).
  useEffect(() => {
    if (!capture) return;
    let annule = false;
    // Copie défensive : les octets viennent d'un clone structuré, on ne
    // veut pas que le Blob garde une vue sur un tampon réutilisé ailleurs.
    const blob = new Blob([capture.bytes.slice()], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (annule) return;
      imgRef.current = img;
      setPret(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (annule) return;
      setErreur("erreurCapture");
    };
    img.src = url;
    return () => { annule = true; };
  }, [capture]);

  // ── Rendu ──────────────────────────────────────────────────────────
  const redessiner = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !capture) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const liste = brouillonRef.current ? [...opsRef.current, brouillonRef.current] : opsRef.current;
    dessiner(ctx, img, capture.w, capture.h, liste);
  }, [capture]);

  useEffect(() => { if (pret) redessiner(); }, [pret, ops, redessiner]);

  // Focus du champ de texte, posé à la frame SUIVANTE et non par
  // `autoFocus` : au montage, le navigateur n'a pas encore fini de
  // déplacer le focus consécutif au clic, et un focus posé trop tôt lui
  // était repris aussitôt.
  const saisieOuverte = saisie !== null;
  useEffect(() => {
    if (!saisieOuverte) { saisieFocusee.current = false; return; }
    const r = requestAnimationFrame(() => saisieRef.current?.focus());
    return () => cancelAnimationFrame(r);
  }, [saisieOuverte]);

  // ── Saisie de pointeur ────────────────────────────────────────────
  /** Convertit un événement écran en coordonnées de l'IMAGE : le canvas
   *  est affiché redimensionné pour tenir dans la fenêtre, mais les
   *  opérations sont stockées dans le repère de la capture — sans quoi
   *  elles se décaleraient chez un destinataire au grand écran. */
  const pointDeLEvenement = (e: React.PointerEvent): [number, number] => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pret || saisie) return;
    const at = pointDeLEvenement(e);

    // ⚠️ LE CHAMP DE TEXTE S'OUVRE AU RELÂCHEMENT, PAS À L'ENFONCEMENT.
    // Il était créé ici, et il ne survivait pas au geste : après la
    // distribution du `pointerdown`, le navigateur déplace le focus vers
    // `body`, ce qui faisait perdre le focus à l'input monté dans la
    // foulée — donc `onBlur`, donc validation d'une valeur vide, donc
    // disparition immédiate. À l'écran, l'outil Texte ne faisait
    // strictement rien (signalé en test terrain, dans les trois langues).
    // Au `pointerup`, le déplacement de focus a déjà eu lieu.
    if (outil === "text") {
      pointTexteRef.current = at;
      return;
    }
    if (ops.length >= ANNOTATION_LIMITS.MAX_OPS) { setErreur("erreurTropDOperations"); return; }

    (e.target as Element).setPointerCapture?.(e.pointerId);
    const base = { id: nouvelId(), color: couleur, width: epaisseur };
    brouillonRef.current =
      outil === "pen"    ? { k: "pen", ...base, pts: [at] }
      : outil === "blur" ? { k: "blur", id: base.id, a: at, b: at }
      : outil === "line" ? { k: "line", ...base, a: at, b: at, arrow: true }
      : outil === "rect" ? { k: "rect", ...base, a: at, b: at }
      :                    { k: "circle", ...base, a: at, b: at };
    redessiner();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = brouillonRef.current;
    if (!d) return;
    const at = pointDeLEvenement(e);
    if (d.k === "pen") {
      if (d.pts.length < ANNOTATION_LIMITS.MAX_POINTS_PAR_TRAIT) d.pts.push(at);
    } else if (d.k !== "text" && d.k !== "comment") {
      d.b = at;
    }
    redessiner();
  };

  const onPointerUp = () => {
    // Outil Texte : c'est ici que la saisie s'ouvre (voir onPointerDown).
    if (pointTexteRef.current) {
      const at = pointTexteRef.current;
      pointTexteRef.current = null;
      setSaisie({ at, valeur: "" });
      return;
    }
    const d = brouillonRef.current;
    brouillonRef.current = null;
    if (!d) return;
    // Un simple clic ne doit rien laisser : sans ce filtre, chaque clic
    // manqué déposerait un point ou un rectangle de taille nulle, invisible
    // mais bien présent dans le document.
    const vide =
      (d.k === "pen" && d.pts.length < 2) ||
      ((d.k === "rect" || d.k === "circle" || d.k === "blur" || d.k === "line") &&
        Math.abs(d.b[0] - d.a[0]) < 3 && Math.abs(d.b[1] - d.a[1]) < 3);
    if (vide) { redessiner(); return; }
    setOps((prev) => [...prev, d]);
  };

  const validerSaisie = () => {
    if (!saisie) return;
    const texte = saisie.valeur.trim().slice(0, ANNOTATION_LIMITS.MAX_TEXTE);
    if (texte) {
      setOps((prev) => [...prev, {
        k: "text", id: nouvelId(), at: saisie.at,
        text: texte, size: tailleTexte, color: couleur,
      }]);
    }
    setSaisie(null);
  };

  const annuler = () => { setErreur(null); setOps((prev) => prev.slice(0, -1)); };
  const toutEffacer = () => { setErreur(null); setOps([]); };

  // ── Sorties ────────────────────────────────────────────────────────
  /** Aplatit la capture + les opérations en PNG. PNG et non JPEG : un
   *  trait fin et un texte se dégradent visiblement en JPEG, et c'est
   *  précisément ce qu'on demande au destinataire de lire. */
  const versPng = (): Promise<{ blob: Blob; canvas: HTMLCanvasElement }> =>
    new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) { reject(new Error("canvas")); return; }
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("blob")); return; }
        resolve({ blob, canvas });
      }, "image/png");
    });

  const nomPropose = () => {
    const base = (capture?.title || "annotation").trim().slice(0, 60) || "annotation";
    const d = new Date(capture?.capturedAt || Date.now());
    const horo = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
      + `-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    return `${base} ${horo}`;
  };

  const handleEnregistrer = async () => {
    setOccupe(true); setErreur(null);
    try {
      const { blob } = await versPng();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await (window as any)?.electronAPI?.invoke("annotate-save", {
        bytes, suggestedName: nomPropose(),
      });
      if (!res?.ok && res?.error !== "canceled") setErreur("erreurEnregistrement");
    } catch {
      setErreur("erreurEnregistrement");
    } finally {
      setOccupe(false);
    }
  };

  const handleEnvoyer = async () => {
    setOccupe(true); setErreur(null);
    try {
      const { blob, canvas } = await versPng();
      const bytes = await blob.arrayBuffer();
      const media: PreparedMedia = {
        kind: "image",
        mime: "image/png",
        bytes,
        size: bytes.byteLength,
        w: canvas.width,
        h: canvas.height,
        thumb: vignette(canvas),
        name: `${nomPropose()}.png`,
        previewUrl: URL.createObjectURL(blob),
      };
      // Dépose SANS envoyer : l'utilisateur choisit le fil et rédige son
      // message dans le dock. Une annotation ne part jamais toute seule.
      deposerPieceJointe(media);
      fermerAnnotation();
    } catch {
      setErreur("erreurEnvoi");
      setOccupe(false);
    }
  };

  // Échap ferme, comme tous les panneaux modaux de l'application.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (annotationStore.etat === "prete" && brouillonRef.current) return;
      setSaisie((s) => (s ? null : (fermerAnnotation(), null)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const messageErreur = erreur || snap.erreur;

  return (
    <div className="annot-fond" role="dialog" aria-modal="true" aria-label={t("Annotation.titre")}>
      <style>{`
        .annot-fond{position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;background:rgba(8,12,10,0.96);backdrop-filter:blur(6px)}
        .light .annot-fond{background:rgba(244,247,245,0.97)}
        .annot-barre{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.35)}
        .light .annot-barre{background:rgba(255,255,255,0.85);border-color:rgba(0,99,65,0.15)}
        .annot-groupe{display:flex;align-items:center;gap:4px}
        .annot-sep{width:1px;height:22px;background:rgba(255,255,255,0.15)}
        .light .annot-sep{background:rgba(0,99,65,0.2)}
        /* 4px : rayon des boutons et champs dans toute l'application. */
        .annot-btn{display:flex;align-items:center;justify-content:center;gap:6px;padding:6px;border-radius:4px;border:1px solid transparent;background:transparent;color:rgba(255,255,255,0.65);cursor:pointer;transition:all .15s}
        .annot-btn:hover:not(:disabled){color:#fff;background:rgba(255,255,255,0.12)}
        .annot-btn:disabled{opacity:.35;cursor:not-allowed}
        .light .annot-btn{color:rgba(0,60,30,0.7)}
        .light .annot-btn:hover:not(:disabled){color:#006341;background:rgba(0,99,65,0.1)}
        .annot-btn[aria-pressed="true"]{background:rgba(0,99,65,0.55);color:#fff;border-color:rgba(0,200,120,0.5)}
        .light .annot-btn[aria-pressed="true"]{background:rgba(0,99,65,0.15);border-color:rgba(0,99,65,0.4);color:#006341}
        .annot-pastille{width:20px;height:20px;border-radius:4px;border:2px solid transparent;cursor:pointer;padding:0}
        .annot-pastille[aria-pressed="true"]{border-color:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
        .light .annot-pastille[aria-pressed="true"]{border-color:#006341}
        .annot-action{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;transition:all .15s}
        .annot-action:hover:not(:disabled){background:rgba(255,255,255,0.16)}
        .annot-action:disabled{opacity:.4;cursor:not-allowed}
        .light .annot-action{color:#123;border-color:rgba(0,99,65,0.25);background:rgba(0,99,65,0.08)}
        .annot-action-fort{background:rgba(0,99,65,0.75);border-color:rgba(0,200,120,0.5)}
        .annot-action-fort:hover:not(:disabled){background:rgba(0,120,80,0.9)}
        .light .annot-action-fort{background:rgba(0,99,65,0.9);color:#fff}
        .annot-scene{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:16px;position:relative}
        .annot-toile{max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 6px 30px rgba(0,0,0,.5);border-radius:6px;cursor:crosshair;touch-action:none}
        .annot-pied{padding:6px 12px;font-size:11px;color:rgba(255,255,255,0.45);border-top:1px solid rgba(255,255,255,0.08);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;text-align:start}
        .light .annot-pied{color:rgba(0,60,30,0.55);border-color:rgba(0,99,65,0.12)}
        .annot-erreur{padding:6px 12px;font-size:12px;font-weight:600;color:#fff;background:rgba(200,40,30,0.85)}
        .annot-note{padding:5px 12px;font-size:11.5px;color:rgba(255,220,150,0.95);background:rgba(150,100,0,0.28);border-bottom:1px solid rgba(255,180,60,0.25)}
        .light .annot-note{color:#7a4a00;background:rgba(255,190,80,0.22);border-color:rgba(180,120,0,0.3)}
        .annot-saisie{position:absolute;z-index:2;padding:4px 8px;border-radius:4px;border:1px solid rgba(0,200,120,0.6);background:rgba(0,0,0,0.85);color:#fff;font-size:13px;outline:none;min-width:180px}
        .light .annot-saisie{background:#fff;color:#123;border-color:rgba(0,99,65,0.5)}
        .annot-attente{color:rgba(255,255,255,0.6);font-size:13px}
        .light .annot-attente{color:rgba(0,60,30,0.6)}
      `}</style>

      <div className="annot-barre">
        <div className="annot-groupe">
          {OUTILS.map(({ id, Icone, cle }) => (
            <button
              key={id}
              className="annot-btn"
              aria-pressed={outil === id}
              title={t(`Annotation.${cle}`)}
              onClick={() => { setOutil(id); setSaisie(null); }}
            >
              <Icone size={16} />
            </button>
          ))}
        </div>

        <div className="annot-sep" />

        <div className="annot-groupe">
          {ANNOTATION_COULEURS.map((c) => (
            <button
              key={c}
              className="annot-pastille"
              aria-pressed={couleur === c}
              style={{ background: c }}
              title={t("Annotation.couleur")}
              onClick={() => setCouleur(c)}
            />
          ))}
        </div>

        <div className="annot-sep" />

        <div className="annot-groupe">
          {ANNOTATION_EPAISSEURS.map((w) => (
            <button
              key={w}
              className="annot-btn"
              aria-pressed={epaisseur === w}
              title={t("Annotation.epaisseur")}
              onClick={() => setEpaisseur(w)}
              style={{ width: 28 }}
            >
              <span style={{ display: "block", width: 14, height: w, borderRadius: w, background: "currentColor" }} />
            </button>
          ))}
        </div>

        <div className="annot-sep" />

        <div className="annot-groupe">
          <button className="annot-btn" onClick={annuler} disabled={!ops.length} title={t("Annotation.annuler")}>
            <Undo2 size={16} />
          </button>
          <button className="annot-btn" onClick={toutEffacer} disabled={!ops.length} title={t("Annotation.toutEffacer")}>
            <Trash2 size={16} />
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <div className="annot-groupe">
          <button className="annot-action" onClick={handleEnregistrer} disabled={!pret || occupe}>
            <Download size={14} /> {t("Annotation.enregistrer")}
          </button>
          <button
            className="annot-action annot-action-fort"
            onClick={handleEnvoyer}
            disabled={!pret || occupe || !peutEnvoyer}
            title={peutEnvoyer ? undefined : t("Annotation.envoyerHorsSalon")}
          >
            <Send size={14} /> {t("Annotation.envoyer")}
          </button>
          <button className="annot-btn" onClick={fermerAnnotation} title={t("Annotation.fermer")}>
            <X size={18} />
          </button>
        </div>
      </div>

      {messageErreur && <div className="annot-erreur">{t(`Annotation.${messageErreur}`)}</div>}
      {/* Dit POURQUOI « Envoyer » est gris, plutôt que de laisser deviner.
          Affiché seulement quand la capture est prête : avant, la barre
          n'est pas encore le sujet. */}
      {pret && !peutEnvoyer && (
        <div className="annot-note">{t("Annotation.envoyerHorsSalon")}</div>
      )}

      <div className="annot-scene">
        {!capture && !messageErreur && <span className="annot-attente">{t("Annotation.capture")}</span>}
        {capture && (
          <>
            <canvas
              ref={canvasRef}
              width={capture.w}
              height={capture.h}
              className="annot-toile"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {saisie && (
              <input
                ref={saisieRef}
                className="annot-saisie"
                // Positionnée par rapport à la scène, en pourcentage du
                // canvas : l'image est redimensionnée pour tenir à l'écran,
                // un placement en pixels de l'image tomberait à côté.
                style={positionSaisie(canvasRef.current, saisie.at)}
                value={saisie.valeur}
                maxLength={ANNOTATION_LIMITS.MAX_TEXTE}
                placeholder={t("Annotation.texteInvite")}
                onChange={(e) => setSaisie({ ...saisie, valeur: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); validerSaisie(); }
                  if (e.key === "Escape") { e.preventDefault(); setSaisie(null); }
                }}
                onFocus={() => { saisieFocusee.current = true; }}
                onBlur={() => { if (saisieFocusee.current) validerSaisie(); }}
              />
            )}
          </>
        )}
      </div>

      {capture && <div className="annot-pied" title={capture.url}>{capture.url}</div>}
    </div>
  );
}

/** Place le champ de saisie au-dessus du point cliqué, en coordonnées
 *  ÉCRAN : le canvas est affiché à une taille différente de sa résolution
 *  interne, il faut refaire le trajet inverse. */
function positionSaisie(canvas: HTMLCanvasElement | null, at: [number, number]): React.CSSProperties {
  if (!canvas) return { display: "none" };
  const r = canvas.getBoundingClientRect();
  const parent = canvas.parentElement?.getBoundingClientRect();
  if (!parent) return { display: "none" };
  return {
    left: r.left - parent.left + (at[0] / canvas.width) * r.width,
    top: r.top - parent.top + (at[1] / canvas.height) * r.height,
  };
}
