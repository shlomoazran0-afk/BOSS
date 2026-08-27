/* ============================================================
   RAGE ALLEY — Audio manager
   Real samples: OpenGameArt (CC0 hits / CC-BY synthwave loops).
   Light utility blips (whoosh/jump/pickup/…) are synthesized
   with WebAudio at runtime.
   ============================================================ */

const OGA = "https://opengameart.org/sites/default/files";

export const SFX_URLS: Record<string, string> = {
  hitLight: `${OGA}/hit23.mp3.mp3`,
  hitMid: `${OGA}/hit22.mp3.mp3`,
  hitHeavy: `${OGA}/hit20.mp3.mp3`,
};

export const MUSIC_URLS = {
  menu: `${OGA}/going%5Fundercover-loop1.ogg`,
  game: `${OGA}/hostile%5Fterritory-loop1.ogg`,
  act2: `${OGA}/deadly%5Fcontracts-loop1.ogg`,
};

type SynthName =
  | "whoosh" | "jump" | "land" | "pickup" | "smash" | "special"
  | "ko" | "horn" | "select" | "hurt" | "heal";

export class AudioMan {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pools = new Map<string, HTMLAudioElement[]>();
  private poolIdx = new Map<string, number>();
  private musicA: HTMLAudioElement;
  private musicB: HTMLAudioElement;
  private activeMusic: HTMLAudioElement;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  musicVolume = 0.5;

  constructor() {
    this.musicA = new Audio();
    this.musicB = new Audio();
    this.musicA.loop = true;
    this.musicB.loop = true;
    this.activeMusic = this.musicA;
    // preload SFX pools (3 voices each)
    for (const [name, url] of Object.entries(SFX_URLS)) {
      const els = [0, 1, 2].map(() => {
        const a = new Audio();
        a.src = url;
        a.preload = "auto";
        a.volume = 0.85;
        return a;
      });
      this.pools.set(name, els);
      this.poolIdx.set(name, 0);
    }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch { /* audio unsupported — game continues silently */ }
    }
    this.ctx?.resume().catch(() => {});
    if (this.activeMusic.src) this.activeMusic.play().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
    this.musicA.volume = m ? 0 : this.musicVolume;
    this.musicB.volume = m ? 0 : this.musicVolume;
    for (const els of this.pools.values()) for (const a of els) a.volume = m ? 0 : 0.85;
  }

  playSample(name: keyof typeof SFX_URLS, rate = 1, vol = 1) {
    const els = this.pools.get(name);
    if (!els || els.length === 0) return;
    const i = (this.poolIdx.get(name) ?? 0) % els.length;
    this.poolIdx.set(name, i + 1);
    const a = els[i];
    try {
      a.pause();
      a.currentTime = 0;
      a.playbackRate = rate;
      a.volume = this.muted ? 0 : 0.85 * vol;
      a.play().catch(() => {});
    } catch { /* ignore */ }
  }

  playMusic(kind: "menu" | "game" | "act2") {
    const url = MUSIC_URLS[kind];
    const incoming = this.activeMusic === this.musicA ? this.musicB : this.musicA;
    const outgoing = this.activeMusic;
    if (incoming.src === url || incoming.src.endsWith(url)) return;
    incoming.src = url;
    incoming.volume = 0;
    incoming.play().catch(() => {});
    const target = this.muted ? 0 : this.musicVolume;
    const fade = (el: HTMLAudioElement, to: number) => {
      const step = () => {
        const d = to - el.volume;
        if (Math.abs(d) < 0.02) { el.volume = to; if (to === 0) el.pause(); return; }
        el.volume += d * 0.08;
        requestAnimationFrame(step);
      };
      step();
    };
    fade(incoming, target);
    fade(outgoing, 0);
    this.activeMusic = incoming;
  }

  /* ---------- WebAudio synth blips ---------- */

  synth(name: SynthName) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const env = (peak: number, dur: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      g.connect(this.master!);
      return g;
    };
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      o.connect(env(peak, dur));
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const noise = (dur: number, peak: number, filterFreq: number, type: BiquadFilterType = "bandpass") => {
      if (!this.noiseBuf) return;
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(filterFreq, t);
      f.Q.value = 1.1;
      s.connect(f);
      f.connect(env(peak, dur));
      s.start(t);
      s.stop(t + dur + 0.05);
    };

    switch (name) {
      case "whoosh":
        noise(0.16, 0.25, 1600);
        osc("sine", 900, 240, 0.14, 0.06);
        break;
      case "jump":
        osc("square", 190, 520, 0.16, 0.12);
        break;
      case "land":
        noise(0.1, 0.2, 320, "lowpass");
        break;
      case "pickup":
        osc("square", 660, 660, 0.07, 0.1);
        setTimeout(() => osc("square", 990, 990, 0.1, 0.1), 70);
        break;
      case "heal":
        osc("sine", 520, 780, 0.16, 0.12);
        setTimeout(() => osc("sine", 780, 1040, 0.2, 0.1), 90);
        break;
      case "smash":
        noise(0.28, 0.5, 480, "lowpass");
        osc("triangle", 160, 50, 0.24, 0.22);
        break;
      case "special":
        osc("sawtooth", 90, 720, 0.4, 0.16);
        noise(0.4, 0.3, 900);
        break;
      case "ko":
        osc("sawtooth", 300, 55, 0.5, 0.2);
        noise(0.3, 0.25, 260, "lowpass");
        break;
      case "horn":
        osc("sawtooth", 220, 220, 0.3, 0.12);
        osc("sawtooth", 277, 277, 0.3, 0.1);
        setTimeout(() => { osc("sawtooth", 330, 330, 0.4, 0.13); }, 260);
        break;
      case "select":
        osc("square", 880, 880, 0.06, 0.08);
        break;
      case "hurt":
        osc("square", 220, 90, 0.14, 0.14);
        break;
    }
  }
}
