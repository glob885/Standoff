/* ============================================================
   ОПЕРАЦИЯ «СИРЕНА» — 3D FPS (Three.js, вид от первого лица)
   ПК: мышь + WASD. Телефон: стик + свайп + кнопка ОГОНЬ.
   Весь мир, техника и монстр — процедурная геометрия.
   ============================================================ */
'use strict';
const T = THREE;

/* ---------------- утилиты ---------------- */
const TAU = Math.PI * 2;
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angLerp = (a, b, t) => { const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };

/* ---------------- звук ---------------- */
const Sound = {
  ctx: null, master: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain();
    this.master.gain.value = 0.45; this.master.connect(this.ctx.destination);
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  noise(dur) {
    const c = this.ctx, n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf; return s;
  },
  shot(v = 0.2) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const s = this.noise(0.12), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.13);
  },
  boom(v = 0.45, low = 60) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(low * 2.4, t);
    o.frequency.exponentialRampToValueAtTime(low * 0.4, t + 0.5);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.75);
    const s = this.noise(0.4), ng = c.createGain();
    ng.gain.setValueAtTime(v * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    s.connect(ng); ng.connect(this.master); s.start(t); s.stop(t + 0.42);
  },
  siren(dur = 3.2, v = 0.32) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.35);
    g.gain.setValueAtTime(v, t + dur - 0.9);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur); g.connect(this.master);
    [0, 3, 7].forEach((det, i) => {
      const o = c.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth';
      const base = 175 + det * 9;
      o.frequency.setValueAtTime(base, t);
      o.frequency.linearRampToValueAtTime(base * 2.1, t + dur * 0.45);
      o.frequency.linearRampToValueAtTime(base * 0.72, t + dur);
      const og = c.createGain(); og.gain.value = i === 2 ? 0.15 : 0.38;
      o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + 0.05);
    });
  }
};

/* ============================================================
   РЕНДЕР
   ============================================================ */
const canvas = document.getElementById('game');
const renderer = new T.WebGLRenderer({ canvas, antialias: (devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

const scene = new T.Scene();
scene.background = new T.Color(0x101a20);
scene.fog = new T.FogExp2(0x0a1116, 0.018);

const camera = new T.PerspectiveCamera(74, 1, 0.1, 900);
const camRig = new T.Object3D();
camRig.add(camera); scene.add(camRig);

const ambient = new T.HemisphereLight(0x51708a, 0x16201c, 1.05); scene.add(ambient);
const moon = new T.DirectionalLight(0xbcd8ee, 1.15); moon.position.set(-60, 90, 40); scene.add(moon);
const gunLight = new T.PointLight(0xbfd4e0, 0.9, 4);
const muzzleLight = new T.PointLight(0xffd08a, 0, 22); scene.add(muzzleLight);
const bossLight = new T.PointLight(0xff4a3a, 0, 70); scene.add(bossLight);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = h > w ? 84 : 74; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------------- материалы и заготовки ---------------- */
const MAT = {
  ground: new T.MeshLambertMaterial({ color: 0x1d2a20 }),
  trunk: new T.MeshLambertMaterial({ color: 0x2a2118 }),
  leaf: new T.MeshLambertMaterial({ color: 0x152a1c }),
  rock: new T.MeshLambertMaterial({ color: 0x2a2f33 }),
  gearA: new T.MeshLambertMaterial({ color: 0x33452f }),
  gearB: new T.MeshLambertMaterial({ color: 0x27331f }),
  skin: new T.MeshLambertMaterial({ color: 0x6b5b4b }),
  metal: new T.MeshLambertMaterial({ color: 0x2b332c }),
  metalDark: new T.MeshLambertMaterial({ color: 0x161a17 }),
  tread: new T.MeshLambertMaterial({ color: 0x121513 }),
  glass: new T.MeshLambertMaterial({ color: 0x25404a }),
  boss: new T.MeshLambertMaterial({ color: 0x14171a }),
  husk: new T.MeshLambertMaterial({ color: 0x1a1416 }),
  huskPale: new T.MeshLambertMaterial({ color: 0x6a6258 }),
  eye: new T.MeshBasicMaterial({ color: 0xff3b30 }),
  fire: new T.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 }),
  tracer: new T.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9 }),
  shock: new T.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.6, side: T.DoubleSide })
};
const GEO = {
  box: new T.BoxGeometry(1, 1, 1),
  cyl: new T.CylinderGeometry(1, 1, 1, 8),
  cone: new T.ConeGeometry(1, 1, 8),
  sph: new T.SphereGeometry(1, 10, 8),
  ring: new T.RingGeometry(0.88, 1, 40)
};
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(GEO.box, mat); m.scale.set(w, h, d); m.position.set(x, y, z); return m;
}
function cyl(r, h, mat, x = 0, y = 0, z = 0) {
  const m = new T.Mesh(GEO.cyl, mat); m.scale.set(r, h, r); m.position.set(x, y, z); return m;
}

/* ============================================================
   МОДЕЛИ
   ============================================================ */
