import { useEffect, useRef, useState } from "react";
import { Game, VIEW_W, VIEW_H } from "./game/engine";
import type { Mode, GameStats } from "./game/engine";
import { loadAllAssets, SOURCES } from "./game/assets";

const CONTROLS: Array<[string, string[]]> = [
  ["תנועה", ["←↑↓→", "WASD"]],
  ["אגרוף / קומבו", ["Z", "J"]],
  ["בעיטה", ["X", "K"]],
  ["מתקפה מיוחדת", ["C", "L"]],
  ["קפיצה", ["SPACE", "V"]],
  ["השהיה", ["P", "ESC"]],
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-1" dir="ltr">
      {keys.map((k) => (
        <kbd key={k} className="key">{k}</kbd>
      ))}
    </span>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [progress, setProgress] = useState({ loaded: 0, total: 1, label: "" });
  const [stats, setStats] = useState<GameStats>({ score: 0, hiScore: 0, kills: 0, maxCombo: 0, wavesCleared: 0, bossDefeated: false });
  const [credits, setCredits] = useState(false);
  const [muted, setMuted] = useState(false);
  const [scale, setScale] = useState(2);
  const [hintT, setHintT] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const game = new Game({
      onMode: (m, s) => {
        if (cancelled) return;
        setMode(m);
        if (s) setStats(s);
        if (m === "playing") {
          setHintT(true);
          window.setTimeout(() => setHintT(false), 6000);
        }
      },
    });
    gameRef.current = game;
    if (canvasRef.current) game.attach(canvasRef.current);

    (async () => {
      try {
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
      } catch { /* fonts optional */ }
      const assets = await loadAllAssets((loaded, total, label) => {
        if (!cancelled) setProgress({ loaded, total, label });
      });
      if (!cancelled) game.setAssets(assets);
    })();

    const onResize = () => {
      const s = Math.max(1, Math.min(
        Math.floor((window.innerWidth - 16) / VIEW_W),
        Math.floor((window.innerHeight - 16) / VIEW_H)
      ));
      setScale(s);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const g = () => gameRef.current;
  const inGame = mode === "playing" || mode === "paused";

  return (
    <div className="h-full w-full flex items-center justify-center bg-night scanlines vignette relative overflow-hidden">
      {/* ambient page glow behind the cabinet */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 40% at 20% 0%, rgba(255,45,120,0.10), transparent 70%), radial-gradient(50% 35% at 85% 100%, rgba(41,230,255,0.08), transparent 70%)",
        }}
      />
      {/* cabinet */}
      <div
        className="relative"
        style={{ width: VIEW_W * scale, height: VIEW_H * scale }}
      >
        <canvas
          ref={canvasRef}
          className="pixelated block w-full h-full"
          style={{ imageRendering: "pixelated" }}
        />

        {/* ══ LOADING ══ */}
        {mode === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-night/95 z-50" dir="rtl">
            <div className="font-pixel text-neon-cyan text-[10px] anim-flicker">RAGE ALLEY</div>
            <h1 className="font-display text-4xl neon-text-pink">סמטת הזעם</h1>
            <div className="w-64">
              <div className="flex justify-between text-xs text-[#8a86a8] mb-1 font-body">
                <span>טוען נכסים…</span>
                <span dir="ltr" className="font-pixel text-[8px]">{progress.loaded}/{progress.total}</span>
              </div>
              <div className="h-3 bg-[#171326] border border-[#3a3355] panel-cut overflow-hidden">
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    width: `${(progress.loaded / progress.total) * 100}%`,
                    background: "linear-gradient(90deg, #ff2d78, #ffb02e)",
                  }}
                />
              </div>
              <div className="text-[11px] text-[#5a5678] mt-2 text-center font-body">{progress.label}</div>
            </div>
          </div>
        )}

        {/* ══ ATTRACT / MENU ══ */}
        {mode === "attract" && (
          <div className="absolute inset-0 z-30 menu-rain" dir="rtl">
            {/* marquee — top right */}
            <div className="absolute top-[5%] right-[4%] text-right anim-marquee">
              <div className="font-pixel text-[9px] text-neon-amber tracking-widest mb-2" dir="ltr">
                ★ STREET BRAWL ★
              </div>
              <h1 className="font-display leading-[0.95] text-neon-pink neon-text-pink anim-flicker"
                  style={{ fontSize: Math.max(34, scale * 26) }}>
                סמטת<br />הזעם
              </h1>
              <div className="mt-2 text-[12px] text-[#b8b4d0] font-body font-medium">
                שתי מערכות · שישה אזורים · גלי בריונים — ובסוף מחכה <span className="text-neon-pink font-bold">אדון הסערה</span>
              </div>
            </div>

            {/* controls panel — bottom left */}
            <div className="absolute bottom-[6%] left-[3%] panel-cut bg-panel/90 border border-[#3a3355] p-3 anim-slide-up anim-slide-up-1"
                 style={{ width: Math.max(230, scale * 130) }}>
              <div className="font-display text-neon-cyan text-sm mb-2 neon-text-cyan">בקרות</div>
              <div className="space-y-1.5">
                {CONTROLS.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between gap-2 text-[11px] text-[#c8c4e0]">
                    <span>{label}</span>
                    <Keys keys={keys} />
                  </div>
                ))}
              </div>
            </div>

            {/* start prompt — bottom right */}
            <div className="absolute bottom-[7%] right-[4%] text-right anim-slide-up anim-slide-up-2">
              <button
                onClick={() => g()?.startGame()}
                className="btn-arcade block w-full text-right text-lg text-night bg-neon-amber panel-cut px-6 py-2.5 font-display"
                style={{ boxShadow: "0 0 26px rgba(255,176,46,0.35)" }}
              >
                התחל קרב
              </button>
              <div className="mt-2 font-pixel text-[8px] text-[#8dff5a] anim-blink" dir="ltr">
                PRESS ENTER
              </div>
              <div className="mt-3 flex gap-2 justify-start">
                <button
                  onClick={() => setCredits(true)}
                  className="btn-arcade text-[11px] text-neon-cyan border border-[#1d4a55] bg-[#0a1a22]/80 px-3 py-1.5 panel-cut font-body font-bold"
                >
                  מקורות וקרדיטים
                </button>
                <button
                  onClick={() => { const m = !muted; setMuted(m); g()?.audio.setMuted(m); }}
                  className="btn-arcade text-[11px] text-[#c8c4e0] border border-[#3a3355] bg-[#171326]/80 px-3 py-1.5 panel-cut font-body font-bold"
                >
                  {muted ? "הפעל סאונד" : "השתק"}
                </button>
              </div>
              <div className="mt-2 text-[10px] text-[#5a5678] font-body">
                נבנה עם נכסים חופשיים · CC0 / CC-BY · הקרדיטים בפנים
              </div>
            </div>
          </div>
        )}

        {/* ══ PLAY HINT ══ */}
        {inGame && hintT && mode === "playing" && (
          <div className="absolute bottom-2 inset-x-0 flex justify-center z-20 pointer-events-none" dir="rtl">
            <div className="bg-night/75 border border-[#3a3355] px-3 py-1 text-[10px] text-[#c8c4e0] font-body panel-cut anim-slide-up">
              <span className="text-neon-amber font-bold">Z</span> אגרוף ·{" "}
              <span className="text-neon-amber font-bold">X</span> בעיטה ·{" "}
              <span className="text-neon-cyan font-bold">רווח</span> קפיצה ·{" "}
              <span className="text-neon-pink font-bold">C</span> מיוחד כשהמד מלא · שבור פחים לחיים וניקוד
            </div>
          </div>
        )}

        {/* ══ PAUSE ══ */}
        {mode === "paused" && (
          <div className="absolute inset-0 z-30 bg-night/80 flex flex-col items-center justify-center gap-4 anim-slide-up" dir="rtl">
            <h2 className="font-display text-4xl neon-text-cyan text-neon-cyan">השהיה</h2>
            <div className="flex flex-col gap-2 w-48">
              <button onClick={() => g()?.togglePause()}
                className="btn-arcade bg-neon-amber text-night font-display py-2 panel-cut">
                המשך (P)
              </button>
              <button onClick={() => setCredits(true)}
                className="btn-arcade border border-[#1d4a55] text-neon-cyan font-body font-bold text-sm py-2 panel-cut bg-[#0a1a22]/70">
                מקורות וקרדיטים
              </button>
              <button onClick={() => { const m = !muted; setMuted(m); g()?.audio.setMuted(m); }}
                className="btn-arcade border border-[#3a3355] text-[#c8c4e0] font-body font-bold text-sm py-2 panel-cut bg-[#171326]/70">
                {muted ? "הפעל סאונד" : "השתק"}
              </button>
              <button onClick={() => g()?.backToMenu()}
                className="btn-arcade border border-[#55243a] text-neon-pink font-body font-bold text-sm py-2 panel-cut bg-[#22101a]/70">
                חזרה לתפריט
              </button>
            </div>
          </div>
        )}

        {/* ══ GAME OVER ══ */}
        {mode === "gameover" && (
          <div className="absolute inset-0 z-30 bg-[#12040a]/85 flex flex-col items-center justify-center gap-3" dir="rtl">
            <div className="font-pixel text-[12px] text-blood anim-flicker" dir="ltr">K.O.</div>
            <h2 className="font-display text-5xl neon-text-pink text-neon-pink anim-slide-up">הופלת!</h2>
            <div className="text-[#c8c4e0] text-sm font-body anim-slide-up anim-slide-up-1">הסמטה ניצחה הפעם. קום ותחזור חזק יותר.</div>
            <StatsRow stats={stats} />
            <div className="flex gap-3 mt-2 anim-slide-up anim-slide-up-2">
              <button onClick={() => g()?.startGame()}
                className="btn-arcade bg-neon-pink text-white font-display px-6 py-2 panel-cut"
                style={{ boxShadow: "0 0 24px rgba(255,45,120,0.4)" }}>
                נסה שוב (ENTER)
              </button>
              <button onClick={() => g()?.backToMenu()}
                className="btn-arcade border border-[#3a3355] text-[#c8c4e0] font-body font-bold px-4 py-2 panel-cut bg-[#171326]/80">
                תפריט
              </button>
            </div>
          </div>
        )}

        {/* ══ VICTORY ══ */}
        {mode === "victory" && (
          <div className="absolute inset-0 z-30 bg-[#04120a]/85 flex flex-col items-center justify-center gap-3" dir="rtl">
            <div className="font-pixel text-[10px] text-toxic" dir="ltr">★ VICTORY ★</div>
            <h2 className="font-display text-5xl neon-text-cyan text-neon-cyan anim-slide-up">הרחוב שלך!</h2>
            <div className="text-[#c8c4e0] text-sm font-body anim-slide-up anim-slide-up-1">
              מהסמטה ועד הרובע התעשייתי — ששת האזורים נוקו ואדון הסערה מוטל ברחוב. העיר שוב שלך.
            </div>
            <StatsRow stats={stats} victory />
            <div className="flex gap-3 mt-2 anim-slide-up anim-slide-up-2">
              <button onClick={() => g()?.startGame()}
                className="btn-arcade bg-toxic text-night font-display px-6 py-2 panel-cut"
                style={{ boxShadow: "0 0 24px rgba(141,255,90,0.35)" }}>
                סיבוב נוסף (ENTER)
              </button>
              <button onClick={() => g()?.backToMenu()}
                className="btn-arcade border border-[#3a3355] text-[#c8c4e0] font-body font-bold px-4 py-2 panel-cut bg-[#171326]/80">
                תפריט
              </button>
            </div>
          </div>
        )}

        {/* ══ CREDITS MODAL ══ */}
        {credits && (
          <div className="absolute inset-0 z-50 bg-night/92 flex items-center justify-center p-4" dir="rtl">
            <div className="panel-cut bg-panel border border-[#3a3355] max-w-xl w-full max-h-full overflow-y-auto p-4 anim-slide-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-xl neon-text-cyan text-neon-cyan">מקורות וקרדיטים</h3>
                <button onClick={() => setCredits(false)}
                  className="btn-arcade text-[#c8c4e0] border border-[#3a3355] px-2.5 py-1 text-sm panel-cut bg-[#171326]">
                  סגור ✕
                </button>
              </div>
              <p className="text-[11px] text-[#8a86a8] font-body mb-3">
                כל הוויזואל במשחק — דמויות, רקע, נשקים, אביזרים — מבוסס אך ורק על נכסים חופשיים קיימים:
              </p>
              <ul className="space-y-2.5">
                {SOURCES.map((s) => (
                  <li key={s.what} className="border border-[#2a2440] bg-[#0d0b18] p-2.5 panel-cut">
                    <div className="text-[12px] text-[#e8e4f2] font-body font-bold leading-snug">{s.what}</div>
                    <div className="text-[11px] text-[#8a86a8] font-body mt-0.5">
                      {s.author} · <span className="text-neon-amber">{s.license}</span>
                    </div>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" dir="ltr"
                        className="text-[10px] text-neon-cyan hover:text-white underline underline-offset-2 break-all font-body">
                        {s.url}
                      </a>
                    )}
                    {s.note && <div className="text-[10px] text-[#5a5678] font-body mt-0.5">{s.note}</div>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsRow({ stats, victory }: { stats: GameStats; victory?: boolean }) {
  const items: Array<[string, string, string]> = [
    ["ניקוד", String(stats.score).padStart(7, "0"), "#ffb02e"],
    ["שיא", String(Math.max(stats.hiScore, stats.score)).padStart(7, "0"), "#8a86a8"],
    ["חיסולים", String(stats.kills), "#ff4757"],
    ["קומבו מקסימלי", String(stats.maxCombo) + "×", "#ff2d78"],
    ["גלים", String(stats.wavesCleared), "#29e6ff"],
  ];
  if (victory && stats.bossDefeated) items.push(["אדון הסערה", "הובס ⚔", "#ff5a3d"]);
  return (
    <div className="flex flex-wrap justify-center gap-2 mt-1" dir="rtl">
      {items.map(([label, val, color]) => (
        <div key={label} className="panel-cut bg-panel/90 border border-[#2a2440] px-3 py-2 text-center min-w-[86px]">
          <div className="text-[10px] text-[#8a86a8] font-body">{label}</div>
          <div className="font-pixel text-[10px] mt-1" dir="ltr" style={{ color: victory && label === "ניקוד" ? "#8dff5a" : color }}>
            {val}
          </div>
        </div>
      ))}
    </div>
  );
}
