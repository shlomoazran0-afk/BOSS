/* ============================================================
   RAGE ALLEY — 2D Beat 'em Up engine (Canvas 2D)
   Internal resolution 480×270, pixel-perfect upscale.
   Systems: parallax, fighters (player + AI thugs), hitbox/hurtbox,
   combos, waves/zones with camera lock, destructible
   props, particles, hitstop, screen shake, full HUD.
   ============================================================ */

import type { AnimSet, GameAssets, Strip } from "./assets";
import { AudioMan } from "./audio";

export type Mode = "loading" | "attract" | "playing" | "paused" | "gameover" | "victory";

export interface GameStats {
  score: number;
  hiScore: number;
  kills: number;
  maxCombo: number;
  wavesCleared: number;
  bossDefeated: boolean;
}

export interface EngineCallbacks {
  onMode: (mode: Mode, stats?: GameStats) => void;
}

export const VIEW_W = 480;
export const VIEW_H = 270;
const ZONE_W = 960;
const ZONE_COUNT = 6; // act 1: zones 0-2 (street) · act 2: zones 3-5 (industrial)
const ZONES_PER_ACT = 3;
const LEVEL_W = ZONE_W * ZONE_COUNT;
const GROUND_MIN = 206;
const GROUND_MAX = 254;
const GRAV = 980;
const JUMP_V = 432;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/* ---------------- input ---------------- */

const KEYMAP: Record<string, string> = {
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  KeyZ: "attack", KeyJ: "attack",
  KeyX: "kick", KeyK: "kick",
  KeyC: "special", KeyL: "special",
  Space: "jump", KeyV: "jump",
  KeyP: "pause", Escape: "pause",
  Enter: "confirm",
};

/* ---------------- moves ---------------- */

interface MoveDef {
  anim: "Attack1" | "Attack2";
  fps: number;
  dmg: number;
  kb: number;
  stun: number;
  reach: number;
  from: number; // fraction of anim duration: active window
  to: number;
  lunge: number;
  aoe?: boolean;
  launcher?: boolean;
}

const MOVES: Record<string, MoveDef> = {
  punch1: { anim: "Attack1", fps: 16, dmg: 8, kb: 140, stun: 0.3, reach: 95, from: 0.3, to: 0.58, lunge: 60 },
  punch2: { anim: "Attack2", fps: 16, dmg: 9, kb: 155, stun: 0.32, reach: 100, from: 0.28, to: 0.55, lunge: 65 },
  punch3: { anim: "Attack1", fps: 13, dmg: 15, kb: 420, stun: 0.6, reach: 112, from: 0.3, to: 0.62, lunge: 90, launcher: true },
  kick: { anim: "Attack2", fps: 13, dmg: 12, kb: 270, stun: 0.44, reach: 122, from: 0.33, to: 0.62, lunge: 45 },
  airkick: { anim: "Attack2", fps: 14, dmg: 13, kb: 300, stun: 0.48, reach: 116, from: 0.22, to: 0.72, lunge: 35 },
  special: { anim: "Attack1", fps: 19, dmg: 26, kb: 500, stun: 0.75, reach: 150, from: 0.18, to: 0.78, lunge: 110, aoe: true },
};

/* ---------------- enemies ---------------- */

type EnemyKind = "punk" | "thug" | "heavy" | "raider" | "gunner" | "droid" | "boss";

/** hurtbox [halfWidth, height] for enemies whose art isn't the 200px hero cell */
const KIND_BODY: Partial<Record<EnemyKind, [number, number]>> = {
  raider: [24, 90], // Storm Samurai — low, wide dasher
  droid: [32, 140], // Storm Head Droid — hulking battle robot
  boss: [46, 182], // אדון הסערה — the warlord towers over the alley
};

interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  range: number;
  aggro: number;
  cooldown: number;
  windup: number;
  scale: number;
  score: number;
  armor: boolean;
  ranged?: boolean;
  move: MoveDef;
}

const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  punk: {
    name: "סכינאי", hp: 38, speed: 104, dmg: 6, range: 82, aggro: 300,
    cooldown: 1.15, windup: 0.34, scale: 0.81, score: 300, armor: false,
    move: { anim: "Attack1", fps: 15, dmg: 6, kb: 150, stun: 0.35, reach: 88, from: 0.32, to: 0.6, lunge: 45 },
  },
  thug: {
    name: "חוליגן", hp: 74, speed: 74, dmg: 10, range: 90, aggro: 285,
    cooldown: 1.55, windup: 0.42, scale: 0.91, score: 500, armor: false,
    move: { anim: "Attack1", fps: 13, dmg: 10, kb: 220, stun: 0.4, reach: 94, from: 0.32, to: 0.6, lunge: 50 },
  },
  heavy: {
    name: "המחסל", hp: 155, speed: 52, dmg: 17, range: 108, aggro: 340,
    cooldown: 2.1, windup: 0.56, scale: 1.08, score: 900, armor: true,
    move: { anim: "Attack2", fps: 12, dmg: 17, kb: 400, stun: 0.6, reach: 112, from: 0.35, to: 0.65, lunge: 60 },
  },
  raider: {
    name: "סמוראי הסערה", hp: 60, speed: 126, dmg: 9, range: 78, aggro: 330,
    cooldown: 1.0, windup: 0.28, scale: 2.0, score: 450, armor: false,
    move: { anim: "Attack1", fps: 16, dmg: 9, kb: 185, stun: 0.36, reach: 88, from: 0.26, to: 0.62, lunge: 60 },
  },
  droid: {
    name: "דרואיד המחץ", hp: 175, speed: 48, dmg: 18, range: 58, aggro: 350,
    cooldown: 2.2, windup: 0.6, scale: 1.15, score: 950, armor: true,
    move: { anim: "Attack1", fps: 12, dmg: 18, kb: 420, stun: 0.62, reach: 66, from: 0.34, to: 0.66, lunge: 70 },
  },
  gunner: {
    name: "צלף", hp: 62, speed: 72, dmg: 9, range: 210, aggro: 360,
    cooldown: 1.9, windup: 0.46, scale: 0.81, score: 600, armor: false, ranged: true,
    move: { anim: "Attack1", fps: 13, dmg: 9, kb: 150, stun: 0.32, reach: 0, from: 0.35, to: 0.65, lunge: 0 },
  },
  boss: {
    name: "אדון הסערה", hp: 620, speed: 86, dmg: 16, range: 135, aggro: 9999,
    cooldown: 1.5, windup: 0.5, scale: 1.55, score: 5000, armor: true,
    move: { anim: "Attack1", fps: 13, dmg: 14, kb: 300, stun: 0.5, reach: 135, from: 0.32, to: 0.6, lunge: 70 },
  },
};

/* ---------------- BOSS — אדון הסערה ---------------- */

const BOSS_MOVES: Record<string, MoveDef> = {
  slash1: { anim: "Attack1", fps: 13, dmg: 14, kb: 300, stun: 0.5, reach: 135, from: 0.32, to: 0.6, lunge: 70 },
  slash2: { anim: "Attack1", fps: 11, dmg: 18, kb: 380, stun: 0.55, reach: 152, from: 0.3, to: 0.62, lunge: 90 },
  dash: { anim: "Attack1", fps: 18, dmg: 16, kb: 360, stun: 0.5, reach: 100, from: 0, to: 1, lunge: 0 },
  slam: { anim: "Attack1", fps: 9, dmg: 20, kb: 420, stun: 0.6, reach: 84, from: 0, to: 1, lunge: 0 },
  fanBullet: { anim: "Attack1", fps: 1, dmg: 10, kb: 220, stun: 0.36, reach: 0, from: 0, to: 1, lunge: 0 },
  shock: { anim: "Attack1", fps: 1, dmg: 12, kb: 280, stun: 0.42, reach: 0, from: 0, to: 1, lunge: 0 },
};

/** per-phase combat profile: speed / attack cooldown / windup / melee swings per combo */
function bossParams(phase: number) {
  return phase === 1
    ? { speed: 76, atkCd: 1.6, windup: 0.5, comboMax: 1 }
    : phase === 2
      ? { speed: 96, atkCd: 1.15, windup: 0.4, comboMax: 2 }
      : { speed: 118, atkCd: 0.85, windup: 0.32, comboMax: 2 };
}

const BULLET_MOVE: MoveDef = { anim: "Attack1", fps: 1, dmg: 9, kb: 150, stun: 0.32, reach: 0, from: 0, to: 1, lunge: 0 };

interface WaveGroup { kind: EnemyKind; count: number }
/** zones → waves → groups */
const ZONE_WAVES: WaveGroup[][][] = [
  [
    [{ kind: "punk", count: 2 }],
    [{ kind: "punk", count: 1 }, { kind: "thug", count: 1 }],
  ],
  [
    [{ kind: "thug", count: 2 }, { kind: "punk", count: 1 }],
    [{ kind: "punk", count: 2 }, { kind: "thug", count: 1 }],
  ],
  [
    [{ kind: "heavy", count: 1 }, { kind: "punk", count: 2 }],
    [{ kind: "heavy", count: 1 }, { kind: "thug", count: 1 }, { kind: "punk", count: 1 }],
  ],
  // ── ACT 2 · the industrial district — samurai, gunslingers & battle droids ──
  [
    [{ kind: "raider", count: 2 }],
    [{ kind: "raider", count: 1 }, { kind: "gunner", count: 1 }],
  ],
  [
    [{ kind: "gunner", count: 2 }, { kind: "raider", count: 1 }],
    [{ kind: "droid", count: 1 }, { kind: "raider", count: 1 }],
  ],
  [
    [{ kind: "droid", count: 1 }, { kind: "raider", count: 2 }, { kind: "gunner", count: 1 }],
    [{ kind: "droid", count: 2 }, { kind: "gunner", count: 1 }, { kind: "raider", count: 1 }],
  ],
];

/* ---------------- entities ---------------- */

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string; grav: number;
}

interface FloatText { x: number; y: number; txt: string; color: string; t: number; big: boolean }

interface RainDrop { x: number; y: number; len: number; spd: number }

interface Bullet { x: number; y: number; vx: number; vy?: number; life: number; shooter: Enemy; tint?: string; big?: boolean }

interface Shockwave { x: number; y: number; dir: 1 | -1; life: number; hit: boolean }

interface Ember { x: number; y: number; vy: number; drift: number; size: number; tw: number }

interface Pickup {
  x: number; y: number;
  t: number; ttl: number;
}

interface TrashCan {
  x: number; y: number; hp: number; vx: number; broken: boolean; t: number;
}

class Fighter {
  x = 0; y = 0; z = 0;
  vx = 0; vz = 0;
  facing = 1;
  hp = 100; maxHp = 100;
  state = "idle";
  stateT = 0;
  move: MoveDef | null = null;
  moveDur = 0;
  flashT = 0;
  invulnT = 0;
  swingHit = new Set<object | string>();
  scale = 0.36;
  hw = 12; // hurtbox half-width (px)
  hh = 64; // hurtbox height (px)
  dead = false;
  gone = false;
  alpha = 1;

  get onGround() { return this.z <= 0.01; }
  get footY() { return this.y - this.z; }
  get scaleN() { return this.scale / 0.36; }

  hurtbox(): [number, number, number, number] {
    return [this.x - this.hw, this.y - this.hh, this.hw * 2, this.hh];
  }
}

class Player extends Fighter {
  chain = 0;
  chainQueued = false;
  kickQueued = false;
  meter = 0; // 0..100 special
  combo = 0;
  comboT = 0;
  maxCombo = 0;
  kills = 0;
  ghostHp = 100;

  constructor() {
    super();
    this.maxHp = 100; this.hp = 100; this.ghostHp = 100;
    this.scale = 0.9; // 2.5× the original 0.36
    this.hw = 30; this.hh = 160;
    this.x = 150; this.y = 232;
  }
}

class Enemy extends Fighter {
  kind: EnemyKind;
  def: EnemyDef;
  side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  cooldownT = 0;
  aiT = 0;
  spawnT = 0;
  hasHitPlayer = false;
  scoreGiven = false;

  // ── boss brain ──
  bossPhase = 1;
  bossCombo = 0;
  bossNext: "slash" | "dash" | "slam" | "fan" | null = null;
  bossWindT = 0;
  bossTargetX = 0;
  fanCd = 0;
  slamCd = 0;
  dashCd = 0;
  summonUsed = false;