function makeSoldier(leader) {
  const g = new T.Group();
  const legL = box(0.22, 0.85, 0.26, MAT.gearB, -0.16, 0.43, 0);
  const legR = box(0.22, 0.85, 0.26, MAT.gearB, 0.16, 0.43, 0);
  g.add(legL, legR);
  g.add(box(0.56, 0.72, 0.34, MAT.gearA, 0, 1.22, 0));
  g.add(box(0.60, 0.34, 0.40, MAT.gearB, 0, 1.20, 0));
  g.add(box(0.26, 0.28, 0.26, MAT.skin, 0, 1.72, 0));
  g.add(box(0.34, 0.16, 0.38, leader ? MAT.gearA : MAT.gearB, 0, 1.84, 0));
  const rifle = new T.Group();
  rifle.add(box(0.07, 0.09, 0.85, MAT.metalDark, 0, 0, 0.2));
  rifle.add(box(0.06, 0.16, 0.2, MAT.metalDark, 0, -0.11, -0.05));
  rifle.position.set(0.22, 1.28, 0.28); g.add(rifle);
  g.add(box(0.16, 0.6, 0.18, MAT.gearA, -0.36, 1.25, 0.05));
  g.add(box(0.16, 0.6, 0.18, MAT.gearA, 0.34, 1.25, 0.18));
  g.userData = { legL, legR, rifle };
  return g;
}
function makeHusk() {
  const g = new T.Group();
  g.add(box(0.42, 1.0, 0.32, MAT.husk, 0, 1.25, 0));
  g.add(box(0.26, 0.3, 0.26, MAT.huskPale, 0, 1.95, 0));
  const legL = box(0.18, 1.0, 0.2, MAT.husk, -0.14, 0.5, 0);
  const legR = box(0.18, 1.0, 0.2, MAT.husk, 0.14, 0.5, 0);
  const armL = box(0.14, 1.2, 0.14, MAT.husk, -0.34, 1.15, 0.1);
  const armR = box(0.14, 1.2, 0.14, MAT.husk, 0.34, 1.15, 0.1);
  g.add(legL, legR, armL, armR);
  const eyeL = box(0.05, 0.05, 0.05, MAT.eye, -0.07, 1.97, 0.14);
  const eyeR = box(0.05, 0.05, 0.05, MAT.eye, 0.07, 1.97, 0.14);
  g.add(eyeL, eyeR);
  g.userData = { legL, legR, armL, armR };
  return g;
}
function makeTank() {
  const g = new T.Group();
  g.add(box(3.1, 0.9, 6.2, MAT.metal, 0, 1.1, 0));
  g.add(box(2.9, 0.5, 5.6, MAT.metalDark, 0, 1.7, -0.2));
  g.add(box(0.9, 1.0, 6.4, MAT.tread, -1.6, 0.55, 0));
  g.add(box(0.9, 1.0, 6.4, MAT.tread, 1.6, 0.55, 0));
  const turret = new T.Group();
  turret.add(box(2.2, 0.85, 2.8, MAT.metal, 0, 0, 0));
  const barrel = cyl(0.14, 4.0, MAT.metalDark, 0, 0.05, 1.9);
  barrel.rotation.x = Math.PI / 2; turret.add(barrel);
  turret.position.set(0, 2.2, -0.3); g.add(turret);
  g.userData = { turret };
  return g;
}
function makeBTR() {
  const g = new T.Group();
  g.add(box(2.6, 1.1, 5.6, MAT.metal, 0, 1.2, 0));
  g.add(box(2.2, 0.6, 3.4, MAT.metalDark, 0, 1.9, -0.4));
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const w = cyl(0.55, 0.4, MAT.tread, s * 1.35, 0.55, -1.9 + i * 1.3);
    w.rotation.z = Math.PI / 2; g.add(w);
  }
  const turret = new T.Group();
  turret.add(box(1.1, 0.6, 1.2, MAT.metal, 0, 0, 0));
  const barrel = cyl(0.08, 2.2, MAT.metalDark, 0, 0, 1.1); barrel.rotation.x = Math.PI / 2;
  turret.add(barrel); turret.position.set(0, 2.4, -0.2); g.add(turret);
  g.userData = { turret };
  return g;
}
function makeHeli() {
  const g = new T.Group();
  g.add(box(1.7, 1.5, 5.0, MAT.metal, 0, 0, 0));
  g.add(box(1.0, 0.9, 1.2, MAT.glass, 0, 0.1, 2.6));
  g.add(box(0.5, 0.5, 4.0, MAT.metal, 0, 0.4, -3.4));
  g.add(box(0.2, 1.6, 0.8, MAT.metal, 0, 1.1, -5.2));
  g.add(box(2.6, 0.15, 0.6, MAT.metalDark, 0, -0.4, 0.4));
  const rotor = new T.Group();
  rotor.add(box(11, 0.09, 0.4, MAT.metalDark));
  rotor.add(box(0.4, 0.09, 11, MAT.metalDark));
  rotor.position.set(0, 1.15, 0); g.add(rotor);
  const tailRotor = box(0.1, 1.8, 0.25, MAT.metalDark, 0.3, 1.1, -5.2); g.add(tailRotor);
  g.userData = { rotor, tailRotor };
  return g;
}
function makeBoss() {
  const g = new T.Group();
  const legL = new T.Group(), legR = new T.Group();
  for (const [grp, s] of [[legL, -1], [legR, 1]]) {
    grp.add(cyl(0.32, 3.6, MAT.boss, 0, -1.8, 0));
    grp.add(cyl(0.26, 3.4, MAT.boss, 0, -5.2, 0));
    grp.add(box(0.7, 0.3, 1.4, MAT.boss, 0, -6.9, 0.3));
    grp.position.set(s * 0.55, 7.2, 0); g.add(grp);
  }
  g.add(box(1.5, 4.2, 0.9, MAT.boss, 0, 9.4, 0));
  g.add(box(3.6, 0.5, 0.7, MAT.boss, 0, 11.4, 0));
  const armL = new T.Group(), armR = new T.Group();
  for (const [grp, s] of [[armL, -1], [armR, 1]]) {
    grp.add(cyl(0.22, 4.2, MAT.boss, 0, -2.1, 0));
    const fore = new T.Group();
    fore.add(cyl(0.19, 4.0, MAT.boss, 0, -2.0, 0));
    fore.add(box(0.45, 0.5, 0.35, MAT.boss, 0, -4.2, 0));
    fore.position.set(0, -4.2, 0); grp.add(fore);
    grp.position.set(s * 1.75, 11.3, 0); grp.userData = { fore }; g.add(grp);
  }
  g.add(cyl(0.22, 1.0, MAT.boss, 0, 12.0, 0));
  g.add(box(2.4, 0.28, 0.28, MAT.boss, 0, 12.5, 0));
  const spk = [];
  for (const s of [-1, 1]) {
    const cone = new T.Mesh(GEO.cone, new T.MeshLambertMaterial({ color: 0x1b1d20 }));
    cone.scale.set(0.85, 1.9, 0.85);
    cone.position.set(s * 1.1, 13.2, 0);
    cone.rotation.z = s * -0.42; cone.rotation.x = -0.15;
    g.add(cone); spk.push(cone);
  }
  g.userData = { legL, legR, armL, armR, spk };
  return g;
}

/* ============================================================
   МИР
   ============================================================ */
const World = {
  level: 0, size: 170,
  units: [], enemies: [], vehicles: [], boss: null, player: null,
  shells: [], fx: [], shocks: [], statics: [],
  clear() {
    const all = [...this.units, ...this.enemies, ...this.vehicles, ...this.shells, ...this.fx, ...this.shocks];
    for (const o of all) if (o.mesh) scene.remove(o.mesh);
    for (const o of this.statics) scene.remove(o);
    if (this.boss) scene.remove(this.boss.mesh);
    this.units = []; this.enemies = []; this.vehicles = []; this.shells = [];
    this.fx = []; this.shocks = []; this.statics = []; this.boss = null; this.player = null;
    bossLight.intensity = 0; muzzleLight.intensity = 0;
  },
  aliveSquad() { return this.units.filter(u => u.hp > 0).length; }
};

