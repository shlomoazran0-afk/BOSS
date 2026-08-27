/* ============================================================
   RAGE ALLEY — Asset registry & loader
   All visuals are REAL free assets hotlinked from the web:
   - Martial Hero (LuizMelo, CC0) via GitHub mirror
   - Synth Cities / Cyberpunk Street (ansimuz, CC0) via itch CDN
    - Trash can (dant-e, CC0) via OpenGameArt
    - Storm Samurai & Storm Head Droid (Penusbmic, free w/ credit) via itch CDN GIFs
    See SOURCES at the bottom for the full credit list.
   ============================================================ */

import { parseGIF, decompressFrames } from "gifuct-js";

export interface Strip {
  img: CanvasImageSource;
  frameW: number;
  frameH: number;
  count: number;
  w: number; // full pixel width
  h: number; // full pixel height
  /** transparent px between the sprite's lowest opaque pixel and the cell bottom (per frame) */
  footPad: number[];
}

export interface AnimSet {
  [anim: string]: Strip;
}

export interface GameAssets {
  player: AnimSet;
  enemies: { punk: AnimSet; thug: AnimSet; heavy: AnimSet; raider: AnimSet; gunner: AnimSet; droid: AnimSet; boss: AnimSet };
  /** true when the real external sheets decoded (affects draw scale) */
  raiderSamurai: boolean;
  droidReal: boolean;
  bgSkyline: HTMLImageElement;
  bgStreet: HTMLImageElement;
  /** ACT 2 industrial parallax layers: [sky, far-buildings, buildings, foreground] */
  bgAct2: Array<HTMLImageElement | null>;
  /** ACT 2 rich street scene (demo capture, drawn as the near layer) */
  bgAct2Scene: HTMLImageElement | null;
  trashCan: HTMLImageElement;
  failed: string[];
}

export const PLAYER_ANIMS = [
  "Idle",
  "Run",
  "Attack1",
  "Attack2",
  "Death",
  "Take Hit",
  "Jump",
  "Fall",
] as const;

const GH_RAW = "https://raw.githubusercontent.com/gengen1988/unity-martial-hero";
const OGA = "https://opengameart.org/sites/default/files";

export const ASSET_URLS = {
  playerSheets: Object.fromEntries(
    PLAYER_ANIMS.map((a) => [a, `${GH_RAW}/master/Textures/${encodeURIComponent(a)}.png`])
  ) as Record<string, string>,
  bgSkyline: "https://img.itch.zone/aW1hZ2UvMTI0NDE0LzI1NzA1MTg0LmdpZg==/original/SmEoNV.gif",
  bgStreet: "https://img.itch.zone/aW1hZ2UvMTI0NDE0LzI1NzA1MTAxLmdpZg==/original/l13gMU.gif",
  // ACT 2 map — ansimuz "Industrial Parallax" layers, hosted on GitHub raw (CORS-friendly)
  act2Layers: [
    "https://raw.githubusercontent.com/fendevel/wasm-industrial-parallax/main/image/bg.png",
    "https://raw.githubusercontent.com/fendevel/wasm-industrial-parallax/main/image/far-buildings.png",
    "https://raw.githubusercontent.com/fendevel/wasm-industrial-parallax/main/image/buildings.png",
    "https://raw.githubusercontent.com/fendevel/wasm-industrial-parallax/main/image/skill-foreground.png",
  ],
  // ACT 2 street-level scene — the pack's own seamless parallax demo capture (GitHub raw)
  act2Scene: "https://raw.githubusercontent.com/fendevel/wasm-industrial-parallax/main/2021-07-03_18-39-03.gif",
  // ACT 2 enemies — Penusbmic "Sci-Fi Character Pack 8" (free w/ credit), demo GIFs on itch CDN.
  // The sheets are reconstructed at runtime from these animation collages (gifuct-js).
  samuraiGif: "https://img.itch.zone/aW1nLzQ0NjgzODQuZ2lm/original/Z%2BjfsX.gif",
  droidGif: "https://img.itch.zone/aW1nLzQ0NjgzODguZ2lm/original/3aPz7q.gif",
  trashCan: `${OGA}/trash_can.png`,
};

