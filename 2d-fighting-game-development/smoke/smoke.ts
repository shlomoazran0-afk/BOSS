/* Headless smoke test — drives the REAL engine through a full game:
   clear 6 zones → boss intro → fight through all 3 phases → victory → retry.
   DOM / Canvas / Audio are stubbed; all game logic is the real code. */

/* ---------- global stubs ---------- */
class FakeAudio {
  src = ""; volume = 1; loop = false; preload = ""; playbackRate = 1; currentTime = 0;
  play() { return Promise.resolve(); }
  pause() {}
  addEventListener() {}
}
(globalThis as Record<string, unknown>).Audio = FakeAudio;

class FakeParam { value = 0; setValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeAudioNode {
  gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam();
  type = ""; buffer: unknown = null;
  connect() {} start() {} stop() {}
}
class FakeAudioContext {
  destination = {}; sampleRate = 44100; currentTime = 0;
  createGain() { return new FakeAudioNode(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  createOscillator() { return new FakeAudioNode(); }
  createBufferSource() { return new FakeAudioNode(); }
  createBiquadFilter() { return new FakeAudioNode(); }
  resume() { return Promise.resolve(); }
}

(globalThis as Record<string, unknown>).window = {
  addEventListener() {}, removeEventListener() {},
  AudioContext: FakeAudioContext, webkitAudioContext: FakeAudioContext,
  innerWidth: 1400, innerHeight: 900,
};
(globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
(globalThis as Record<string, unknown>).localStorage = { getItem: () => "0", setItem() {} };

function fakeCtx(): unknown {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return () => undefined;
    },
    set() { return true; },
  });
}
const canvas = { width: 480, height: 270, getContext: () => fakeCtx() } as unknown as HTMLCanvasElement;

/* ---------- engine under test ---------- */
import { Game, MOVES } from "../src/game/engine";

const fakeAssets = {
  player: {},
  enemies: { punk: {}, thug: {}, heavy: {}, raider: {}, gunner: {}, droid: {}, boss: {} },
  raiderSamurai: false,
  droidReal: false,
  bgSkyline: null,
  bgStreet: null,
  bgAct2: [],
  bgAct2Scene: null,
  trashCan: null,
  failed: [],
};

let mode = "loading";
let lastStats: Record<string, unknown> = {};
const game = new Game({
  onMode: (m, s) => { mode = m; if (s) lastStats = { ...s }; },
});
game.attach(canvas);
game.setAssets(fakeAssets as never);

const g = game as unknown as Record<string, any>;
const log = (...a: unknown[]) => console.log("•", ...a);
let failures = 0;
const expect = (cond: boolean, msg: string) => {
  if (cond) log("OK  ", msg);
  else { failures++; console.error("FAIL", msg); }
};

game.startGame();
expect(mode === "playing", "game starts");

/* ---------- phase 1: blast through zones 1..6 ---------- */
const seenStates = new Set<string>();
let steps = 0;
let bossSeen = false;
let maxShockwaves = 0;
let fanBullets = 0;
let phasesSeen = new Set<number>();
let bossIntroBanner = false;

while (mode === "playing" && steps < 200000) {
  steps++;
  // auto-walk right & auto-kill to push through the waves
  const zoneEnd = (g.zoneIdx as number + 1) * 960;
  if (g.waveState === "go") g.player.x = zoneEnd - 85;
  for (const e of g.enemies) {
    if (e.kind !== "boss") { e.hp = 0; e.dead = true; e.gone = true; }
  }
  g.spawnQueue.length = 0;

  game.frame(1 / 60);

  const boss = g.boss;
  if (boss) {
    bossSeen = true;
    seenStates.add(boss.state);
    phasesSeen.add(boss.bossPhase);
    maxShockwaves = Math.max(maxShockwaves, g.shockwaves.length);
    fanBullets = Math.max(fanBullets, g.bullets.filter((b: { tint?: string }) => b.tint === "#ff6b4a").length);
    if (boss.state === "chase") {
      // mostly brawl up close; every ~3s back off far to bait dash / projectile fan
      const farWindow = steps % 180 < 40;
      g.player.x = boss.x - (farWindow ? 380 : 90);
      g.player.y = boss.y;
      if (!farWindow && steps % 45 === 0 && !boss.dead) game.applyHit(g.player, boss, MOVES.punch3);
    }
    g.player.hp = Math.max(g.player.hp, 80); // keep the duelist alive for the smoke run
    if (g.waveState === "boss" && g.bannerT > 0 && g.bannerTxt.includes("אדון הסערה")) bossIntroBanner = true;
  }
}
expect(bossSeen, "boss spawned after zone 6");
expect(bossIntroBanner, "boss intro banner shown");
expect(phasesSeen.has(1) && phasesSeen.has(2) && phasesSeen.has(3), `all 3 boss phases reached (seen: ${[...phasesSeen].join(",")})`);
expect(seenStates.has("enter"), "boss entrance played");
expect(seenStates.has("transition"), "boss phase transition roars played");
expect(seenStates.has("attack"), "boss melee slashes");
expect(seenStates.has("dash"), "boss dash attack used");
expect(seenStates.has("slamJump"), "boss slam jump used");
expect(seenStates.has("fan"), "boss projectile fan used");
expect(maxShockwaves >= 2, `slam shockwaves spawned (max ${maxShockwaves})`);
expect(fanBullets >= 3, `fan bullets spawned (max ${fanBullets})`);
expect(mode === "victory", `victory reached (mode=${mode}, steps=${steps})`);
expect(lastStats.bossDefeated === true, "stats flag bossDefeated");
expect(g.zoneIdx === 5, `victory inside the final zone (${g.zoneIdx}/6)`);
log(`  score=${lastStats.score} kills=${lastStats.kills} waves=${lastStats.wavesCleared}`);

/* ---------- phase 2: retry from victory ---------- */
game.startGame();
expect(mode === "playing", "retry after victory starts a new run");
expect(g.boss === null && g.bossState === "none" && g.shockwaves.length === 0, "boss state fully reset");
expect(!g.enemies.some((e: { kind: string }) => e.kind === "boss"), "no boss in new run");

/* ---------- phase 3: player death during boss → gameover, no crash ---------- */
// fast-forward to the boss again
steps = 0;
while (mode === "playing" && g.waveState !== "boss" && steps < 200000) {
  steps++;
  const zoneEnd = (g.zoneIdx as number + 1) * 960;
  if (g.waveState === "go") g.player.x = zoneEnd - 85;
  for (const e of g.enemies) if (e.kind !== "boss") { e.hp = 0; e.dead = true; e.gone = true; }
  g.spawnQueue.length = 0;
  game.frame(1 / 60);
}
expect(g.waveState === "boss", "second run reaches the boss");
const boss2 = g.boss;
expect(boss2 && !boss2.dead, "boss present and alive");
// let the boss beat on an idle player
steps = 0;
while (mode === "playing" && steps < 60000) {
  steps++;
  game.frame(1 / 60);
}
expect(mode === "gameover", `player death → gameover (mode=${mode})`);

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED ✅" : `\n${failures} FAILURES ❌`);
process.exit(failures === 0 ? 0 : 1);
