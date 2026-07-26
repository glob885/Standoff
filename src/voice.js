/* ============================================================
   src/voice.js — голоса персонажей.

   Два движка:
   1) FormantVoice — процедурная «речь» на WebAudio: формантный
      синтез гласных + шумовые согласные, ритм берётся из самого
      русского текста. Звучит как переговоры по рации, работает
      везде и не требует голосовых пакетов.
   2) TTSVoice — системный синтез речи (SpeechSynthesis) с
      русским голосом, если он есть в устройстве.

   Сверху — VoiceDirector: очередь реплик, приоритеты, кулдауны,
   «кто говорит» (командир, боец, штаб), радио-обработка и
   синхронные субтитры.
   ============================================================ */
'use strict';

const Voice = (() => {

  /* ------------------------------------------------------------
     ФОРМАНТЫ РУССКИХ ГЛАСНЫХ (F1, F2, F3) и их «раскрытость»
     ------------------------------------------------------------ */
  const VOWELS = {
    'а': { f: [700, 1220, 2600], open: 1.00 },
    'я': { f: [660, 1800, 2600], open: 0.95 },
    'о': { f: [520, 900, 2500], open: 0.85 },
    'ё': { f: [500, 1500, 2500], open: 0.85 },
    'у': { f: [320, 720, 2400], open: 0.70 },
    'ю': { f: [320, 1650, 2400], open: 0.70 },
    'э': { f: [530, 1800, 2500], open: 0.90 },
    'е': { f: [430, 2000, 2600], open: 0.88 },
    'и': { f: [300, 2280, 3000], open: 0.75 },
    'ы': { f: [330, 1500, 2400], open: 0.72 }
  };

  /* согласные: тип возбуждения и яркость */
  const CONSONANTS = {
    /* взрывные */
    'п': { kind: 'plosive', bright: 0.5, voiced: false },
    'б': { kind: 'plosive', bright: 0.4, voiced: true },
    'т': { kind: 'plosive', bright: 0.85, voiced: false },
    'д': { kind: 'plosive', bright: 0.6, voiced: true },
    'к': { kind: 'plosive', bright: 0.7, voiced: false },
    'г': { kind: 'plosive', bright: 0.45, voiced: true },
    /* фрикативы */
    'с': { kind: 'fric', bright: 1.0, voiced: false },
    'з': { kind: 'fric', bright: 0.8, voiced: true },
    'ш': { kind: 'fric', bright: 0.65, voiced: false },
    'ж': { kind: 'fric', bright: 0.55, voiced: true },
    'щ': { kind: 'fric', bright: 0.75, voiced: false },
    'ф': { kind: 'fric', bright: 0.7, voiced: false },
    'в': { kind: 'fric', bright: 0.5, voiced: true },
    'х': { kind: 'fric', bright: 0.6, voiced: false },
    'ц': { kind: 'fric', bright: 0.95, voiced: false },
    'ч': { kind: 'fric', bright: 0.8, voiced: false },
    /* сонорные */
    'м': { kind: 'nasal', bright: 0.25, voiced: true },
    'н': { kind: 'nasal', bright: 0.3, voiced: true },
    'л': { kind: 'liquid', bright: 0.35, voiced: true },
    'р': { kind: 'trill', bright: 0.45, voiced: true },
    'й': { kind: 'liquid', bright: 0.5, voiced: true }
  };

  const isVowel = ch => Object.prototype.hasOwnProperty.call(VOWELS, ch);
  const isConsonant = ch => Object.prototype.hasOwnProperty.call(CONSONANTS, ch);

  /* ------------------------------------------------------------
     РАЗБОР ТЕКСТА НА «ФОНЕМЫ»
     ------------------------------------------------------------ */
  function parsePhonemes(text) {
    const out = [];
    const s = text.toLowerCase();
    let wordIndex = 0;
    let syllablesInWord = 0;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (isVowel(ch)) {
        out.push({ type: 'v', ch, word: wordIndex, idx: syllablesInWord++ });
      } else if (isConsonant(ch)) {
        out.push({ type: 'c', ch, word: wordIndex });
      } else if (ch === ' ') {
        out.push({ type: 'gap', len: 0.09, word: wordIndex });
        wordIndex++; syllablesInWord = 0;
      } else if (',' === ch || ';' === ch || ':' === ch || '—' === ch || '-' === ch) {
        out.push({ type: 'gap', len: 0.2, word: wordIndex });
      } else if ('.!?…'.includes(ch)) {
        out.push({ type: 'gap', len: 0.34, word: wordIndex, sentenceEnd: true });
      } else if (ch === 'ь' || ch === 'ъ') {
        // мягкий/твёрдый знак — слегка меняет предыдущий согласный
        const prev = out[out.length - 1];
        if (prev && prev.type === 'c') prev.soft = true;
      }
    }
    // ударение: грубая эвристика — предпоследний слог слова
    const byWord = new Map();
    for (const p of out) {
      if (p.type !== 'v') continue;
      if (!byWord.has(p.word)) byWord.set(p.word, []);
      byWord.get(p.word).push(p);
    }
    for (const [, arr] of byWord) {
      if (!arr.length) continue;
      const stressIdx = arr.length === 1 ? 0 : Math.max(0, arr.length - 2);
      arr[stressIdx].stress = true;
    }
    return out;
  }

  /* ------------------------------------------------------------
     ПРОФИЛИ ГОЛОСОВ
     ------------------------------------------------------------ */
  const PROFILES = {
    commander: {
      pitch: 96, jitter: 0.03, rate: 1.0, breath: 0.10, radio: 0.85,
      formantShift: 0.94, growl: 0.35, gain: 0.9
    },
    soldier: {
      pitch: 118, jitter: 0.05, rate: 1.08, breath: 0.16, radio: 0.9,
      formantShift: 1.0, growl: 0.2, gain: 0.8
    },
    soldierYoung: {
      pitch: 142, jitter: 0.07, rate: 1.16, breath: 0.2, radio: 0.9,
      formantShift: 1.08, growl: 0.12, gain: 0.78
    },
    soldierDeep: {
      pitch: 86, jitter: 0.03, rate: 0.95, breath: 0.12, radio: 0.88,
      formantShift: 0.9, growl: 0.4, gain: 0.85
    },
    hq: {
      pitch: 108, jitter: 0.02, rate: 0.98, breath: 0.05, radio: 1.0,
      formantShift: 0.97, growl: 0.1, gain: 0.85
    },
    pilot: {
      pitch: 126, jitter: 0.04, rate: 1.12, breath: 0.12, radio: 1.0,
      formantShift: 1.02, growl: 0.15, gain: 0.8
    },
    /* «оно» — имитация человеческого голоса объектом: почти правильно, но неправильно */
    entity: {
      pitch: 104, jitter: 0.22, rate: 0.82, breath: 0.3, radio: 0.35,
      formantShift: 0.8, growl: 0.75, gain: 1.0, detune: true
    }
  };

  /* ============================================================
     ФОРМАНТНЫЙ СИНТЕЗАТОР
     ============================================================ */
  class FormantVoice {
    constructor(audio) {
      this.audio = audio;               // Audio2.Engine
      this.active = [];
    }
    get ctx() { return this.audio.ctx; }

    /* цепочка «рации»: полосовой фильтр + мягкое искажение + шум эфира */
    makeRadioChain(amount) {
      const c = this.ctx;
      const input = c.createGain();
      const output = c.createGain();

      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 250 + amount * 250;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200 - amount * 2000;
      const peak = c.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 1800;
      peak.gain.value = amount * 8;
      peak.Q.value = 1.1;

      const shaper = c.createWaveShaper();
      const curve = new Float32Array(1024);
      const drive = 1 + amount * 4;
      for (let i = 0; i < 1024; i++) {
        const x = (i / 512) - 1;
        curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
      }
      shaper.curve = curve;

      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -22;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.12;

      input.connect(hp); hp.connect(peak); peak.connect(shaper);
      shaper.connect(lp); lp.connect(comp); comp.connect(output);
      return { input, output };
    }

    /* короткий щелчок тангенты рации */
    squelch(t, dest, gain = 0.25) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.audio.noiseBuffer(0.035, 2.2);
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 1.4;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t); src.stop(t + 0.05);
    }

    /* фоновый шип эфира на время фразы */
    hiss(t, dur, dest, gain = 0.035) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.audio.noiseBuffer(Math.max(0.3, dur), 0);
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.03);
      g.gain.setValueAtTime(gain, t + dur - 0.05);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t); src.stop(t + dur + 0.1);
    }

    /* один слог: голосовой источник через три форманты */
    speakVowel(t, dur, vowel, prof, dest, contour) {
      const c = this.ctx;
      const V = VOWELS[vowel] || VOWELS['а'];
      const base = prof.pitch * contour.pitchMul;

      // источник: пила + немного шума дыхания
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base * (1 + U.rand(-prof.jitter, prof.jitter)), t);
      // интонация внутри слога
      osc.frequency.linearRampToValueAtTime(base * contour.endMul, t + dur);
      if (prof.detune) {
        // «оно» — второй расстроенный голос
        const osc2 = c.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(base * 1.017, t);
        osc2.frequency.linearRampToValueAtTime(base * contour.endMul * 0.985, t + dur);
        const g2 = c.createGain();
        g2.gain.value = 0.5;
        osc2.connect(g2);
        this._routeFormants(g2, t, dur, V, prof, dest, contour);
        osc2.start(t); osc2.stop(t + dur + 0.02);
      }

      const src = c.createGain();
      src.gain.value = 1;
      osc.connect(src);

      // дыхание
      if (prof.breath > 0.01) {
        const n = c.createBufferSource();
        n.buffer = this.audio.noiseBuffer(dur + 0.05, 0.4);
        const ng = c.createGain();
        ng.gain.value = prof.breath * 0.5;
        n.connect(ng); ng.connect(src);
        n.start(t); n.stop(t + dur + 0.05);
      }

      this._routeFormants(src, t, dur, V, prof, dest, contour);
      osc.start(t); osc.stop(t + dur + 0.02);
    }

    _routeFormants(source, t, dur, V, prof, dest, contour) {
      const c = this.ctx;
      const amp = c.createGain();
      // огибающая слога
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(contour.amp, t + Math.min(0.035, dur * 0.3));
      amp.gain.setValueAtTime(contour.amp, t + dur * 0.6);
      amp.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      amp.connect(dest);

      const gains = [1.0, 0.65, 0.32];
      for (let i = 0; i < 3; i++) {
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        const freq = V.f[i] * prof.formantShift * contour.formantMul;
        f.frequency.setValueAtTime(freq * 0.92, t);
        f.frequency.linearRampToValueAtTime(freq, t + dur * 0.4);
        f.Q.value = 7 + i * 3;
        const g = c.createGain();
        g.gain.value = gains[i] * (1 + prof.growl * (i === 0 ? 0.4 : -0.1));
        source.connect(f); f.connect(g); g.connect(amp);
      }
      // «рычание» — суб-гармоника
      if (prof.growl > 0.2) {
        const sub = c.createBiquadFilter();
        sub.type = 'lowpass';
        sub.frequency.value = 180;
        const sg = c.createGain();
        sg.gain.value = prof.growl * 0.4;
        source.connect(sub); sub.connect(sg); sg.connect(amp);
      }
    }

    /* согласный: шум/взрыв нужной яркости */
    speakConsonant(t, dur, ch, prof, dest) {
      const c = this.ctx;
      const C = CONSONANTS[ch];
      if (!C) return;
      const bright = C.bright * (C.soft ? 1.15 : 1);

      if (C.kind === 'trill') {
        // «р» — быстрая амплитудная модуляция
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = prof.pitch * 0.9;
        const trem = c.createGain();
        trem.gain.setValueAtTime(0, t);
        const steps = 4;
        for (let i = 0; i < steps; i++) {
          trem.gain.linearRampToValueAtTime(0.5, t + (i + 0.3) * dur / steps);
          trem.gain.linearRampToValueAtTime(0.05, t + (i + 1) * dur / steps);
        }
        const f = c.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 900 * prof.formantShift; f.Q.value = 4;
        osc.connect(f); f.connect(trem); trem.connect(dest);
        osc.start(t); osc.stop(t + dur);
        return;
      }

      if (C.kind === 'nasal' || C.kind === 'liquid') {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = prof.pitch * 0.95;
        const f = c.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = (C.kind === 'nasal' ? 700 : 1400) * prof.formantShift;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        osc.connect(f); f.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + dur + 0.01);
        return;
      }

      // взрывные и фрикативы — шум
      const n = c.createBufferSource();
      n.buffer = this.audio.noiseBuffer(dur + 0.02, C.kind === 'plosive' ? 3.5 : 0.6);
      const f = c.createBiquadFilter();
      f.type = C.kind === 'plosive' ? 'highpass' : 'bandpass';
      f.frequency.value = 800 + bright * 4200;
      f.Q.value = C.kind === 'plosive' ? 0.7 : 1.6;
      const g = c.createGain();
      const peak = C.kind === 'plosive' ? 0.5 : 0.3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (C.kind === 'plosive' ? 0.008 : dur * 0.4));
      g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
      n.connect(f); f.connect(g); g.connect(dest);
      n.start(t); n.stop(t + dur + 0.02);

      // звонкость — подмешиваем тон
      if (C.voiced) {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = prof.pitch * 0.8;
        const og = c.createGain();
        og.gain.setValueAtTime(0.14, t);
        og.gain.exponentialRampToValueAtTime(0.0006, t + dur);
        osc.connect(og); og.connect(dest);
        osc.start(t); osc.stop(t + dur + 0.01);
      }
    }

    /* произнести фразу; возвращает длительность в секундах */
    speak(text, profileName, opts = {}) {
      if (!this.audio.ready) return 0;
      const c = this.ctx;
      const prof = PROFILES[profileName] || PROFILES.soldier;
      const phon = parsePhonemes(text);
      const rate = (opts.rate || 1) * prof.rate;
      const urgency = opts.urgency || 0;      // 0..1 — крик в бою
      const t0 = c.currentTime + (opts.delay || 0);

      const radioAmt = opts.radio !== undefined ? opts.radio : prof.radio;
      const chain = this.makeRadioChain(radioAmt);
      const out = c.createGain();
      out.gain.value = (opts.gain || 1) * prof.gain * (1 + urgency * 0.25);
      chain.output.connect(out);

      // пространственное позиционирование, если задана позиция
      if (opts.pos) {
        const sp = this.audio.spatial(opts.pos, 14, 120);
        out.connect(sp.input);
        this.audio.connectOut(sp.output, 0.25);
      } else {
        out.connect(this.audio.busSfx);
        if (this.audio.reverb) {
          const w = c.createGain();
          w.gain.value = 0.18;
          out.connect(w); w.connect(this.audio.reverb);
        }
      }

      let t = t0;
      if (radioAmt > 0.4) this.squelch(t, chain.input, 0.22);
      t += radioAmt > 0.4 ? 0.06 : 0;
      const speechStart = t;

      for (const p of phon) {
        if (p.type === 'gap') {
          t += p.len / rate * (1 - urgency * 0.35);
          continue;
        }
        if (p.type === 'c') {
          const dur = (CONSONANTS[p.ch].kind === 'plosive' ? 0.045 : 0.07) / rate;
          this.speakConsonant(t, dur, p.ch, prof, chain.input);
          t += dur * 0.85;
          continue;
        }
        // гласная = ядро слога
        const stressed = !!p.stress;
        const dur = (stressed ? 0.155 : 0.105) / rate * U.rand(0.9, 1.12);
        const contour = {
          amp: (stressed ? 0.52 : 0.34) * (1 + urgency * 0.5),
          pitchMul: (stressed ? 1.1 : 1.0) * (1 + urgency * 0.18) * U.rand(0.97, 1.03),
          endMul: stressed ? 0.94 : 1.02,
          formantMul: 1 + urgency * 0.05
        };
        this.speakVowel(t, dur, p.ch, prof, chain.input, contour);
        t += dur;
      }
      const dur = t - speechStart;
      this.hiss(t0, dur + 0.15, chain.input, 0.03 * radioAmt);
      if (radioAmt > 0.4) this.squelch(t + 0.06, chain.input, 0.16);

      return dur + 0.15;
    }

    /* нечленораздельные крики: боль, команда, смерть */
    shout(kind, profileName, opts = {}) {
      if (!this.audio.ready) return 0;
      const prof = PROFILES[profileName] || PROFILES.soldier;
      const words = {
        pain: ['аах', 'ах', 'ох'],
        death: ['аааа', 'ааах'],
        effort: ['хэй', 'ха'],
        fear: ['ааа', 'нет']
      };
      const w = U.pick(words[kind] || words.effort);
      return this.speak(w, profileName, Object.assign({ urgency: 1, radio: 0.15, gain: 1.1 }, opts));
    }
  }

  /* ============================================================
     СИСТЕМНЫЙ СИНТЕЗ РЕЧИ (если в устройстве есть русский голос)
     ============================================================ */
  class TTSVoice {
    constructor() {
      this.supported = typeof speechSynthesis !== 'undefined';
      this.voices = [];
      this.ru = null;
      this.enabled = false;
      if (this.supported) {
        const load = () => {
          this.voices = speechSynthesis.getVoices() || [];
          this.ru = this.voices.find(v => /ru[-_]RU/i.test(v.lang)) ||
            this.voices.find(v => /^ru/i.test(v.lang)) || null;
          this.enabled = !!this.ru;
        };
        load();
        if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', load);
        else speechSynthesis.onvoiceschanged = load;
      }
    }
    speak(text, profileName, opts = {}) {
      if (!this.enabled) return 0;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = this.ru;
        u.lang = 'ru-RU';
        const prof = PROFILES[profileName] || PROFILES.soldier;
        u.pitch = U.clamp(prof.pitch / 110, 0.4, 1.8);
        u.rate = U.clamp(prof.rate * (opts.rate || 1) * 1.05, 0.5, 2);
        u.volume = U.clamp01((opts.gain || 1) * 0.9);
        speechSynthesis.speak(u);
        // грубая оценка длительности
        return U.clamp(text.length * 0.062 / u.rate, 0.6, 12);
      } catch (e) { return 0; }
    }
    cancel() { if (this.supported) try { speechSynthesis.cancel(); } catch (e) { } }
  }

  /* ============================================================
     БИБЛИОТЕКА РЕПЛИК
     ============================================================ */
  const LINES = {
    /* приказы командира */
    advance: [
      'Отряд, вперёд. Держим строй.',
      'Двигаемся на север. Дистанция три метра.',
      'Первый фланг, не отставать.'
    ],
    holdFlank: [
      'Держать фланги!',
      'Прикрой левый, я справа!',
      'Не разбегаться, работаем строем!'
    ],
    contact: [
      'Контакт! Цель прямо по курсу!',
      'Вижу его! Огонь!',
      'Он здесь! Все стволы на цель!'
    ],
    scream: [
      'Он кричит! Уши берегите!',
      'Бей в динамики, он открыт!',
      'Сейчас будет волна, к земле!'
    ],
    huskSpawn: [
      'Он кого-то зовёт!',
      'Движение справа, их много!',
      'Твари прут со всех сторон!'
    ],
    manDown: [
      'Человек упал!',
      'Минус один, прикройте меня!',
      'Триста! У нас двухсотый!'
    ],
    vehicleLost: [
      'Танк горит!',
      'Мы потеряли машину!',
      'Экипаж, уходите оттуда!'
    ],
    tankFire: [
      'Танк, беглый огонь!',
      'Работай по нему!',
      'Броня, добивай!'
    ],
    reload: [
      'Перезарядка!',
      'Меняю магазин, прикрой!',
      'Сухой! Секунду!'
    ],
    kill: [
      'Минус один!',
      'Готов!',
      'Цель поражена!'
    ],
    hurt: [
      'Меня задело!',
      'Я ранен, держусь!',
      'Кровит, но живой!'
    ],
    phase2: [
      'Он ускоряется! Дистанцию держать!',
      'Смотри в оба, он злее стал!'
    ],
    phase3: [
      'Он озверел! Бей по башке!',
      'Последний рывок, дожимаем!'
    ],
    bossDown: [
      'Цель нейтрализована!',
      'Он падает! Мы сделали это!',
      'Отбой. Объект уничтожен.'
    ],
    /* «голоса» самого объекта — приманка */
    lure: [
      'помогите...',
      'я здесь... сюда...',
      'не стреляйте, я свой...',
      'кто здесь?...',
      'ребята, вы где?...'
    ],
    /* штаб */
    hq: [
      'Единица ε-одиннадцать, доложите обстановку.',
      'Штаб на связи. Работайте по протоколу.',
      'Подтверждаем: цель класса кетер.'
    ]
  };

  /* ============================================================
     РЕЖИССЁР ГОЛОСОВ
     ============================================================ */
  class VoiceDirector {
    constructor(audio, hud) {
      this.audio = audio;
      this.hud = hud;
      this.formant = new FormantVoice(audio);
      this.tts = new TTSVoice();
      // по умолчанию — системный русский голос (настоящая речь);
      // радио-синтез остаётся запасным вариантом
      const saved = U.Store.read('voiceMode', null);
      this.mode = saved || 'auto';   // auto | radio | tts | off
      this.busyUntil = 0;
      this.cooldowns = new Map();
      this.queue = [];
      this.subtitles = U.Store.read('subs', true);
      this.lastLine = new Map();
      this.time = 0;
      /* каждому бойцу — свой тембр */
      this.profilePool = ['soldier', 'soldierYoung', 'soldierDeep', 'soldier'];
    }

    profileFor(unit) {
      if (!unit) return 'soldier';
      if (unit.isPlayer) return 'soldier';
      if (unit.voiceProfile) return unit.voiceProfile;
      const p = this.profilePool[(unit.index || 0) % this.profilePool.length];
      unit.voiceProfile = p;
      return p;
    }

    setMode(m) {
      this.mode = m;
      U.Store.write('voiceMode', m);
      if (m !== 'tts') this.tts.cancel();
    }
    setSubtitles(on) {
      this.subtitles = on;
      U.Store.write('subs', on);
      if (!on && this.hud) this.hud.subtitle('');
    }

    canSpeak(tag, cooldown) {
      const now = this.time;
      const last = this.cooldowns.get(tag) || -999;
      if (now - last < cooldown) return false;
      if (now < this.busyUntil) return false;
      return true;
    }

    /* основная точка входа: сказать реплику по тегу */
    say(tag, opts = {}) {
      if (this.mode === 'off') return 0;
      const pool = LINES[tag];
      if (!pool) return 0;
      const cooldown = opts.cooldown !== undefined ? opts.cooldown : 6;
      const priority = opts.priority || 0;
      if (!this.canSpeak(tag, cooldown) && priority < 2) return 0;

      // не повторять ту же фразу подряд
      let text = U.pick(pool);
      if (pool.length > 1 && this.lastLine.get(tag) === text) {
        text = U.pick(pool.filter(l => l !== text));
      }
      this.lastLine.set(tag, text);
      return this.speak(text, opts);
    }

    resolveMode() {
      if (this.mode === 'auto') return this.tts.enabled ? 'tts' : 'radio';
      if (this.mode === 'tts' && !this.tts.enabled) return 'radio';
      return this.mode;
    }

    speak(text, opts = {}) {
      if (this.mode === 'off' || !text) return 0;
      const profile = opts.profile || (opts.unit ? this.profileFor(opts.unit) : 'soldier');
      const mode = this.resolveMode();
      let dur = 0;
      if (mode === 'tts') {
        dur = this.tts.speak(text, profile, opts);
      } else {
        dur = this.formant.speak(text, profile, Object.assign({
          pos: opts.unit ? { x: opts.unit.x, z: opts.unit.z } : opts.pos
        }, opts));
      }
      this.busyUntil = this.time + dur * (opts.blocking === false ? 0.35 : 0.85);
      if (opts.tag) this.cooldowns.set(opts.tag, this.time);
      if (this.subtitles && this.hud && opts.subtitle !== false) {
        const who = opts.who || (profile === 'commander' ? 'КОМАНДИР'
          : profile === 'hq' ? 'ШТАБ'
            : profile === 'entity' ? '???' : 'БОЕЦ');
        this.hud.subtitle(`[${who}] ${text}`);
        clearTimeout(this._subT);
        this._subT = setTimeout(() => this.hud.subtitle(''), Math.max(1200, dur * 1000 + 500));
      }
      return dur;
    }

    /* крик боли/смерти конкретного бойца */
    shout(kind, unit, opts = {}) {
      if (this.mode === 'off') return 0;
      if (this.resolveMode() === 'tts') {
        // системный TTS не умеет кричать — используем формантный движок
        return this.formant.shout(kind, this.profileFor(unit),
          Object.assign({ pos: unit ? { x: unit.x, z: unit.z } : null }, opts));
      }
      return this.formant.shout(kind, this.profileFor(unit),
        Object.assign({ pos: unit ? { x: unit.x, z: unit.z } : null }, opts));
    }

    /* приманка объекта — звучит из его позиции, без рации */
    lure(pos) {
      const text = U.pick(LINES.lure);
      const dur = this.formant.speak(text, 'entity', {
        pos, radio: 0.05, gain: 0.9, rate: 0.85, urgency: 0
      });
      if (this.subtitles && this.hud) {
        this.hud.subtitle(`[???] ${text}`);
        clearTimeout(this._subT);
        this._subT = setTimeout(() => this.hud.subtitle(''), dur * 1000 + 800);
      }
      return dur;
    }

    /* реплики командира из катсцен идут отдельным каналом */
    cutsceneLine(who, text) {
      const profile = /КОМАНДИР/i.test(who) ? 'commander'
        : /ФОНД|ШТАБ|ЦЕНТР/i.test(who) ? 'hq'
          : /РАДИО|\?\?\?/i.test(who) ? 'entity' : 'soldier';
      return this.speak(text, {
        profile, subtitle: false, gain: 1.0,
        radio: profile === 'entity' ? 0.25 : 0.8
      });
    }

    update(dt) { this.time += dt; }
  }

  return { VoiceDirector, FormantVoice, TTSVoice, LINES, PROFILES, parsePhonemes };
})();