/* ---------- loading helpers ---------- */

function loadImage(url: string, cors = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (cors) {
        // retry without CORS (still drawable to canvas, just tainted)
        loadImage(url, false).then(resolve, reject);
      } else reject(new Error("load failed: " + url));
    };
    img.src = url;
  });
}

async function loadImageWithBranchFallback(url: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(url);
  } catch (e) {
    if (url.includes("/master/")) return loadImage(url.replace("/master/", "/main/"));
    if (url.includes("/main/")) return loadImage(url.replace("/main/", "/master/"));
    throw e;
  }
}

/** Horizontal strip → frames. LuizMelo packs have square cells, so cell size = image height by default. */
function toStrip(img: HTMLImageElement | HTMLCanvasElement, cellW?: number, cellH?: number): Strip {
  const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const fw = cellW ?? h;
  const fh = cellH ?? h;
  const count = Math.max(1, Math.round(w / fw));
  const strip: Strip = { img, frameW: fw, frameH: fh, count, w, h, footPad: [] };
  // measure the real foot line of every frame so sprites stand ON the ground
  try {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    const fw = w / count;
    for (let i = 0; i < count; i++) {
      let lowest = -1;
      const x0 = Math.floor(i * fw), x1 = Math.min(w, Math.ceil((i + 1) * fw));
      for (let y = h - 1; y >= 0 && lowest < 0; y--) {
        for (let x = x0; x < x1; x++) {
          if (data[(y * w + x) * 4 + 3] > 60) { lowest = y; break; }
        }
      }
      strip.footPad.push(lowest < 0 ? 0 : h - 1 - lowest);
    }
  } catch {
    for (let i = 0; i < count; i++) strip.footPad.push(Math.round(h * 0.06));
  }
  return strip;
}

/* ---------- palette swap (runtime derivative of the CC0 sheet) ---------- */

type RGB = [number, number, number];

function rgb2hsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

function hsl2rgb([h, s, l]: [number, number, number]): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2 = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2(p, q, h + 1 / 3) * 255),
    Math.round(hue2(p, q, h) * 255),
    Math.round(hue2(p, q, h - 1 / 3) * 255),
  ];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Recolors every frame of a strip (hue in degrees, sat & light additive). Returns canvas-backed strip. */
function recolorStrip(strip: Strip, hueDeg: number, satMult: number, lightAdd: number): Strip {
  const c = document.createElement("canvas");
  c.width = Math.round(strip.w);
  c.height = Math.round(strip.h);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(strip.img as CanvasImageSource, 0, 0);
  try {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    const hShift = hueDeg / 360;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const [h, s, l] = rgb2hsl([px[i], px[i + 1], px[i + 2]]);
      // skin tones (low-sat warm) shift less so faces stay readable
      const isSkin = s < 0.45 && h > 0.02 && h < 0.13;
      const hh = isSkin ? h + hShift * 0.25 : (h + hShift + 1) % 1;
      const ss = clamp01(isSkin ? s * 0.9 : s * satMult);
      const ll = clamp01(l + lightAdd);
      const [r, g, b] = hsl2rgb([hh, ss, ll]);
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
    ctx.putImageData(data, 0, 0);
  } catch {
    /* tainted canvas (no CORS) — keep original pixels */
  }
  const out = toStrip(c);
  out.footPad = strip.footPad; // alpha channel unchanged by recolor
  return out;
}

function recolorSet(set: AnimSet, hueDeg: number, satMult: number, lightAdd: number): AnimSet {
  const out: AnimSet = {};
  for (const k of Object.keys(set)) out[k] = recolorStrip(set[k], hueDeg, satMult, lightAdd);
  return out;
}

