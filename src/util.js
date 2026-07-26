/* ============================================================
   OPERATION SIREN — v2
   src/util.js — математика, шум, генераторы, пулы, тайминг
   ============================================================ */
'use strict';

const U = (() => {

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ---------------- базовая математика ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b - a === 0 ? 0 : (v - a) / (b - a));
  const remap = (v, a1, b1, a2, b2) => lerp(a2, b2, clamp01(invLerp(a1, b1, v)));
  const smoothstep = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const smootherstep = t => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
  const sign = v => (v < 0 ? -1 : v > 0 ? 1 : 0);
  const sqr = v => v * v;

  /* экспоненциальное сглаживание, независимое от FPS */
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

  /* углы */
  const wrapPi = a => {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  };
  const angleDelta = (a, b) => wrapPi(b - a);
  const angleLerp = (a, b, t) => a + angleDelta(a, b) * t;
  const angleDamp = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

  /* ---------------- случайность ---------------- */
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const randInt = (a, b) => Math.floor(rand(a, b));
  const randSign = () => (Math.random() < 0.5 ? -1 : 1);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const chance = p => Math.random() < p;
  const gauss = (mean = 0, sd = 1) => {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  /* случайная точка в круге (равномерно) */
  const randInDisc = (r) => {
    const a = rand(TAU), rr = Math.sqrt(Math.random()) * r;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
  };
  const randOnRing = (r0, r1) => {
    const a = rand(TAU), rr = Math.sqrt(lerp(sqr(r0 / r1), 1, Math.random())) * r1;
    return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
  };

  /* детерминированный ГПСЧ (mulberry32) — для повторяемых миров */
  function makeRNG(seed) {
    let a = seed >>> 0;
    const f = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (lo, hi) => Math.floor(f.range(lo, hi));
    f.pick = arr => arr[Math.floor(f() * arr.length)];
    f.chance = p => f() < p;
    f.sign = () => (f() < 0.5 ? -1 : 1);
    return f;
  }

  /* ---------------- value-noise / fbm ---------------- */
  function makeNoise(seed = 1337) {
    const rng = makeRNG(seed);
    const P = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i + 1);
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];

    const grad2 = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
        case 4: return x; case 5: return -x; case 6: return y; default: return -y;
      }
    };
    /* перлиноподобный 2D-шум в диапазоне ~[-1,1] */
    function noise2(x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = smootherstep(xf), v = smootherstep(yf);
      const aa = P[P[X] + Y], ab = P[P[X] + Y + 1];
      const ba = P[P[X + 1] + Y], bb = P[P[X + 1] + Y + 1];
      const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
      const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
      return lerp(x1, x2, v);
    }
    function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += amp * noise2(x * freq, y * freq);
        norm += amp;
        amp *= gain; freq *= lacunarity;
      }
      return sum / (norm || 1);
    }
    function ridged(x, y, octaves = 4) {
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < octaves; i++) {
        const n = 1 - Math.abs(noise2(x * freq, y * freq));
        sum += amp * n * n; norm += amp;
        amp *= 0.5; freq *= 2.1;
      }
      return sum / (norm || 1);
    }
    return { noise2, fbm, ridged };
  }

  /* ---------------- easing ---------------- */
  const Ease = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => t * (2 - t),
    inOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    inCubic: t => t * t * t,
    outCubic: t => (--t) * t * t + 1,
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    outQuint: t => 1 + (--t) * t * t * t * t,
    outExpo: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inExpo: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => {
      const c4 = TAU / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2
  };

  /* ---------------- пул объектов ---------------- */
  class Pool {
    constructor(factory, reset, initial = 0) {
      this.factory = factory; this.reset = reset;
      this.free = []; this.used = new Set();
      for (let i = 0; i < initial; i++) this.free.push(factory());
    }
    get() {
      const o = this.free.length ? this.free.pop() : this.factory();
      this.used.add(o);
      return o;
    }
    put(o) {
      if (!this.used.has(o)) return;
      this.used.delete(o);
      if (this.reset) this.reset(o);
      this.free.push(o);
    }
    get active() { return this.used.size; }
  }

  /* ---------------- пространственная сетка ---------------- */
  class Grid {
    constructor(cell = 12) { this.cell = cell; this.map = new Map(); }
    key(x, z) { return ((Math.floor(x / this.cell)) * 73856093) ^ ((Math.floor(z / this.cell)) * 19349663); }
    clear() { this.map.clear(); }
    insert(obj) {
      const k = this.key(obj.x, obj.z);
      let a = this.map.get(k);
      if (!a) { a = []; this.map.set(k, a); }
      a.push(obj);
    }
    query(x, z, r, out) {
      out = out || [];
      out.length = 0;
      const c = this.cell, r2 = r * r;
      const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
      const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = (ix * 73856093) ^ (iz * 19349663);
          const a = this.map.get(k);
          if (!a) continue;
          for (let i = 0; i < a.length; i++) {
            const o = a[i];
            const dx = o.x - x, dz = o.z - z;
            if (dx * dx + dz * dz <= r2) out.push(o);
          }
        }
      }
      return out;
    }
  }

  /* ---------------- таймеры / твины ---------------- */
  class Timeline {
    constructor() { this.items = []; this.t = 0; }
    at(time, fn) { this.items.push({ time, fn, done: false }); return this; }
    after(delay, fn) { return this.at((this.items.length ? this.items[this.items.length - 1].time : 0) + delay, fn); }
    reset() { this.t = 0; for (const i of this.items) i.done = false; }
    update(dt) {
      this.t += dt;
      for (const i of this.items) {
        if (!i.done && this.t >= i.time) { i.done = true; i.fn(); }
      }
      return this.items.every(i => i.done);
    }
  }

  class Tween {
    constructor() { this.list = []; }
    to(obj, key, target, dur, ease = Ease.inOutQuad, onDone) {
      this.list.push({ obj, key, from: obj[key], to: target, dur, t: 0, ease, onDone });
    }
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const tw = this.list[i];
        tw.t += dt;
        const k = clamp01(tw.t / tw.dur);
        tw.obj[tw.key] = lerp(tw.from, tw.to, tw.ease(k));
        if (k >= 1) { this.list.splice(i, 1); if (tw.onDone) tw.onDone(); }
      }
    }
    clear() { this.list.length = 0; }
  }

  /* ---------------- сглаженное значение (для HUD/камеры) ---------------- */
  class Smooth {
    constructor(v = 0, lambda = 8) { this.v = v; this.target = v; this.lambda = lambda; }
    set(v) { this.target = v; }
    snap(v) { this.v = this.target = v; }
    update(dt) { this.v = damp(this.v, this.target, this.lambda, dt); return this.v; }
  }

  /* ---------------- измеритель FPS + авто-качество ---------------- */
  class PerfMonitor {
    constructor() {
      this.frames = 0; this.acc = 0; this.fps = 60;
      this.history = []; this.sampleTime = 0.5;
    }
    tick(dt) {
      this.frames++; this.acc += dt;
      if (this.acc >= this.sampleTime) {
        this.fps = this.frames / this.acc;
        this.history.push(this.fps);
        if (this.history.length > 20) this.history.shift();
        this.frames = 0; this.acc = 0;
        return true;
      }
      return false;
    }
    avg(n = 6) {
      const h = this.history.slice(-n);
      if (!h.length) return this.fps;
      return h.reduce((a, b) => a + b, 0) / h.length;
    }
  }

  /* ---------------- вспомогательное ---------------- */
  const fmtTime = sec => {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  };
  const nowMs = () => (performance && performance.now ? performance.now() : Date.now());

  const isMobile = () =>
    matchMedia('(pointer:coarse)').matches ||
    'ontouchstart' in window ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  /* определение "слабого" устройства для авто-качества */
  const guessTier = () => {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    if (isMobile()) {
      if (mem <= 3 || cores <= 4) return 'low';
      return 'medium';
    }
    if (mem >= 8 && cores >= 8) return 'high';
    return 'medium';
  };

  /* сохранение настроек/прогресса */
  const Store = {
    read(key, def) {
      try {
        const v = localStorage.getItem('siren_' + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    write(key, val) {
      try { localStorage.setItem('siren_' + key, JSON.stringify(val)); } catch (e) { /* игнор */ }
    }
  };

  return {
    TAU, DEG,
    clamp, clamp01, lerp, invLerp, remap, smoothstep, smootherstep, sign, sqr, damp,
    wrapPi, angleDelta, angleLerp, angleDamp,
    rand, randInt, randSign, pick, chance, gauss, randInDisc, randOnRing,
    makeRNG, makeNoise, Ease, Pool, Grid, Timeline, Tween, Smooth, PerfMonitor,
    fmtTime, nowMs, isMobile, guessTier, Store
  };
})();
