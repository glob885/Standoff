/* ============================================================
   src/audio.js — процедурный звук на WebAudio:
   выстрелы со «слоями», эхо в лесу, взрывы с рокотом,
   вой сирены, ветер-эмбиент, шаги, гул техники, рация.
   Панорама и громкость считаются от позиции слушателя.
   ============================================================ */
'use strict';

const Audio2 = (() => {

  class Engine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.master = null;
      this.busSfx = null;
      this.busAmb = null;
      this.busMusic = null;
      this.reverb = null;
      this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
      this.loops = new Map();
      this.volume = U.Store.read('volume', 0.8);
      this.muted = U.Store.read('muted', false);
    }

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;

      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      // мягкий лимитер, чтобы залпы не рвали динамики
      this.limiter = c.createDynamicsCompressor();
      this.limiter.threshold.value = -8;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter);
      this.limiter.connect(c.destination);

      this.busSfx = c.createGain(); this.busSfx.gain.value = 1.0; this.busSfx.connect(this.master);
      this.busAmb = c.createGain(); this.busAmb.gain.value = 0.5; this.busAmb.connect(this.master);
      this.busMusic = c.createGain(); this.busMusic.gain.value = 0.55; this.busMusic.connect(this.master);

      // реверб «лес/долина»
      this.reverb = c.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.6, 2.4);
      this.reverbGain = c.createGain();
      this.reverbGain.gain.value = 0.32;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.master);

      this.ready = true;
      this.startAmbience();
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    setVolume(v) {
      this.volume = U.clamp01(v);
      U.Store.write('volume', this.volume);
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    }
    toggleMute() {
      this.muted = !this.muted;
      U.Store.write('muted', this.muted);
      if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
      return this.muted;
    }

    /* ---------- генераторы буферов ---------- */
    makeImpulse(duration, decay) {
      const c = this.ctx;
      const rate = c.sampleRate;
      const len = Math.floor(rate * duration);
      const buf = c.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
        }
      }
      return buf;
    }

    noiseBuffer(dur, curve = 1) {
      const c = this.ctx;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, curve);
      }
      return buf;
    }

    /* ---------- пространственный узел ---------- */
    spatial(pos, refDist = 24, maxDist = 260) {
      const c = this.ctx;
      const g = c.createGain();
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      let vol = 1, panVal = 0;
      if (pos) {
        const dx = pos.x - this.listener.x;
        const dz = pos.z - this.listener.z;
        const dist = Math.hypot(dx, dz);
        vol = U.clamp01(refDist / Math.max(refDist, dist)) * U.clamp01(1 - dist / maxDist);
        vol = Math.pow(vol, 1.2);
        // угол относительно направления взгляда
        const ang = Math.atan2(dx, dz) - this.listener.yaw;
        panVal = U.clamp(-Math.sin(ang), -1, 1);
      }
      g.gain.value = vol;
      if (pan) {
        pan.pan.value = panVal;
        g.connect(pan);
        return { input: g, output: pan, volume: vol };
      }
      return { input: g, output: g, volume: vol };
    }

    connectOut(node, wet = 0.25) {
      node.connect(this.busSfx);
      if (this.reverb && wet > 0) {
        const g = this.ctx.createGain();
        g.gain.value = wet;
        node.connect(g);
        g.connect(this.reverb);
      }
    }

    /* ============================================================
       КОНКРЕТНЫЕ ЗВУКИ
       ============================================================ */

    /* выстрел: щелчок + тело + хвост, с эхом по лесу */
    rifleShot(pos, opts = {}) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const sp = this.spatial(pos, 18, 220);
      if (sp.volume < 0.01) return;
      const gain = opts.gain || 0.5;

      // 1) резкий транзиент
      const click = c.createBufferSource();
      click.buffer = this.noiseBuffer(0.02, 0.4);
      const clickF = c.createBiquadFilter();
      clickF.type = 'highpass'; clickF.frequency.value = 2200;
      const clickG = c.createGain();
      clickG.gain.setValueAtTime(gain * 0.9, t);
      clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      click.connect(clickF); clickF.connect(clickG); clickG.connect(sp.input);
      click.start(t); click.stop(t + 0.06);

      // 2) тело выстрела
      const body = c.createBufferSource();
      body.buffer = this.noiseBuffer(0.18, 2.2);
      const bodyF = c.createBiquadFilter();
      bodyF.type = 'bandpass';
      bodyF.frequency.setValueAtTime(900, t);
      bodyF.frequency.exponentialRampToValueAtTime(280, t + 0.16);
      bodyF.Q.value = 0.9;
      const bodyG = c.createGain();
      bodyG.gain.setValueAtTime(gain, t);
      bodyG.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      body.connect(bodyF); bodyF.connect(bodyG); bodyG.connect(sp.input);
      body.start(t); body.stop(t + 0.22);

      // 3) низ (отдача)
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      const og = c.createGain();
      og.gain.setValueAtTime(gain * 0.55, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(og); og.connect(sp.input);
      osc.start(t); osc.stop(t + 0.16);

      this.connectOut(sp.output, 0.3);

      // 4) эхо по лесу (два отражения)
      if (sp.volume > 0.25 && Math.random() < 0.7) {
        for (let i = 0; i < 2; i++) {
          const delay = 0.14 + i * 0.13 + Math.random() * 0.05;
          const e = c.createBufferSource();
          e.buffer = this.noiseBuffer(0.25, 2.6);
          const ef = c.createBiquadFilter();
          ef.type = 'lowpass'; ef.frequency.value = 900 - i * 250;
          const eg = c.createGain();
          eg.gain.setValueAtTime(0, t + delay);
          eg.gain.linearRampToValueAtTime(gain * (0.22 - i * 0.08) * sp.volume, t + delay + 0.02);
          eg.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.3);
          e.connect(ef); ef.connect(eg); eg.connect(this.busSfx);
          e.start(t + delay); e.stop(t + delay + 0.32);
        }
      }
    }

    /* пулемётный/пушечный выстрел техники */
    cannonShot(pos, power = 1) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const sp = this.spatial(pos, 60, 400);
      if (sp.volume < 0.01) return;

      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(0.5, 1.6);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1800, t);
      f.frequency.exponentialRampToValueAtTime(180, t + 0.35);
      const g = c.createGain();
      g.gain.setValueAtTime(0.9 * power, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      n.connect(f); f.connect(g); g.connect(sp.input);
      n.start(t); n.stop(t + 0.6);

      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(120 * power, t);
      o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
      const og = c.createGain();
      og.gain.setValueAtTime(1.0 * power, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(og); og.connect(sp.input);
      o.start(t); o.stop(t + 0.75);

      this.connectOut(sp.output, 0.45);
    }

    /* взрыв */
    explosion(pos, size = 1) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const sp = this.spatial(pos, 70, 520);
      if (sp.volume < 0.005) return;

      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(1.4, 1.1);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(2400, t);
      f.frequency.exponentialRampToValueAtTime(120, t + 0.9);
      const g = c.createGain();
      g.gain.setValueAtTime(1.1 * size, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      n.connect(f); f.connect(g); g.connect(sp.input);
      n.start(t); n.stop(t + 1.5);

      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90 * size, t);
      sub.frequency.exponentialRampToValueAtTime(26, t + 1.1);
      const sg = c.createGain();
      sg.gain.setValueAtTime(1.2 * size, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      sub.connect(sg); sg.connect(sp.input);
      sub.start(t); sub.stop(t + 1.35);

      this.connectOut(sp.output, 0.6);
    }

    /* вой сирены — главный «голос» босса */
    siren(pos, dur = 3.2, gain = 0.8) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const sp = this.spatial(pos, 120, 700);
      const master = c.createGain();
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(gain, t + 0.4);
      master.gain.setValueAtTime(gain, t + dur - 0.8);
      master.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      master.connect(sp.input);
      this.connectOut(sp.output, 0.8);

      // три расстроенных пилы + квадрат: «механический» вой
      const dets = [0, 7, 12, 19];
      dets.forEach((d, i) => {
        const o = c.createOscillator();
        o.type = i === 3 ? 'square' : 'sawtooth';
        const base = 150 * Math.pow(2, d / 24);
        o.frequency.setValueAtTime(base, t);
        o.frequency.linearRampToValueAtTime(base * 2.3, t + dur * 0.42);
        o.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
        const og = c.createGain();
        og.gain.value = i === 3 ? 0.12 : 0.3 / (i + 1);
        // лёгкое дрожание
        const lfo = c.createOscillator();
        lfo.frequency.value = 4.5 + i;
        const lfoG = c.createGain();
        lfoG.gain.value = base * 0.03;
        lfo.connect(lfoG); lfoG.connect(o.frequency);
        lfo.start(t); lfo.stop(t + dur + 0.1);
        o.connect(og); og.connect(master);
        o.start(t); o.stop(t + dur + 0.05);
      });

      // шумовой «рупорный» слой
      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(dur, 0.6);
      const nf = c.createBiquadFilter();
      nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 1.2;
      const ng = c.createGain(); ng.gain.value = 0.22;
      n.connect(nf); nf.connect(ng); ng.connect(master);
      n.start(t); n.stop(t + dur);
    }

    /* шаг гиганта */
    stomp(pos, power = 1) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const sp = this.spatial(pos, 50, 400);
      if (sp.volume < 0.01) return;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70 * power, t);
      o.frequency.exponentialRampToValueAtTime(24, t + 0.45);
      const g = c.createGain();
      g.gain.setValueAtTime(0.9 * power, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g); g.connect(sp.input);
      o.start(t); o.stop(t + 0.62);
      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(0.3, 2.0);
      const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 400;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.4, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      n.connect(nf); nf.connect(ng); ng.connect(sp.input);
      n.start(t); n.stop(t + 0.32);
      this.connectOut(sp.output, 0.5);
    }

    /* шаг игрока */
    footstep(gain = 0.2) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(0.12, 3);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = U.rand(320, 700);
      f.Q.value = 0.7;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      n.connect(f); f.connect(g); g.connect(this.busSfx);
      n.start(t); n.stop(t + 0.14);
    }

    /* попадание по плоти / металлу */
    impact(pos, kind = 'flesh') {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const sp = this.spatial(pos, 16, 90);
      if (sp.volume < 0.02) return;
      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(kind === 'metal' ? 0.14 : 0.1, 2.4);
      const f = c.createBiquadFilter();
      if (kind === 'metal') { f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 3; }
      else { f.type = 'lowpass'; f.frequency.value = 800; }
      const g = c.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      n.connect(f); f.connect(g); g.connect(sp.input);
      n.start(t); n.stop(t + 0.16);
      this.connectOut(sp.output, 0.15);
    }

    /* перезарядка: щелчки */
    reloadSound() {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const times = [0, 0.28, 0.75, 1.1];
      times.forEach((dt, i) => {
        const n = c.createBufferSource();
        n.buffer = this.noiseBuffer(0.06, 3);
        const f = c.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1800 + i * 400; f.Q.value = 4;
        const g = c.createGain();
        g.gain.setValueAtTime(0.35, t + dt);
        g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.07);
        n.connect(f); f.connect(g); g.connect(this.busSfx);
        n.start(t + dt); n.stop(t + dt + 0.08);
      });
    }

    /* радио-фраза: шум + «морзе» речи, полосовой фильтр */
    radio(dur = 1.2, gain = 0.3) {
      if (!this.ready) return;
      const c = this.ctx, t = c.currentTime;
      const g = c.createGain();
      g.gain.value = gain;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 2.4;
      const dist = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 128) - 1;
        curve[i] = Math.tanh(x * 3);
      }
      dist.curve = curve;
      g.connect(dist); dist.connect(f); f.connect(this.busSfx);

      // щелчок тангенты
      const click = c.createBufferSource();
      click.buffer = this.noiseBuffer(0.04, 2);
      const cg = c.createGain(); cg.gain.value = 0.5;
      click.connect(cg); cg.connect(g);
      click.start(t); click.stop(t + 0.05);

      // «речь»
      const steps = Math.floor(dur / 0.09);
      for (let i = 0; i < steps; i++) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = U.rand(90, 220);
        const og = c.createGain();
        const st = t + 0.05 + i * 0.09;
        const amp = Math.random() < 0.25 ? 0 : U.rand(0.1, 0.3);
        og.gain.setValueAtTime(0, st);
        og.gain.linearRampToValueAtTime(amp, st + 0.02);
        og.gain.linearRampToValueAtTime(0, st + 0.085);
        o.connect(og); og.connect(g);
        o.start(st); o.stop(st + 0.09);
      }
      // хвост шума
      const n = c.createBufferSource();
      n.buffer = this.noiseBuffer(dur + 0.2, 1);
      const ng = c.createGain(); ng.gain.value = 0.06;
      n.connect(ng); ng.connect(g);
      n.start(t); n.stop(t + dur + 0.2);
    }

    /* ---------- зацикленные источники ---------- */
    startLoop(id, factory) {
      if (!this.ready || this.loops.has(id)) return this.loops.get(id);
      const nodes = factory(this.ctx);
      this.loops.set(id, nodes);
      return nodes;
    }
    stopLoop(id) {
      const n = this.loops.get(id);
      if (!n) return;
      try { n.stop && n.stop(); } catch (e) { /* нет */ }
      this.loops.delete(id);
    }

    /* эмбиент: ветер + далёкий лес */
    startAmbience() {
      if (!this.ready) return;
      this.startLoop('wind', (c) => {
        const src = c.createBufferSource();
        src.buffer = this.noiseBuffer(4, 0);
        src.loop = true;
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 420;
        const g = c.createGain(); g.gain.value = 0.16;
        // медленные «порывы»
        const lfo = c.createOscillator();
        lfo.frequency.value = 0.07;
        const lfoG = c.createGain(); lfoG.gain.value = 0.09;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        lfo.start();
        src.connect(f); f.connect(g); g.connect(this.busAmb);
        src.start();
        return { stop: () => { try { src.stop(); lfo.stop(); } catch (e) { } }, gain: g };
      });
    }

    /* гул вертолёта рядом */
    heliLoop(on) {
      if (!this.ready) return;
      if (on && !this.loops.has('heli')) {
        this.startLoop('heli', (c) => {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = 22;
          const g = c.createGain(); g.gain.value = 0.0;
          const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
          o.connect(f); f.connect(g); g.connect(this.busAmb);
          o.start();
          return { stop: () => { try { o.stop(); } catch (e) { } }, gain: g };
        });
      } else if (!on) this.stopLoop('heli');
    }
    setHeliVolume(v) {
      const l = this.loops.get('heli');
      if (l && l.gain) l.gain.gain.value = U.clamp01(v) * 0.25;
    }

    /* низкий гул присутствия объекта (нарастает вблизи) */
    dreadLoop(on) {
      if (!this.ready) return;
      if (on && !this.loops.has('dread')) {
        this.startLoop('dread', (c) => {
          const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 41;
          const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 61.5;
          const g = c.createGain(); g.gain.value = 0;
          o1.connect(g); o2.connect(g); g.connect(this.busMusic);
          o1.start(); o2.start();
          return { stop: () => { try { o1.stop(); o2.stop(); } catch (e) { } }, gain: g };
        });
      } else if (!on) this.stopLoop('dread');
    }
    setDread(v) {
      const l = this.loops.get('dread');
      if (l && l.gain) l.gain.gain.value = U.clamp01(v) * 0.3;
    }

    /* обновление позиции слушателя */
    setListener(x, y, z, yaw) {
      this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
    }
  }

  return { Engine };
})();