/** Overlays a translucent color on every frame (source-atop) — tints even grayscale art. */
function tintStrip(strip: Strip, color: string, alpha: number, brighten = 0): Strip {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(strip.w));
  c.height = Math.max(1, Math.round(strip.h));
  const ctx = c.getContext("2d")!;
  if (brighten !== 0) {
    ctx.filter = `brightness(${1 + brighten})`;
  }
  ctx.drawImage(strip.img as CanvasImageSource, 0, 0);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const out = toStrip(c);
  out.footPad = strip.footPad;
  return out;
}

function tintSet(set: AnimSet, color: string, alpha: number, brighten = 0): AnimSet {
  const out: AnimSet = {};
  for (const k of Object.keys(set)) out[k] = tintStrip(set[k], color, alpha, brighten);
  return out;
}

/* ---------- ACT 2 enemies: rebuild sprite sheets from Penusbmic's demo GIFs ---------- */

interface GifRowMap { anim: string; row: number }

async function loadGifSheet(
  url: string,
  frameW: number,
  frameH: number,
  expectedRows: number,
  rowsMap: GifRowMap[]
): Promise<AnimSet | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const gif = parseGIF(buf);
    const frames = decompressFrames(gif, true) as Array<{
      dims: { width: number; height: number; left: number; top: number };
      patch: Uint8ClampedArray;
    }>;
    if (frames.length === 0) return null;
    const W = frames[0].dims.width, H = frames[0].dims.height;
    // union-composite every frame: the collage lights up one column at a time,
    // so accumulating all frames reconstructs the full sheet
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const tmp = document.createElement("canvas");
    for (const f of frames) {
      tmp.width = f.dims.width; tmp.height = f.dims.height;
      const tctx = tmp.getContext("2d")!;
      const id = tctx.createImageData(f.dims.width, f.dims.height);
      id.data.set(f.patch);
      tctx.putImageData(id, 0, 0);
      ctx.drawImage(tmp, f.dims.left, f.dims.top);
    }
    const rows = Math.round(H / frameH);
    if (rows < expectedRows || Math.abs(rows * frameH - H) > frameH * 0.5) return null;
    const cols = Math.max(1, Math.round(W / frameW));
    const data = ctx.getImageData(0, 0, W, H).data;
    const countForRow = (r: number): number => {
      let maxCol = 0;
      for (let c = 0; c < cols; c++) {
        let any = false;
        const y1 = Math.min(H, (r + 1) * frameH);
        for (let y = r * frameH; y < y1 && !any; y++) {
          const x1 = Math.min(W, (c + 1) * frameW);
          for (let x = c * frameW; x < x1; x++) {
            if (data[(y * W + x) * 4 + 3] > 50) { any = true; break; }
          }
        }
        if (any) maxCol = c;
      }
      return maxCol + 1;
    };
    const set: AnimSet = {};
    for (const { anim, row } of rowsMap) {
      if (row >= rows) continue;
      const n = countForRow(row);
      const rc = document.createElement("canvas");
      rc.width = n * frameW; rc.height = frameH;
      rc.getContext("2d")!.drawImage(canvas, 0, row * frameH, rc.width, frameH, 0, 0, rc.width, frameH);
      set[anim] = toStrip(rc, frameW, frameH);
    }
    return Object.keys(set).length >= 3 ? set : null;
  } catch {
    return null;
  }
}

/* ---------- master loader ---------- */