function addGround(size) {
  const g = new T.Mesh(new T.PlaneGeometry(size * 2.6, size * 2.6), MAT.ground);
  g.rotation.x = -Math.PI / 2; scene.add(g); World.statics.push(g);
  for (let i = 0; i < 60; i++) {
    const r = new T.Mesh(GEO.sph, MAT.rock);
    const sc = rnd(0.4, 1.6);
    r.scale.set(sc, sc * 0.6, sc);
    r.position.set(rnd(-size, size), sc * 0.25, rnd(-size, size));
    scene.add(r); World.statics.push(r);
  }
}
function addForest(count, radius, holeR) {
  const trunkG = new T.CylinderGeometry(0.22, 0.3, 3.4, 6);
  const leafG = new T.ConeGeometry(1.9, 6.4, 7);
  const trunks = new T.InstancedMesh(trunkG, MAT.trunk, count);
  const leaves = new T.InstancedMesh(leafG, MAT.leaf, count);
  const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
  for (let i = 0; i < count; i++) {
    const a = rnd(TAU), r = holeR + Math.sqrt(Math.random()) * (radius - holeR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, sc = rnd(0.75, 1.5);
    q.setFromEuler(new T.Euler(0, rnd(TAU), 0));
    s.set(sc, sc, sc);
    p.set(x, 1.7 * sc, z); m.compose(p, q, s); trunks.setMatrixAt(i, m);
    p.set(x, 6.6 * sc, z); m.compose(p, q, s); leaves.setMatrixAt(i, m);
  }
  trunks.instanceMatrix.needsUpdate = true; leaves.instanceMatrix.needsUpdate = true;
  scene.add(trunks, leaves); World.statics.push(trunks, leaves);
}

/* ---------------- спавн ---------------- */
function spawnSoldier(x, z, isPlayer, i) {
  const u = {
    type: isPlayer ? 'player' : 'ally', x, z, hp: isPlayer ? 140 : 110, max: isPlayer ? 140 : 110,
    yaw: 0, sp: isPlayer ? 5.6 : 4.8, cd: 0, mag: 30, ammo: 30, reloading: 0,
    stun: 0, walk: rnd(TAU), idx: i, ox: 0, oz: 0, lastHit: 9
  };
  u.mesh = makeSoldier(isPlayer);
  u.mesh.position.set(x, 0, z);
  u.mesh.visible = !isPlayer;
  scene.add(u.mesh);
  return u;
}
function spawnHusk(x, z) {
  const h = { type: 'husk', x, z, hp: 80, max: 80, yaw: 0, sp: rnd(4.5, 6.4), atk: 0, walk: rnd(TAU) };
  h.mesh = makeHusk(); h.mesh.position.set(x, 0, z); scene.add(h.mesh); return h;
}
function spawnVehicle(kind, x, z) {
  const v = { type: kind, x, z, yaw: 0, cd: rnd(1, 3) };
  if (kind === 'tank') Object.assign(v, { hp: 2200, max: 2200, sp: 6.5, rate: 4.2, dmg: 700 });
  else if (kind === 'btr') Object.assign(v, { hp: 1100, max: 1100, sp: 9, rate: 0.25, dmg: 24 });
  else Object.assign(v, { hp: 700, max: 700, sp: 22, rate: 2.4, dmg: 300, alt: 26, orbit: rnd(TAU) });
  v.mesh = kind === 'tank' ? makeTank() : kind === 'btr' ? makeBTR() : makeHeli();
  v.mesh.position.set(x, kind === 'heli' ? 26 : 0, z);
  scene.add(v.mesh); return v;
}
function spawnBoss(x, z) {
  const b = {
    type: 'boss', x, z, hp: 120000, max: 120000, yaw: 0, sp: 4.4, phase: 1,
    state: 'walk', st: 0, vuln: 0, scream: 6, summon: 10, swipe: 0, walk: 0,
    target: null, screamed: false, waved: false, swiped: false, dying: 0
  };
  b.mesh = makeBoss(); b.mesh.position.set(x, 0, z); scene.add(b.mesh);
  return b;
}

/* ============================================================
   ЭФФЕКТЫ
   ============================================================ */
function tracer(from, to) {
  const g = new T.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const l = new T.Line(g, MAT.tracer.clone());
  scene.add(l);
  World.fx.push({ mesh: l, t: 0.07, life: 0.07, kind: 'fade' });
}
function puff(pos, color, n = 6, spread = 0.6, life = 0.4) {
  for (let i = 0; i < n; i++) {
    const m = new T.Mesh(GEO.box, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    const s = rnd(0.06, 0.2); m.scale.set(s, s, s); m.position.copy(pos); scene.add(m);
    World.fx.push({
      mesh: m, t: life, life, kind: 'debris',
      v: new T.Vector3(rnd(-spread, spread), rnd(0.2, spread * 1.6), rnd(-spread, spread)).multiplyScalar(6)
    });
  }
}
function explosion(pos, radius, dmg, hitFriendly) {
  const m = new T.Mesh(GEO.sph, MAT.fire.clone());
  m.position.copy(pos); m.scale.setScalar(0.6); scene.add(m);
  World.fx.push({ mesh: m, t: 0.45, life: 0.45, kind: 'boom', grow: radius * 0.8 });
  const l = new T.PointLight(0xffa040, 8, radius * 4); l.position.copy(pos); scene.add(l);
  World.fx.push({ mesh: l, t: 0.4, life: 0.4, kind: 'light' });
  puff(pos, 0x6b6b6b, 10, 1.2, 1.0);
  Sound.boom(0.5, 52);
  if (World.player) Game.shake(clamp(24 / (1 + dist2D(World.player, pos)), 0, 0.8));
  if (dmg > 0) {
    const list = hitFriendly ? World.units.concat(World.vehicles) : World.enemies.concat(World.boss ? [World.boss] : []);
    for (const t of list) {
      if (!t || t.hp <= 0) continue;
      const d = dist2D(pos, t);
      if (d < radius) damage(t, dmg * (1 - d / (radius * 1.5)));
    }
  }
}
function shockwave(x, z, maxR, dmg) {
  const m = new T.Mesh(GEO.ring, MAT.shock.clone());
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.4, z); m.scale.setScalar(2); scene.add(m);
  World.shocks.push({ mesh: m, r: 2, max: maxR, dmg, hit: new Set(), x, z, speed: maxR / 1.2 });
}

/* ---------------- урон ---------------- */
function damage(t, amount) {
  if (!t || t.hp <= 0) return;
  if (t.type === 'boss') {
    if (t.vuln > 0) amount *= 2.2;
    t.hp -= amount;
    if (t.hp <= 0) { t.hp = 0; Game.bossDown(); }
    return;
  }
  t.hp -= amount;
  if (t.type === 'player') { t.lastHit = 0; Game.hurtFlash(); }
  if (t.hp > 0) return;
  t.hp = 0;
  if (t.type === 'husk') {
    puff(new T.Vector3(t.x, 1.2, t.z), 0x7a1616, 8, 0.8, 0.5);
    Game.stats.kills++; scene.remove(t.mesh);
  } else if (t.type === 'ally' || t.type === 'player') {
    Game.stats.lost++;
    t.mesh.visible = true;
    t.mesh.rotation.set(-Math.PI / 2, t.yaw, 0);
    t.mesh.position.y = 0.3;
    puff(new T.Vector3(t.x, 1.2, t.z), 0x7a1616, 6, 0.6, 0.5);
    if (t.type === 'player') Game.playerDown();
  } else {
    explosion(new T.Vector3(t.x, t.type === 'heli' ? t.mesh.position.y : 1.4, t.z), 10, 0, false);
    Game.stats.vehLost++;
    Toast.show(t.type === 'heli' ? 'ВЕРТОЛЁТ СБИТ' : 'ТЕХНИКА ПОТЕРЯНА');
  }
}

/* ============================================================
   ВВОД
   ============================================================ */
const Input = {
  keys: {}, look: { yaw: 0, pitch: 0 }, move: { x: 0, y: 0 },
  firing: false, sprint: false, touch: false, locked: false,
  init() {
    addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyR') Game.reload();
      if (e.code === 'Escape') Game.togglePause();
      if (e.code === 'Space' || e.code === 'Enter') { Cut.advance(); e.preventDefault(); }
      Sound.init(); Sound.resume();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    canvas.addEventListener('mousedown', () => {
      Sound.init(); Sound.resume();
      if (Game.state === 'play' && !this.touch && !this.locked) { canvas.requestPointerLock(); return; }
      this.firing = true;
    });
    addEventListener('mouseup', () => { this.firing = false; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.look.yaw -= e.movementX * 0.0022;
      this.look.pitch = clamp(this.look.pitch - e.movementY * 0.0022, -1.35, 1.2);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    if (matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window) {
      this.touch = true;
      document.getElementById('touch').classList.remove('hidden');
      this.bindStick(); this.bindLook();
      const fb = document.getElementById('fireBtn');
      fb.addEventListener('touchstart', e => { e.preventDefault(); this.firing = true; Sound.init(); Sound.resume(); }, { passive: false });
      fb.addEventListener('touchend', e => { e.preventDefault(); this.firing = false; }, { passive: false });
      document.getElementById('reloadBtn').addEventListener('touchstart', e => { e.preventDefault(); Game.reload(); }, { passive: false });
      const sp = document.getElementById('sprintBtn');
      sp.addEventListener('touchstart', e => { e.preventDefault(); this.sprint = true; }, { passive: false });
      sp.addEventListener('touchend', e => { e.preventDefault(); this.sprint = false; }, { passive: false });
    }
  },
  bindStick() {
    const el = document.getElementById('stickL'), knob = el.querySelector('.knob');
    let id = null, cx = 0, cy = 0; const R = 52; const self = this;
    const start = e => {
      const t = e.changedTouches[0]; id = t.identifier;
      const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      el.classList.add('active'); move(e);
    };
    const move = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        let dx = t.clientX - cx, dy = t.clientY - cy;
        const d = Math.hypot(dx, dy) || 1, k = Math.min(d, R) / d;
        dx *= k; dy *= k; knob.style.transform = `translate(${dx}px,${dy}px)`;
        self.move.x = dx / R; self.move.y = dy / R;
      }
    };
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        id = null; self.move.x = self.move.y = 0;
        knob.style.transform = 'translate(0,0)'; el.classList.remove('active');
      }
    };
    el.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, { passive: false });
    el.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); end(e); }, { passive: false });
    el.addEventListener('touchcancel', end);
  },
  bindLook() {
    const el = document.getElementById('lookArea'); const self = this;
    let id = null, lx = 0, ly = 0;
    el.addEventListener('touchstart', e => {
      e.preventDefault(); const t = e.changedTouches[0];
      id = t.identifier; lx = t.clientX; ly = t.clientY; Sound.init(); Sound.resume();
    }, { passive: false });
    el.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier !== id) continue;
        self.look.yaw -= (t.clientX - lx) * 0.005;
        self.look.pitch = clamp(self.look.pitch - (t.clientY - ly) * 0.005, -1.35, 1.2);
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === id) id = null; };
    el.addEventListener('touchend', e => { e.preventDefault(); end(e); }, { passive: false });
    el.addEventListener('touchcancel', end);
  }
};

/* ============================================================
   HUD
   ============================================================ */