  constructor(kind: EnemyKind, x: number, y: number) {
    super();
    this.kind = kind;
    this.def = ENEMY_DEFS[kind];
    this.maxHp = this.def.hp; this.hp = this.def.hp;
    this.scale = this.def.scale;
    const body = KIND_BODY[kind];
    if (body) { this.hw = body[0]; this.hh = body[1]; }
    else { const sn = this.def.scale / 0.36; this.hw = 12 * sn; this.hh = 64 * sn; }
    this.x = x; this.y = y;
    this.state = "enter";
  }
}

/* ---------------- the game ---------------- */

export class Game {
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private lastT = 0;
  private destroyed = false;

  readonly audio = new AudioMan();
  assets: GameAssets | null = null;

  mode: Mode = "loading";
  private cb: EngineCallbacks;

  private player = new Player();
  private enemies: Enemy[] = [];
  private pickups: Pickup[] = [];
  private cans: TrashCan[] = [];
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private rain: RainDrop[] = [];
  private bullets: Bullet[] = [];
  private embers: Ember[] = [];
  private actFlashT = 0;

  // ── boss encounter ──
  private boss: Enemy | null = null;
  private bossState: "none" | "intro" | "fight" | "defeated" = "none";
  private bossGhostHp = 0;
  private bossDefeated = false;
  private shockwaves: Shockwave[] = [];

  private keys = new Set<string>();
  private bufferAttack = 0;
  private bufferKick = 0;
  private bufferJump = 0;
  private bufferSpecial = 0;

  private camX = 0;
  private zoneIdx = 0;
  private waveIdx = 0;
  private waveState: "announce" | "fighting" | "cleared" | "go" | "boss" = "announce";
  private waveT = 0;
  private spawnQueue: Array<{ kind: EnemyKind; at: number; side: 1 | -1 }> = [];
  private wavesCleared = 0;

  private score = 0;
  private hiScore = 0;

  private freezeT = 0;
  private shakeT = 0;
  private shakeMag = 0;
  private hurtFlashT = 0;
  private bannerTxt = "";
  private bannerSub = "";
  private bannerT = 0;
  private time = 0;
  private attractT = 0;
  private flickerT = 0;
  private flickerOn = 0;