export async function loadAllAssets(
  onProgress: (loaded: number, total: number, label: string) => void
): Promise<GameAssets> {
  const failed: string[] = [];
  const tasks: Array<Promise<void>> = [];
  let loaded = 0;
  const total = PLAYER_ANIMS.length + 2 + 1 + 4 + 1 + 2; // sheets + act1 bgs + trashcan + act2 layers + scene + enemies
  const tick = (label: string) => {
    loaded++;
    onProgress(Math.min(loaded, total), total, label);
  };

  const player: AnimSet = {};
  for (const anim of PLAYER_ANIMS) {
    tasks.push(
      loadImageWithBranchFallback(ASSET_URLS.playerSheets[anim])
        .then((img) => { player[anim] = toStrip(img); })
        .catch(() => { failed.push("player:" + anim); })
        .finally(() => tick(anim))
    );
  }

  let bgSkyline: HTMLImageElement | null = null;
  let bgStreet: HTMLImageElement | null = null;
  tasks.push(
    loadImage(ASSET_URLS.bgSkyline).then((i) => { bgSkyline = i; }).catch(() => { failed.push("bg:skyline"); }).finally(() => tick("רקע רחוק"))
  );
  tasks.push(
    loadImage(ASSET_URLS.bgStreet).then((i) => { bgStreet = i; }).catch(() => { failed.push("bg:street"); }).finally(() => tick("רקע רחוב"))
  );

  let trashCan: HTMLImageElement | null = null;
  tasks.push(
    loadImage(ASSET_URLS.trashCan).then((i) => { trashCan = i; }).catch(() => { failed.push("prop:trashcan"); }).finally(() => tick("פח אשפה"))
  );

  // ACT 2 industrial map — 4 real parallax layers from GitHub raw (CORS-friendly)
  const bgAct2: Array<HTMLImageElement | null> = [null, null, null, null];
  ASSET_URLS.act2Layers.forEach((url, i) => {
    tasks.push(
      loadImageWithBranchFallback(url)
        .then((img) => { bgAct2[i] = img; })
        .catch(() => { failed.push("bg:act2:" + i); })
        .finally(() => tick("מפה מערכה 2"))
    );
  });

  // ACT 2 street scene (demo capture of the seamless industrial parallax)
  let bgAct2Scene: HTMLImageElement | null = null;
  tasks.push(
    loadImageWithBranchFallback(ASSET_URLS.act2Scene)
      .then((img) => { bgAct2Scene = img; })
      .catch(() => { failed.push("bg:act2scene"); })
      .finally(() => tick("סצנת הרחוב התעשייתי"))
  );

  // ACT 2 enemies — real sheets rebuilt from Penusbmic's demo GIFs
  // Storm Samurai rows: 0 static idle, 1 battle idle, 2 run, 3 attack1, 4 attack2, 5 damaged, 6 death (134×47)
  let samuraiSet: AnimSet | null = null;
  tasks.push(
    loadGifSheet(ASSET_URLS.samuraiGif, 134, 47, 7, [
      { anim: "Idle", row: 1 }, { anim: "Run", row: 2 }, { anim: "Attack1", row: 3 },
      { anim: "Attack2", row: 4 }, { anim: "Take Hit", row: 5 }, { anim: "Death", row: 6 },
    ])
      .then((s) => { samuraiSet = s; })
      .catch(() => { failed.push("enemy:samurai"); })
      .finally(() => tick("סמוראי הסערה"))
  );
  // Storm Head Droid rows: 0 idle, 1 run, 2 attack, 3 damaged, 4 death (119×124)
  let droidSet: AnimSet | null = null;
  tasks.push(
    loadGifSheet(ASSET_URLS.droidGif, 119, 124, 5, [
      { anim: "Idle", row: 0 }, { anim: "Run", row: 1 }, { anim: "Attack1", row: 2 },
      { anim: "Take Hit", row: 3 }, { anim: "Death", row: 4 },
    ])
      .then((s) => { droidSet = s; })
      .catch(() => { failed.push("enemy:droid"); })
      .finally(() => tick("דרואיד המחץ"))
  );

  await Promise.all(tasks);

  // Act-1 gangs derive from the CC0 hero sheet; act-2 uses the real Penusbmic sheets (with gang fallbacks)
  const enemies = {
    punk: recolorSet(player, 150, 1.15, 0.03), // teal knife-punk
    thug: recolorSet(player, 80, 0.95, -0.04), // olive hooligan
    heavy: recolorSet(player, -70, 1.2, -0.09), // crimson enforcer
    raider: samuraiSet ?? recolorSet(player, 197, 0.8, 0.07),
    gunner: recolorSet(player, 165, 1.3, -0.03), // hazard-orange gunslinger
    droid: droidSet ?? recolorSet(player, -70, 1.2, -0.09),
    // THE BOSS — אדון הסערה: the droid chassis repainted in ember-crimson warlord plating
    boss: tintSet(droidSet ?? samuraiSet ?? recolorSet(player, -70, 1.2, -0.09), "#c81e2e", 0.42, 0.06),
  };

  return {
    player,
    enemies,
    raiderSamurai: samuraiSet !== null,
    droidReal: droidSet !== null,
    bgSkyline: bgSkyline!,
    bgStreet: bgStreet!,
    bgAct2,
    bgAct2Scene,
    trashCan: trashCan!,
    failed,
  };
}