const Toast = {
  el: document.getElementById('toast'), t: 0,
  show(txt, time = 2.4) { this.el.textContent = txt; this.el.classList.add('show'); this.t = time; },
  update(dt) { if (this.t > 0) { this.t -= dt; if (this.t <= 0) this.el.classList.remove('show'); } }
};
const HUD = {
  squad: document.getElementById('squadAlive'), obj: document.getElementById('objText'),
  hp: document.getElementById('hpFill'), ammo: document.getElementById('ammoNow'),
  ammoMax: document.getElementById('ammoMax'), bossBar: document.getElementById('bossBar'),
  bossFill: document.getElementById('bossFill'), bossPhase: document.getElementById('bossPhase'),
  hitmark: document.getElementById('hitmark'), compass: document.getElementById('compass'),
  arrow: document.getElementById('compassArrow'), cdist: document.getElementById('compassDist'),
  hitT: 0,
  hit() { this.hitmark.classList.add('on'); this.hitT = 0.1; },
  objective(t) { this.obj.textContent = t; },
  update(dt) {
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hitmark.classList.remove('on'); }
    this.squad.textContent = World.aliveSquad();
    const p = World.player;
    if (p) {
      this.hp.style.width = clamp(p.hp / p.max * 100, 0, 100) + '%';
      this.ammo.textContent = p.reloading > 0 ? '···' : p.ammo;
      this.ammoMax.textContent = p.mag;
    }
    if (World.boss && World.boss.hp > 0) {
      this.bossBar.classList.remove('hidden');
      this.bossFill.style.width = clamp(World.boss.hp / World.boss.max * 100, 0, 100) + '%';
      this.bossPhase.textContent = 'ФАЗА ' + ['I', 'II', 'III'][World.boss.phase - 1];
    } else this.bossBar.classList.add('hidden');
    const tgt = (World.boss && World.boss.hp > 0) ? World.boss : Game.waypoint();
    if (tgt && p) {
      const ang = Math.atan2(tgt.x - p.x, tgt.z - p.z);
      let rel = ((ang - Input.look.yaw - Math.PI + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.compass.style.display = Math.abs(rel) < 0.4 ? 'none' : 'block';
      this.arrow.style.transform = `rotate(${-rel}rad)`;
      this.cdist.textContent = Math.round(dist2D(p, tgt)) + ' м';
    } else this.compass.style.display = 'none';
  }
};

/* ============================================================
   КАТСЦЕНЫ
   ============================================================ */
const Cut = {
  el: document.getElementById('cutscene'), textEl: document.getElementById('cutText'),
  active: false, lines: [], i: 0, typed: 0, t: 0, shots: [], shotI: 0, shotT: 0, onDone: null,
  play(shots, lines, onDone) {
    this.active = true; this.shots = shots; this.lines = lines;
    this.i = 0; this.typed = 0; this.t = 0; this.shotI = 0; this.shotT = 0; this.onDone = onDone;
    this.el.classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    Game.state = 'cut';
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
  },
  render() {
    const l = this.lines[this.i]; if (!l) return;
    const shown = l.text.slice(0, Math.floor(this.typed));
    this.textEl.innerHTML = (l.who ? `<span class="who">${l.who}</span>` : '') + shown +
      (shown.length < l.text.length ? '<span style="opacity:.35">▌</span>' : '');
  },
  advance() {
    if (!this.active) return;
    const l = this.lines[this.i];
    if (l && this.typed < l.text.length) { this.typed = l.text.length; this.render(); return; }
    this.i++; this.typed = 0; this.t = 0;
    if (this.i >= this.lines.length) this.finish(); else this.render();
  },
  finish() {
    this.active = false; this.el.classList.add('hidden');
    const cb = this.onDone; this.onDone = null; if (cb) cb();
  },
  update(dt) {
    if (!this.active) return;
    this.t += dt; this.shotT += dt;
    const l = this.lines[this.i];
    if (l) {
      if (this.typed < l.text.length) { this.typed += dt * 40; this.render(); }
      else if (this.t > 2.0 + l.text.length * 0.035) this.advance();
    }
    const s = this.shots[this.shotI];
    if (s) {
      const k = clamp(this.shotT / s.dur, 0, 1), e = k * k * (3 - 2 * k);
      camera.rotation.set(0, 0, 0); camera.position.set(0, 0, 0);
      camRig.position.set(lerp(s.from[0], s.to[0], e), lerp(s.from[1], s.to[1], e), lerp(s.from[2], s.to[2], e));
      camRig.lookAt(
        lerp(s.lookFrom[0], s.lookTo[0], e),
        lerp(s.lookFrom[1], s.lookTo[1], e),
        lerp(s.lookFrom[2], s.lookTo[2], e));
      if (s.onUpdate) s.onUpdate(e, dt);
      if (this.shotT >= s.dur && this.shotI < this.shots.length - 1) { this.shotI++; this.shotT = 0; }
    }
  }
};
Cut.el.addEventListener('pointerdown', () => { Sound.init(); Sound.resume(); Cut.advance(); });

/* ---------------- сюжет ---------------- */
const STORY = {
  brief: [
    { who: 'ФОНД · КОМАНДНЫЙ ЦЕНТР', text: 'Квадрат 41-B. За шесть дней — сорок один пропавший. Ни тел, ни следов.' },
    { who: 'КОМАНДИР', text: 'Объект — SCP-6789. Тринадцать метров. Имитирует голоса, приманивает и забирает.' },
    { who: 'КОМАНДИР', text: 'Нас ровно пятьдесят. Два фланга. Танки и БТР идут следом, вертолёты держат небо.' },
    { who: 'КОМАНДИР', text: 'Услышите знакомый голос — это не он. Не отвечать, из строя не выходить.' }
  ],
  convoy: [
    { who: '04:12 · КРОМКА ЛЕСА', text: 'Колонна встала. Дальше идёт пехота, техника — следом по просеке.' },
    { who: 'КОМАНДИР', text: 'Прочёсываем секторы A, B и C. Тихо. Он где-то здесь.' }
  ],
  contact: [
    { who: '', text: 'Лес замолчал. Ни птиц, ни ветра.' },
    { who: 'РАДИО', text: '...эй... помогите... я здесь...' },
    { who: 'КОМАНДИР', text: 'НИКОМУ НЕ ОТВЕЧАТЬ. Это он.' },
    { who: '', text: 'То, что казалось сухим деревом, повернуло голову.' },
    { who: 'КОМАНДИР', text: 'КОНТАКТ! Все стволы на цель! Танки — беглый огонь! Вертолёты, по башке его!' }
  ],
  rage: [
    { who: '', text: 'Сирены взвыли так, что лопнули стёкла прицелов.' },
    { who: 'КОМАНДИР', text: 'Он озверел! Бей в динамики, когда он кричит — там он открыт!' }
  ],
  victory: [
    { who: '', text: 'Он падал долго — как рушится вышка.' },
    { who: 'КОМАНДИР', text: 'Цель нейтрализована. Оцепить квадрат, вызвать группу утилизации.' },
    { who: 'ФОНД', text: 'Операция «Сирена» завершена. Класс объекта: Neutralized.' }
  ]
};

/* ============================================================
   ОРУЖИЕ В РУКАХ
   ============================================================ */
const Weapon = {
  group: new T.Group(), recoil: 0, bobT: 0, flash: null, flashT: 0,
  init() {
    const g = this.group;
    g.add(box(0.09, 0.11, 1.0, MAT.metalDark, 0, 0, -0.35));
    g.add(box(0.08, 0.2, 0.26, MAT.metalDark, 0, -0.14, -0.05));
    g.add(box(0.07, 0.07, 0.34, MAT.metal, 0, 0.02, -0.95));
    g.add(box(0.14, 0.06, 0.3, MAT.metalDark, 0, 0.09, -0.3));
    g.position.set(0.18, -0.18, -0.42);
    g.scale.setScalar(0.72);
    gunLight.position.set(0.2, -0.1, -0.5);
    camera.add(gunLight);
    camera.add(g);
    this.flash = box(0.18, 0.18, 0.32, MAT.fire, 0, 0.02, -1.18);
    this.flash.visible = false; g.add(this.flash);
  },
  fire() { this.recoil = 1; this.flash.visible = true; this.flashT = 0.045; },
  update(dt, moving) {
    this.bobT += dt * (moving ? 9 : 2.2);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    const g = this.group;
    g.position.set(
      0.18 + Math.sin(this.bobT) * (moving ? 0.014 : 0.003),
      -0.18 + Math.abs(Math.cos(this.bobT)) * (moving ? 0.016 : 0.004) - this.recoil * 0.018,
      -0.42 + this.recoil * 0.08);
    g.rotation.x = this.recoil * 0.18;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }
};

/* ============================================================
   БОЕВАЯ ЛОГИКА
   ============================================================ */
const tmpV = new T.Vector3();

function bossHitSpheres(b) {
  const y = b.mesh.position.y;
  return [
    { x: b.x, y: y + 3.5, z: b.z, r: 1.7, mult: 1 },
    { x: b.x, y: y + 9.4, z: b.z, r: 2.0, mult: 1.2 },
    { x: b.x, y: y + 13.2, z: b.z, r: 2.4, mult: 3.0 }
  ];
}
function raySphere(orig, dir, c, r) {
  tmpV.set(c.x - orig.x, c.y - orig.y, c.z - orig.z);
  const t = tmpV.dot(dir);
  if (t < 0) return -1;
  const d2 = tmpV.lengthSq() - t * t;
  if (d2 > r * r) return -1;
  return t - Math.sqrt(r * r - d2);
}
function playerShoot(p, spread) {
  const q = camera.getWorldQuaternion(new T.Quaternion());
  const dir = new T.Vector3(0, 0, -1).applyQuaternion(q);
  dir.x += rnd(-spread, spread); dir.y += rnd(-spread, spread); dir.z += rnd(-spread, spread);
  dir.normalize();
  const orig = new T.Vector3(); camera.getWorldPosition(orig);
  let best = 260, hitObj = null, mult = 1;
  for (const e of World.enemies) {
    if (e.hp <= 0) continue;
    const t = raySphere(orig, dir, { x: e.x, y: 1.2, z: e.z }, 0.8);
    if (t > 0 && t < best) { best = t; hitObj = e; mult = 1; }
  }
  if (World.boss && World.boss.hp > 0) {
    for (const s of bossHitSpheres(World.boss)) {
      const t = raySphere(orig, dir, s, s.r);
      if (t > 0 && t < best) { best = t; hitObj = World.boss; mult = s.mult; }
    }
  }
  const end = orig.clone().add(dir.clone().multiplyScalar(hitObj ? best : 170));
  const muzzle = new T.Vector3(); Weapon.flash.getWorldPosition(muzzle);
  tracer(muzzle, end);
  Weapon.fire();
  muzzleLight.position.copy(muzzle); muzzleLight.intensity = 6; Game.muzzleT = 0.05;
  Sound.shot(0.14); Game.shake(0.05);
  if (hitObj) {
    damage(hitObj, 30 * mult);
    puff(end, hitObj.type === 'boss' ? 0x553030 : 0x7a1616, 3, 0.4, 0.25);
    HUD.hit();
  }
}

function updatePlayer(p, dt) {
  if (!p || p.hp <= 0) return;
  let fx = 0, fz = 0;
  if (Input.touch) { fx = Input.move.x; fz = Input.move.y; }
  else {
    if (Input.keys.KeyW || Input.keys.ArrowUp) fz -= 1;
    if (Input.keys.KeyS || Input.keys.ArrowDown) fz += 1;
    if (Input.keys.KeyA || Input.keys.ArrowLeft) fx -= 1;
    if (Input.keys.KeyD || Input.keys.ArrowRight) fx += 1;
  }
  const mag = Math.hypot(fx, fz);
  const sprint = (Input.keys.ShiftLeft || Input.keys.ShiftRight || Input.sprint) ? 1.7 : 1;
  const yaw = Input.look.yaw;
  if (mag > 0.05) {
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    // вперёд = -Z в локальных координатах камеры
    const dx = fx * cosY + fz * sinY;
    const dz = -fx * sinY + fz * cosY;
    const len = Math.hypot(dx, dz) || 1;
    const k = p.sp * sprint * dt * Math.min(mag, 1) / len;
    p.x += dx * k; p.z += dz * k;
    p.walk += dt * (7 + sprint * 3) * Math.min(mag, 1);
  }
  const lim = World.size;
  p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim);
  p.yaw = yaw;
  p.mesh.position.set(p.x, 0, p.z);
  p.mesh.rotation.y = yaw;

  const bob = Math.sin(p.walk * 2) * 0.055 * (mag > 0.05 ? 1 : 0);
  const sway = Math.cos(p.walk) * 0.03 * (mag > 0.05 ? 1 : 0);
  camRig.position.set(p.x + sway, 1.68 + bob + Game.shakeY, p.z);
  camRig.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(Input.look.pitch, yaw, Game.shakeR);

  p.cd -= dt;
  if (p.reloading > 0) { p.reloading -= dt; if (p.reloading <= 0) p.ammo = p.mag; }
  else if (Input.firing && p.cd <= 0 && p.ammo > 0) {
    p.cd = 0.09; p.ammo--;
    playerShoot(p, mag > 0.05 ? 0.022 : 0.008);
    if (p.ammo <= 0) Game.reload();
  }
  p.lastHit += dt;
  if (p.lastHit > 6 && p.hp < p.max) p.hp = Math.min(p.max, p.hp + 8 * dt);
  Weapon.update(dt, mag > 0.05);
}

