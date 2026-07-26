/* ============================================================
   src/fx.js — эффекты: трассеры, вспышки, дым, искры, кровь,
   воронки-декали, гильзы, взрывы, ударные волны, пыль.
   Всё на пулах объектов — без аллокаций в игровом цикле.
   ============================================================ */
'use strict';

const FX = (() => {
  const T = THREE;

  class System {
    constructor(scene, terrain, quality = 'high') {
      this.scene = scene;
      this.terrain = terrain;
      this.quality = quality;
      this.time = 0;

      this.active = [];
      this.lights = [];
      this.decals = [];
      this.maxDecals = quality === 'low' ? 40 : quality === 'medium' ? 90 : 160;

      this.initTracers();
      this.initSprites();
      this.initCasings();
      this.initDebris();
      this.initLights();
      this.initShockwaves();
      this.initDecals();
    }

    /* ---------------------------------------------------------
       ТРАССЕРЫ — один InstancedMesh из вытянутых боксов
       --------------------------------------------------------- */
    initTracers() {
      const N = this.quality === 'low' ? 90 : 220;
      const geo = new T.BoxGeometry(0.035, 0.035, 1);
      const mat = new T.MeshBasicMaterial({
        color: 0xffd98a, transparent: true, opacity: 0.95,
        blending: T.AdditiveBlending, depthWrite: false
      });
      this.tracerMesh = new T.InstancedMesh(geo, mat, N);
      this.tracerMesh.frustumCulled = false;
      this.tracerMesh.count = N;
      this.scene.add(this.tracerMesh);
      this.tracers = [];
      const zero = new T.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < N; i++) {
        this.tracerMesh.setMatrixAt(i, zero);
        this.tracers.push({ alive: false, t: 0, life: 0, from: new T.Vector3(), to: new T.Vector3(), speed: 0, len: 0, dist: 0, cur: 0 });
      }
      this.tracerMesh.instanceMatrix.needsUpdate = true;
      this._m = new T.Matrix4();
      this._q = new T.Quaternion();
      this._v = new T.Vector3();
      this._v2 = new T.Vector3();
      this._up = new T.Vector3(0, 0, 1);
    }

    tracer(from, to, opts = {}) {
      const slot = this.tracers.find(t => !t.alive);
      if (!slot) return;
      slot.alive = true;
      slot.from.copy(from);
      slot.to.copy(to);
      slot.dist = from.distanceTo(to);
      slot.speed = opts.speed || 420;
      slot.len = opts.len || Math.min(8, slot.dist * 0.4);
      slot.cur = 0;
      slot.life = slot.dist / slot.speed;
      slot.t = 0;
    }

    updateTracers(dt) {
      const m = this._m, q = this._q, v = this._v, v2 = this._v2;
      let idx = 0;
      for (const tr of this.tracers) {
        if (!tr.alive) { this.tracerMesh.setMatrixAt(idx++, new T.Matrix4().makeScale(0, 0, 0)); continue; }
        tr.t += dt;
        tr.cur = Math.min(tr.dist, tr.cur + tr.speed * dt);
        if (tr.t >= tr.life) { tr.alive = false; }
        // положение головы трассера
        v.copy(tr.to).sub(tr.from);
        const dir = v.clone().normalize();
        const head = tr.from.clone().addScaledVector(dir, tr.cur);
        const tail = head.clone().addScaledVector(dir, -Math.min(tr.len, tr.cur));
        const mid = head.clone().add(tail).multiplyScalar(0.5);
        const len = head.distanceTo(tail) || 0.01;
        q.setFromUnitVectors(this._up, dir);
        m.compose(mid, q, v2.set(1, 1, len));
        this.tracerMesh.setMatrixAt(idx++, m);
      }
      this.tracerMesh.instanceMatrix.needsUpdate = true;
    }

    /* ---------------------------------------------------------
       СПРАЙТЫ: дым, искры, вспышки, кровь
       --------------------------------------------------------- */
    initSprites() {
      const cap = this.quality === 'low' ? 160 : this.quality === 'medium' ? 320 : 560;
      this.spriteCap = cap;
      this.sprites = [];
      this.spriteFree = [];
      const mkMat = (tex, color, blending) => new T.SpriteMaterial({
        map: TEX.get(tex), color, transparent: true, depthWrite: false,
        blending: blending || T.NormalBlending, opacity: 1
      });
      this.spriteMats = {
        smoke: mkMat('smoke', 0x9aa2a8),
        smokeDark: mkMat('smoke', 0x3a3d40),
        fire: mkMat('spark', 0xffb060, T.AdditiveBlending),
        spark: mkMat('spark', 0xffdca0, T.AdditiveBlending),
        blood: mkMat('blood', 0xa01820),
        dust: mkMat('smoke', 0x6d6455),
        flash: mkMat('flash', 0xfff0c0, T.AdditiveBlending)
      };
      for (let i = 0; i < cap; i++) {
        const s = new T.Sprite(this.spriteMats.smoke.clone());
        s.visible = false;
        s.matrixAutoUpdate = true;
        this.scene.add(s);
        const o = {
          sprite: s, alive: false, t: 0, life: 1,
          vel: new T.Vector3(), grav: 0, drag: 1, size0: 1, size1: 2,
          op0: 1, op1: 0, rot: 0, rotSpeed: 0, kind: 'smoke'
        };
        this.sprites.push(o);
        this.spriteFree.push(o);
      }
    }

    spawnSprite(kind, pos, opts = {}) {
      const o = this.spriteFree.pop();
      if (!o) return null;
      o.alive = true;
      o.kind = kind;
      o.t = 0;
      o.life = opts.life || 1;
      o.vel.set(opts.vx || 0, opts.vy || 0, opts.vz || 0);
      o.grav = opts.grav !== undefined ? opts.grav : -1.5;
      o.drag = opts.drag !== undefined ? opts.drag : 1.2;
      o.size0 = opts.size0 !== undefined ? opts.size0 : 1;
      o.size1 = opts.size1 !== undefined ? opts.size1 : o.size0 * 2;
      o.op0 = opts.op0 !== undefined ? opts.op0 : 0.85;
      o.op1 = opts.op1 !== undefined ? opts.op1 : 0;
      o.rot = opts.rot || U.rand(U.TAU);
      o.rotSpeed = opts.rotSpeed !== undefined ? opts.rotSpeed : U.rand(-1, 1);
      const s = o.sprite;
      s.material = this.spriteMats[kind] ? this.spriteMats[kind].clone() : this.spriteMats.smoke.clone();
      if (opts.color) s.material.color.setHex(opts.color);
      s.material.opacity = o.op0;
      s.material.rotation = o.rot;
      s.position.copy(pos);
      s.scale.setScalar(o.size0);
      s.visible = true;
      this.active.push(o);
      return o;
    }

    updateSprites(dt) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const o = this.active[i];
        o.t += dt;
        const k = U.clamp01(o.t / o.life);
        o.vel.y += o.grav * dt;
        o.vel.multiplyScalar(Math.exp(-o.drag * dt));
        o.sprite.position.addScaledVector(o.vel, dt);
        const sc = U.lerp(o.size0, o.size1, k);
        o.sprite.scale.setScalar(sc);
        o.sprite.material.opacity = U.lerp(o.op0, o.op1, k);
        o.sprite.material.rotation += o.rotSpeed * dt;
        if (k >= 1) {
          o.alive = false;
          o.sprite.visible = false;
          this.active.splice(i, 1);
          this.spriteFree.push(o);
        }
      }
    }

    /* ---------------------------------------------------------
       ГИЛЬЗЫ
       --------------------------------------------------------- */
    initCasings() {
      const N = this.quality === 'low' ? 12 : 40;
      this.casings = [];
      for (let i = 0; i < N; i++) {
        const m = Models.makeCasing();
        m.visible = false;
        this.scene.add(m);
        this.casings.push({
          mesh: m, alive: false, t: 0, life: 2.6,
          vel: new T.Vector3(), spin: new T.Vector3()
        });
      }
    }
    ejectCasing(pos, dir) {
      const c = this.casings.find(c => !c.alive);
      if (!c) return;
      c.alive = true; c.t = 0;
      c.mesh.visible = true;
      c.mesh.position.copy(pos);
      c.vel.set(dir.x * 1.5 + U.rand(-0.4, 0.4), U.rand(1.6, 2.6), dir.z * 1.5 + U.rand(-0.4, 0.4));
      c.spin.set(U.rand(-14, 14), U.rand(-14, 14), U.rand(-14, 14));
    }
    updateCasings(dt) {
      for (const c of this.casings) {
        if (!c.alive) continue;
        c.t += dt;
        c.vel.y -= 12 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
        const groundY = this.terrain ? this.terrain.height(c.mesh.position.x, c.mesh.position.z) : 0;
        if (c.mesh.position.y < groundY + 0.02) {
          c.mesh.position.y = groundY + 0.02;
          c.vel.multiplyScalar(0.3);
          c.vel.y = Math.abs(c.vel.y) * 0.25;
          c.spin.multiplyScalar(0.4);
        }
        if (c.t > c.life) { c.alive = false; c.mesh.visible = false; }
      }
    }

    /* ---------------------------------------------------------
       ОБЛОМКИ (при взрывах техники)
       --------------------------------------------------------- */
    initDebris() {
      const N = this.quality === 'low' ? 14 : 46;
      this.debris = [];
      for (let i = 0; i < N; i++) {
        const m = Models.makeDebris();
        m.visible = false;
        this.scene.add(m);
        this.debris.push({ mesh: m, alive: false, t: 0, life: 5, vel: new T.Vector3(), spin: new T.Vector3() });
      }
    }
    spawnDebris(pos, count, power = 8) {
      for (let i = 0; i < count; i++) {
        const d = this.debris.find(d => !d.alive);
        if (!d) return;
        d.alive = true; d.t = 0;
        d.life = U.rand(3, 6);
        const s = U.rand(0.15, 0.5);
        d.mesh.scale.set(s, s * U.rand(0.4, 1.2), s * U.rand(0.5, 1.5));
        d.mesh.position.copy(pos);
        d.mesh.visible = true;
        const a = U.rand(U.TAU);
        d.vel.set(Math.cos(a) * U.rand(1, power), U.rand(power * 0.4, power), Math.sin(a) * U.rand(1, power));
        d.spin.set(U.rand(-10, 10), U.rand(-10, 10), U.rand(-10, 10));
      }
    }
    updateDebris(dt) {
      for (const d of this.debris) {
        if (!d.alive) continue;
        d.t += dt;
        d.vel.y -= 16 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.z += d.spin.z * dt;
        const gy = this.terrain ? this.terrain.height(d.mesh.position.x, d.mesh.position.z) : 0;
        if (d.mesh.position.y < gy + 0.1) {
          d.mesh.position.y = gy + 0.1;
          d.vel.set(d.vel.x * 0.4, Math.abs(d.vel.y) * 0.2, d.vel.z * 0.4);
          d.spin.multiplyScalar(0.5);
        }
        if (d.t > d.life) { d.alive = false; d.mesh.visible = false; }
      }
    }

    /* ---------------------------------------------------------
       ДИНАМИЧЕСКИЕ ИСТОЧНИКИ СВЕТА (пул)
       --------------------------------------------------------- */
    initLights() {
      const N = this.quality === 'low' ? 3 : this.quality === 'medium' ? 5 : 8;
      for (let i = 0; i < N; i++) {
        const l = new T.PointLight(0xffaa55, 0, 60, 2);
        l.visible = false;
        this.scene.add(l);
        this.lights.push({ light: l, alive: false, t: 0, life: 0.3, peak: 100 });
      }
    }
    flashLight(pos, color, peak, life, distance) {
      const item = this.lights.find(l => !l.alive) || this.lights[0];
      item.alive = true; item.t = 0; item.life = life || 0.25; item.peak = peak || 120;
      item.light.color.setHex(color || 0xffaa55);
      item.light.distance = distance || 60;
      item.light.position.copy(pos);
      item.light.visible = true;
      return item;
    }
    updateLights(dt) {
      for (const it of this.lights) {
        if (!it.alive) continue;
        it.t += dt;
        const k = U.clamp01(1 - it.t / it.life);
        it.light.intensity = it.peak * k * k;
        if (it.t >= it.life) { it.alive = false; it.light.visible = false; it.light.intensity = 0; }
      }
    }

    /* ---------------------------------------------------------
       УДАРНЫЕ ВОЛНЫ
       --------------------------------------------------------- */
    initShockwaves() {
      this.shockPool = [];
      for (let i = 0; i < 6; i++) {
        const geo = new T.RingGeometry(0.9, 1, 48);
        geo.rotateX(-Math.PI / 2);
        const mat = new T.MeshBasicMaterial({
          color: 0xff6a4a, transparent: true, opacity: 0,
          side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending
        });
        const m = new T.Mesh(geo, mat);
        m.visible = false;
        this.scene.add(m);
        this.shockPool.push({ mesh: m, alive: false, r: 0, max: 10, t: 0, life: 1 });
      }
      this.shocks = [];
    }
    shockwave(x, z, maxR, speed, color) {
      const s = this.shockPool.find(s => !s.alive);
      if (!s) return null;
      s.alive = true; s.r = 1; s.max = maxR; s.t = 0;
      s.life = maxR / (speed || 45);
      s.mesh.visible = true;
      s.mesh.material.color.setHex(color || 0xff6a4a);
      s.mesh.position.set(x, (this.terrain ? this.terrain.height(x, z) : 0) + 0.35, z);
      return s;
    }
    updateShockwaves(dt) {
      for (const s of this.shockPool) {
        if (!s.alive) continue;
        s.t += dt;
        const k = U.clamp01(s.t / s.life);
        s.r = U.lerp(1, s.max, k);
        s.mesh.scale.setScalar(s.r);
        s.mesh.material.opacity = (1 - k) * 0.75;
        if (k >= 1) { s.alive = false; s.mesh.visible = false; }
      }
    }

    /* ---------------------------------------------------------
       ДЕКАЛИ (воронки, кровь) — плоские плашки на рельефе
       --------------------------------------------------------- */
    initDecals() {
      this.decalGeo = new T.PlaneGeometry(1, 1);
      this.decalGeo.rotateX(-Math.PI / 2);
    }
    decal(kind, x, z, size, rot) {
      const mat = new T.MeshBasicMaterial({
        map: TEX.get(kind === 'blood' ? 'blood' : 'crater'),
        transparent: true, depthWrite: false, opacity: kind === 'blood' ? 0.8 : 0.92,
        color: kind === 'blood' ? 0x8c1414 : 0xffffff
      });
      const m = new T.Mesh(this.decalGeo, mat);
      m.position.set(x, (this.terrain ? this.terrain.height(x, z) : 0) + 0.04 + Math.random() * 0.02, z);
      m.rotation.y = rot !== undefined ? rot : U.rand(U.TAU);
      m.scale.setScalar(size);
      m.renderOrder = 2;
      this.scene.add(m);
      this.decals.push({ mesh: m, t: 0 });
      if (this.decals.length > this.maxDecals) {
        const old = this.decals.shift();
        this.scene.remove(old.mesh);
        old.mesh.material.dispose();
      }
      return m;
    }

    /* ---------------------------------------------------------
       ГОТОВЫЕ КОМБО-ЭФФЕКТЫ
       --------------------------------------------------------- */
    muzzleFlash(pos, dir, scale = 1) {
      this.spawnSprite('flash', pos, {
        life: 0.06, size0: 1.4 * scale, size1: 1.9 * scale,
        op0: 0.95, op1: 0, grav: 0, drag: 0
      });
      this.spawnSprite('smokeDark', pos, {
        life: 0.6, size0: 0.35 * scale, size1: 1.5 * scale,
        op0: 0.28, op1: 0, grav: 0.4, drag: 2,
        vx: dir.x * 2, vy: dir.y * 2 + 0.4, vz: dir.z * 2
      });
      this.flashLight(pos, 0xffc070, 45 * scale, 0.07, 22 * scale);
    }

    impact(pos, normal, material = 'dirt') {
      const n = normal || new T.Vector3(0, 1, 0);
      const count = this.quality === 'low' ? 3 : 6;
      for (let i = 0; i < count; i++) {
        this.spawnSprite('spark', pos, {
          life: U.rand(0.15, 0.35), size0: 0.09, size1: 0.02,
          op0: 1, op1: 0, grav: -6, drag: 1.5,
          vx: n.x * 3 + U.rand(-2.5, 2.5),
          vy: n.y * 3 + U.rand(0.5, 3),
          vz: n.z * 3 + U.rand(-2.5, 2.5)
        });
      }
      this.spawnSprite(material === 'metal' ? 'smokeDark' : 'dust', pos, {
        life: 0.7, size0: 0.3, size1: 1.2, op0: 0.4, op1: 0,
        grav: 0.2, drag: 2.2, vy: 0.6
      });
    }

    bloodHit(pos, dir) {
      const n = this.quality === 'low' ? 3 : 7;
      for (let i = 0; i < n; i++) {
        this.spawnSprite('blood', pos, {
          life: U.rand(0.3, 0.6), size0: U.rand(0.1, 0.28), size1: U.rand(0.3, 0.6),
          op0: 0.9, op1: 0, grav: -7, drag: 1.4,
          vx: dir.x * 2 + U.rand(-1.6, 1.6),
          vy: U.rand(0.4, 2.4),
          vz: dir.z * 2 + U.rand(-1.6, 1.6)
        });
      }
    }

    explosion(pos, radius, opts = {}) {
      const big = radius > 8;
      // огненное ядро
      for (let i = 0; i < (big ? 10 : 5); i++) {
        this.spawnSprite('fire', pos, {
          life: U.rand(0.25, 0.55), size0: radius * 0.25, size1: radius * U.rand(0.8, 1.3),
          op0: 1, op1: 0, grav: 2.5, drag: 2.2,
          vx: U.rand(-3, 3), vy: U.rand(1, 5), vz: U.rand(-3, 3)
        });
      }
      // дым
      for (let i = 0; i < (big ? 12 : 6); i++) {
        this.spawnSprite('smokeDark', pos, {
          life: U.rand(1.6, 3.2), size0: radius * 0.3, size1: radius * U.rand(1.4, 2.4),
          op0: 0.7, op1: 0, grav: 0.9, drag: 0.7,
          vx: U.rand(-4, 4), vy: U.rand(1.5, 4.5), vz: U.rand(-4, 4),
          rotSpeed: U.rand(-0.6, 0.6)
        });
      }
      // искры
      for (let i = 0; i < (big ? 20 : 10); i++) {
        this.spawnSprite('spark', pos, {
          life: U.rand(0.3, 0.9), size0: 0.16, size1: 0.03,
          op0: 1, op1: 0, grav: -10, drag: 0.8,
          vx: U.rand(-12, 12), vy: U.rand(2, 14), vz: U.rand(-12, 12)
        });
      }
      // пыль по земле
      const gy = this.terrain ? this.terrain.height(pos.x, pos.z) : 0;
      if (pos.y - gy < radius) {
        for (let i = 0; i < (big ? 10 : 5); i++) {
          const a = U.rand(U.TAU);
          this.spawnSprite('dust', new T.Vector3(pos.x, gy + 0.4, pos.z), {
            life: U.rand(1.2, 2.4), size0: radius * 0.3, size1: radius * 1.6,
            op0: 0.55, op1: 0, grav: 0.1, drag: 1.4,
            vx: Math.cos(a) * radius * 0.8, vy: 0.6, vz: Math.sin(a) * radius * 0.8
          });
        }
        this.decal('crater', pos.x, pos.z, radius * 1.4);
      }
      this.flashLight(pos, opts.color || 0xffa050, radius * 45, 0.35, radius * 8);
      this.spawnDebris(pos, big ? 8 : 3, radius * 1.2);
      return true;
    }

    smokeColumn(pos, intensity = 1) {
      this.spawnSprite('smokeDark', pos, {
        life: U.rand(2.5, 4.5), size0: 1.2 * intensity, size1: 6 * intensity,
        op0: 0.5, op1: 0, grav: 1.4, drag: 0.35,
        vx: U.rand(-0.6, 0.6), vy: U.rand(1.4, 2.6), vz: U.rand(-0.6, 0.6),
        rotSpeed: U.rand(-0.4, 0.4)
      });
    }

    dustBurst(pos, radius, count = 6) {
      for (let i = 0; i < count; i++) {
        const a = U.rand(U.TAU);
        this.spawnSprite('dust', pos, {
          life: U.rand(0.8, 1.8), size0: radius * 0.3, size1: radius * 1.2,
          op0: 0.45, op1: 0, grav: 0.2, drag: 1.8,
          vx: Math.cos(a) * radius, vy: U.rand(0.3, 1.2), vz: Math.sin(a) * radius
        });
      }
    }

    footstepDust(pos) {
      if (this.quality === 'low') return;
      this.spawnSprite('dust', pos, {
        life: 0.5, size0: 0.15, size1: 0.6, op0: 0.25, op1: 0,
        grav: 0.1, drag: 2.4, vy: 0.3
      });
    }

    /* ---------------------------------------------------------
       ОБНОВЛЕНИЕ
       --------------------------------------------------------- */
    update(dt, camera) {
      this.time += dt;
      this.updateTracers(dt);
      this.updateSprites(dt);
      this.updateCasings(dt);
      this.updateDebris(dt);
      this.updateLights(dt);
      this.updateShockwaves(dt);
    }

    clear() {
      for (const o of this.active) { o.alive = false; o.sprite.visible = false; this.spriteFree.push(o); }
      this.active.length = 0;
      for (const t of this.tracers) t.alive = false;
      for (const c of this.casings) { c.alive = false; c.mesh.visible = false; }
      for (const d of this.debris) { d.alive = false; d.mesh.visible = false; }
      for (const l of this.lights) { l.alive = false; l.light.visible = false; l.light.intensity = 0; }
      for (const s of this.shockPool) { s.alive = false; s.mesh.visible = false; }
      for (const d of this.decals) { this.scene.remove(d.mesh); d.mesh.material.dispose(); }
      this.decals.length = 0;
    }

    dispose() {
      this.clear();
      this.scene.remove(this.tracerMesh);
      this.tracerMesh.geometry.dispose();
      this.tracerMesh.material.dispose();
      for (const s of this.sprites) { this.scene.remove(s.sprite); }
      for (const c of this.casings) this.scene.remove(c.mesh);
      for (const d of this.debris) this.scene.remove(d.mesh);
      for (const l of this.lights) this.scene.remove(l.light);
      for (const s of this.shockPool) this.scene.remove(s.mesh);
    }
  }

  return { System };
})();