/* ---------- full credit list (shown in-game + required by licenses) ---------- */

export interface SourceCredit {
  what: string;
  author: string;
  license: string;
  url: string;
  note?: string;
}

export const SOURCES: SourceCredit[] = [
  {
    what: "דמות השחקן + כל אנימציות הלוחם (Idle/Run/Attack/Jump/Hurt/Death)",
    author: "LuizMelo — Martial Hero",
    license: "CC0",
    url: "https://luizmelo.itch.io/martial-hero",
    note: "נגרס דרך מראת GitHub: github.com/gengen1988/unity-martial-hero",
  },
  {
    what: "רקע הרחוב הקיברפאנקי + קו הרקיע (שכבות Parallax)",
    author: "ansimuz (Luis Zuno) — Synth Cities / Cyberpunk Street Environment",
    license: "CC0",
    url: "https://ansimuz.itch.io/cyberpunk-street-environment",
    note: "פריים ראשון של הדמו המונפש, דרך itch CDN",
  },
  {
    what: "פח אשפה הריס (Trash Can)",
    author: "dant-e",
    license: "CC0",
    url: "https://opengameart.org/content/trash-can",
  },
  {
    what: "מפת מערכה 2 — רקע תעשייתי לילי, 5 מישורי Parallax (Industrial Parallax)",
    author: "ansimuz (Luis Zuno) · אירוח: fendevel/wasm-industrial-parallax",
    license: "CC-BY 4.0",
    url: "https://github.com/fendevel/wasm-industrial-parallax",
    note: "4 השכבות המקוריות + סצנת הרחוב המלאה מהדמו הרשמי של החבילה, דרך GitHub raw",
  },
  {
    what: "אויבי מערכה 2: סמוראי הסערה + דרואיד המחץ (Storm Samurai & Storm Head Droid)",
    author: "Penusbmic — Sci-Fi Character Pack 8",
    license: "חינם עם קרדיט (כולל מסחרי)",
    url: "https://penusbmic.itch.io/sci-fi-character-pack-8",
    note: "גיליונות הספרייטים משוחזרים בזמן ריצה מתוך ה-GIFs של החבילה (gifuct-js)",
  },
  {
    what: "הצלף + כנופיות הגיבוי — נגזרות צבע של גיליון ה-CC0",
    author: "נגזר מ-Martial Hero (LuizMelo, CC0 — מתיר יצירות נגזרות)",
    license: "CC0",
    url: "https://luizmelo.itch.io/martial-hero",
  },
  {
    what: "מוזיקת רקע: hostile_territory · deadly_contracts · going_undercover (סינת'ווייב רטרו, לופ)",
    author: "Tomasz Kucza — Retro Synthwave Loops",
    license: "CC-BY 4.0",
    url: "https://opengameart.org/content/retro-synthwave-loops",
  },
  {
    what: "אפקטי מכה/חבטה (hit20/hit22/hit23)",
    author: "KonitaTutorials / Independent.nu — Hit Sound Effects (Mp3 של 37 hits/punches)",
    license: "CC0",
    url: "https://opengameart.org/content/hit-sound-effects",
  },
  {
    what: "שאר אפקטים קלים (whoosh, קפיצה, הרמה, שבירה) — סונתזו בקוד (WebAudio)",
    author: "נוצרו רונטיים במנוע המשחק",
    license: "—",
    url: "",
    note: "כל הוויזואל במשחק מבוסס 100% על הנכסים לעיל",
  },
];