function nearestTarget(from, range) {
  let best = null, bd = range;
  for (const e of World.enemies) {
    if (e.hp <= 0) continue;
    const d = dist2D(from, e); if (d < bd) { bd = d; best = e; }
  }
  if (World.boss && World.boss.hp > 0) {
    const d = dist2D(from, World.boss);
    if (d < range * 1.6 && (!best || d < bd * 1.3)) best = World.boss;
  }
  return best;
}

function updateAlly(u, dt) {
  u.stun = Math.max(0, u.stun - dt);
  const p = World.player;
  const ax = (p ? p.x : 0) + u.ox, az = (p ? p.z : 0) + u.oz;
  let dx = ax - u.x, dz = az - u.z, d = Math.hypot(dx, dz);
  if (World.boss && World.boss.hp > 0) {
    const db = dist2D(u, World.boss);
    if (db < 22) { dx -= (World.boss.x - u.x) * 2.2; dz -= (World.boss.z - u.z) * 2.2; d = Math.hypot(dx, dz) || 1; }
  }
  if (u.stun <= 0 && d > 1.6) {
    const k = Math.min(u.sp, d * 1.6) * dt / d;
    u.x += dx * k; u.z += dz * k; u.walk += dt * 8;
  }
  const tgt = nearestTarget(u, 70);
  if (tgt) {
    u.yaw = angLerp(u.yaw, Math.atan2(tgt.x - u.x, tgt.z - u.z), 1 - Math.pow(0.001, dt));
    u.cd -= dt;
    if (u.reloading > 0) { u.reloading -= dt; if (u.reloading <= 0) u.ammo = u.mag; }
    else if (u.cd <= 0 && u.stun <= 0) {
      u.cd = rnd(0.2, 0.35); u.ammo--;
      const from = new T.Vector3(u.x, 1.3, u.z);
      const ty = tgt.type === 'boss' ? rnd(3, 12) : 1.2;
      tracer(from, new T.Vector3(tgt.x + rnd(-0.6, 0.6), ty, tgt.z + rnd(-0.6, 0.6)));
      damage(tgt, 6);
      if (Math.random() < 0.12) Sound.shot(0.04);
      if (u.ammo <= 0) u.reloading = rnd(1.8, 2.8);
    }
  } else if (d > 1.6) u.yaw = angLerp(u.yaw, Math.atan2(dx, dz), 1 - Math.pow(0.01, dt));

  u.mesh.position.set(u.x, 0, u.z);
  u.mesh.rotation.y = u.yaw;
  const sw = Math.sin(u.walk) * 0.5;
  u.mesh.userData.legL.rotation.x = sw; u.mesh.userData.legR.rotation.x = -sw;
}

function updateHusk(h, dt) {
  if (h.hp <= 0) return;
  let best = null, bd = 1e9;
  for (const u of World.units) { if (u.hp <= 0) continue; const d = dist2D(h, u); if (d < bd) { bd = d; best = u; } }
  if (!best) return;
  h.yaw = Math.atan2(best.x - h.x, best.z - h.z);
  if (bd > 1.4) {
    h.x += Math.sin(h.yaw) * h.sp * dt; h.z += Math.cos(h.yaw) * h.sp * dt; h.walk += dt * 13;
  } else {
    h.atk -= dt;
    if (h.atk <= 0) { h.atk = 0.8; damage(best, 16); }
  }
  h.mesh.position.set(h.x, 0, h.z);
  h.mesh.rotation.y = h.yaw;
  const sw = Math.sin(h.walk) * 0.8, ud = h.mesh.userData;
  ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw;
  ud.armL.rotation.x = -sw * 0.7 - 0.6; ud.armR.rotation.x = sw * 0.7 - 0.6;
}

function makeShell(from, to, speed, dmg, radius) {
  const m = new T.Mesh(GEO.sph, MAT.fire.clone());
  m.scale.setScalar(0.25); m.position.copy(from); scene.add(m);
  const dir = to.clone().sub(from).normalize();
  return { mesh: m, v: dir.multiplyScalar(speed), dmg, radius, life: 4 };
}

