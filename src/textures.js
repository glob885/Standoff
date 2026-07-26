/* ============================================================
   src/textures.js — процедурные текстуры (canvas → THREE.Texture)
   Никаких внешних картинок: всё рисуется кодом при загрузке.
   ============================================================ */
'use strict';

const TEX = (() => {
  const T = THREE;
  const cache = new Map();

  function canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function toTexture(cv, { repeat = 1, srgb = true, aniso = 8, mag = T.LinearFilter } = {}) {
    const t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.magFilter = mag;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    if (srgb && 'colorSpace' in t) t.colorSpace = T.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  /* --------- утилиты рисования --------- */
  const noise = U.makeNoise(9182);

  function fillNoise(ctx, size, opts) {
    const {
      scale = 0.05, octaves = 4, base = [40, 50, 40], amp = [30, 30, 30],
      contrast = 1, warp = 0
    } = opts;
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sx = x, sy = y;
        if (warp) {
          sx += noise.fbm(x * scale * 2, y * scale * 2, 2) * warp;
          sy += noise.fbm(x * scale * 2 + 100, y * scale * 2 + 100, 2) * warp;
        }
        let n = noise.fbm(sx * scale, sy * scale, octaves);
        n = Math.sign(n) * Math.pow(Math.abs(n), 1 / contrast);
        const i = (y * size + x) * 4;
        d[i] = U.clamp(base[0] + n * amp[0], 0, 255);
        d[i + 1] = U.clamp(base[1] + n * amp[1], 0, 255);
        d[i + 2] = U.clamp(base[2] + n * amp[2], 0, 255);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function speckle(ctx, size, count, colors, rMin = 0.5, rMax = 2) {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = U.pick(colors);
      const x = Math.random() * size, y = Math.random() * size, r = U.rand(rMin, rMax);
      ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.fill();
    }
  }

  function streaks(ctx, size, count, color, len = 30, w = 1.2, alpha = 0.15) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const a = U.rand(-0.35, 0.35) + Math.PI / 2;
      const l = U.rand(len * 0.3, len);
      ctx.lineWidth = U.rand(w * 0.4, w);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* грубая карта нормалей из карты высот в канвасе */
  function normalFromCanvas(cv, strength = 2.2) {
    const size = cv.width;
    const src = cv.getContext('2d').getImageData(0, 0, size, size).data;
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const octx = out.getContext('2d');
    const img = octx.createImageData(size, size);
    const d = img.data;
    const lum = (x, y) => {
      x = (x + size) % size; y = (y + size) % size;
      const i = (y * size + x) * 4;
      return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
        const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        d[i] = ((dx / len) * 0.5 + 0.5) * 255;
        d[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
        d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(out);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }

  /* ============================================================
     КОНКРЕТНЫЕ ТЕКСТУРЫ
     ============================================================ */

  /* --- земля: трава/грязь --- */
  function groundColor(size = 512) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    fillNoise(ctx, size, { scale: 0.018, octaves: 5, base: [96, 116, 72], amp: [30, 34, 24], warp: 8 });
    // пятна грязи
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = U.rand(8, 46);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = U.chance(0.5);
      g.addColorStop(0, dark ? 'rgba(118,98,66,0.55)' : 'rgba(126,146,86,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // травинки-детали
    speckle(ctx, size, 2600, ['#7d9c5e', '#6b8a50', '#93b06c', '#5c7845'], 0.4, 1.5);
    // мелкие камни
    speckle(ctx, size, 320, ['#9a9b92', '#7d7e77', '#adaea4'], 0.6, 1.8);
    return cv;
  }

  /* --- кора дерева --- */
  function barkColor(size = 256) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    fillNoise(ctx, size, { scale: 0.03, octaves: 4, base: [118, 98, 76], amp: [26, 22, 18] });
    // вертикальные борозды
    ctx.save();
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * size;
      ctx.globalAlpha = U.rand(0.06, 0.24);
      ctx.strokeStyle = U.chance(0.5) ? '#5c4632' : '#b49878';
      ctx.lineWidth = U.rand(1, 4.5);
      ctx.beginPath();
      let y = 0, xx = x;
      ctx.moveTo(xx, y);
      while (y < size) {
        y += U.rand(8, 22);
        xx += U.rand(-3, 3);
        ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    speckle(ctx, size, 400, ['#7a6248', '#c0a888'], 0.5, 1.6);
    return cv;
  }

  /* --- хвоя --- */
  function needleColor(size = 256) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    fillNoise(ctx, size, { scale: 0.05, octaves: 3, base: [74, 106, 66], amp: [22, 30, 20] });
    ctx.save();
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const a = U.rand(U.TAU), l = U.rand(3, 11);
      ctx.globalAlpha = U.rand(0.15, 0.5);
      ctx.strokeStyle = U.pick(['#5c8a52', '#6f9f60', '#87b476', '#4a7444']);
      ctx.lineWidth = U.rand(0.6, 1.6);
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.restore();
    return cv;
  }

  /* --- камуфляж (форма бойцов) --- */
  function camoColor(size = 256, palette) {
    const pal = palette || ['#6c7a52', '#7e8c60', '#55603f', '#93a072'];
    const cv = canvas(size), ctx = cv.getContext('2d');
    ctx.fillStyle = pal[0]; ctx.fillRect(0, 0, size, size);
    for (let layer = 1; layer < pal.length; layer++) {
      ctx.fillStyle = pal[layer];
      for (let i = 0; i < 26; i++) {
        const cx = Math.random() * size, cy = Math.random() * size;
        ctx.beginPath();
        const pts = U.randInt(5, 9), rad = U.rand(14, 46);
        for (let p = 0; p <= pts; p++) {
          const a = (p / pts) * U.TAU;
          const r = rad * U.rand(0.55, 1.25);
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (p === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
      }
    }
    // потёртости
    ctx.globalAlpha = 0.12;
    speckle(ctx, size, 700, ['#48513a', '#98a67c'], 0.5, 2.2);
    ctx.globalAlpha = 1;
    return cv;
  }

  /* --- крашеный металл техники --- */
  function armorColor(size = 256, tint = [116, 128, 100]) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    fillNoise(ctx, size, { scale: 0.04, octaves: 4, base: tint, amp: [10, 12, 10] });
    // сварные швы и панели
    ctx.strokeStyle = 'rgba(64,72,58,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const y = Math.random() * size;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + U.rand(-8, 8)); ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = Math.random() * size;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + U.rand(-8, 8), size); ctx.stroke();
    }
    // заклёпки
    for (let i = 0; i < 120; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      ctx.fillStyle = 'rgba(180,190,168,0.35)';
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, U.TAU); ctx.fill();
      ctx.fillStyle = 'rgba(48,54,44,0.4)';
      ctx.beginPath(); ctx.arc(x + 0.7, y + 0.7, 1.2, 0, U.TAU); ctx.fill();
    }
    // сколы краски и ржавчина
    speckle(ctx, size, 260, ['#9a7a52', '#7a6238', '#b8a882'], 0.5, 2.4);
    streaks(ctx, size, 70, '#5a4c32', 40, 2, 0.18);
    return cv;
  }

  /* --- ржавый металл сиреноголового --- */
  function rustColor(size = 512) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    fillNoise(ctx, size, { scale: 0.02, octaves: 5, base: [124, 108, 96], amp: [32, 26, 22], warp: 12 });
    // рыжие пятна
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = U.rand(6, 54);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${U.randInt(110, 150)},${U.randInt(58, 80)},${U.randInt(24, 40)},0.55)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.fill();
    }
    streaks(ctx, size, 160, '#6e4c30', 70, 3, 0.22);
    speckle(ctx, size, 900, ['#5c524c', '#a8886a', '#3e3834'], 0.4, 2);
    return cv;
  }

  /* --- сетка динамика (для рупоров) --- */
  function grilleColor(size = 256) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    ctx.fillStyle = '#3a3f42'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#6c7477';
    ctx.lineWidth = 2;
    const step = 12;
    for (let y = step / 2; y < size; y += step) {
      for (let x = step / 2; x < size; x += step) {
        ctx.beginPath();
        ctx.arc(x + ((Math.floor(y / step) % 2) * step / 2), y, 3.4, 0, U.TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.35;
    speckle(ctx, size, 260, ['#5a4a34', '#20242a'], 0.6, 2);
    ctx.globalAlpha = 1;
    return cv;
  }

  /* --- кожа/плоть (хаски) --- */
  function fleshColor(size = 256) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    fillNoise(ctx, size, { scale: 0.03, octaves: 4, base: [138, 120, 110], amp: [26, 22, 20], warp: 6 });
    ctx.globalAlpha = 0.35;
    streaks(ctx, size, 120, '#3a1c1c', 40, 2.4, 0.4);
    ctx.globalAlpha = 1;
    speckle(ctx, size, 500, ['#5c4a44', '#7d6a60', '#3a2c28'], 0.5, 2);
    return cv;
  }

  /* --- альфа-спрайты --- */
  function smokeSprite(size = 128) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const c = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - c) / c, dy = (y - c) / c;
        const r = Math.hypot(dx, dy);
        const n = noise.fbm(x * 0.05, y * 0.05, 4) * 0.5 + 0.5;
        let a = U.clamp01(1 - r) * n * 1.6;
        a = U.clamp01(a);
        const i = (y * size + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  function flashSprite(size = 128) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.25, 'rgba(255,214,140,0.9)');
    g.addColorStop(0.6, 'rgba(255,150,60,0.35)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    // лучи
    ctx.save();
    ctx.translate(c, c);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      ctx.rotate(U.TAU / 7);
      const grad = ctx.createLinearGradient(0, 0, c, 0);
      grad.addColorStop(0, 'rgba(255,230,180,0.8)');
      grad.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -4); ctx.lineTo(c * U.rand(0.6, 1), 0); ctx.lineTo(0, 4);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return cv;
  }

  function sparkSprite(size = 64) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.4, 'rgba(255,190,110,0.7)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    return cv;
  }

  function bloodSprite(size = 128) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    for (let i = 0; i < 26; i++) {
      const a = U.rand(U.TAU), r = U.rand(0, c * 0.8);
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      const rad = U.rand(3, 16) * (1 - r / c);
      ctx.fillStyle = `rgba(${U.randInt(90, 130)},12,14,${U.rand(0.5, 0.95)})`;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, rad), 0, U.TAU); ctx.fill();
    }
    return cv;
  }

  function decalCrater(size = 256) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(16,13,10,0.92)');
    g.addColorStop(0.55, 'rgba(24,20,16,0.7)');
    g.addColorStop(0.85, 'rgba(30,26,20,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, U.TAU); ctx.fill();
    // выброс грунта
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 60; i++) {
      const a = U.rand(U.TAU), r = U.rand(c * 0.3, c);
      ctx.fillStyle = `rgba(60,50,38,${U.rand(0.1, 0.4)})`;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, U.rand(2, 9), 0, U.TAU);
      ctx.fill();
    }
    return cv;
  }

  function grassBlade(size = 64) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 5; i++) {
      const x = size * (0.15 + i * 0.18);
      const w = size * U.rand(0.05, 0.1);
      const h = size * U.rand(0.5, 0.98);
      const g = ctx.createLinearGradient(0, size, 0, size - h);
      g.addColorStop(0, '#4a6b3a');
      g.addColorStop(0.6, '#6f9a52');
      g.addColorStop(1, '#9ec46e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - w, size);
      ctx.quadraticCurveTo(x - w * 0.4, size - h * 0.6, x + U.rand(-6, 6), size - h);
      ctx.quadraticCurveTo(x + w * 0.6, size - h * 0.6, x + w, size);
      ctx.closePath(); ctx.fill();
    }
    return cv;
  }

  function fogSprite(size = 128) {
    const cv = canvas(size), ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data, c = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.hypot((x - c) / c, (y - c) / c);
        const n = noise.fbm(x * 0.03, y * 0.03, 3) * 0.5 + 0.5;
        const a = U.clamp01((1 - r) * n * 1.2);
        const i = (y * size + x) * 4;
        d[i] = 200; d[i + 1] = 214; d[i + 2] = 224;
        d[i + 3] = a * 160;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /* ============================================================
     ПУБЛИЧНЫЙ КЭШ
     ============================================================ */
  function get(name) {
    if (cache.has(name)) return cache.get(name);
    let tex = null;
    switch (name) {
      case 'ground': tex = toTexture(groundColor(512), { repeat: 40 }); break;
      case 'groundN': tex = normalFromCanvas(groundColor(256), 1.6); tex.repeat.set(40, 40); break;
      case 'bark': tex = toTexture(barkColor(256), { repeat: 2 }); break;
      case 'needle': tex = toTexture(needleColor(256), { repeat: 1 }); break;
      case 'camo': tex = toTexture(camoColor(256), { repeat: 1 }); break;
      case 'camoDark': tex = toTexture(camoColor(256, ['#525c3c', '#5f6a46', '#414a30', '#6d7a52']), { repeat: 1 }); break;
      case 'armor': tex = toTexture(armorColor(256), { repeat: 2 }); break;
      case 'armorN': tex = normalFromCanvas(armorColor(256), 1.2); tex.repeat.set(2, 2); break;
      case 'rust': tex = toTexture(rustColor(512), { repeat: 2 }); break;
      case 'rustN': tex = normalFromCanvas(rustColor(256), 2.4); tex.repeat.set(2, 2); break;
      case 'grille': tex = toTexture(grilleColor(256), { repeat: 1 }); break;
      case 'flesh': tex = toTexture(fleshColor(256), { repeat: 1 }); break;
      case 'smoke': tex = toTexture(smokeSprite(128), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      case 'flash': tex = toTexture(flashSprite(128), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      case 'spark': tex = toTexture(sparkSprite(64), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      case 'blood': tex = toTexture(bloodSprite(128), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      case 'crater': tex = toTexture(decalCrater(256), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      case 'grass': tex = toTexture(grassBlade(64), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      case 'fog': tex = toTexture(fogSprite(128), { repeat: 1, srgb: false }); tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; break;
      default: console.warn('TEX: неизвестная текстура', name);
    }
    cache.set(name, tex);
    return tex;
  }

  function preload(names) { for (const n of names) get(n); }

  return { get, preload, toTexture, normalFromCanvas, canvas };
})();