  constructor(cb: EngineCallbacks) {
    this.cb = cb;
    try { this.hiScore = parseInt(localStorage.getItem("ragealley-hi") || "0", 10) || 0; } catch { /* ignore */ }
    for (let i = 0; i < 130; i++) {
      this.rain.push({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, len: rand(5, 13), spd: rand(260, 420) });
    }
    for (let i = 0; i < 46; i++) {
      this.embers.push({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, vy: -rand(9, 26), drift: rand(4, 14), size: rand(1, 2.4), tw: rand(1.5, 5) });
    }
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  attach(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.033, (t - this.lastT) / 1000);
      this.lastT = t;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setAssets(a: GameAssets) {
    this.assets = a;
    this.setMode("attract");
    this.audio.playMusic("menu");
  }

  /* ---------- public controls (called from React UI) ---------- */

  startGame() {
    this.audio.unlock();
    this.audio.playMusic("game");
    this.resetWorld();
    this.setMode("playing");
    this.audio.synth("horn");
    this.showBanner("אזור 1 — הגל הראשון", "הרחוב שלך. תגן עליו.");
  }

  togglePause() {
    if (this.mode === "playing") {
      this.setMode("paused");
      this.audio.synth("select");
    } else if (this.mode === "paused") {
      this.setMode("playing");
      this.audio.synth("select");
    }
  }

  backToMenu() {
    this.audio.playMusic("menu");
    this.player = new Player();
    this.enemies = [];
    this.pickups = [];
    this.cans = [];
    this.camX = 0;
    this.resetBoss();
    this.setMode("attract");
  }

  getStats(): GameStats {
    return {
      score: this.score, hiScore: this.hiScore, kills: this.player.kills,
      maxCombo: this.player.maxCombo, wavesCleared: this.wavesCleared,
      bossDefeated: this.bossDefeated,
    };
  }

  /* ---------- internals ---------- */

  private setMode(m: Mode) {
    this.mode = m;
    this.cb.onMode(m, this.getStats());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(action);
    this.audio.unlock();

    if (action === "confirm") {
      if (this.mode === "attract" || this.mode === "gameover" || this.mode === "victory") this.startGame();
      else if (this.mode === "paused") this.togglePause();
      return;
    }
    if (action === "pause") {
      if (this.mode === "playing" || this.mode === "paused") this.togglePause();
      return;
    }
    if (this.mode !== "playing") return;
    const p = this.player;
    // mid-swing chaining
    if ((action === "attack" || action === "kick") && (p.state === "attack" || p.state === "airattack")) {
      this.queueCombo(action);
    }
    if (action === "attack") this.bufferAttack = 0.18;
    if (action === "kick") this.bufferKick = 0.18;
    if (action === "jump") this.bufferJump = 0.16;
    if (action === "special") this.bufferSpecial = 0.2;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (action) this.keys.delete(action);
  };

  private onBlur = () => {
    this.keys.clear();
    if (this.mode === "playing") this.setMode("paused");
  };

  private resetWorld() {
    this.player = new Player();
    this.enemies = [];
    this.pickups = [];
    this.particles = [];
    this.texts = [];
    this.score = 0;
    this.camX = 0;
    this.zoneIdx = 0;
    this.waveIdx = -1;
    this.waveState = "announce";
    this.waveT = 1.2;
    this.wavesCleared = 0;
    this.freezeT = 0;
    this.bullets = [];
    this.resetBoss();
    // scatter destructible trash cans across both acts
    this.cans = [];
    const canXs = [330, 620, 1150, 1500, 2050, 2420, 2700, 3150, 3520, 4050, 4420, 4900, 5300];
    for (const cx of canXs) {
      this.cans.push({ x: cx + rand(-30, 30), y: rand(GROUND_MIN + 6, GROUND_MAX - 4), hp: 2, vx: 0, broken: false, t: 0 });
    }
    this.nextWave();
  }

  /* ---------- waves & spawning ---------- */

  private nextWave() {
    this.waveIdx++;
    const zone = ZONE_WAVES[this.zoneIdx];
    if (this.waveIdx >= zone.length) {
      // final zone cleared → the warlord himself steps in
      if (this.zoneIdx === ZONE_COUNT - 1) {
        this.startBoss();
        return;
      }
      // zone cleared → unlock camera
      this.waveState = "go";
      this.score += 1000;
      this.addText(this.player.x, this.player.y - 80, "+1000", "#ffb02e", false);
      this.showBanner(`אזור ${this.zoneIdx + 1} נוקה`, "התקדם ימינה →");
      return;
    }
    this.waveState = "announce";
    this.waveT = 1.35;
    const totalWaves = zone.length;
    const isLastZone = this.zoneIdx === ZONE_COUNT - 1;
    const isLastWave = this.waveIdx === totalWaves - 1;
    if (this.zoneIdx === ZONES_PER_ACT && this.waveIdx === 0) {
      this.showBanner("מערכה 2 — הרובע התעשייתי", "סמוראי הסערה ודרואידי המחץ הצטרפו לקרב");
    } else {
      this.showBanner(
        `גל ${this.waveIdx + 1}/${totalWaves}`,
        isLastZone && isLastWave ? "הגל האחרון — תן הכול!" : `מערכה ${Math.floor(this.zoneIdx / ZONES_PER_ACT) + 1}`
      );
    }
    this.audio.synth("horn");
    // build spawn queue (staggered, both sides)
    this.spawnQueue = [];
    let at = 0.2;
    for (const g of zone[this.waveIdx]) {
      for (let i = 0; i < g.count; i++) {
        this.spawnQueue.push({ kind: g.kind, at, side: Math.random() < 0.5 ? -1 : 1 });
        at += 0.5;
      }
    }
  }

  private updateWaves(dt: number) {
    if (this.waveState === "boss") return; // handled by the boss encounter
    if (this.waveState === "announce") {
      this.waveT -= dt;
      if (this.waveT <= 0) this.waveState = "fighting";
      return;
    }
    if (this.waveState === "fighting") {
      // spawn pending
      for (const s of this.spawnQueue) s.at -= dt;
      while (this.spawnQueue.length > 0 && this.spawnQueue[0].at <= 0) {
        const s = this.spawnQueue.shift()!;
        const x = s.side === -1 ? this.camX - 80 : this.camX + VIEW_W + 80;
        const e = new Enemy(s.kind, x, clamp(this.player.y + rand(-26, 26), GROUND_MIN, GROUND_MAX));
        // fallback gang bodies when the real sheets failed to decode
        if (s.kind === "raider" && this.assets && !this.assets.raiderSamurai) { e.scale = 0.78; e.hw = 26; e.hh = 140; }
        if (s.kind === "droid" && this.assets && !this.assets.droidReal) { e.scale = 1.08; e.hw = 36; e.hh = 192; }
        e.spawnT = 0.35;
        e.facing = s.side === -1 ? 1 : -1;
        this.enemies.push(e);
        this.burst(e.x, e.y - 30, 8, "#29e6ff", 60, 0.3);
      }
      const alive = this.enemies.some((e) => !e.dead);
      const pending = this.spawnQueue.length > 0;
      if (!alive && !pending) {
        this.wavesCleared++;
        this.score += 500;
        this.addText(this.player.x, this.player.y - 70, "גל נוקה +500", "#8dff5a", false);
        this.waveState = "cleared";
        this.waveT = 1.0;
      }
      return;
    }
    if (this.waveState === "cleared") {
      this.waveT -= dt;
      if (this.waveT <= 0) this.nextWave();
      return;
    }
    // "go" — wait for player to walk to the zone edge
    if (this.player.x > (this.zoneIdx + 1) * ZONE_W - 90) {
      this.zoneIdx++;
      if (this.zoneIdx >= ZONE_COUNT) {
        this.winGame();
        return;
      }
      if (this.zoneIdx === ZONES_PER_ACT) {
        // ═══ ACT 2 transition ═══
        this.actFlashT = 1.15;
        this.bullets = [];
        this.audio.playMusic("act2");
        this.audio.synth("horn");
      }
      this.waveIdx = -1;
      this.nextWave();
    }
  }

  private winGame() {
    this.score += 2000 + Math.round(this.player.hp) * 20;
    this.updateHi();
    this.audio.synth("horn");
    this.setMode("victory");
  }

  /* ---------- BOSS — אדון הסערה ---------- */

  private resetBoss() {
    this.boss = null;
    this.bossState = "none";
    this.bossGhostHp = 0;
    this.bossDefeated = false;
    this.shockwaves = [];
  }

  private startBoss() {
    this.waveState = "boss";
    this.bossState = "intro";
    this.shockwaves = [];
    this.bullets = [];
    const x = this.camX + VIEW_W + 90;
    const b = new Enemy("boss", x, GROUND_MAX - 4);
    b.facing = -1;
    b.state = "enter";
    b.spawnT = 0.35;
    this.enemies.push(b);
    this.boss = b;
    this.bossGhostHp = b.maxHp;
    this.showBanner("אדון הסערה", "ראש הכנופיות — הקרב האחרון!");
    this.audio.synth("horn");
    this.shake(5);
    this.actFlashT = 0.7;
    this.burst(b.x, b.y - 100, 30, "#ff5a3d", 180, 0.55);
    this.burst(b.x, b.y - 100, 14, "#ffd98a", 120, 0.4);
    // a mercy pack before the duel
    this.pickups.push({ x: this.camX + VIEW_W * 0.3, y: GROUND_MAX - 8, t: 0, ttl: 30 });
  }

  /** per-frame boss encounter bookkeeping: victory, ghost hp, shockwaves */
  private updateBossEncounter(dt: number) {
    const b = this.boss;
    if (!b || this.bossState === "none") return;

    if (this.bossState === "defeated") {
      if (b.gone) {
        this.bossState = "none";
        this.winGame();
      }
      return;
    }

    this.bossGhostHp = Math.max(b.hp, this.bossGhostHp - 34 * dt);

    // ground shockwaves from the slam
    const p = this.player;
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i];
      w.x += w.dir * 252 * dt;
      w.life -= dt;
      if (w.life <= 0 || w.x < this.camX - 50 || w.x > this.camX + VIEW_W + 50) {
        this.shockwaves.splice(i, 1);
        continue;
      }
      if (this.particles.length < 300) this.burst(w.x, w.y - 4, 1, "#ff9a4d", 46, 0.24);
      if (
        !w.hit && !p.dead && p.invulnT <= 0 && p.z < 15 &&
        Math.abs(p.x - w.x) < 17 && Math.abs(p.y - w.y) < 30
      ) {
        w.hit = true;
        this.applyHit(b, p, BOSS_MOVES.shock);
      }
    }
  }

  private updateBoss(e: Enemy, dt: number) {
    const p = this.player;
    e.invulnT = Math.max(0, e.invulnT - dt);
    e.fanCd = Math.max(0, e.fanCd - dt);
    e.slamCd = Math.max(0, e.slamCd - dt);
    e.dashCd = Math.max(0, e.dashCd - dt);

    const prm = bossParams(e.bossPhase);
    const arenaMin = this.camX + 48;
    const arenaMax = this.camX + VIEW_W - 48;

    // ── phase transitions ──
    const frac = e.hp / e.maxHp;
    const wantPhase = frac <= 1 / 3 ? 3 : frac <= 2 / 3 ? 2 : 1;
    const busy = e.state === "attack" || e.state === "dash" || e.state === "slamJump" || e.state === "transition" || e.state === "enter";
    if (wantPhase > e.bossPhase && !busy && e.state !== "dying") {
      e.bossPhase = wantPhase;
      e.state = "transition";
      e.stateT = 0;
      e.move = null;
      e.bossNext = null;
      e.cooldownT = 0;
      this.showBanner(e.bossPhase === 2 ? "אדון הסערה זועם!" : "האחרון שנשאר!", `שלב ${e.bossPhase} — היזהר`);
      this.shake(6);
      this.audio.synth("horn");
      this.burst(e.x, e.y - e.hh * 0.6, 26, "#ff5a3d", 200, 0.5);
      this.burst(e.x, e.y - e.hh * 0.3, 14, "#ffd98a", 150, 0.4);
      // heal pack + (final phase) reinforcement call
      this.pickups.push({ x: clamp(this.player.x + rand(-70, 70), this.camX + 60, this.camX + VIEW_W - 60), y: GROUND_MAX - 8, t: 0, ttl: 26 });
      if (e.bossPhase === 3 && !e.summonUsed) {
        e.summonUsed = true;
        this.addText(e.x, e.y - e.hh - 16, "תגי עזרה!", "#ff5a3d", true);
        for (const side of [-1, 1] as const) {
          const x = side === -1 ? this.camX - 80 : this.camX + VIEW_W + 80;
          const m = new Enemy("raider", x, clamp(p.y + rand(-20, 20), GROUND_MIN, GROUND_MAX));
          m.spawnT = 0.35;
          m.facing = side === -1 ? 1 : -1;
          this.enemies.push(m);
        }
      }
      return;
    }

    switch (e.state) {
      case "enter": {
        // dramatic walk-in from the right edge
        e.invulnT = 0.6;
        const stopX = this.camX + VIEW_W - 130;
        e.facing = -1;
        this.setAnimState(e, "run");
        e.x -= 110 * dt;
        if (this.particles.length < 300 && Math.random() < 0.4) {
          this.burst(e.x + rand(-30, 30), e.y - rand(0, 30), 1, "#ff5a3d", 60, 0.35);
        }
        if (e.x <= stopX) {
          e.state = "transition";
          e.stateT = 0;
          this.bossState = "fight";
          this.shake(4);
          this.audio.synth("special");
          this.burst(e.x, e.y - e.hh * 0.5, 18, "#ff5a3d", 150, 0.45);
        }
        e.x = clamp(e.x, arenaMin, arenaMax + 140);
        return;
      }

      case "transition": {
        e.invulnT = 0.6;
        this.setAnimState(e, "idle");
        e.flashT = Math.sin(this.time * 30) > 0 ? 0.1 : 0; // enrage flicker
        if (e.stateT > 1.25) {
          e.state = "chase";
          e.stateT = 0;
          e.flashT = 0;
        }
        return;
      }

      case "chase": {
        if (p.dead) { this.setAnimState(e, "idle"); return; }
        e.facing = p.x > e.x ? 1 : -1;
        // orbit the player at blade range
        if (e.aiT > 2.6) { e.aiT = 0; if (Math.random() < 0.5) e.side = e.side === 1 ? -1 : 1; }
        const standX = p.x - e.side * 96;
        const dxs = standX - e.x;
        const dys = clamp(p.y + e.side * 8, GROUND_MIN, GROUND_MAX) - e.y;
        const dist = Math.hypot(dxs, dys);
        if (dist > 4) {
          e.x += (dxs / dist) * prm.speed * dt;
          e.y = clamp(e.y + (dys / dist) * prm.speed * 0.6 * dt, GROUND_MIN, GROUND_MAX);
        }
        this.setAnimState(e, dist > 8 ? "run" : "idle");
        e.x = clamp(e.x, arenaMin, arenaMax);
        if (e.cooldownT > 0) return;

        const adx = Math.abs(p.x - e.x);
        const ady = Math.abs(p.y - e.y);
        if (ady > 30) return;
        // pick an attack
        if (e.bossPhase >= 2 && adx < 175 && e.slamCd <= 0 && Math.random() < 0.55) {
          e.bossCombo = 0;
          this.bossWindup(e, "slam", prm.windup * 1.15);
        } else if (e.bossPhase >= 3 && adx > 130 && adx < 430 && e.fanCd <= 0 && Math.random() < 0.5) {
          this.bossWindup(e, "fan", prm.windup);
        } else if (adx > 330 && e.dashCd <= 0) {
          this.bossWindup(e, "dash", prm.windup * 1.1);
        } else if (adx < e.def.range + 26) {
          e.bossCombo = 0;
          this.bossWindup(e, "slash", prm.windup);
        }
        return;
      }

      case "windup": {
        this.setAnimState(e, "idle");
        e.facing = p.x > e.x ? 1 : -1;
        if (e.stateT >= e.bossWindT) {
          e.stateT = 0;
          switch (e.bossNext) {
            case "dash": {
              e.state = "dash";
              e.bossTargetX = p.x;
              this.audio.synth("whoosh");
              this.burst(e.x, e.y - e.hh * 0.45, 8, "#ff5a3d", 110, 0.3);
              break;
            }
            case "slam": {
              e.state = "slamJump";
              e.vz = 430;
              e.z = 0.02;
              e.bossTargetX = p.x;
              e.hasHitPlayer = false;
              this.audio.synth("jump");
              break;
            }
            case "fan": {
              e.state = "fan";
              e.hasHitPlayer = false;
              break;
            }
            default: {
              e.state = "attack";
              e.hasHitPlayer = false;
              this.bossStartSlash(e, e.bossCombo > 0 ? BOSS_MOVES.slash2 : BOSS_MOVES.slash1);
              this.audio.synth("whoosh");
            }
          }
          e.bossNext = null;
        }
        return;
      }

      case "attack": {
        const m = e.move!;
        const prog = e.stateT / e.moveDur;
        if (prog < 0.3) e.x += e.facing * m.lunge * dt * 2.0;
        e.x = clamp(e.x, arenaMin - 20, arenaMax + 20);
        if (!e.hasHitPlayer && prog >= m.from && prog <= m.to) {
          this.bossMeleeCheck(e, m);
        }
        if (e.stateT >= e.moveDur) {
          // chain into the second slash
          if (e.bossCombo < prm.comboMax - 1) {
            e.bossCombo++;
            e.state = "windup";
            e.stateT = 0;
            e.bossWindT = 0.2;
            e.bossNext = "slash";
            return;
          }
          e.state = "recover";
          e.stateT = 0;
          e.move = null;
          e.cooldownT = prm.atkCd * rand(0.9, 1.15);
        }
        return;
      }

      case "dash": {
        this.setAnimState(e, "run");
        const dir = e.facing;
        e.x += dir * (e.bossPhase >= 3 ? 620 : 540) * dt;
        e.x = clamp(e.x, this.camX + 20, this.camX + VIEW_W - 20);
        if (this.particles.length < 300 && Math.random() < 0.7) {
          this.burst(e.x - dir * 30, e.y - rand(10, 90), 1, "#ff5a3d", 70, 0.3);
        }
        if (!e.hasHitPlayer && !p.dead && p.invulnT <= 0 && p.z < 70 &&
            Math.abs(p.x - e.x) < e.hw + 26 && Math.abs(p.y - e.y) < 38) {
          e.hasHitPlayer = true;
          this.applyHit(e, p, BOSS_MOVES.dash);
        }
        if (e.stateT > 0.52 || (dir === 1 && e.x >= arenaMax) || (dir === -1 && e.x <= arenaMin)) {
          e.state = "recover";
          e.stateT = 0;
          e.cooldownT = prm.atkCd * rand(0.9, 1.2);
          e.dashCd = 4;
        }
        return;
      }

      case "slamJump": {
        // airborne — steer toward the marked spot
        e.x += clamp(e.bossTargetX - e.x, -170 * dt, 170 * dt);
        e.x = clamp(e.x, arenaMin - 30, arenaMax + 30);
        if (e.onGround && e.stateT > 0.25) {
          // IMPACT
          this.shake(7);
          this.hitstop(0.08);
          this.audio.playSample("hitHeavy", rand(0.9, 1.05));
          this.burst(e.x, e.y - 6, 26, "#ff9a4d", 210, 0.5);
          this.burst(e.x, e.y - 6, 12, "#ffd98a", 150, 0.4);
          for (const dir of [1, -1] as const) {
            this.shockwaves.push({ x: e.x + dir * 42, y: e.y, dir, life: 1.5, hit: false });
          }
          if (!p.dead && p.invulnT <= 0 && p.z < 34 && Math.abs(p.x - e.x) < 84 && Math.abs(p.y - e.y) < 32) {
            this.applyHit(e, p, BOSS_MOVES.slam);
          }
          e.state = "recover";
          e.stateT = 0;
          e.move = null;
          e.cooldownT = prm.atkCd * 1.2;
          e.slamCd = 5;
        }
        return;
      }

      case "fan": {
        this.setAnimState(e, "idle");
        if (!e.hasHitPlayer && e.stateT > 0.42) {
          e.hasHitPlayer = true;
          const dir = p.x > e.x ? 1 : -1;
          e.facing = dir;
          const by = e.y - e.hh * 0.6;
          for (const vy of [-52, 0, 52]) {
            this.bullets.push({ x: e.x + dir * (e.hw + 8), y: by + vy * 0.35, vx: dir * 305, vy, life: 2.6, shooter: e, tint: "#ff6b4a", big: true });
          }
          this.burst(e.x + dir * e.hw, by, 8, "#ff6b4a", 120, 0.25);
          this.audio.playSample("hitLight", rand(1.6, 1.9), 0.5);
          this.audio.synth("whoosh");
        }
        if (e.stateT > 0.85) {
          e.state = "recover";
          e.stateT = 0;
          e.cooldownT = prm.atkCd * rand(0.95, 1.2);
          e.fanCd = 4.5;
        }
        return;
      }

      case "recover": {
        this.setAnimState(e, "idle");
        if (e.stateT > 0.55) { e.state = "chase"; e.stateT = 0; }
        return;
      }
    }
  }

  /** open a telegraphed windup for a chosen boss attack */
  private bossWindup(e: Enemy, next: "slash" | "dash" | "slam" | "fan", t: number) {
    e.state = "windup";
    e.stateT = 0;
    e.bossNext = next;
    e.bossWindT = t;
  }

  private bossStartSlash(e: Enemy, m: MoveDef) {
    e.move = m;
    e.moveDur = (() => {
      const strip = this.stripFor(e, m.anim);
      return strip ? strip.count / m.fps : 0.45;
    })();
    e.swingHit.clear();
  }

  /** sword hit vs the player (boss melee swings) */
  private bossMeleeCheck(e: Enemy, m: MoveDef) {
    const p = this.player;
    if (p.dead || p.invulnT > 0 || p.z > 62 || Math.abs(p.y - e.y) > 36) return;
    const x0 = e.x + e.facing * 14;
    const x1 = e.x + e.facing * (m.reach + 20);
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const [bx, , bw] = p.hurtbox();
    if (bx + bw > minX && bx < maxX) {
      e.hasHitPlayer = true;
      this.applyHit(e, p, m);
    }
  }

  private updateHi() {
    if (this.score > this.hiScore) {
      this.hiScore = this.score;
      try { localStorage.setItem("ragealley-hi", String(this.hiScore)); } catch { /* ignore */ }
    }
  }

  private showBanner(txt: string, sub: string) {
    this.bannerTxt = txt;
    this.bannerSub = sub;
    this.bannerT = 2.1;
  }

  /* ---------- combat helpers ---------- */

  private burst(x: number, y: number, n: number, color: string, spd: number, life: number) {
    if (this.particles.length > 320) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(spd * 0.3, spd);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
        life, maxLife: life, size: rand(1.5, 3.2), color, grav: 260,
      });
    }
  }

  private addText(x: number, y: number, txt: string, color: string, big: boolean) {
    this.texts.push({ x, y, txt, color, t: 0.9, big });
  }

  private hitstop(t: number) { this.freezeT = Math.max(this.freezeT, t); }
  private shake(m: number) { this.shakeT = 0.22; this.shakeMag = Math.max(this.shakeMag, m); }

  private startMove(f: Fighter, move: MoveDef) {
    const anim = this.stripFor(f, move.anim);
    f.move = move;
    f.state = f instanceof Player && !f.onGround ? "airattack" : "attack";
    if (f instanceof Player && !f.onGround && move !== MOVES.airkick) f.state = "airattack";
    f.stateT = 0;
    f.moveDur = anim ? anim.count / move.fps : 0.4;
    f.swingHit.clear();
  }

  private stripFor(f: Fighter, anim: string): Strip | null {
    if (!this.assets) return null;
    const set: AnimSet = f instanceof Player ? this.assets.player : this.assets.enemies[(f as Enemy).kind];
    return set[anim] ?? null;
  }

  /** Active-frame hitbox sweep of `f` against victims. */
  private sweep(f: Fighter, move: MoveDef, victims: Fighter[], hitCans: boolean) {
    const dir = f.facing;
    const x0 = f.x + dir * 14;
    const x1 = f.x + dir * (move.reach + 18);
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const scaleN = f.scale / 0.36;

    for (const v of victims) {
      if (v.dead || v.gone || f.swingHit.has(v)) continue;
      if (v.z > 62) continue;
      if (Math.abs(v.y - f.y) > 34) continue;
      const vb = v.hurtbox();
      if (vb[0] > maxX || vb[0] + vb[2] < minX) continue;
      f.swingHit.add(v);
      this.applyHit(f, v, move);
    }

    if (hitCans) {
      for (const c of this.cans) {
        if (c.broken || f.swingHit.has(c)) continue;
        if (Math.abs(c.y - f.y) > 34) continue;
        if (c.x > minX - 22 && c.x < maxX + 22) {
          f.swingHit.add(c);
          this.damageCan(c, dir);
        }
      }
    }
    void scaleN;
  }

  private applyHit(attacker: Fighter, victim: Fighter, move: MoveDef) {
    const isPlayerAttacking = attacker instanceof Player;
    const victimEnemy = victim instanceof Enemy;
    const isBoss = victimEnemy && victim.kind === "boss";

    // boss ignores damage during his entrance / phase transitions
    if (isBoss && victim.invulnT > 0) {
      this.burst(victim.x, victim.y - victim.hh * 0.55, 3, "#ff5a3d", 90, 0.2);
      this.audio.playSample("hitLight", rand(1.2, 1.4), 0.35);
      return;
    }

    const armored = victimEnemy && victim.def.armor && victim.state === "attack";

    if (isBoss) {
      // super-armor: damage lands but the warlord never flinches; guarded swings take less
      const guarding = victim.state === "attack" || victim.state === "dash" || victim.state === "windup";
      victim.hp -= Math.round(move.dmg * (guarding ? 0.6 : 1));
      victim.flashT = 0.12;
    } else if (!armored) {
      victim.hp -= move.dmg;
      victim.state = "hurt";
      victim.stateT = 0;
      victim.move = null;
      victim.vx = attacker.facing * move.kb;
      if (move.launcher) victim.vz = 265;
      victim.flashT = 0.12;
    } else {
      victim.flashT = 0.1;
      victim.hp -= Math.round(move.dmg * 0.5);
    }

    // feedback
    const hx = victim.x - attacker.facing * 6;
    const hy = victim.y - victim.hh * 0.62;
    this.burst(hx, hy, armored ? 4 : 9, isPlayerAttacking ? "#ffe45e" : "#ff6b6b", 130, 0.28);
    this.burst(hx, hy, 4, "#ffffff", 90, 0.18);
    this.hitstop(move.aoe || move.launcher ? 0.11 : armored ? 0.04 : 0.065);
    this.shake(move.aoe ? 5 : move.launcher ? 4 : 2.2);
    this.audio.playSample(
      move.dmg >= 15 ? "hitHeavy" : move.dmg >= 10 ? "hitMid" : "hitLight",
      rand(0.92, 1.1)
    );

    if (isPlayerAttacking) {
      const p = attacker as Player;
      p.combo++;
      p.comboT = 1.6;
      p.maxCombo = Math.max(p.maxCombo, p.combo);
      p.meter = clamp(p.meter + 7, 0, 100);
      const gained = Math.round((40 + p.combo * 12) * (victimEnemy ? 1 : 0.6));
      this.score += gained;
      this.addText(hx + rand(-8, 8), hy - 14, `+${gained}`, p.combo >= 6 ? "#ff2d78" : "#ffe45e", p.combo >= 6);
    } else {
      // victim is player
      const p = victim as Player;
      p.combo = 0;
      p.comboT = 0;
      p.meter = clamp(p.meter + 5, 0, 100);
      p.invulnT = Math.max(p.invulnT, 0.6); // mercy window — no cheap stun-locks
      this.hurtFlashT = 0.25;
      this.audio.synth("hurt");
      if (p.hp <= 0) {
        p.hp = 0;
        p.dead = true;
        p.state = "death";
        p.stateT = 0;
        this.audio.synth("ko");
        this.shake(6);
      }
    }

    if (victimEnemy && victim.hp <= 0 && !victim.dead) {
      const e = victim as Enemy;
      e.dead = true;
      e.state = "dying";
      e.stateT = 0;
      e.move = null;
      if (!e.scoreGiven) {
        e.scoreGiven = true;
        this.player.kills++;
        this.score += e.def.score;
        this.addText(e.x, e.y - 70, `K.O +${e.def.score}`, "#29e6ff", true);
        this.audio.synth("ko");
      }
      if (e.kind === "boss") {
        // ── THE WARLORD FALLS ──
        this.bossDefeated = true;
        this.bossState = "defeated";
        this.hitstop(0.5);
        this.shake(8);
        this.audio.playSample("hitHeavy", 0.8);
        this.burst(e.x, e.y - e.hh * 0.5, 40, "#ff5a3d", 260, 0.7);
        this.burst(e.x, e.y - e.hh * 0.3, 24, "#ffd98a", 190, 0.6);
        this.burst(e.x, e.y - e.hh * 0.7, 18, "#ffffff", 150, 0.5);
        this.showBanner("אדון הסערה הובס!", "הרחוב נקה מאימתו");
        this.shockwaves = [];
        // without their leader the gang scatters — leftovers drop
        for (const m of this.enemies) {
          if (m !== e && !m.dead) {
            m.dead = true;
            m.state = "dying";
            m.stateT = 0;
            m.move = null;
            if (!m.scoreGiven) {
              m.scoreGiven = true;
              this.player.kills++;
              const half = Math.round(m.def.score / 2);
              this.score += half;
              this.addText(m.x, m.y - 60, `+${half}`, "#29e6ff", false);
            }
          }
        }
      }
    }
  }

  private damageCan(c: TrashCan, dir: number) {
    c.hp--;
    c.vx = dir * 130;
    this.burst(c.x, c.y - 14, 6, "#9aa7b8", 90, 0.3);
    this.audio.playSample("hitMid", rand(1.1, 1.3), 0.7);
    this.hitstop(0.03);
    if (c.hp <= 0 && !c.broken) {
      c.broken = true;
      c.t = 0;
      this.audio.synth("smash");
      this.burst(c.x, c.y - 12, 16, "#7f8ea3", 140, 0.5);
      this.burst(c.x, c.y - 12, 8, "#4d5a6b", 100, 0.6);
      this.score += 100;
      this.addText(c.x, c.y - 40, "+100", "#ffe45e", false);
      // drop loot — health or credits
      if (Math.random() < 0.45) {
        this.pickups.push({ x: c.x, y: c.y, t: 0, ttl: 22 });
      } else {
        this.score += 150;
        this.addText(c.x, c.y - 52, "+150", "#ffb02e", false);
      }
    }
  }

  /* ---------- per-frame ---------- */

  private frame(dt: number) {
    this.time += dt;
    // rain always animates (even in menus)
    for (const d of this.rain) {
      d.y += d.spd * dt;
      d.x -= d.spd * 0.18 * dt;
      if (d.y > VIEW_H + 10) { d.y = -12; d.x = Math.random() * (VIEW_W + 60); }
    }
    if (this.mode === "playing") {
      if (this.freezeT > 0) this.freezeT -= dt;
      else this.update(dt);
    } else if (this.mode === "attract") {
      this.attractT += dt;
      this.camX = 40 + Math.sin(this.attractT * 0.25) * 40;
      this.updatePlayerAttract(dt);
    }
    // decay timers even when paused? keep them frozen when paused.
    if (this.mode !== "paused") {
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.hurtFlashT = Math.max(0, this.hurtFlashT - dt);
      this.bannerT = Math.max(0, this.bannerT - dt);
      this.actFlashT = Math.max(0, this.actFlashT - dt);
      if (this.flickerT <= 0 && Math.random() < 0.004) { this.flickerT = rand(0.06, 0.16); this.flickerOn = rand(0.02, 0.05); }
      this.flickerT = Math.max(0, this.flickerT - dt);
      this.updateParticles(dt);
    }
    this.render();
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t -= dt;
      t.y -= 26 * dt;
      if (t.t <= 0) this.texts.splice(i, 1);
    }
  }

  private updatePlayerAttract(dt: number) {
    const p = this.player;
    p.stateT += dt;
    p.state = "idle";
    void dt;
  }

  /* ---------- main update ---------- */

  private update(dt: number) {
    const p = this.player;

    this.bufferAttack = Math.max(0, this.bufferAttack - dt);
    this.bufferKick = Math.max(0, this.bufferKick - dt);
    this.bufferJump = Math.max(0, this.bufferJump - dt);
    this.bufferSpecial = Math.max(0, this.bufferSpecial - dt);

    this.updatePlayer(dt);
    for (const e of this.enemies) this.updateEnemy(e, dt);
    // remove fully gone enemies
    this.enemies = this.enemies.filter((e) => !e.gone);
    this.updateBossEncounter(dt);

    // separation between enemies
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i], b = this.enemies[j];
        if (a.dead || b.dead) continue;
        if (a.kind === "boss" || b.kind === "boss") continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) < 48 && Math.abs(dy) < 22) {
          const push = (48 - Math.abs(dx)) * 0.5 * Math.sign(dx || 1);
          a.x -= push * dt * 8; b.x += push * dt * 8;
        }
      }
    }

    this.updatePickups(dt);
    this.updateCans(dt);
    this.updateBullets(dt);
    if (this.zoneIdx >= ZONES_PER_ACT) this.updateEmbers(dt);
    this.updateWaves(dt);

    // camera
    const zoneEnd = (this.zoneIdx + 1) * ZONE_W;
    const unlocked = this.waveState === "go";
    const camMax = (unlocked ? Math.min(LEVEL_W, zoneEnd + ZONE_W) : zoneEnd) - VIEW_W;
    const target = clamp(p.x - VIEW_W * 0.44, 0, Math.max(0, camMax));
    this.camX = lerp(this.camX, target, 1 - Math.pow(0.0015, dt));

    // combo timer
    if (p.comboT > 0) {
      p.comboT -= dt;
      if (p.comboT <= 0) p.combo = 0;
    }
    // ghost hp trail
    p.ghostHp = Math.max(p.hp, p.ghostHp - 26 * dt);

    // game over transition
    if (p.dead && p.state === "death" && p.stateT > 1.4) {
      this.updateHi();
      this.setMode("gameover");
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    p.stateT += dt;
    p.flashT = Math.max(0, p.flashT - dt);
    p.invulnT = Math.max(0, p.invulnT - dt);

    if (p.dead) {
      p.vx *= Math.pow(0.001, dt);
      p.x += p.vx * dt;
      return;
    }

    // gravity / jump height
    if (!p.onGround) {
      p.vz -= GRAV * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0; p.vz = 0;
        this.audio.synth("land");
        this.burst(p.x, p.y, 5, "#5a6a80", 50, 0.25);
        if (p.state === "jump" || p.state === "fall" || p.state === "airattack") { p.state = "idle"; p.stateT = 0; p.move = null; }
      }
    }

    const inHurt = p.state === "hurt";
    const inAttack = p.state === "attack" || p.state === "airattack" || p.state === "special";

    if (inHurt) {
      p.x += p.vx * dt;
      p.vx *= Math.pow(0.002, dt);
      if (p.stateT > 0.34) { p.state = "idle"; p.stateT = 0; }
      this.clampPlayerX();
      return;
    }

    // ----- attacking -----
    if (inAttack && p.move) {
      const m = p.move;
      const prog = p.stateT / p.moveDur;
      // lunge impulse early in the swing
      if (prog < 0.3) p.x += p.facing * m.lunge * dt * 2.4;
      // active window
      if (prog >= m.from && prog <= m.to) {
        this.sweep(p, m, this.enemies as Fighter[], true);
        if (m.aoe && !p.swingHit.has("aoe")) {
          p.swingHit.add("aoe");
          this.burst(p.x + p.facing * 20, p.y - 34, 22, "#29e6ff", 190, 0.4);
          this.burst(p.x + p.facing * 20, p.y - 34, 12, "#ff2d78", 150, 0.35);
          this.shake(5);
        }
      }
      if (p.stateT >= p.moveDur) {
        // chain
        if (p.state !== "special" && p.onGround) {
          if (p.chainQueued && p.chain < 2) {
            p.chain++;
            p.chainQueued = false;
            this.startPlayerMove(p.chain === 1 ? MOVES.punch2 : MOVES.punch3);
            this.clampPlayerX();
            return;
          }
          if (p.kickQueued) {
            p.kickQueued = false;
            p.chain = 0;
            this.startPlayerMove(MOVES.kick);
            this.clampPlayerX();
            return;
          }
        }
        p.state = "idle"; p.stateT = 0; p.move = null; p.chain = 0;
      }
      this.clampPlayerX();
      return;
    }

    // ----- movement -----
    let mx = 0, my = 0;
    if (this.keys.has("left")) mx -= 1;
    if (this.keys.has("right")) mx += 1;
    if (this.keys.has("up")) my -= 1;
    if (this.keys.has("down")) my += 1;

    const speed = 118;
    p.x += mx * speed * dt;
    p.y = clamp(p.y + my * speed * 0.62 * dt, GROUND_MIN, GROUND_MAX);
    if (mx !== 0) p.facing = mx > 0 ? 1 : -1;
    const moving = mx !== 0 || my !== 0;

    // actions
    if (this.bufferSpecial > 0 && p.meter >= 100 && p.onGround) {
      this.bufferSpecial = 0;
      p.meter = 0;
      p.state = "special";
      this.startPlayerMove(MOVES.special);
      this.audio.synth("special");
      this.addText(p.x, p.y - 84, "מתקפה מיוחדת!", "#29e6ff", true);
    } else if (this.bufferJump > 0 && p.onGround) {
      this.bufferJump = 0;
      p.vz = JUMP_V;
      p.z = 0.02;
      p.state = "jump";
      p.stateT = 0;
      this.audio.synth("jump");
    } else if (this.bufferAttack > 0) {
      this.bufferAttack = 0;
      p.chain = 0;
      this.startPlayerMove(p.onGround ? MOVES.punch1 : MOVES.airkick);
      this.audio.synth("whoosh");
    } else if (this.bufferKick > 0) {
      this.bufferKick = 0;
      p.chain = 0;
      this.startPlayerMove(p.onGround ? MOVES.kick : MOVES.airkick);
      this.audio.synth("whoosh");
    }

    const justActed = p.state === "attack" || p.state === "airattack" || p.state === "special";
    if (!inAttack && !justActed && p.onGround && p.state !== "jump") {
      p.state = moving ? "run" : "idle";
    }
    if (!p.onGround && p.state !== "airattack" && p.state !== "attack") {
      p.state = p.vz > 0 ? "jump" : "fall";
    }
  }

  private startPlayerMove(m: MoveDef) {
    this.startMove(this.player, m);
    if (m === MOVES.punch1 || m === MOVES.punch2 || m === MOVES.punch3) {
      // allow chaining: buffered inputs during swing
      this.player.chainQueued = false;
      this.player.kickQueued = false;
    }
  }

  /** called from input buffering while attacking */
  queueCombo(kind: "attack" | "kick") {
    const p = this.player;
    if (p.state === "attack" || p.state === "airattack") {
      if (kind === "attack") p.chainQueued = true;
      else p.kickQueued = true;
    }
  }

  private clampPlayerX() {
    const p = this.player;
    const unlocked = this.waveState === "go";
    const minX = this.camX + 26;
    const maxX = unlocked
      ? Math.min(LEVEL_W - 26, (this.zoneIdx + 1) * ZONE_W + ZONE_W - 50)
      : this.camX + VIEW_W - 26;
    p.x = clamp(p.x, minX, maxX);
    p.y = clamp(p.y, GROUND_MIN, GROUND_MAX);
  }

  /* ---------- enemy AI ---------- */

  private updateEnemy(e: Enemy, dt: number) {
    const p = this.player;
    e.stateT += dt;
    e.flashT = Math.max(0, e.flashT - dt);
    e.spawnT = Math.max(0, e.spawnT - dt);
    e.cooldownT = Math.max(0, e.cooldownT - dt);
    e.aiT += dt;

    // gravity for launched enemies
    if (!e.onGround) {
      e.vz -= GRAV * dt;
      e.z += e.vz * dt;
      if (e.z <= 0) { e.z = 0; e.vz = 0; }
    }

    if (e.state === "dying") {
      const strip = this.stripFor(e, "Death");
      const dur = strip ? strip.count / 11 : 0.6;
      if (e.stateT > dur) {
        e.alpha -= dt * 2.4;
        if (e.alpha <= 0) e.gone = true;
      }
      return;
    }

    // the warlord runs his own brain
    if (e.kind === "boss") {
      this.updateBoss(e, dt);
      return;
    }

    if (e.state === "hurt") {
      e.x += e.vx * dt;
      e.vx *= Math.pow(0.004, dt);
      const stunT = 0.32;
      if (e.stateT > stunT) { e.state = "chase"; e.stateT = 0; }
      e.x = clamp(e.x, 8, LEVEL_W - 8);
      return;
    }

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (e.state === "enter") {
      const inMin = this.camX + 46, inMax = this.camX + VIEW_W - 46;
      e.x += (e.x < p.x ? 1 : -1) * e.def.speed * dt;
      e.facing = dx > 0 ? 1 : -1;
      this.setAnimState(e, "run");
      if (e.x > inMin && e.x < inMax) { e.state = "chase"; e.stateT = 0; }
      return;
    }

    if (e.state === "chase") {
      if (p.dead) { this.setAnimState(e, "idle"); return; }
      // ── ranged gunslinger: kite the player and shoot ──
      if (e.def.ranged) {
        e.facing = dx > 0 ? 1 : -1;
        if (adx < 105) {
          e.x -= Math.sign(dx || 1) * e.def.speed * dt;
          this.setAnimState(e, "run");
        } else if (adx > 250) {
          e.x += Math.sign(dx || 1) * e.def.speed * dt;
          if (Math.abs(dy) > 6) e.y = clamp(e.y + Math.sign(dy) * e.def.speed * 0.5 * dt, GROUND_MIN, GROUND_MAX);
          this.setAnimState(e, "run");
        } else {
          if (Math.abs(dy) > 6) {
            e.y = clamp(e.y + Math.sign(dy) * e.def.speed * 0.6 * dt, GROUND_MIN, GROUND_MAX);
            this.setAnimState(e, "run");
          } else {
            this.setAnimState(e, "idle");
            if (ady < 44 && e.cooldownT <= 0) { e.state = "windup"; e.stateT = 0; }
          }
        }
        e.x = clamp(e.x, 8, LEVEL_W - 8);
        return;
      }
      // pick orbit side occasionally
      if (e.aiT > 2.2) { e.aiT = 0; if (Math.random() < 0.4) e.side = e.side === 1 ? -1 : 1; }
      const standX = e.side * (e.def.range * 0.5 + 8);
      const tx = p.x + standX;
      const ty = clamp(p.y + e.side * 10, GROUND_MIN, GROUND_MAX);
      const tdx = tx - e.x, tdy = ty - e.y;
      const dist = Math.hypot(tdx, tdy);
      if (dist > 4) {
        const s = e.def.speed;
        e.x += (tdx / dist) * s * dt;
        e.y = clamp(e.y + (tdy / dist) * s * 0.62 * dt, GROUND_MIN, GROUND_MAX);
      }
      e.facing = dx > 0 ? 1 : -1;
      this.setAnimState(e, dist > 6 ? "run" : "idle");
      // engage
      if (adx < e.def.range && ady < 20 && e.cooldownT <= 0 && !p.dead) {
        e.state = "windup";
        e.stateT = 0;
        e.facing = dx > 0 ? 1 : -1;
      }
      return;
    }

    if (e.state === "windup") {
      this.setAnimState(e, "idle");
      if (e.stateT >= e.def.windup) {
        e.state = "attack";
        e.stateT = 0;
        e.hasHitPlayer = false;
        e.move = e.def.move;
        const strip = this.stripFor(e, e.def.move.anim);
        e.moveDur = strip ? strip.count / e.def.move.fps : 0.45;
        this.audio.synth("whoosh");
      }
      return;
    }

    if (e.state === "attack") {
      const m = e.move!;
      const prog = e.stateT / e.moveDur;
      if (e.def.ranged) {
        if (!e.hasHitPlayer && prog >= m.from && prog <= m.to) {
          e.hasHitPlayer = true;
          this.spawnBullet(e);
        }
        if (e.stateT >= e.moveDur) {
          e.state = "recover"; e.stateT = 0; e.move = null;
          e.cooldownT = e.def.cooldown * rand(0.85, 1.2);
        }
        return;
      }
      if (prog < 0.3) e.x += e.facing * m.lunge * dt * 2.0;
      if (!e.hasHitPlayer && prog >= m.from && prog <= m.to) {
        if (Math.abs(p.y - e.y) < 34 && p.z < 62) {
          const hx0 = e.x + e.facing * 14;
          const hx1 = e.x + e.facing * (m.reach + 18);
          const minX = Math.min(hx0, hx1), maxX = Math.max(hx0, hx1);
          const [bx, by, bw, bh] = p.hurtbox();
          if (bx + bw > minX && bx < maxX && by < e.y && by + bh > e.y - e.hh * 0.85 && p.invulnT <= 0 && !p.dead) {
            e.hasHitPlayer = true;
            this.applyHit(e, p, m);
          }
        }
      }
      if (e.stateT >= e.moveDur) {
        e.state = "recover";
        e.stateT = 0;
        e.move = null;
        e.cooldownT = e.def.cooldown * rand(0.85, 1.2);
      }
      return;
    }

    if (e.state === "recover") {
      this.setAnimState(e, "idle");
      if (e.stateT > 0.4) { e.state = "chase"; e.stateT = 0; }
    }
  }

  private setAnimState(e: Enemy, s: string) {
    if (e.state !== "chase" && e.state !== "enter") return;
    // only overwrite visual idle/run state
    if (s === "run" || s === "idle") (e as Enemy & { visual: string }).visual = s;
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      pk.ttl -= dt;
      if (pk.ttl <= 0) { this.pickups.splice(i, 1); continue; }
      if (Math.abs(pk.x - p.x) < 34 && Math.abs(pk.y - p.y) < 26 && !p.dead) {
        p.hp = clamp(p.hp + 22, 0, p.maxHp);
        this.addText(p.x, p.y - 78, "+22 חיים", "#8dff5a", true);
        this.audio.synth("heal");
        this.burst(pk.x, pk.y - 10, 8, "#8dff5a", 90, 0.3);
        this.pickups.splice(i, 1);
      }
    }
  }

  private spawnBullet(e: Enemy) {
    const x = e.x + e.facing * (e.hw + 10);
    const y = e.y - e.hh * 0.62;
    this.bullets.push({ x, y, vx: e.facing * 265, life: 2.4, shooter: e });
    this.burst(x, y, 5, "#ffd98a", 90, 0.18);
    this.audio.playSample("hitLight", rand(1.7, 2.0), 0.5);
    this.audio.synth("whoosh");
  }

  private updateBullets(dt: number) {
    const p = this.player;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += (b.vy ?? 0) * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < this.camX - 60 || b.x > this.camX + VIEW_W + 60) {
        this.bullets.splice(i, 1);
        continue;
      }
      if (
        !p.dead && p.invulnT <= 0 && p.z < 40 &&
        Math.abs(b.y - (p.y - p.hh * 0.55)) < p.hh * 0.45 + 5 &&
        Math.abs(b.x - p.x) < p.hw + 7
      ) {
        this.applyHit(b.shooter, p, BULLET_MOVE);
        this.burst(b.x, b.y, 6, "#ffb02e", 110, 0.25);
        this.bullets.splice(i, 1);
        continue;
      }
      let consumed = false;
      for (const c of this.cans) {
        if (!c.broken && Math.abs(b.x - c.x) < 16 && b.y > c.y - 62 && b.y < c.y) {
          this.damageCan(c, Math.sign(b.vx));
          this.bullets.splice(i, 1);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
    }
  }

  private updateEmbers(dt: number) {
    for (const em of this.embers) {
      em.y += em.vy * dt;
      em.x += Math.sin(this.time * em.tw + em.y * 0.03) * em.drift * dt;
      if (em.y < -6) { em.y = VIEW_H + 6; em.x = Math.random() * VIEW_W; }
      if (em.x < -6) em.x = VIEW_W + 6;
      if (em.x > VIEW_W + 6) em.x = -6;
    }
  }

  private updateCans(dt: number) {
    for (const c of this.cans) {
      if (Math.abs(c.vx) > 1) {
        c.x += c.vx * dt;
        c.vx *= Math.pow(0.01, dt);
        c.x = clamp(c.x, 10, LEVEL_W - 10);
      }
      if (c.broken) c.t += dt;
    }
  }

  /* ================= RENDER ================= */

  private render() {
    const ctx = this.ctx;
    if (!ctx || !this.assets) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // screen shake
    let ox = 0, oy = 0;
    if (this.shakeT > 0) {
      const m = this.shakeMag * (this.shakeT / 0.22);
      ox = rand(-m, m); oy = rand(-m, m);
    } else this.shakeMag = 0;
    ctx.translate(Math.round(ox), Math.round(oy));

    this.drawBackground(ctx);
    this.drawWorld(ctx);
    if (this.act() === 1) this.drawAct2Foreground(ctx);
    this.drawRain(ctx);
    this.drawAtmosphere(ctx);
    ctx.restore();

    if (this.mode !== "attract") this.drawHUD(ctx);
    this.drawBanner(ctx);
  }

  private drawTiled(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | null,
    factor: number,
    dstH: number,
    alpha: number,
    cropTop = 0
  ) {
    if (!img || !img.naturalWidth) return;
    const sy = img.naturalHeight * cropTop;
    const sh = img.naturalHeight - sy;
    const sc = dstH / sh;
    const tw = img.naturalWidth * sc;
    let off = -((this.camX * factor) % tw);
    if (off > 0) off -= tw;
    const dy = VIEW_H - dstH;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let x = off; x < VIEW_W; x += tw) {
      ctx.drawImage(img, 0, sy, img.naturalWidth, sh, Math.round(x), Math.round(dy), Math.ceil(tw), dstH);
    }
    ctx.restore();
  }

  private act() { return this.zoneIdx < ZONES_PER_ACT ? 0 : 1; }

  private drawBackground(ctx: CanvasRenderingContext2D) {
    const act = this.act();
    if (act === 1 && this.drawAct2Background(ctx)) return;
    const farImg = this.assets!.bgSkyline;
    const nearImg = this.assets!.bgStreet;
    // base night sky
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, "#120a26"); sky.addColorStop(0.5, "#0a0817"); sky.addColorStop(1, "#070610");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // far layer (slow parallax, darkened to silhouette)
    this.drawTiled(ctx, farImg, 0.16, VIEW_H, 0.9);
    ctx.fillStyle = "rgba(8, 6, 24, 0.46)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // near layer — bottom crop, scrolls with camera
    const streetTop = VIEW_H * 0.4;
    this.drawTiled(ctx, nearImg, 1, VIEW_H * 0.6, 1, 0.4);
    // blend the horizon seam
    const seam = ctx.createLinearGradient(0, streetTop - 14, 0, streetTop + 22);
    seam.addColorStop(0, "rgba(10,8,23,0.85)");
    seam.addColorStop(1, "rgba(10,8,23,0)");
    ctx.fillStyle = seam;
    ctx.fillRect(0, streetTop - 14, VIEW_W, 36);
    // depth shading so fighters pop
    const g = ctx.createLinearGradient(0, 160, 0, VIEW_H);
    g.addColorStop(0, "rgba(4,3,12,0)");
    g.addColorStop(1, "rgba(4,3,12,0.3)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 160, VIEW_W, VIEW_H - 160);
    // flickering lamp glows (fixed world positions, per-act color)
    const lamps = act === 0 ? [300, 1230, 2180] : [620, 1500, 2380, 3300, 4220, 5120];
    const lampRGB = act === 0 ? "255, 176, 46" : "255, 122, 40";
    for (const lx of lamps) {
      const sx = lx - this.camX;
      if (sx < -80 || sx > VIEW_W + 80) continue;
      const flick = 0.55 + 0.45 * Math.sin(this.time * 13 + lx) * Math.sin(this.time * 3.1 + lx * 2);
      const a = 0.10 + 0.06 * Math.max(0, flick);
      const rg = ctx.createRadialGradient(sx, 120, 6, sx, 120, 110);
      rg.addColorStop(0, `rgba(${lampRGB}, ${a})`);
      rg.addColorStop(1, `rgba(${lampRGB}, 0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(sx - 110, 10, 220, 240);
    }
  }

  /** ACT 2 — five parallax planes of real industrial art + living smoke, glows and beacons. */
  private drawAct2Background(ctx: CanvasRenderingContext2D): boolean {
    const [sky, far, mid, fg] = this.assets!.bgAct2;
    const scene = this.assets!.bgAct2Scene;
    if (!scene && !(far && mid)) return false;
    // furnace sky
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, "#2b130b");
    g.addColorStop(0.5, "#1a0d0e");
    g.addColorStop(1, "#0c0709");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // plane 1 — smokestack sky
    if (sky) this.drawTiled(ctx, sky, 0.1, VIEW_H, 1);
    ctx.fillStyle = "rgba(34, 14, 5, 0.3)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // plane 2 — far refineries + blinking tower beacons
    if (far) this.drawTiled(ctx, far, 0.25, VIEW_H, 1);
    this.drawBeacons(ctx);
    // living smoke columns rise between the far and mid planes
    this.drawSmoke(ctx, 0.4);
    ctx.fillStyle = "rgba(24, 10, 7, 0.2)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // furnace fires breathing behind the mid skyline
    this.drawFurnaceGlows(ctx);
    // plane 3 — mid factories
    if (mid) this.drawTiled(ctx, mid, 0.55, VIEW_H, 1);
    ctx.fillStyle = "rgba(12, 6, 9, 0.14)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // plane 4 — the street itself: the pack's own rich demo scene (bottom crop, full scroll)
    if (scene) {
      this.drawTiled(ctx, scene, 1.0, VIEW_H * 0.62, 1, 0.42);
      // blend the horizon seam
      const streetTop = VIEW_H * 0.38;
      const seam = ctx.createLinearGradient(0, streetTop - 12, 0, streetTop + 24);
      seam.addColorStop(0, "rgba(16,8,8,0.8)");
      seam.addColorStop(1, "rgba(16,8,8,0)");
      ctx.fillStyle = seam;
      ctx.fillRect(0, streetTop - 12, VIEW_W, 36);
    } else if (fg) {
      this.drawTiled(ctx, fg, 1.0, VIEW_H, 1);
    }

    // ── the factory floor under the walk band ──
    const floorTop = GROUND_MIN - 14;
    const flr = ctx.createLinearGradient(0, floorTop, 0, VIEW_H);
    flr.addColorStop(0, "rgba(36,27,43,0.9)");
    flr.addColorStop(0.3, "rgba(23,17,32,0.92)");
    flr.addColorStop(1, "rgba(10,8,16,0.95)");
    ctx.fillStyle = flr;
    ctx.fillRect(0, floorTop, VIEW_W, VIEW_H - floorTop);
    if (fg) this.drawTiled(ctx, fg, 1.0, VIEW_H - floorTop, 0.35, 0.55);
    ctx.fillStyle = "rgba(255, 140, 60, 0.16)";
    ctx.fillRect(0, floorTop, VIEW_W, 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(0, floorTop + 2, VIEW_W, 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    const seamW = 96;
    let seamOff = -(this.camX % seamW);
    if (seamOff > 0) seamOff -= seamW;
    for (let x = seamOff; x < VIEW_W; x += seamW) {
      ctx.fillRect(Math.round(x), floorTop + 8, 2, VIEW_H - floorTop - 8);
    }

    // depth shading so fighters pop
    const dg = ctx.createLinearGradient(0, 160, 0, VIEW_H);
    dg.addColorStop(0, "rgba(4,3,10,0)");
    dg.addColorStop(1, "rgba(4,3,10,0.3)");
    ctx.fillStyle = dg;
    ctx.fillRect(0, 160, VIEW_W, VIEW_H - 160);
    // furnace lamps
    for (const lx of [620, 1500, 2380, 3300, 4220, 5120]) {
      const sx = lx - this.camX;
      if (sx < -90 || sx > VIEW_W + 90) continue;
      const flick = 0.55 + 0.45 * Math.sin(this.time * 11 + lx) * Math.sin(this.time * 2.7 + lx * 2);
      const a = 0.1 + 0.06 * Math.max(0, flick);
      const rg = ctx.createRadialGradient(sx, 130, 6, sx, 130, 120);
      rg.addColorStop(0, `rgba(255, 122, 40, ${a})`);
      rg.addColorStop(1, "rgba(255, 122, 40, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(sx - 120, 10, 240, 250);
    }
    return true;
  }

  /** Smoke columns drifting up from the stacks (deterministic — pure function of time). */
  private drawSmoke(ctx: CanvasRenderingContext2D, factor: number) {
    for (const wx of [420, 1150, 1980, 2850, 3700, 4600, 5450]) {
      const bx = wx - this.camX * factor;
      if (bx < -70 || bx > VIEW_W + 70) continue;
      for (let i = 0; i < 6; i++) {
        const ph = (this.time * 0.1 + i / 6 + wx * 0.0013) % 1;
        const y = 120 - ph * 108;
        const x = bx + Math.sin((ph * 6 + wx) * 1.7) * (4 + ph * 11) + ph * 16;
        const r = 4 + ph * 14;
        ctx.globalAlpha = (1 - ph) * 0.15;
        ctx.fillStyle = "#bdb4c9";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Breathing furnace fires behind the mid skyline. */
  private drawFurnaceGlows(ctx: CanvasRenderingContext2D) {
    const factor = 0.5;
    for (const wx of [520, 1420, 2320, 3220, 4120, 5020]) {
      const sx = wx - this.camX * factor;
      if (sx < -80 || sx > VIEW_W + 80) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 1.8 + wx * 0.7) * Math.sin(this.time * 3.3 + wx);
      const a = 0.05 + 0.06 * Math.max(0, pulse);
      const rg = ctx.createRadialGradient(sx, 150, 4, sx, 150, 90);
      rg.addColorStop(0, `rgba(255, 150, 50, ${a})`);
      rg.addColorStop(1, "rgba(255, 150, 50, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(sx - 90, 60, 180, 180);
    }
  }

  /** Red aviation beacons blinking on the far towers. */
  private drawBeacons(ctx: CanvasRenderingContext2D) {
    const factor = 0.25;
    for (const wx of [900, 2050, 3100, 4150, 5200]) {
      const sx = wx - this.camX * factor;
      if (sx < -10 || sx > VIEW_W + 10) continue;
      const on = Math.sin(this.time * 2.2 + wx * 0.37) > 0.45;
      if (!on) continue;
      ctx.fillStyle = "rgba(255, 60, 60, 0.25)";
      ctx.beginPath();
      ctx.arc(sx, 36, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff5a5a";
      ctx.fillRect(Math.round(sx) - 1, 35, 2, 2);
    }
  }

  /** Plane 5 — dark girder strip + steam vents, drawn IN FRONT of the fighters for real depth. */
  private drawAct2Foreground(ctx: CanvasRenderingContext2D) {
    const fg = this.assets!.bgAct2[3];
    if (fg) {
      this.drawTiled(ctx, fg, 1.3, 52, 1, 0.6);
      ctx.fillStyle = "rgba(3, 2, 8, 0.72)";
      ctx.fillRect(0, VIEW_H - 52, VIEW_W, 52);
    }
    // periodic steam vents along the walk band
    for (const wx of [760, 1650, 2540, 3430, 4320, 5210]) {
      const sx = wx - this.camX;
      if (sx < -30 || sx > VIEW_W + 30) continue;
      const phase = (this.time * 0.45 + wx * 0.0031) % 1;
      if (phase >= 0.32) continue;
      const k = phase / 0.32;
      for (let i = 0; i < 5; i++) {
        const kk = clamp(k + i * 0.12, 0, 1);
        const y = GROUND_MIN + 8 - kk * 52;
        const x = sx + Math.sin((kk * 5 + wx) * 2.3) * (2 + kk * 5);
        ctx.globalAlpha = (1 - kk) * 0.2;
        ctx.fillStyle = "#e8e2f0";
        ctx.beginPath();
        ctx.arc(x, y, 2.5 + kk * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawWorld(ctx: CanvasRenderingContext2D) {
    // collect drawables sorted by depth (foot y)
    type Drawable = { y: number; draw: () => void };
    const list: Drawable[] = [];

    for (const c of this.cans) {
      if (!c.broken) {
        list.push({ y: c.y, draw: () => this.drawCan(ctx, c) });
      } else if (c.t < 3) {
        list.push({ y: c.y, draw: () => this.drawCanBroken(ctx, c) });
      }
    }
    for (const pk of this.pickups) list.push({ y: pk.y, draw: () => this.drawPickup(ctx, pk) });
    for (const e of this.enemies) list.push({ y: e.y, draw: () => this.drawFighter(ctx, e) });
    list.push({ y: this.player.y, draw: () => this.drawFighter(ctx, this.player) });

    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    // particles (world space)
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      const s = Math.round(p.size);
      ctx.fillRect(Math.round(p.x - this.camX - s / 2), Math.round(p.y - s / 2), s, s);
    }
    ctx.globalAlpha = 1;

    // floating texts
    for (const t of this.texts) {
      const a = clamp(t.t / 0.4, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = t.big ? '11px "Press Start 2P"' : '7px "Press Start 2P"';
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(5,3,10,0.9)";
      const tx = Math.round(t.x - this.camX), ty = Math.round(t.y);
      ctx.strokeText(t.txt, tx, ty);
      ctx.fillStyle = t.color;
      ctx.fillText(t.txt, tx, ty);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    // gunner tracers (+ the boss's crimson fan bullets)
    ctx.save();
    for (const b of this.bullets) {
      const sx = b.x - this.camX;
      const tint = b.tint ?? "#ffd98a";
      const r = b.big ? 9 : 6;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(sx, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      const w = b.big ? 7 : 5;
      ctx.fillStyle = tint;
      ctx.fillRect(Math.round(sx - w), Math.round(b.y - 1.5), w * 2, 3);
      ctx.fillStyle = "#fff6d8";
      ctx.fillRect(Math.round(sx - 2), Math.round(b.y - 0.5), 4, 1);
    }
    ctx.restore();

    // slam shockwaves racing along the ground
    for (const w of this.shockwaves) {
      const sx = w.x - this.camX;
      const age = clamp(1 - w.life / 1.5, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(255, 130, 60, ${0.75 - age * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sx, Math.round(w.y), 9 + Math.sin(this.time * 22) * 2, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 170, 80, ${0.6 - age * 0.25})`;
      for (let i = 0; i < 3; i++) {
        const fx = sx + Math.sin(this.time * 26 + i * 2.1) * 4;
        const fh = 7 + ((this.time * 40 + i * 13) % 9);
        ctx.fillRect(Math.round(fx - 1.5), Math.round(w.y - fh), 3, Math.round(fh));
      }
      ctx.restore();
    }
  }

  private drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = "#020208";
    ctx.beginPath();
    ctx.ellipse(Math.round(x), Math.round(y + 2), w, w * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter) {
    if (!this.assets) return;
    const isPlayer = f instanceof Player;
    const set: AnimSet = isPlayer ? this.assets.player : this.assets.enemies[(f as Enemy).kind];
    const sx = Math.round(f.x - this.camX);
    const footY = Math.round(f.footY);

    // shadow — hugs the feet to sell the grounding
    const shW = f.hh * 0.105 * clamp(1 - f.z / 160, 0.5, 1);
    this.drawShadow(ctx, sx, Math.round(f.y), shW);

    // choose anim strip
    let animName: string = "Idle";
    let loop = true;
    let fps = 9;
    const st = f.state;
    if (isPlayer) {
      if (st === "idle") { animName = "Idle"; fps = 8; }
      else if (st === "run") { animName = "Run"; fps = 13; }
      else if (st === "jump") { animName = "Jump"; fps = 8; loop = false; }
      else if (st === "fall" || st === "airattack") { animName = st === "airattack" ? (f.move?.anim ?? "Fall") : "Fall"; fps = 8; }
      else if (st === "attack" || st === "special") { animName = f.move?.anim ?? "Attack1"; fps = f.move?.fps ?? 14; loop = false; }
      else if (st === "hurt") { animName = "Take Hit"; fps = 11; loop = false; }
      else if (st === "death") { animName = "Death"; fps = 9; loop = false; }
    } else {
      const e = f as Enemy;
      const visual = (e as Enemy & { visual?: string }).visual ?? "idle";
      if (st === "dying") { animName = "Death"; fps = 11; loop = false; }
      else if (st === "attack") { animName = e.move?.anim ?? "Attack1"; fps = e.move?.fps ?? 13; loop = false; }
      else if (st === "dash") { animName = "Run"; fps = 22; }
      else if (st === "slamJump" || st === "fan") { animName = e.move?.anim ?? "Attack2"; fps = 8; loop = false; }
      else if (st === "transition") { animName = "Idle"; fps = 12; }
      else if (st === "windup") { animName = "Idle"; fps = 5; }
      else if (st === "hurt") { animName = "Take Hit"; fps = 11; loop = false; }
      else if (visual === "run") { animName = "Run"; fps = 12; }
      else { animName = "Idle"; fps = 7; }
    }

    const strip = set[animName] ?? set["Idle"];
    if (!strip) {
      // fallback rect so the game never breaks
      ctx.fillStyle = isPlayer ? "#29e6ff" : "#ff4757";
      ctx.fillRect(sx - 8, footY - 40, 16, 40);
      return;
    }

    let frame = Math.floor(f.stateT * fps);
    if (loop) frame = frame % strip.count;
    else frame = clamp(frame, 0, strip.count - 1);

    const w = strip.frameW * f.scale;
    const h = strip.frameH * f.scale;

    ctx.save();
    ctx.globalAlpha = f.alpha;
    // ground the sprite: offset by the frame's real foot padding so feet touch the floor
    const padSrc = strip.footPad && strip.footPad[frame] !== undefined ? strip.footPad[frame] : strip.frameH * 0.05;
    ctx.translate(sx, footY + padSrc * f.scale);
    ctx.scale(f.facing, 1);
    if (f.flashT > 0) {
      ctx.filter = "brightness(2.6) saturate(0.2)";
    }
    ctx.drawImage(
      strip.img,
      Math.round(frame * strip.frameW), 0, Math.ceil(strip.frameW), strip.frameH,
      Math.round(-w / 2), Math.round(-h), Math.ceil(w), Math.ceil(h)
    );
    ctx.filter = "none";

    // bare-knuckle swing arc on active frames
    if (isPlayer && (st === "attack" || st === "special") && f.move) {
      const prog = clamp(f.stateT / f.moveDur, 0, 1);
      if (prog >= f.move.from && prog <= f.move.to) {
        const sN = f.hh / 64;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(4 * sN, -h * 0.55, 24 * sN, -1.2, 0.7);
        ctx.stroke();
      }
    }
    ctx.restore();

    // windup telegraph "!"
    if (!isPlayer && f.state === "windup") {
      const blink = Math.sin(this.time * 26) > 0;
      if (blink) {
        ctx.font = '9px "Press Start 2P"';
        ctx.textAlign = "center";
        ctx.fillStyle = "#ff4757";
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3;
        ctx.strokeText("!", sx, footY - h - 8);
        ctx.fillText("!", sx, footY - h - 8);
        ctx.textAlign = "left";
      }
    }

    // enemy hp bar
    if (!isPlayer && f.hp < f.maxHp && !f.dead) {
      const bw = Math.round(Math.max(30, f.hh * 0.26));
      const ratio = clamp(f.hp / f.maxHp, 0, 1);
      const bx = sx - bw / 2, by = footY - h - 7;
      ctx.fillStyle = "rgba(4,3,10,0.75)";
      ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
      ctx.fillStyle = ratio > 0.5 ? "#8dff5a" : ratio > 0.25 ? "#ffb02e" : "#ff4757";
      ctx.fillRect(bx, by, Math.round(bw * ratio), 3);
    }

    // spawn flash ring
    if (!isPlayer && (f as Enemy).spawnT > 0) {
      const e = f as Enemy;
      ctx.save();
      ctx.globalAlpha = e.spawnT / 0.35;
      ctx.strokeStyle = "#29e6ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(sx, Math.round(f.y) + 2, f.hh * 0.13 * (1 - e.spawnT / 0.35) + 10, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawCan(ctx: CanvasRenderingContext2D, c: TrashCan) {
    const img = this.assets!.trashCan;
    const sx = Math.round(c.x - this.camX);
    this.drawShadow(ctx, sx, Math.round(c.y), 20);
    if (img && img.naturalWidth) {
      const h = 62;
      const w = h * (img.naturalWidth / img.naturalHeight);
      ctx.drawImage(img, Math.round(sx - w / 2), Math.round(c.y - h), Math.round(w), h);
      if (c.hp === 1) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#0a0a12";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 7, c.y - h + 10); ctx.lineTo(sx + 4, c.y - 20);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.fillStyle = "#5a6a7a";
      ctx.fillRect(sx - 16, Math.round(c.y - 54), 32, 54);
    }
  }

  private drawCanBroken(ctx: CanvasRenderingContext2D, c: TrashCan) {
    const sx = Math.round(c.x - this.camX);
    ctx.save();
    ctx.globalAlpha = clamp(1 - (c.t - 2), 0, 1);
    ctx.fillStyle = "#3d4a5a";
    ctx.fillRect(sx - 18, Math.round(c.y - 13), 14, 10);
    ctx.fillRect(sx + 2, Math.round(c.y - 10), 16, 8);
    ctx.fillStyle = "#5a6a7a";
    ctx.fillRect(sx - 7, Math.round(c.y - 20), 12, 7);
    ctx.restore();
  }

  private drawPickup(ctx: CanvasRenderingContext2D, pk: Pickup) {
    const sx = Math.round(pk.x - this.camX);
    const bob = Math.sin(pk.t * 4) * 2.5;
    const blink = pk.ttl < 4 && Math.sin(pk.t * 14) > 0;
    if (blink) return;
    // glow ring
    ctx.save();
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(pk.t * 5);
    ctx.strokeStyle = "#8dff5a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(sx, Math.round(pk.y) + 1, 17, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // pixel heart
    ctx.save();
    ctx.translate(sx, Math.round(pk.y - 18 + bob));
    ctx.fillStyle = "#ff4757";
    ctx.fillRect(-6, -5, 12, 8);
    ctx.fillRect(-9, -8, 6, 6);
    ctx.fillRect(3, -8, 6, 6);
    ctx.fillRect(-3, 3, 6, 3);
    ctx.restore();
  }

  private drawRain(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // act 2 rain catches the furnace light — warm ash-rain
    ctx.strokeStyle = this.act() === 1 ? "rgba(255, 200, 150, 0.17)" : "rgba(150, 210, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.rain) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.25, d.y + d.len);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawAtmosphere(ctx: CanvasRenderingContext2D) {
    // neon flicker
    if (this.flickerT > 0) {
      ctx.fillStyle = `rgba(255, 45, 120, ${this.flickerOn})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // hurt flash
    if (this.hurtFlashT > 0) {
      ctx.fillStyle = `rgba(255, 40, 60, ${this.hurtFlashT * 0.5})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // low hp pulse
    const p = this.player;
    if ((this.mode === "playing" || this.mode === "paused") && p.hp > 0 && p.hp < 25) {
      const a = 0.08 + 0.07 * Math.sin(this.time * 6);
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 90, VIEW_W / 2, VIEW_H / 2, 260);
      g.addColorStop(0, "rgba(255,0,40,0)");
      g.addColorStop(1, `rgba(255,0,40,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // act 2 — rising furnace embers
    if (this.act() === 1 && this.mode !== "attract" && this.mode !== "loading") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const em of this.embers) {
        const a = 0.22 + 0.2 * Math.sin(this.time * em.tw * 2);
        ctx.fillStyle = `rgba(255, 140, 50, ${a})`;
        ctx.fillRect(em.x, em.y, em.size, em.size);
      }
      ctx.restore();
    }
    // act transition fade
    if (this.actFlashT > 0) {
      ctx.fillStyle = `rgba(2,1,6,${clamp(this.actFlashT * 1.1, 0, 1)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    // attract dim
    if (this.mode === "attract") {
      ctx.fillStyle = "rgba(5,4,14,0.42)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /* ---------- HUD ---------- */

  private drawHUD(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    ctx.save();

    // ── player plate (top-left in screen space; RTL flavor via layout) ──
    const px = 10, py = 10;
    ctx.fillStyle = "rgba(6,5,16,0.72)";
    ctx.fillRect(px - 4, py - 4, 190, 46);
    ctx.strokeStyle = "rgba(41,230,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 3.5, py - 3.5, 189, 45);

    // portrait from real sprite (frame 0 crop)
    const idle = this.assets!.player["Idle"];
    if (idle) {
      ctx.fillStyle = "#1a1730";
      ctx.fillRect(px, py, 36, 36);
      ctx.drawImage(
        idle.img,
        idle.frameW * 0.28, idle.frameH * 0.05, idle.frameW * 0.44, idle.frameH * 0.44,
        px + 2, py + 2, 32, 32
      );
      ctx.strokeStyle = p.hp < 25 ? "#ff4757" : "#ffb02e";
      ctx.strokeRect(px + 0.5, py + 0.5, 35, 35);
    }

    // name + hp
    ctx.textAlign = "left";
    ctx.font = '700 10px Rubik, sans-serif';
    ctx.fillStyle = "#ffd9e8";
    ctx.fillText("רון ״סערה״", px + 42, py + 9);
    const bx = px + 42, by = py + 13, bw = 132, bh = 9;
    ctx.fillStyle = "#14060c";
    ctx.fillRect(bx, by, bw, bh);
    // ghost trail
    const ghostR = clamp(p.ghostHp / p.maxHp, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * ghostR), bh - 2);
    const hpR = clamp(p.hp / p.maxHp, 0, 1);
    const hpGrad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    if (hpR > 0.35) { hpGrad.addColorStop(0, "#ffe45e"); hpGrad.addColorStop(1, "#ffb02e"); }
    else { hpGrad.addColorStop(0, "#ff8a3d"); hpGrad.addColorStop(1, "#ff4757"); }
    ctx.fillStyle = hpGrad;
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * hpR), bh - 2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    for (let i = 1; i < 12; i++) {
      const tx = bx + (bw / 12) * i;
      ctx.beginPath(); ctx.moveTo(tx, by + 1); ctx.lineTo(tx, by + bh - 1); ctx.stroke();
    }
    ctx.strokeStyle = "#08060f";
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    // special meter
    const my = by + bh + 3;
    ctx.fillStyle = "#06121a";
    ctx.fillRect(bx, my, bw, 5);
    const mR = p.meter / 100;
    ctx.fillStyle = p.meter >= 100 ? (Math.sin(this.time * 10) > 0 ? "#7df3ff" : "#29e6ff") : "#1a8fa3";
    ctx.fillRect(bx + 1, my + 1, Math.round((bw - 2) * mR), 3);
    ctx.font = '6px "Press Start 2P"';
    ctx.fillStyle = p.meter >= 100 ? "#7df3ff" : "#5a7a8a";
    ctx.fillText(p.meter >= 100 ? "SPECIAL READY — C" : "SPECIAL", bx + bw + 5, my + 5);



    // ── score (top-right) ──
    ctx.textAlign = "right";
    ctx.font = '6px "Press Start 2P"';
    ctx.fillStyle = "#8a86a8";
    ctx.fillText("SCORE", VIEW_W - 12, 18);
    ctx.font = '11px "Press Start 2P"';
    ctx.fillStyle = "#ffb02e";
    ctx.fillText(String(this.score).padStart(7, "0"), VIEW_W - 12, 31);
    ctx.font = '6px "Press Start 2P"';
    ctx.fillStyle = "#5a5678";
    ctx.fillText("HI " + String(Math.max(this.hiScore, this.score)).padStart(7, "0"), VIEW_W - 12, 42);

    // wave / zone indicator
    const zone = ZONE_WAVES[this.zoneIdx];
    const totalW = zone ? zone.length : 0;
    const alive = this.enemies.filter((e) => !e.dead).length + this.spawnQueue.length;
    ctx.textAlign = "center";
    ctx.font = '700 10px Rubik, sans-serif';
    ctx.fillStyle = "#c8c4e0";
    if (this.waveState === "boss") {
      ctx.fillStyle = Math.sin(this.time * 8) > 0 ? "#ff5a5a" : "#8a2020";
      ctx.fillText("⚔ הקרב האחרון ⚔", VIEW_W / 2, 18);
    } else if (this.waveState === "go") {
      ctx.fillStyle = Math.sin(this.time * 6) > 0 ? "#8dff5a" : "#4a7a3a";
      ctx.fillText("האזור פתוח — התקדם!", VIEW_W / 2, 18);
    } else {
      const actN = Math.floor(this.zoneIdx / ZONES_PER_ACT) + 1;
      const zInAct = (this.zoneIdx % ZONES_PER_ACT) + 1;
      ctx.fillText(`מערכה ${actN} · אזור ${zInAct}/${ZONES_PER_ACT}  ·  גל ${Math.min(this.waveIdx + 1, totalW)}/${totalW}  ·  אויבים ${alive}`, VIEW_W / 2, 18);
    }

    // ── combo counter ──
    if (p.combo >= 2) {
      const pop = 1 + Math.max(0, p.comboT - 1.45) * 3;
      const cx = VIEW_W / 2, cy = 66;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      ctx.font = '20px "Press Start 2P"';
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(5,3,10,0.9)";
      ctx.strokeText(String(p.combo), 0, 0);
      ctx.fillStyle = p.combo >= 10 ? "#ff2d78" : p.combo >= 5 ? "#ffb02e" : "#ffe45e";
      ctx.fillText(String(p.combo), 0, 0);
      ctx.font = '6px "Press Start 2P"';
      ctx.strokeStyle = "rgba(5,3,10,0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText("COMBO", 0, 12);
      ctx.fillStyle = "#e8e4f2";
      ctx.fillText("COMBO", 0, 12);
      ctx.restore();
      // timer bar
      ctx.fillStyle = "rgba(6,5,16,0.7)";
      ctx.fillRect(cx - 26, cy + 17, 52, 3);
      ctx.fillStyle = p.combo >= 10 ? "#ff2d78" : "#ffe45e";
      ctx.fillRect(cx - 25, cy + 18, Math.round(50 * clamp(p.comboT / 1.6, 0, 1)), 1.5);
    }

    // ── GO arrow ──
    if (this.waveState === "go" && Math.sin(this.time * 7) > -0.3) {
      ctx.textAlign = "right";
      ctx.font = '10px "Press Start 2P"';
      ctx.fillStyle = "#8dff5a";
      ctx.strokeStyle = "rgba(5,3,10,0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText("GO ▶▶", VIEW_W - 14, VIEW_H / 2);
      ctx.fillText("GO ▶▶", VIEW_W - 14, VIEW_H / 2);
    }

    // ── boss health plate ──
    if (this.waveState === "boss") this.drawBossBar(ctx);

    ctx.restore();
  }

  private drawBossBar(ctx: CanvasRenderingContext2D) {
    const b = this.boss;
    if (!b || b.gone || this.bossState === "defeated") return;
    const bw = 236;
    const bx = Math.round((VIEW_W - bw) / 2);
    const by = 26;

    // portrait crop from the boss sheet
    const idle = this.assets?.enemies.boss["Idle"];
    if (idle) {
      ctx.fillStyle = "#1c0a10";
      ctx.fillRect(bx - 26, by - 3, 24, 24);
      ctx.drawImage(
        idle.img,
        idle.frameW * 0.3, idle.frameH * 0.08, idle.frameW * 0.4, idle.frameH * 0.4,
        bx - 24, by - 1, 20, 20
      );
      ctx.strokeStyle = "#ff5a5a";
      ctx.strokeRect(bx - 25.5, by - 2.5, 23, 23);
    }

    // name
    ctx.textAlign = "center";
    ctx.font = '700 10px Rubik, sans-serif';
    ctx.fillStyle = "#ffd9e8";
    ctx.fillText("אדון הסערה", VIEW_W / 2 + 12, by - 5);

    // bar backing + ghost trail + hp
    ctx.fillStyle = "rgba(6,3,8,0.8)";
    ctx.fillRect(bx - 1, by - 1, bw + 2, 11);
    const ghostR = clamp(this.bossGhostHp / b.maxHp, 0, 1);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * ghostR), 8);
    const hpR = clamp(b.hp / b.maxHp, 0, 1);
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, "#ff8a3d");
    grad.addColorStop(1, "#c81e2e");
    ctx.fillStyle = grad;
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * hpR), 8);
    // phase threshold ticks (⅓ and ⅔)
    ctx.strokeStyle = "rgba(6,3,8,0.9)";
    ctx.lineWidth = 1.5;
    for (const t of [1 / 3, 2 / 3]) {
      const tx = bx + bw * t;
      ctx.beginPath();
      ctx.moveTo(tx, by); ctx.lineTo(tx, by + 10);
      ctx.stroke();
    }
    ctx.strokeStyle = "#0a0408";
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 9);

    // phase pips
    for (let i = 1; i <= 3; i++) {
      const px = bx + bw + 10 + (i - 1) * 8;
      const on = i <= b.bossPhase;
      ctx.fillStyle = on ? (b.bossPhase === 3 && Math.sin(this.time * 10) > 0 ? "#ffd98a" : "#ff5a3d") : "rgba(255,90,61,0.22)";
      ctx.beginPath();
      ctx.moveTo(px + 3, by + 2);
      ctx.lineTo(px + 6, by + 5);
      ctx.lineTo(px + 3, by + 8);
      ctx.lineTo(px, by + 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    if (this.bannerT <= 0) return;
    const tIn = clamp((2.1 - this.bannerT) / 0.25, 0, 1);
    const tOut = clamp(this.bannerT / 0.35, 0, 1);
    const a = Math.min(tIn, tOut);
    const scale = 0.85 + 0.15 * tIn;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(VIEW_W / 2, VIEW_H * 0.36);
    ctx.scale(scale, scale);
    ctx.textAlign = "center";
    ctx.font = '26px "Suez One", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(5,3,10,0.92)";
    ctx.strokeText(this.bannerTxt, 0, 0);
    ctx.fillStyle = "#ffd9e8";
    ctx.shadowColor = "#ff2d78";
    ctx.shadowBlur = 18;
    ctx.fillText(this.bannerTxt, 0, 0);
    ctx.shadowBlur = 0;
    if (this.bannerSub) {
      ctx.font = '700 12px Rubik, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeText(this.bannerSub, 0, 22);
      ctx.fillStyle = "#29e6ff";
      ctx.fillText(this.bannerSub, 0, 22);
    }
    ctx.restore();
  }
}

export { MOVES };