function updateVehicle(v, dt) {
  if (v.hp <= 0) {
    if (v.type === 'heli' && v.mesh.position.y > 0.6) {
      v.mesh.position.y -= 18 * dt;
      v.mesh.rotation.z += 2.2 * dt; v.mesh.rotation.x += 1.1 * dt;
      if (v.mesh.position.y <= 0.6) explosion(v.mesh.position.clone(), 12, 0, false);
    }
    return;
  }
  const boss = World.boss && World.boss.hp > 0 ? World.boss : null;
  const tgt = boss || nearestTarget(v, 90);

  if (v.type === 'heli') {
    v.mesh.userData.rotor.rotation.y += dt * 26;
    v.mesh.userData.tailRotor.rotation.x += dt * 30;
    if (tgt) {
      v.orbit += dt * 0.35;
      const gx = tgt.x + Math.cos(v.orbit) * 55, gz = tgt.z + Math.sin(v.orbit) * 55;
      const dx = gx - v.x, dz = gz - v.z, d = Math.hypot(dx, dz) || 1;
      const k = Math.min(v.sp * dt, d) / d;
      v.x += dx * k; v.z += dz * k;
      v.yaw = angLerp(v.yaw, Math.atan2(tgt.x - v.x, tgt.z - v.z), 1 - Math.pow(0.02, dt));
      v.mesh.position.set(v.x, v.alt, v.z);
      v.mesh.rotation.set(-0.08, v.yaw, Math.sin(v.orbit) * 0.12);
      v.cd -= dt;
      if (v.cd <= 0) {
        v.cd = v.rate;
        const aim = new T.Vector3(tgt.x, tgt.type === 'boss' ? 9 : 1, tgt.z);
        for (const s of [-1, 1]) {
          const from = new T.Vector3(v.x + Math.cos(v.yaw) * s * 1.4, v.alt - 0.6, v.z - Math.sin(v.yaw) * s * 1.4);
          World.shells.push(makeShell(from, aim, 90, v.dmg, 9));
        }
        Sound.shot(0.16);
      }
    }
    return;
  }

  if (tgt) {
    const keep = v.type === 'tank' ? 60 : 42;
    const d = dist2D(v, tgt);
    const ang = Math.atan2(tgt.x - v.x, tgt.z - v.z);
    const dir = d > keep + 6 ? 1 : d < keep - 6 ? -0.6 : 0;
    if (dir !== 0) { v.x += Math.sin(ang) * v.sp * dir * dt; v.z += Math.cos(ang) * v.sp * dir * dt; }
    v.yaw = angLerp(v.yaw, ang, 1 - Math.pow(0.06, dt));
    v.mesh.position.set(v.x, 0, v.z); v.mesh.rotation.y = v.yaw;
    const tu = v.mesh.userData.turret;
    tu.rotation.y = angLerp(tu.rotation.y, ang - v.yaw, 1 - Math.pow(0.01, dt));
    v.cd -= dt;
    if (v.cd <= 0 && d < 130) {
      v.cd = v.rate;
      const my = 2.4;
      const from = new T.Vector3(v.x + Math.sin(ang) * 4.5, my, v.z + Math.cos(ang) * 4.5);
      const aim = new T.Vector3(tgt.x, tgt.type === 'boss' ? rnd(6, 12) : 1, tgt.z);
      if (v.type === 'tank') {
        World.shells.push(makeShell(from, aim, 120, v.dmg, 11));
        const l = new T.PointLight(0xffb060, 6, 40); l.position.copy(from); scene.add(l);
        World.fx.push({ mesh: l, t: 0.12, life: 0.12, kind: 'light' });
        puff(from, 0x9a9a9a, 6, 1.0, 0.6);
        Sound.boom(0.4, 68);
        if (World.player) Game.shake(clamp(12 / (1 + dist2D(World.player, v)), 0, 0.4));
      } else {
        tracer(from, aim);
        damage(tgt, v.dmg);
        Sound.shot(0.07);
      }
    }
  }
}

function updateShells(dt) {
  for (let i = World.shells.length - 1; i >= 0; i--) {
    const s = World.shells[i];
    s.mesh.position.addScaledVector(s.v, dt);
    s.life -= dt;
    let hit = s.mesh.position.y <= 0.25 || s.life <= 0;
    const b = World.boss;
    if (!hit && b && b.hp > 0) {
      for (const sp of bossHitSpheres(b)) {
        if (s.mesh.position.distanceTo(new T.Vector3(sp.x, sp.y, sp.z)) < sp.r + 0.7) { hit = true; break; }
      }
    }
    if (!hit) for (const e of World.enemies) {
      if (e.hp > 0 && Math.hypot(s.mesh.position.x - e.x, s.mesh.position.z - e.z) < 1.3 && s.mesh.position.y < 2.4) { hit = true; break; }
    }
    if (hit) {
      explosion(s.mesh.position.clone(), s.radius, s.dmg, false);
      scene.remove(s.mesh); World.shells.splice(i, 1);
    }
  }
}

function updateShocks(dt) {
  for (let i = World.shocks.length - 1; i >= 0; i--) {
    const s = World.shocks[i];
    s.r += s.speed * dt;
    s.mesh.scale.setScalar(s.r);
    s.mesh.material.opacity = clamp(1 - s.r / s.max, 0, 1) * 0.7;
    for (const u of World.units.concat(World.vehicles)) {
      if (u.hp <= 0 || s.hit.has(u)) continue;
      const d = Math.hypot(u.x - s.x, u.z - s.z);
      if (Math.abs(d - s.r) < 2.6) {
        s.hit.add(u); damage(u, s.dmg);
        if (u.type === 'ally') u.stun = 0.8;
        if (u.type === 'player') Game.shake(1.0);
      }
    }
    if (s.r >= s.max) { scene.remove(s.mesh); World.shocks.splice(i, 1); }
  }
}

function updateBoss(b, dt) {
  const ud = b.mesh.userData;
  if (b.hp <= 0) {
    b.dying += dt;
    const k = clamp(b.dying / 2.4, 0, 1);
    b.mesh.rotation.x = -k * Math.PI / 2;
    bossLight.intensity = Math.max(0, bossLight.intensity - dt * 6);
    return;
  }
  b.st += dt; b.walk += dt;
  b.vuln = Math.max(0, b.vuln - dt);

  const frac = b.hp / b.max;
  const want = frac > 0.66 ? 1 : frac > 0.3 ? 2 : 3;
  if (want !== b.phase) {
    b.phase = want;
    if (want === 3) { Game.ragePhase(); return; }
    Toast.show('ФАЗА II · ОН УСКОРЯЕТСЯ');
    Sound.siren(2.2, 0.3);
  }
  const speed = b.sp * (b.phase === 1 ? 1 : b.phase === 2 ? 1.3 : 1.6);

  if (!b.target || b.target.hp <= 0 || Math.random() < dt * 0.5) {
    let best = null, bd = 1e9;
    for (const c of World.units.concat(World.vehicles)) {
      if (c.hp <= 0 || c.type === 'heli') continue;
      const d = dist2D(b, c); if (d < bd) { bd = d; best = c; }
    }
    b.target = best;
  }
  const t = b.target;

  if (b.state === 'walk') {
    if (t) {
      const ang = Math.atan2(t.x - b.x, t.z - b.z);
      b.yaw = angLerp(b.yaw, ang, 1 - Math.pow(0.1, dt));
      const d = dist2D(b, t);
      if (d > 9) {
        b.x += Math.sin(b.yaw) * speed * dt; b.z += Math.cos(b.yaw) * speed * dt;
      } else if (b.swipe <= 0) { b.state = 'swipe'; b.st = 0; b.swipe = 3.2; b.swiped = false; }
    }
    b.scream -= dt; b.summon -= dt; b.swipe -= dt;
    if (b.scream <= 0) { b.state = 'scream'; b.st = 0; b.screamed = false; b.waved = false; b.scream = b.phase === 3 ? 8 : 11; }
    else if (b.summon <= 0) { b.state = 'summon'; b.st = 0; b.summon = b.phase === 3 ? 10 : 14; }
  }
  else if (b.state === 'scream') {
    if (b.st < 1.2) {
      if (!b.screamed) { b.screamed = true; Sound.siren(2.8, 0.4); Toast.show('ОН КРИЧИТ — БЕЙ В ДИНАМИКИ!', 2.2); }
      const k = b.st / 1.2;
      for (const s of ud.spk) s.material.emissive.setRGB(k * 0.9, k * 0.14, k * 0.1);
      bossLight.position.set(b.x, 13, b.z); bossLight.intensity = k * 7;
    } else if (b.st < 3.4) {
      if (!b.waved) {
        b.waved = true; b.vuln = 2.6;
        for (let i = 0; i < (b.phase === 3 ? 3 : 2); i++) {
          setTimeout(() => { if (b.hp > 0) shockwave(b.x, b.z, 55, 20 + b.phase * 6); }, i * 380);
        }
      }
      Game.shake(dt * 6);
    } else {
      b.state = 'walk'; b.st = 0;
      for (const s of ud.spk) s.material.emissive.setRGB(0, 0, 0);
      bossLight.intensity = 0;
    }
  }
  else if (b.state === 'summon') {
    if (b.st > 0.8) {
      const n = 4 + b.phase * 2;
      for (let i = 0; i < n; i++) {
        const a = rnd(TAU), r = rnd(8, 20);
        World.enemies.push(spawnHusk(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r));
      }
      Toast.show('ОН ЗОВЁТ ИХ · ДЕРЖАТЬ ФЛАНГИ', 2);
      b.state = 'walk'; b.st = 0;
    }
  }
  else if (b.state === 'swipe') {
    const k = clamp(b.st / 0.75, 0, 1);
    ud.armR.rotation.x = -Math.sin(k * Math.PI) * 2.0;
    ud.armR.rotation.z = -Math.sin(k * Math.PI) * 0.9;
    if (b.st > 0.6 && !b.swiped) {
      b.swiped = true;
      shockwave(b.x + Math.sin(b.yaw) * 8, b.z + Math.cos(b.yaw) * 8, 14, 55);
      Sound.boom(0.55, 44); Game.shake(0.7);
      for (const v of World.vehicles) if (v.hp > 0 && v.type !== 'heli' && dist2D(v, b) < 16) damage(v, 420);
    }
    if (b.st > 1.4) { b.state = 'walk'; b.st = 0; ud.armR.rotation.x = 0; ud.armR.rotation.z = 0; }
  }

  b.x = clamp(b.x, -World.size, World.size); b.z = clamp(b.z, -World.size, World.size);
  const sw = Math.sin(b.walk * 2.2) * 0.45;
  b.mesh.position.set(b.x, Math.abs(Math.sin(b.walk * 2.2)) * 0.18, b.z);
  b.mesh.rotation.y = b.yaw;
  ud.legL.rotation.x = sw; ud.legR.rotation.x = -sw;
  ud.armL.rotation.x = -sw * 0.6;
  if (b.state !== 'swipe') ud.armR.rotation.x = sw * 0.6;
}

function updateFx(dt) {
  for (let i = World.fx.length - 1; i >= 0; i--) {
    const f = World.fx[i];
    f.t -= dt;
    const k = clamp(f.t / f.life, 0, 1);
    if (f.kind === 'fade') f.mesh.material.opacity = k;
    else if (f.kind === 'boom') { f.mesh.scale.setScalar(0.6 + (1 - k) * f.grow); f.mesh.material.opacity = k * 0.9; }
    else if (f.kind === 'light') f.mesh.intensity = k * 8;
    else if (f.kind === 'debris') {
      f.v.y -= 22 * dt;
      f.mesh.position.addScaledVector(f.v, dt);
      if (f.mesh.position.y < 0.05) { f.mesh.position.y = 0.05; f.v.set(0, 0, 0); }
      f.mesh.material.opacity = k;
    }
    if (f.t <= 0) { scene.remove(f.mesh); World.fx.splice(i, 1); }
  }
  for (let i = World.enemies.length - 1; i >= 0; i--) if (World.enemies[i].hp <= 0) World.enemies.splice(i, 1);
}

/* ============================================================
   ИГРА
   ============================================================ */
const Game = {
  state: 'menu', level: 0, time: 0, shakeAmt: 0, shakeY: 0, shakeR: 0, muzzleT: 0,
  wp: [], wpIdx: 0, voiceT: 8, ended: false,
  stats: { lost: 0, kills: 0, vehLost: 0, time: 0 },

  shake(v) { this.shakeAmt = Math.min(this.shakeAmt + v, 1.6); },
  hurtFlash() {
    const d = document.getElementById('dmg');
    d.style.opacity = '1'; clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { d.style.opacity = '0'; }, 170);
  },
  waypoint() { return this.level === 1 ? this.wp[this.wpIdx] : null; },

  start(skip) {
    this.stats = { lost: 0, kills: 0, vehLost: 0, time: 0 };
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('endScreen').classList.add('hidden');
    Sound.init(); Sound.resume();
    if (skip) { this.buildBattle(); this.begin(2); return; }
    this.buildSearch();
    Cut.play([
      { from: [0, 48, 200], to: [0, 26, 168], lookFrom: [0, 8, 60], lookTo: [0, 4, 100], dur: 11 },
      { from: [22, 3.4, 168], to: [-8, 2.8, 152], lookFrom: [0, 2, 150], lookTo: [0, 2, 138], dur: 11 }
    ], STORY.brief.concat(STORY.convoy), () => this.begin(1));
  },

  begin(n) {
    this.level = n; this.ended = false; this.wpIdx = 0; this.voiceT = 8;
    document.getElementById('hud').classList.remove('hidden');
    this.state = 'play';
    Input.look.yaw = 0; Input.look.pitch = 0;
    if (n === 1) {
      HUD.objective('ПРОЧЕСАТЬ ЛЕС. ДОЙТИ ДО МЕТКИ.');
      Toast.show('СЕКТОР 41-B · ДВИЖЕНИЕ НА СЕВЕР', 3.4);
    } else {
      HUD.objective('УНИЧТОЖИТЬ SCP-6789. ТЕХНИКА — ГЛАВНЫЙ УРОН.');
      Toast.show('ОГОНЬ ПО ЦЕЛИ!', 2.6);
      Sound.siren(3, 0.3);
    }
    const p = World.player;
    if (p) camRig.position.set(p.x, 1.68, p.z);
  },

  squadFormation(cx, cz) {
    const p = spawnSoldier(cx, cz, true, 0);
    World.player = p; World.units.push(p);
    for (let i = 1; i < 50; i++) {
      const side = i % 2 ? 1 : -1, row = Math.floor(i / 2);
      const ox = side * (3 + (row % 6) * 2.6), oz = 2 + Math.floor(row / 6) * 3.4;
      const u = spawnSoldier(cx + ox, cz + oz, false, i);
      u.ox = ox; u.oz = oz; World.units.push(u);
    }
  },

  buildSearch() {
    World.clear(); World.size = 170;
    scene.fog = new T.FogExp2(0x101a20, 0.020);
    scene.background = new T.Color(0x101a20);
    ambient.intensity = 1.0; moon.intensity = 1.0; moon.color.setHex(0x9fc0d8);
    addGround(200); addForest(1300, 190, 5);
    this.squadFormation(0, 140);
    World.vehicles.push(spawnVehicle('tank', -14, 158));
    World.vehicles.push(spawnVehicle('tank', 14, 158));
    World.vehicles.push(spawnVehicle('btr', -26, 164));
    World.vehicles.push(spawnVehicle('btr', 26, 164));
    this.wp = [
      { x: 4, z: 88, txt: 'СЕКТОР A · ЧИСТО', next: 'ПРОДОЛЖАТЬ ДВИЖЕНИЕ НА СЕВЕР.' },
      { x: -22, z: 32, txt: 'СЕКТОР B · ЧИСТО', next: 'В ЭФИРЕ ПОМЕХИ. ВПЕРЁД.' },
      { x: 18, z: -24, txt: 'СЕКТОР C · ЧИСТО', next: 'ЛЕС ЗАТИХ. ДОЙТИ ДО ПРОСЕКИ.' },
      { x: 0, z: -80, txt: '', next: '' }
    ];
  },

  buildBattle() {
    World.clear(); World.size = 210;
    scene.fog = new T.FogExp2(0x101a20, 0.0085);
    scene.background = new T.Color(0x101a20);
    ambient.intensity = 1.1; moon.intensity = 1.15; moon.color.setHex(0x9fc0d8);
    addGround(240); addForest(900, 230, 55);
    this.squadFormation(0, 70);
    World.vehicles.push(spawnVehicle('tank', -30, 92));
    World.vehicles.push(spawnVehicle('tank', 30, 92));
    World.vehicles.push(spawnVehicle('tank', 0, 104));
    World.vehicles.push(spawnVehicle('btr', -52, 84));
    World.vehicles.push(spawnVehicle('btr', 52, 84));
    World.vehicles.push(spawnVehicle('btr', -16, 100));
    World.vehicles.push(spawnVehicle('btr', 16, 100));
    World.vehicles.push(spawnVehicle('heli', -60, 40));
    World.vehicles.push(spawnVehicle('heli', 60, 40));
    World.boss = spawnBoss(0, -30);
  },

  contact() {
    this.state = 'cut';
    this.buildBattle();
    const b = World.boss;
    b.mesh.position.y = -15;
    Sound.siren(4.2, 0.42);
    Cut.play([
      {
        from: [7, 1.9, 88], to: [7, 2.6, 74], lookFrom: [0, 4, 20], lookTo: [0, 9, -24], dur: 9,
        onUpdate: k => { b.mesh.position.y = lerp(-15, 0, clamp(k * 1.5, 0, 1)); }
      },
      { from: [12, 7, 26], to: [5, 13, 6], lookFrom: [0, 10, -30], lookTo: [0, 13, -30], dur: 10 }
    ], STORY.contact, () => { World.boss.mesh.position.y = 0; this.begin(2); });
  },

  ragePhase() {
    if (this.state !== 'play') return;
    const b = World.boss;
    Sound.siren(3.4, 0.42);
    for (const s of b.mesh.userData.spk) s.material.emissive.setRGB(0.9, 0.15, 0.1);
    bossLight.position.set(b.x, 13, b.z); bossLight.intensity = 7;
    Cut.play([
      { from: [b.x + 9, 13, b.z + 15], to: [b.x + 4, 13.4, b.z + 9], lookFrom: [b.x, 13, b.z], lookTo: [b.x, 13.2, b.z], dur: 8 }
    ], STORY.rage, () => {
      for (const s of b.mesh.userData.spk) s.material.emissive.setRGB(0, 0, 0);
      bossLight.intensity = 0;
      this.state = 'play';
      document.getElementById('hud').classList.remove('hidden');
    });
  },

  bossDown() {
    if (this.ended) return;
    this.ended = true;
    const b = World.boss;
    explosion(new T.Vector3(b.x, 8, b.z), 26, 0, false);
    Toast.show('ЦЕЛЬ НЕЙТРАЛИЗОВАНА', 3);
    Sound.siren(3.6, 0.34);
    for (const e of World.enemies) { scene.remove(e.mesh); e.hp = 0; }
    setTimeout(() => {
      const dawn = { k: 0 };
      Cut.play([
        {
          from: [b.x + 16, 5, b.z + 28], to: [b.x + 7, 3, b.z + 19], lookFrom: [b.x, 5, b.z], lookTo: [b.x, 1.5, b.z], dur: 9,
          onUpdate: (k, dt) => {
            dawn.k = Math.min(1, dawn.k + dt * 0.16);
            const c = new T.Color(0x101a20).lerp(new T.Color(0xd08a4a), dawn.k);
            scene.background = c; scene.fog.color = c;
            moon.color.setHex(0xffd0a0); moon.intensity = 1.0 + dawn.k * 0.9;
            ambient.intensity = 1.0 + dawn.k * 0.6;
          }
        },
        { from: [b.x + 7, 3, b.z + 19], to: [b.x + 4, 10, b.z + 34], lookFrom: [b.x, 1.5, b.z], lookTo: [b.x - 40, 16, b.z - 90], dur: 12 }
      ], STORY.victory, () => this.finish(true));
    }, 2600);
  },

  reload() {
    const p = World.player;
    if (!p || p.hp <= 0 || p.reloading > 0 || p.ammo === p.mag) return;
    p.reloading = 1.6;
  },

  playerDown() {
    const next = World.units.find(u => u.hp > 0 && u.type === 'ally');
    if (!next) { this.finish(false); return; }
    next.type = 'player'; next.hp = next.max = 140;
    next.mag = 30; next.ammo = 30; next.reloading = 0;
    next.mesh.visible = false;
    World.player = next;
    Toast.show('БОЕЦ ПОГИБ · ПЕРЕХОД К СЛЕДУЮЩЕМУ', 2.4);
    this.hurtFlash(); this.shake(1.2);
  },

  finish(win) {
    this.state = 'end';
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('endTitle').textContent = win ? 'ЦЕЛЬ УНИЧТОЖЕНА' : 'ОТРЯД УНИЧТОЖЕН';
    document.getElementById('endText').textContent = win
      ? 'SCP-6789 нейтрализован. Зона оцеплена, гражданские амнезированы.'
      : 'Связь с группой потеряна. Объект остаётся в квадрате 41-B.';
    document.getElementById('endStats').innerHTML =
      `Выжило: <b>${World.aliveSquad()}</b> из 50<br>` +
      `Потери техники: <b>${this.stats.vehLost}</b><br>` +
      `Уничтожено сущностей: <b>${this.stats.kills}</b><br>` +
      `Время: <b>${Math.floor(this.stats.time / 60)}:${String(Math.floor(this.stats.time % 60)).padStart(2, '0')}</b>`;
    document.getElementById('endScreen').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  },

  togglePause() {
    if (this.state === 'play') {
      this.state = 'pause';
      document.getElementById('pause').classList.remove('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (this.state === 'pause') {
      this.state = 'play';
      document.getElementById('pause').classList.add('hidden');
    }
  },

  updateSearch(dt) {
    const p = World.player, wp = this.wp[this.wpIdx];
    if (!p || !wp) return;
    if (dist2D(p, wp) < 10) {
      this.wpIdx++;
      if (wp.txt) { Toast.show(wp.txt + ' · НИКОГО', 2.6); HUD.objective(wp.next); }
      else this.contact();
    }
    this.voiceT -= dt;
    if (this.voiceT <= 0 && this.wpIdx > 0) {
      this.voiceT = rnd(9, 16);
      Toast.show(['...кто здесь?...', '...помогите...', '...я свой, не стреляйте...', '...сюда...'][Math.floor(rnd(4))], 2.2);
    }
  }
};

/* ============================================================
   ЦИКЛ
   ============================================================ */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 0.05);
  Game.time += dt;

  if (Game.state === 'play') {
    Game.stats.time += dt;
    updatePlayer(World.player, dt);
    for (const u of World.units) if (u !== World.player && u.hp > 0) updateAlly(u, dt);
    for (const h of World.enemies) updateHusk(h, dt);
    for (const v of World.vehicles) updateVehicle(v, dt);
    if (World.boss) updateBoss(World.boss, dt);
    updateShells(dt); updateShocks(dt); updateFx(dt);
    if (Game.level === 1) Game.updateSearch(dt);
    if (World.aliveSquad() === 0 && !Game.ended) { Game.ended = true; Game.finish(false); }
    HUD.update(dt);
  } else if (Game.state === 'cut') {
    Cut.update(dt);
    for (const v of World.vehicles) if (v.type === 'heli' && v.hp > 0) v.mesh.userData.rotor.rotation.y += dt * 26;
    if (World.boss && World.boss.hp <= 0) updateBoss(World.boss, dt);
    updateFx(dt); updateShocks(dt);
  } else if (Game.state === 'menu') {
    camera.rotation.set(0, 0, 0); camera.position.set(0, 0, 0);
    camRig.position.set(Math.sin(Game.time * 0.09) * 34, 11, 26 + Math.cos(Game.time * 0.09) * 12);
    camRig.lookAt(0, 8, -26);
  }

  Toast.update(dt);
  Game.shakeAmt = Math.max(0, Game.shakeAmt - dt * 2.4);
  Game.shakeY = (Math.random() - 0.5) * Game.shakeAmt * 0.12;
  Game.shakeR = (Math.random() - 0.5) * Game.shakeAmt * 0.02;
  if (Game.muzzleT > 0) { Game.muzzleT -= dt; if (Game.muzzleT <= 0) muzzleLight.intensity = 0; }

  renderer.render(scene, camera);
}

/* ---------------- кнопки ---------------- */
document.getElementById('playBtn').onclick = () => Game.start(false);
document.getElementById('skipBtn').onclick = () => Game.start(true);
document.getElementById('pauseBtn').onclick = () => Game.togglePause();
document.getElementById('resumeBtn').onclick = () => Game.togglePause();
document.getElementById('restartBtn').onclick = () => {
  document.getElementById('pause').classList.add('hidden');
  if (Game.level === 1) { Game.buildSearch(); Game.begin(1); }
  else { Game.buildBattle(); Game.begin(2); }
};
document.getElementById('quitBtn').onclick = () => {
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  Game.state = 'menu';
  buildMenuScene();
};
document.getElementById('againBtn').onclick = () => {
  document.getElementById('endScreen').classList.add('hidden');
  Game.buildBattle(); Game.begin(2);
};
document.getElementById('menuBtn').onclick = () => {
  document.getElementById('endScreen').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  Game.state = 'menu';
  buildMenuScene();
};

/* ---------------- заставка меню ---------------- */
function buildMenuScene() {
  World.clear(); World.size = 120;
  scene.fog = new T.FogExp2(0x101a20, 0.016);
  scene.background = new T.Color(0x101a20);
  ambient.intensity = 1.05; moon.intensity = 1.1; moon.color.setHex(0x9fc0d8);
  addGround(160); addForest(700, 150, 12);
  const b = makeBoss(); b.position.set(0, 0, -26); b.rotation.y = 0.5;
  scene.add(b); World.statics.push(b);
}

/* ---------------- старт ---------------- */
Input.init();
Weapon.init();
resize();
buildMenuScene();
document.getElementById('loading').classList.add('hidden');
requestAnimationFrame(loop);
