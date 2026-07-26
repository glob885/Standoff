/* ============================================================
   src/game.js — ядро игры v2:
   мир, игрок от первого лица, ИИ-менеджер, снаряды,
   катсцены, уровни, HUD, ввод (ПК + телефон), цикл.
   ============================================================ */
'use strict';

const Game = (() => {
  const T = THREE;

  /* ============================================================
     ВВОД
     ============================================================ */
  class InputManager {
    constructor(canvas) {
      this.canvas = canvas;
      this.keys = {};
      this.yaw = 0; this.pitch = 0;
      this.move = { x: 0, y: 0 };
      this.firing = false;
      this.ads = false;
      this.sprint = false;
      this.locked = false;
      this.touch = U.isMobile();
      this.sensitivity = U.Store.read('sens', 1.0);
      this.invertY = U.Store.read('invertY', false);
      this.onPause = null;
      this.onReload = null;
      this.onInteract = null;
      this.bind();
    }

    bind() {
      addEventListener('keydown', e => {
        this.keys[e.code] = true;
        if (e.code === 'KeyR' && this.onReload) this.onReload();
        if (e.code === 'Escape' && this.onPause) this.onPause();
        if (e.code === 'KeyF' && this.onInteract) this.onInteract();
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      });
      addEventListener('keyup', e => { this.keys[e.code] = false; });
      addEventListener('blur', () => { this.keys = {}; this.firing = false; });

      this.canvas.addEventListener('mousedown', e => {
        if (e.button === 0) this.firing = true;
        if (e.button === 2) this.ads = true;
      });
      addEventListener('mouseup', e => {
        if (e.button === 0) this.firing = false;
        if (e.button === 2) this.ads = false;
      });
      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
      addEventListener('mousemove', e => {
        if (!this.locked) return;
        const s = 0.0022 * this.sensitivity;
        this.yaw -= e.movementX * s;
        this.pitch += (this.invertY ? 1 : -1) * e.movementY * s;
        this.pitch = U.clamp(this.pitch, -1.35, 1.3);
      });
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.canvas;
      });

      // тач-управление берёт на себя TouchUI (src/touch.js)
    }

    requestLock() {
      if (!this.touch && this.canvas.requestPointerLock) this.canvas.requestPointerLock();
    }
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    }

    bindTouch() {
      const stick = document.getElementById('stickL');
      const knob = stick.querySelector('.knob');
      const R = 54;
      let stickId = null, cx = 0, cy = 0;
      const startS = e => {
        const t = e.changedTouches[0];
        stickId = t.identifier;
        const r = stick.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        stick.classList.add('active');
        moveS(e);
      };
      const moveS = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== stickId) continue;
          let dx = t.clientX - cx, dy = t.clientY - cy;
          const d = Math.hypot(dx, dy) || 1;
          const k = Math.min(d, R) / d;
          dx *= k; dy *= k;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.move.x = dx / R; this.move.y = dy / R;
        }
      };
      const endS = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== stickId) continue;
          stickId = null; this.move.x = this.move.y = 0;
          knob.style.transform = 'translate(0,0)';
          stick.classList.remove('active');
        }
      };
      stick.addEventListener('touchstart', e => { e.preventDefault(); startS(e); }, { passive: false });
      stick.addEventListener('touchmove', e => { e.preventDefault(); moveS(e); }, { passive: false });
      stick.addEventListener('touchend', e => { e.preventDefault(); endS(e); }, { passive: false });
      stick.addEventListener('touchcancel', endS);

      // обзор свайпом по правой половине
      const look = document.getElementById('lookArea');
      let lookId = null, lx = 0, ly = 0, moved = 0;
      look.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        lookId = t.identifier; lx = t.clientX; ly = t.clientY; moved = 0;
      }, { passive: false });
      look.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier !== lookId) continue;
          const dx = t.clientX - lx, dy = t.clientY - ly;
          moved += Math.abs(dx) + Math.abs(dy);
          const s = 0.0055 * this.sensitivity;
          this.yaw -= dx * s;
          this.pitch += (this.invertY ? 1 : -1) * dy * s;
          this.pitch = U.clamp(this.pitch, -1.35, 1.3);
          lx = t.clientX; ly = t.clientY;
        }
      }, { passive: false });
      const endL = e => {
        for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
      };
      look.addEventListener('touchend', e => { e.preventDefault(); endL(e); }, { passive: false });
      look.addEventListener('touchcancel', endL);

      const hold = (id, on, off) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', e => { e.preventDefault(); on(); }, { passive: false });
        el.addEventListener('touchend', e => { e.preventDefault(); if (off) off(); }, { passive: false });
        el.addEventListener('touchcancel', e => { if (off) off(); });
      };
      hold('fireBtn', () => { this.firing = true; }, () => { this.firing = false; });
      hold('adsBtn', () => { this.ads = !this.ads; });
      hold('sprintBtn', () => { this.sprint = true; }, () => { this.sprint = false; });
      hold('reloadBtn', () => { if (this.onReload) this.onReload(); });
    }

    isSprinting() {
      return this.sprint || this.keys.ShiftLeft || this.keys.ShiftRight;
    }
    getMove() {
      if (this.touch) return { x: this.move.x, y: this.move.y };
      let x = 0, y = 0;
      if (this.keys.KeyW || this.keys.ArrowUp) y -= 1;
      if (this.keys.KeyS || this.keys.ArrowDown) y += 1;
      if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
      if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
      return { x, y };
    }
  }

  /* ============================================================
     HUD
     ============================================================ */
  class HUD {
    constructor() {
      this.el = {
        root: document.getElementById('hud'),
        squad: document.getElementById('squadAlive'),
        obj: document.getElementById('objText'),
        hp: document.getElementById('hpFill'),
        hpNum: document.getElementById('hpNum'),
        ammo: document.getElementById('ammoNow'),
        ammoMax: document.getElementById('ammoMax'),
        reserve: document.getElementById('ammoReserve'),
        bossBar: document.getElementById('bossBar'),
        bossFill: document.getElementById('bossFill'),
        bossPhase: document.getElementById('bossPhase'),
        toast: document.getElementById('toast'),
        hitmark: document.getElementById('hitmark'),
        crosshair: document.getElementById('crosshair'),
        compass: document.getElementById('compass'),
        compassArrow: document.getElementById('compassArrow'),
        compassDist: document.getElementById('compassDist'),
        subtitle: document.getElementById('subtitle'),
        fps: document.getElementById('fpsCounter'),
        reload: document.getElementById('reloadIndicator')
      };
      this.toastT = 0;
      this.hitT = 0;
      this.killT = 0;
    }
    show() { this.el.root.classList.remove('hidden'); }
    hide() { this.el.root.classList.add('hidden'); }
    toast(text, time = 2.4) {
      this.el.toast.textContent = text;
      this.el.toast.classList.add('show');
      this.toastT = time;
    }
    subtitle(text) {
      if (!this.el.subtitle) return;
      this.el.subtitle.textContent = text || '';
      this.el.subtitle.classList.toggle('show', !!text);
    }
    hit(kill) {
      this.el.hitmark.classList.add('on');
      this.el.hitmark.classList.toggle('kill', !!kill);
      this.hitT = kill ? 0.22 : 0.1;
    }
    objective(text) { this.el.obj.textContent = text; }
    update(dt, game) {
      if (this.toastT > 0) {
        this.toastT -= dt;
        if (this.toastT <= 0) this.el.toast.classList.remove('show');
      }
      if (this.hitT > 0) {
        this.hitT -= dt;
        if (this.hitT <= 0) { this.el.hitmark.classList.remove('on'); this.el.hitmark.classList.remove('kill'); }
      }
      const p = game.player;
      if (p) {
        const hpPct = U.clamp01(p.hp / p.maxHp) * 100;
        this.el.hp.style.width = hpPct + '%';
        if (this.el.hpNum) this.el.hpNum.textContent = Math.ceil(p.hp);
        this.el.ammo.textContent = p.reloading > 0 ? '—' : p.ammo;
        this.el.ammoMax.textContent = p.mag;
        if (this.el.reserve) this.el.reserve.textContent = p.reserve;
        if (this.el.reload) this.el.reload.classList.toggle('show', p.reloading > 0);
      }
      this.el.squad.textContent = game.world.aliveSoldiers();

      const boss = game.world.boss;
      if (boss && !boss.dead && game.state === 'play') {
        this.el.bossBar.classList.remove('hidden');
        this.el.bossFill.style.width = U.clamp01(boss.hp / boss.maxHp) * 100 + '%';
        this.el.bossPhase.textContent = 'ФАЗА ' + ['I', 'II', 'III'][boss.phase - 1] +
          (boss.vuln > 0 ? ' · УЯЗВИМ' : '');
        this.el.bossPhase.classList.toggle('vuln', boss.vuln > 0);
      } else this.el.bossBar.classList.add('hidden');

      // компас на цель
      const target = (boss && !boss.dead) ? boss : game.currentWaypoint();
      if (target && p) {
        const ang = Math.atan2(target.x - p.x, target.z - p.z);
        const rel = U.wrapPi(ang - game.input.yaw - Math.PI);
        const visible = Math.abs(rel) > 0.35;
        this.el.compass.style.display = visible ? 'block' : 'none';
        this.el.compassArrow.style.transform = `rotate(${-rel}rad)`;
        this.el.compassDist.textContent = Math.round(Math.hypot(target.x - p.x, target.z - p.z)) + ' м';
      } else if (this.el.compass) this.el.compass.style.display = 'none';

      if (this.el.fps && game.settings.showFps) {
        this.el.fps.textContent = Math.round(game.perf.avg()) + ' FPS';
        this.el.fps.classList.remove('hidden');
      } else if (this.el.fps) this.el.fps.classList.add('hidden');

      // разброс прицела
      if (this.el.crosshair && p) {
        const spread = 6 + game.player.spreadVisual * 26;
        this.el.crosshair.style.setProperty('--gap', spread + 'px');
      }
    }
  }

  /* ============================================================
     МИР
     ============================================================ */
  class World {
    constructor(ctx) {
      this.ctx = ctx;
      this.soldiers = [];
      this.husks = [];
      this.vehicles = [];
      this.boss = null;
      this.shells = [];
      this.rings = [];
      this.grid = new U.Grid(8);
      this.gridT = 0;
      this._q = [];
    }

    clearAll() {
      for (const s of this.soldiers) s.remove();
      for (const h of this.husks) h.remove();
      for (const v of this.vehicles) v.remove();
      if (this.boss) this.boss.remove();
      for (const s of this.shells) this.ctx.scene.remove(s.mesh);
      this.soldiers = []; this.husks = []; this.vehicles = [];
      this.boss = null; this.shells = []; this.rings = [];
    }

    aliveSoldiers() { let n = 0; for (const s of this.soldiers) if (!s.dead) n++; return n; }
    aliveVehicles() { let n = 0; for (const v of this.vehicles) if (!v.wrecked) n++; return n; }

    rebuildGrid() {
      this.grid.clear();
      for (const s of this.soldiers) if (!s.dead) this.grid.insert(s);
    }
    querySoldiers(x, z, r) { return this.grid.query(x, z, r, this._q); }

    findSoldierNear(x, z, range) {
      let best = null, bd = range * range;
      for (const s of this.soldiers) {
        if (s.dead) continue;
        const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    }
    findEnemyNear(from, range) {
      let best = null, bd = range * range;
      for (const h of this.husks) {
        if (h.dead) continue;
        const d = (h.x - from.x) * (h.x - from.x) + (h.z - from.z) * (h.z - from.z);
        if (d < bd) { bd = d; best = h; }
      }
      if (this.boss && !this.boss.dead) {
        const d = (this.boss.x - from.x) ** 2 + (this.boss.z - from.z) ** 2;
        if (d < (range * 1.6) ** 2 && (!best || d < bd * 1.6)) best = this.boss;
      }
      return best;
    }
    findBossTarget(boss) {
      let best = null, bd = 1e9;
      for (const s of this.soldiers) {
        if (s.dead) continue;
        const d = (s.x - boss.x) ** 2 + (s.z - boss.z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      for (const v of this.vehicles) {
        if (v.wrecked || v.kind === 'heli') continue;
        const d = (v.x - boss.x) ** 2 + (v.z - boss.z) ** 2;
        if (d < bd * 0.65) { bd = d; best = v; }
      }
      return best;
    }

    spawnHusk(x, z) {
      const h = new Entities.Husk(this.ctx, x, z);
      this.husks.push(h);
      this.ctx.fx.dustBurst(new T.Vector3(x, this.ctx.terrain.height(x, z), z), 2.4, 4);
      return h;
    }

    /* --- снаряды --- */
    spawnShell(from, to, speed, dmg, radius, owner) {
      const geo = new T.SphereGeometry(0.22, 8, 6);
      const mat = new T.MeshBasicMaterial({ color: 0xffcc88 });
      const mesh = new T.Mesh(geo, mat);
      mesh.position.copy(from);
      this.ctx.scene.add(mesh);
      const dir = to.clone().sub(from).normalize();
      this.shells.push({
        mesh, vel: dir.multiplyScalar(speed), dmg, radius, owner,
        life: 6, trail: 0, rocket: false
      });
    }
    spawnRocket(from, to, speed, dmg, radius, owner) {
      const geo = new T.CylinderGeometry(0.09, 0.09, 0.8, 6);
      geo.rotateX(Math.PI / 2);
      const mat = new T.MeshBasicMaterial({ color: 0xdddddd });
      const mesh = new T.Mesh(geo, mat);
      mesh.position.copy(from);
      mesh.lookAt(to);
      this.ctx.scene.add(mesh);
      const dir = to.clone().sub(from).normalize();
      this.shells.push({
        mesh, vel: dir.multiplyScalar(speed), dmg, radius, owner,
        life: 6, trail: 0, rocket: true
      });
    }

    updateShells(dt) {
      const fx = this.ctx.fx;
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        s.life -= dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        if (s.rocket) {
          s.trail -= dt;
          if (s.trail <= 0) {
            s.trail = 0.02;
            fx.spawnSprite('smokeDark', s.mesh.position, {
              life: 0.9, size0: 0.4, size1: 2.2, op0: 0.5, op1: 0, grav: 0.3, drag: 1.5
            });
          }
        }
        let hit = false;
        const p = s.mesh.position;
        const gy = this.ctx.terrain.height(p.x, p.z);
        if (p.y <= gy + 0.2) hit = true;
        // босс
        const boss = this.boss;
        if (!hit && boss && !boss.dead) {
          for (const sp of boss.hitSpheres()) {
            if (p.distanceToSquared(new T.Vector3(sp.x, sp.y, sp.z)) < (sp.r + 0.6) ** 2) { hit = true; break; }
          }
        }
        if (!hit) {
          for (const h of this.husks) {
            if (h.dead) continue;
            if (Math.hypot(p.x - h.x, p.z - h.z) < 1.4 && Math.abs(p.y - (h.y + 1)) < 1.6) { hit = true; break; }
          }
        }
        if (hit || s.life <= 0) {
          this.explodeAt(p.clone(), s.radius, s.dmg);
          this.ctx.scene.remove(s.mesh);
          s.mesh.geometry.dispose(); s.mesh.material.dispose();
          this.shells.splice(i, 1);
        }
      }
    }

    explodeAt(pos, radius, dmg) {
      this.ctx.fx.explosion(pos, radius);
      this.ctx.audio.explosion({ x: pos.x, z: pos.z }, radius / 9);
      if (this.ctx.game) this.ctx.game.shake(radius * 0.06, this.ctx.game.player ? Math.hypot(pos.x - this.ctx.game.player.x, pos.z - this.ctx.game.player.z) : 0);
      // урон врагам
      for (const h of this.husks) {
        if (h.dead) continue;
        const d = Math.hypot(h.x - pos.x, h.z - pos.z);
        if (d < radius) h.damage(dmg * (1 - d / (radius * 1.4)), null, new T.Vector3(h.x, h.y + 1, h.z));
      }
      if (this.boss && !this.boss.dead) {
        const d = Math.hypot(this.boss.x - pos.x, this.boss.z - pos.z);
        if (d < radius + 3) {
          let mult = 1;
          // прямое попадание в голову — больнее
          if (pos.y > this.boss.y + 10) mult = 2.6;
          if (this.boss.vuln > 0) mult *= 2.0;
          this.boss.damage(dmg * mult * (1 - d / (radius * 2.2)), null, pos);
        }
      }
    }

    /* --- ударные волны босса --- */
    bossShockwave(x, z, maxR, dmg, color) {
      this.ctx.fx.shockwave(x, z, maxR, 42, color);
      this.rings.push({ x, z, r: 1, max: maxR, speed: 42, dmg, hit: new Set() });
      this.ctx.audio.explosion({ x, z }, 0.7);
    }
    bossMelee(x, z, radius, dmg) {
      for (const s of this.soldiers) {
        if (s.dead) continue;
        if (Math.hypot(s.x - x, s.z - z) < radius) s.damage(dmg, null, new T.Vector3(s.x, s.y + 1, s.z));
      }
      for (const v of this.vehicles) {
        if (v.wrecked || v.kind === 'heli') continue;
        if (Math.hypot(v.x - x, v.z - z) < radius + 3) v.damage(dmg * 8, null, new T.Vector3(v.x, v.y + 1, v.z));
      }
    }
    updateRings(dt) {
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.r += r.speed * dt;
        const targets = this.soldiers.concat(this.vehicles);
        for (const t of targets) {
          if (t.dead || t.wrecked || r.hit.has(t)) continue;
          const d = Math.hypot(t.x - r.x, t.z - r.z);
          if (Math.abs(d - r.r) < 3.2) {
            r.hit.add(t);
            const mult = t.type === 'tank' || t.type === 'btr' ? 6 : 1;
            t.damage(r.dmg * mult, null, new T.Vector3(t.x, t.y + 1, t.z));
            if (t.type === 'soldier' && !t.isPlayer) t.stun = 0.7;
          }
        }
        if (r.r >= r.max) this.rings.splice(i, 1);
      }
    }

    update(dt) {
      this.gridT -= dt;
      if (this.gridT <= 0) { this.gridT = 0.12; this.rebuildGrid(); }
      for (const s of this.soldiers) s.update(dt, this);
      for (let i = this.husks.length - 1; i >= 0; i--) {
        const h = this.husks[i];
        h.update(dt, this);
        if (h.dead) this.husks.splice(i, 1);
      }
      for (const v of this.vehicles) v.update(dt, this);
      if (this.boss) this.boss.update(dt, this);
      this.updateShells(dt);
      this.updateRings(dt);
    }
  }


  /* ============================================================
     ОТРЯД: идёт по маршруту сам, игрок — один из бойцов
     ============================================================ */
  class SquadManager {
    constructor(game) {
      this.game = game;
      this.anchor = { x: 0, z: 0 };     // «острие» наступления
      this.dir = 0;                     // курс отряда
      this.route = [];                  // точки маршрута
      this.routeIdx = 0;
      this.speed = 3.1;
      this.mode = 'advance';            // advance | hold | assault
      this.standoff = 34;               // дистанция до объекта в бою
      this.slots = [];
      this.reformT = 0;
      this.waitForPlayer = 45;          // если игрок сильно отстал — отряд ждёт
    }

    setRoute(points, startX, startZ) {
      this.route = points.slice();
      this.routeIdx = 0;
      this.anchor.x = startX;
      this.anchor.z = startZ;
      this.mode = 'advance';
      this.buildSlots();
    }

    /* два фланга в линию с уступом — не клоны в затылок */
    buildSlots() {
      const soldiers = this.game.world.soldiers;
      this.slots = [];
      let n = 0;
      for (const s of soldiers) {
        const side = (n % 2) ? 1 : -1;
        const rank = Math.floor(n / 2);
        // «клин»: чем дальше от центра, тем сильнее отставание
        const lateral = side * (3.4 + (rank % 8) * 2.9 + U.rand(-0.6, 0.6));
        const depth = -(rank % 8) * 1.5 - Math.floor(rank / 8) * 5.5 + U.rand(-1.2, 1.2);
        s.slot = { lateral, depth, jitterPhase: U.rand(0, U.TAU), jitterSpeed: U.rand(0.2, 0.5) };
        s.pace = U.rand(0.88, 1.14);
        this.slots.push(s.slot);
        n++;
      }
    }

    /* центр живого отряда — чтобы техника ехала за пехотой */
    livingCenter() {
      const w = this.game.world;
      let x = 0, z = 0, n = 0;
      for (const s of w.soldiers) {
        if (s.dead) continue;
        x += s.x; z += s.z; n++;
      }
      return n ? { x: x / n, z: z / n } : { x: this.anchor.x, z: this.anchor.z };
    }

    update(dt) {
      const game = this.game;
      const world = game.world;
      const player = game.player;
      const boss = world.boss && !world.boss.dead ? world.boss : null;

      /* --- куда двигать острие --- */
      let targetX = this.anchor.x, targetZ = this.anchor.z, speed = this.speed;

      if (boss) {
        // бой: держим дистанцию и «обтекаем» объект
        const dx = boss.x - this.anchor.x, dz = boss.z - this.anchor.z;
        const d = Math.hypot(dx, dz) || 1;
        const desired = this.standoff + Math.sin(game.time * 0.25) * 6;
        const radial = (d - desired);
        const tangent = Math.sin(game.time * 0.18) * 0.7;
        targetX = this.anchor.x + (dx / d) * radial * 0.6 + (-dz / d) * tangent * 8;
        targetZ = this.anchor.z + (dz / d) * radial * 0.6 + (dx / d) * tangent * 8;
        speed = 4.2;
        this.dir = Math.atan2(dx, dz);
      } else if (this.route.length) {
        const wp = this.route[Math.min(this.routeIdx, this.route.length - 1)];
        const dx = wp.x - this.anchor.x, dz = wp.z - this.anchor.z;
        const d = Math.hypot(dx, dz);
        if (d < 6 && this.routeIdx < this.route.length - 1) this.routeIdx++;
        if (d > 0.5) {
          targetX = this.anchor.x + (dx / d) * speed;
          targetZ = this.anchor.z + (dz / d) * speed;
          this.dir = Math.atan2(dx, dz);
        }
      }

      /* --- ждём отставших: игрока и хвост отряда --- */
      let allowMove = true;
      if (player && !player.dead) {
        const lag = Math.hypot(player.x - this.anchor.x, player.z - this.anchor.z);
        if (lag > this.waitForPlayer) allowMove = false;
      }
      let lagging = 0, alive = 0;
      for (const s of world.soldiers) {
        if (s.dead || s === player) continue;
        alive++;
        if (Math.hypot(s.x - this.anchor.x, s.z - this.anchor.z) > 62) lagging++;
      }
      if (alive && lagging / alive > 0.35) allowMove = false;

      if (allowMove) {
        const dx = targetX - this.anchor.x, dz = targetZ - this.anchor.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01) {
          const step = Math.min(speed * dt, d);
          this.anchor.x += (dx / d) * step;
          this.anchor.z += (dz / d) * step;
        }
      }

      const lim = game.terrain ? game.terrain.opts.size * 0.95 : 200;
      this.anchor.x = U.clamp(this.anchor.x, -lim, lim);
      this.anchor.z = U.clamp(this.anchor.z, -lim, lim);

      /* --- раздаём позиции --- */
      const sin = Math.sin(this.dir), cos = Math.cos(this.dir);
      for (const s of world.soldiers) {
        if (s === player || s.dead || !s.slot) continue;
        const jitter = Math.sin(game.time * s.slot.jitterSpeed + s.slot.jitterPhase);
        const lat = s.slot.lateral + jitter * 1.3;
        const dep = s.slot.depth + Math.cos(game.time * s.slot.jitterSpeed * 0.7 + s.slot.jitterPhase) * 0.9;
        // локальные оси: вперёд = (sin, cos), вбок = (cos, -sin)
        s.formation.x = this.anchor.x + sin * dep + cos * lat;
        s.formation.z = this.anchor.z + cos * dep - sin * lat;
        s.squadDir = this.dir;
      }

      /* --- техника: идёт за пехотой, если нет цели --- */
      for (const v of world.vehicles) {
        if (v.wrecked) continue;
        v.escort = {
          x: this.anchor.x - sin * (v.kind === 'heli' ? -30 : 26) + cos * (v.escortSide || 0),
          z: this.anchor.z - cos * (v.kind === 'heli' ? -30 : 26) - sin * (v.escortSide || 0),
          dir: this.dir
        };
      }
    }
  }

  /* ============================================================
     КИНЕМАТОГРАФИЯ
     ============================================================ */
  class Cinematic {
    constructor(camera, hud) {
      this.camera = camera;
      this.hud = hud;
      this.active = false;
      this.shots = [];
      this.lines = [];
      this.shotIdx = 0;
      this.shotT = 0;
      this.lineIdx = 0;
      this.lineT = 0;
      this.typed = 0;
      this.onDone = null;
      this.el = document.getElementById('cutscene');
      this.textEl = document.getElementById('cutText');
      this.el.addEventListener('pointerdown', () => this.advance());
      addEventListener('keydown', e => {
        if (this.active && (e.code === 'Space' || e.code === 'Enter')) this.advance();
      });
    }

    play(shots, lines, onDone) {
      this.active = true;
      this.shots = shots; this.lines = lines;
      this.shotIdx = 0; this.shotT = 0;
      this.lineIdx = 0; this.lineT = 0; this.typed = 0;
      this.spokenIdx = -1;
      this.onDone = onDone;
      this.el.classList.remove('hidden');
      this.hud.hide();
      this.render();
    }

    render() {
      const l = this.lines[this.lineIdx];
      if (!l) { this.textEl.innerHTML = ''; return; }
      if (this.voice && this.spokenIdx !== this.lineIdx) {
        this.spokenIdx = this.lineIdx;
        this.voice.cutsceneLine(l.who || '', l.text);
      }
      const shown = l.text.slice(0, Math.floor(this.typed));
      this.textEl.innerHTML =
        (l.who ? `<span class="who">${l.who}</span>` : '') +
        shown + (shown.length < l.text.length ? '<span class="caret">▌</span>' : '');
    }

    advance() {
      if (!this.active) return;
      const l = this.lines[this.lineIdx];
      if (l && this.typed < l.text.length) { this.typed = l.text.length; this.render(); return; }
      this.lineIdx++; this.typed = 0; this.lineT = 0;
      if (this.lineIdx >= this.lines.length) this.finish();
      else this.render();
    }

    skip() { if (this.active) this.finish(); }

    finish() {
      this.active = false;
      this.el.classList.add('hidden');
      const cb = this.onDone; this.onDone = null;
      if (cb) cb();
    }

    update(dt) {
      if (!this.active) return;
      this.lineT += dt;
      this.shotT += dt;
      const l = this.lines[this.lineIdx];
      if (l) {
        if (this.typed < l.text.length) { this.typed += dt * 44; this.render(); }
        else if (this.lineT > 1.9 + l.text.length * 0.032) this.advance();
      }
      const s = this.shots[this.shotIdx];
      if (s) {
        const k = U.clamp01(this.shotT / s.dur);
        const e = s.ease ? s.ease(k) : U.smoothstep(k);
        const from = s.from, to = s.to;
        this.camera.position.set(
          U.lerp(from[0], to[0], e),
          U.lerp(from[1], to[1], e),
          U.lerp(from[2], to[2], e));
        let lx, ly, lz;
        if (s.lookAt) {
          const o = s.lookAt();
          lx = o.x; ly = o.y; lz = o.z;
        } else {
          lx = U.lerp(s.lookFrom[0], s.lookTo[0], e);
          ly = U.lerp(s.lookFrom[1], s.lookTo[1], e);
          lz = U.lerp(s.lookFrom[2], s.lookTo[2], e);
        }
        this.camera.lookAt(lx, ly, lz);
        if (s.onUpdate) s.onUpdate(e, dt);
        if (this.shotT >= s.dur && this.shotIdx < this.shots.length - 1) {
          this.shotIdx++; this.shotT = 0;
        }
      }
    }
  }

  /* ============================================================
     СЮЖЕТ
     ============================================================ */
  const STORY = {
    brief: [
      { who: 'ФОНД · ОПЕРАТИВНЫЙ ЦЕНТР', text: 'Квадрат 41-B. За шесть дней — сорок один пропавший. Ни тел, ни следов, ни сигналов.' },
      { who: 'КОМАНДИР', text: 'Объект — SCP-6789. Тринадцать метров. Имитирует голоса и зовёт людей по именам.' },
      { who: 'КОМАНДИР', text: 'Нас ровно пятьдесят. Два фланга. Танки и БТР идут следом, вертолёты держат небо.' },
      { who: 'КОМАНДИР', text: 'Услышите знакомый голос — это не он. Не отвечать. Из строя не выходить.' }
    ],
    convoy: [
      { who: '04:12 · КРОМКА ЛЕСА', text: 'Колонна встала на просеке. Дальше идёт пехота — техника прикрывает с фланга.' },
      { who: 'КОМАНДИР', text: 'Прочёсываем секторы A, B и C. Тихо. Он где-то здесь.' }
    ],
    contact: [
      { who: '', text: 'Лес замолчал. Ни птиц, ни ветра, ни насекомых.' },
      { who: 'РАДИО', text: '...эй... помогите... я здесь...' },
      { who: 'КОМАНДИР', text: 'НИКОМУ НЕ ОТВЕЧАТЬ. Это он.' },
      { who: '', text: 'То, что казалось сухим деревом впереди, медленно повернуло голову.' },
      { who: 'КОМАНДИР', text: 'КОНТАКТ! Все стволы на цель! Танки — беглый огонь! Вертолёты, работайте по башке!' }
    ],
    rage: [
      { who: '', text: 'Сирены взвыли так, что треснули стёкла прицелов.' },
      { who: 'КОМАНДИР', text: 'Он озверел! Бейте в динамики, когда он кричит — только тогда он открыт!' }
    ],
    victory: [
      { who: '', text: 'Он падал долго — как рушится радиовышка.' },
      { who: 'КОМАНДИР', text: 'Цель нейтрализована. Оцепить квадрат, вызвать группу утилизации.' },
      { who: 'ФОНД', text: 'Операция «Сирена» завершена. Класс объекта пересмотрен: Neutralized.' }
    ]
  };

  /* ============================================================
     ОСНОВНОЙ КЛАСС ИГРЫ
     ============================================================ */
  class Engine {
    constructor() {
      this.canvas = document.getElementById('game');
      this.state = 'boot';          // boot|menu|cut|play|pause|end
      this.level = 0;
      this.time = 0;
      this.stats = { kills: 0, lost: 0, vehLost: 0, time: 0, shots: 0, hits: 0 };
      this.perf = new U.PerfMonitor();
      this.settings = {
        quality: U.Store.read('quality', U.guessTier()),
        showFps: U.Store.read('showFps', false),
        bloom: U.Store.read('bloom', true),
        shadows: U.Store.read('shadows', true)
      };
      this.shakeAmt = 0;
      this.shakeTime = 0;
      this.hurt = 0;
      this.radialFx = 0;
      this.waypoints = [];
      this.wpIndex = 0;
      this.initRenderer();
      this.initScene();
      this.initSystems();
      this.bindUI();
    }

    /* ---------------- инициализация ---------------- */
    initRenderer() {
      const q = this.settings.quality;
      this.renderer = new T.WebGLRenderer({
        canvas: this.canvas,
        antialias: q === 'high',
        powerPreference: 'high-performance',
        stencil: false
      });
      const maxDpr = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr));
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.shadowMap.enabled = this.settings.shadows && q !== 'low';
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    }

    initScene() {
      this.scene = new T.Scene();
      this.scene.fog = new T.FogExp2(0x121c24, 0.012);

      this.camera = new T.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 1400);
      this.camera.rotation.order = 'YXZ';
      this.scene.add(this.camera);

      this.hemi = new T.HemisphereLight(0x35506b, 0x14201a, 0.55);
      this.scene.add(this.hemi);
      this.sun = new T.DirectionalLight(0xb9d3f0, 1.5);
      this.sun.position.set(-60, 90, 40);
      this.sun.castShadow = this.renderer.shadowMap.enabled;
      if (this.sun.castShadow) {
        const s = this.settings.quality === 'high' ? 2048 : 1024;
        this.sun.shadow.mapSize.set(s, s);
        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 260;
        const d = 70;
        this.sun.shadow.camera.left = -d;
        this.sun.shadow.camera.right = d;
        this.sun.shadow.camera.top = d;
        this.sun.shadow.camera.bottom = -d;
        this.sun.shadow.bias = -0.0006;
        this.sun.shadow.normalBias = 0.05;
      }
      this.scene.add(this.sun);
      this.scene.add(this.sun.target);

      this.sky = new SkyRig.Sky(this.scene);
      this.sky.apply('day', { hemi: this.hemi, dir: this.sun }, this.renderer, this.scene.fog);
      this.pmrem = new T.PMREMGenerator(this.renderer);
      this.refreshEnvMap();
    }

    refreshEnvMap() {
      try {
        const envScene = new T.Scene();
        const skyClone = this.sky.mesh.clone();
        skyClone.material = this.sky.mesh.material;
        envScene.add(skyClone);
        const rt = this.pmrem.fromScene(envScene, 0, 1, 2000);
        if (this.envMap) this.envMap.dispose();
        this.envMap = rt.texture;
        this.scene.environment = this.envMap;
      } catch (e) { /* окружение необязательно */ }
    }

    initSystems() {
      this.input = new InputManager(this.canvas);
      this.input.onPause = () => this.togglePause();
      this.input.onReload = () => this.reload();
      this.hud = new HUD();
      this.audio = new Audio2.Engine();
      this.composer = new PostFX.Composer(this.renderer, this.scene, this.camera, {
        quality: this.settings.quality,
        enabled: this.settings.bloom
      });
      this.composer.setQuality(this.settings.quality);
      this.cinematic = new Cinematic(this.camera, this.hud);
      this.voice = new Voice.VoiceDirector(this.audio, this.hud);
      this.cinematic.voice = this.voice;
      this.touch = new TouchUI.TouchController(this);
      this.squad = new SquadManager(this);

      this.ctx = {
        scene: this.scene,
        terrain: null,
        fx: null,
        audio: this.audio,
        game: this,
        quality: this.settings.quality
      };
      this.world = new World(this.ctx);

      // viewmodel
      this.viewmodel = Models.makeViewmodel();
      this.viewmodel.scale.setScalar(0.92);
      this.viewmodel.visible = false;
      this.camera.add(this.viewmodel);
      this.vmState = {
        recoil: 0, bob: 0, ads: 0, kickY: 0, kickX: 0, reloadT: 0
      };
      // отдельный свет для оружия не нужен: мир достаточно освещён,
      // а точечный источник вплотную давал белый пересвет
      this.gunLight = null;

      addEventListener('resize', () => this.onResize());
      this.onResize();
    }

    onResize() {
      const w = innerWidth, h = innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = h > w ? 82 : 75;
      this.camera.updateProjectionMatrix();
      const px = this.renderer.getPixelRatio();
      this.composer.setSize(w * px, h * px);
    }

    bindUI() {
      const byId = id => document.getElementById(id);
      const on = (id, fn) => { const el = byId(id); if (el) el.onclick = fn; };
      on('playBtn', () => this.startCampaign());
      on('skipBtn', () => this.startBattle());
      on('pauseBtn', () => this.togglePause());
      on('resumeBtn', () => this.togglePause());
      on('restartBtn', () => { this.closeOverlays(); this.restartLevel(); });
      on('quitBtn', () => { this.closeOverlays(); this.toMenu(); });
      on('againBtn', () => { this.closeOverlays(); this.startBattle(); });
      on('menuBtn', () => { this.closeOverlays(); this.toMenu(); });
      on('settingsBtn', () => byId('settings').classList.remove('hidden'));
      on('settingsClose', () => byId('settings').classList.add('hidden'));
      on('skipCutBtn', () => this.cinematic.skip());

      const q = byId('qualitySel');
      if (q) {
        q.value = this.settings.quality;
        q.onchange = () => {
          this.settings.quality = q.value;
          U.Store.write('quality', q.value);
          this.applyQuality();
        };
      }
      const sens = byId('sensRange');
      if (sens) {
        sens.value = this.input.sensitivity;
        sens.oninput = () => {
          this.input.sensitivity = parseFloat(sens.value);
          U.Store.write('sens', this.input.sensitivity);
        };
      }
      const vol = byId('volRange');
      if (vol) {
        vol.value = this.audio.volume;
        vol.oninput = () => this.audio.setVolume(parseFloat(vol.value));
      }
      const fps = byId('fpsChk');
      if (fps) {
        fps.checked = this.settings.showFps;
        fps.onchange = () => { this.settings.showFps = fps.checked; U.Store.write('showFps', fps.checked); };
      }
      const bloom = byId('bloomChk');
      if (bloom) {
        bloom.checked = this.settings.bloom;
        bloom.onchange = () => {
          this.settings.bloom = bloom.checked;
          this.composer.enabled = bloom.checked;
          U.Store.write('bloom', bloom.checked);
        };
      }
      /* --- v3: голоса --- */
      const voiceSel = byId('voiceSel');
      if (voiceSel) {
        voiceSel.value = this.voice.mode;
        voiceSel.onchange = () => {
          this.voice.setMode(voiceSel.value);
          if (voiceSel.value !== 'off') {
            this.voice.speak('Проверка связи. Приём.', { profile: 'commander', who: 'КОМАНДИР' });
          }
        };
      }
      const subsChk = byId('subsChk');
      if (subsChk) {
        subsChk.checked = this.voice.subtitles;
        subsChk.onchange = () => this.voice.setSubtitles(subsChk.checked);
      }

      /* --- v3: управление на телефоне --- */
      const tc = this.touch;
      const touchSect = byId('touchSect');
      if (tc && !tc.enabled && touchSect) {
        // на ПК прячем блок мобильных настроек
        touchSect.style.display = 'none';
        for (const id of ['autoFireChk', 'dynStickChk', 'adsToggleChk', 'hapticsChk',
          'leftHandChk', 'gyroChk', 'aimAssistRange', 'uiScaleRange', 'layoutBtn', 'layoutResetBtn']) {
          const el = byId(id);
          if (el && el.closest('.setting, .menu-row')) el.closest('.setting, .menu-row').style.display = 'none';
        }
      } else if (tc) {
        const chk = (id, key) => {
          const el = byId(id);
          if (!el) return;
          el.checked = !!tc.settings[key];
          el.onchange = () => tc.setSetting(key, el.checked);
        };
        chk('autoFireChk', 'autoFire');
        chk('dynStickChk', 'dynamicStick');
        chk('adsToggleChk', 'adsToggle');
        chk('hapticsChk', 'haptics');
        chk('leftHandChk', 'leftHanded');
        chk('gyroChk', 'gyro');
        const aa = byId('aimAssistRange');
        if (aa) {
          aa.value = tc.settings.aimAssist;
          aa.oninput = () => tc.setSetting('aimAssist', parseFloat(aa.value));
        }
        const us = byId('uiScaleRange');
        if (us) {
          us.value = tc.settings.uiScale;
          us.oninput = () => tc.setSetting('uiScale', parseFloat(us.value));
        }
        on('layoutBtn', () => {
          byId('settings').classList.add('hidden');
          tc.setEditing(true);
        });
        on('layoutResetBtn', () => tc.resetLayout());
        on('layoutDone', () => tc.setEditing(false));
      }

      // клик по канвасу — захват мыши
      this.canvas.addEventListener('click', () => {
        this.audio.init(); this.audio.resume();
        if (this.state === 'play' && !this.input.touch && !this.input.locked) this.input.requestLock();
      });
    }

    applyQuality() {
      const q = this.settings.quality;
      const maxDpr = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxDpr));
      this.renderer.shadowMap.enabled = this.settings.shadows && q !== 'low';
      this.sun.castShadow = this.renderer.shadowMap.enabled;
      this.composer.setQuality(q);
      this.ctx.quality = q;
      this.onResize();
    }

    closeOverlays() {
      for (const id of ['pause', 'endScreen', 'menu', 'settings']) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      }
    }

    /* ---------------- построение уровней ---------------- */
    buildTerrain(opts) {
      if (this.terrain) this.terrain.dispose();
      if (this.fx) this.fx.dispose();
      this.terrain = new WorldGen.Terrain(this.scene, Object.assign({
        quality: this.settings.quality
      }, opts));
      this.ctx.terrain = this.terrain;
      this.fx = new FX.System(this.scene, this.terrain, this.settings.quality);
      this.ctx.fx = this.fx;
      const f = this.scene.fog;
      this.terrain.setFog(f.color, f.density);

      if (this.props) this.props.dispose();
      if (this.ambience) this.ambience.dispose();
      this.props = new Detail.Props(this.scene, this.terrain, {
        seed: (opts && opts.seed) || 99,
        quality: this.settings.quality,
        camp: !opts || opts.camp !== false,
        logs: this.settings.quality === 'low' ? 18 : 42,
        stumps: this.settings.quality === 'low' ? 12 : 28,
        ferns: this.settings.quality === 'low' ? 0 : this.settings.quality === 'medium' ? 120 : 240,
        crates: 16, sandbags: 22, barrels: 12
      });
      this.ambience = new Detail.Ambience(this.scene, this.terrain, this.settings.quality);
    }

    spawnSquad(cx, cz, facing) {
      const w = this.world;
      // игрок — командир в центре
      const player = new Entities.Soldier(this.ctx, cx, cz, { isPlayer: true, leader: true, index: 0 });
      player.setFirstPerson(true);
      w.soldiers.push(player);
      this.player = player;

      // 49 бойцов двумя флангами
      for (let i = 1; i < 50; i++) {
        const side = i % 2 ? 1 : -1;
        const rank = Math.floor((i - 1) / 2);
        const ox = side * (3.4 + (rank % 8) * 2.9);
        const oz = -(rank % 8) * 1.5 - Math.floor(rank / 8) * 5.5;
        const s = new Entities.Soldier(this.ctx, cx + ox, cz + oz, { index: i, dark: i % 3 === 0 });
        s.formation.x = cx + ox; s.formation.z = cz + oz;
        s.yaw = facing || 0;
        w.soldiers.push(s);
      }
      this.player.yaw = facing || 0;
    }

    updateFormation(dt) {
      // строй ведёт SquadManager: отряд идёт по своему маршруту,
      // игрок свободен и никем не «магнитится»
      if (this.squad) this.squad.update(dt);
    }

    buildSearchLevel() {
      this.world.clearAll();
      this.scene.fog.color.setHex(0x9aacb8);
      this.scene.fog.density = 0.0075;
      this.sky.apply('overcast', { hemi: this.hemi, dir: this.sun }, this.renderer, this.scene.fog);
      this.refreshEnvMap();
      const path = [
        { x: 0, z: 176 }, { x: 0, z: 150 }, { x: 6, z: 96 },
        { x: -34, z: 36 }, { x: 26, z: -26 }, { x: 0, z: -86 }
      ];
      const distToSeg = (x, z, a, b) => {
        const dx = b.x - a.x, dz = b.z - a.z;
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
        t = U.clamp01(t);
        return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      };
      const avoidPath = (x, z) => {
        for (let i = 0; i < path.length - 1; i++) {
          if (distToSeg(x, z, path[i], path[i + 1]) < 9) return true;
        }
        return false;
      };
      this.buildTerrain({
        avoid: avoidPath,
        size: 200, seed: 20250726, segments: 128, amplitude: 7,
        treeCount: this.settings.quality === 'low' ? 300 : this.settings.quality === 'medium' ? 620 : 950,
        grassCount: this.settings.quality === 'low' ? 0 : this.settings.quality === 'medium' ? 5000 : 9000,
        rockCount: 90, bushCount: 240, clearingRadius: 0
      });
      this.spawnSquad(0, 150, 0);
      const V = Entities.Vehicle;
      this.world.vehicles.push(new V(this.ctx, 'tank', -16, 168));
      this.world.vehicles.push(new V(this.ctx, 'tank', 16, 168));
      this.world.vehicles.push(new V(this.ctx, 'btr', -30, 176));
      this.world.vehicles.push(new V(this.ctx, 'btr', 30, 176));
      this.waypoints = [
        { x: 6, z: 96, label: 'СЕКТОР A · ЧИСТО', next: 'ПРОДОЛЖАТЬ ДВИЖЕНИЕ НА СЕВЕР.' },
        { x: -34, z: 36, label: 'СЕКТОР B · ЧИСТО', next: 'В ЭФИРЕ ПОМЕХИ. ВПЕРЁД.' },
        { x: 26, z: -26, label: 'СЕКТОР C · ЧИСТО', next: 'ЛЕС ЗАТИХ. ВЫЙТИ НА ПРОСЕКУ.' },
        { x: 0, z: -86, label: '', next: '' }
      ];
      this.wpIndex = 0;
      this.level = 1;
      this.voiceTimer = 10;
      this.markWaypoint();
      this.squad.setRoute(
        this.waypoints.map(w => ({ x: w.x, z: w.z })), 0, 146);
      this.squad.speed = 3.0;
      let side = -1;
      for (const v of this.world.vehicles) { v.escortSide = side * U.rand(16, 30); side *= -1; }
    }

    buildBattleLevel() {
      this.world.clearAll();
      this.scene.fog.color.setHex(0xa8bfd0);
      this.scene.fog.density = 0.0035;
      this.sky.apply('day', { hemi: this.hemi, dir: this.sun }, this.renderer, this.scene.fog);
      this.refreshEnvMap();
      this.buildTerrain({
        size: 230, seed: 777, segments: 128, amplitude: 5,
        treeCount: this.settings.quality === 'low' ? 260 : this.settings.quality === 'medium' ? 520 : 800,
        grassCount: this.settings.quality === 'low' ? 0 : this.settings.quality === 'medium' ? 4500 : 8000,
        rockCount: 70, bushCount: 180, clearingRadius: 118
      });
      this.spawnSquad(0, 70, 0);
      const V = Entities.Vehicle;
      const w = this.world;
      w.vehicles.push(new V(this.ctx, 'tank', -34, 96));
      w.vehicles.push(new V(this.ctx, 'tank', 34, 96));
      w.vehicles.push(new V(this.ctx, 'tank', 0, 110));
      w.vehicles.push(new V(this.ctx, 'btr', -58, 88));
      w.vehicles.push(new V(this.ctx, 'btr', 58, 88));
      w.vehicles.push(new V(this.ctx, 'btr', -18, 104));
      w.vehicles.push(new V(this.ctx, 'btr', 18, 104));
      w.vehicles.push(new V(this.ctx, 'heli', -70, 40));
      w.vehicles.push(new V(this.ctx, 'heli', 70, 40));
      w.boss = new Entities.Boss(this.ctx, 0, -40);
      this.squad.setRoute([], 0, 66);
      this.squad.speed = 4.2;
      let bside = -1;
      for (const v of w.vehicles) { v.escortSide = bside * U.rand(20, 44); bside *= -1; }
      this.audio.heliLoop(true);
      this.audio.dreadLoop(true);
      this.level = 2;
      this.waypoints = [];
    }

    markWaypoint() {
      if (this.wpMarker) { this.scene.remove(this.wpMarker); this.wpMarker = null; }
      const wp = this.currentWaypoint();
      if (!wp) return;
      const g = new T.Group();
      const ring = new T.Mesh(
        new T.RingGeometry(3.4, 4, 32),
        new T.MeshBasicMaterial({ color: 0x62e0c0, transparent: true, opacity: 0.5, side: T.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      const beam = new T.Mesh(
        new T.CylinderGeometry(0.35, 0.35, 30, 8, 1, true),
        new T.MeshBasicMaterial({ color: 0x62e0c0, transparent: true, opacity: 0.12, side: T.DoubleSide, depthWrite: false })
      );
      beam.position.y = 15;
      g.add(beam);
      g.position.set(wp.x, this.terrain.height(wp.x, wp.z) + 0.1, wp.z);
      this.scene.add(g);
      this.wpMarker = g;
    }

    currentWaypoint() {
      return this.level === 1 ? this.waypoints[this.wpIndex] : null;
    }

    /* ---------------- переходы ---------------- */
    startCampaign() {
      this.closeOverlays();
      this.audio.init(); this.audio.resume();
      this.resetStats();
      this.buildSearchLevel();
      this.state = 'cut';
      const t = this.terrain;
      this.cinematic.play([
        {
          from: [0, 60, 250], to: [0, 34, 200], dur: 12,
          lookFrom: [0, 12, 120], lookTo: [0, 6, 150]
        },
        {
          from: [24, 4.5, 186], to: [-10, 3.2, 168], dur: 12,
          lookFrom: [-6, 2.5, 166], lookTo: [8, 2.2, 150]
        }
      ], STORY.brief.concat(STORY.convoy), () => this.beginPlay(1));
    }

    startBattle() {
      this.closeOverlays();
      this.audio.init(); this.audio.resume();
      this.resetStats();
      this.buildBattleLevel();
      this.beginPlay(2);
      this.hud.toast('ОГОНЬ ПО ЦЕЛИ!', 3);
      this.voice.say('contact', { profile: 'commander', who: 'КОМАНДИР', priority: 2, cooldown: 0 });
      this.audio.siren(this.world.boss, 3.2, 0.8);
    }

    resetStats() {
      this.stats = { kills: 0, lost: 0, vehLost: 0, time: 0, shots: 0, hits: 0 };
      this.ended = false;
    }

    beginPlay(level) {
      this.level = level;
      this.state = 'play';
      this.hud.show();
      this.viewmodel.visible = true;
      this.input.yaw = this.player ? this.player.yaw : 0;
      this.input.pitch = 0;
      if (level === 1) {
        this.hud.objective('ПРОЧЕСАТЬ ЛЕС. ДОЙТИ ДО МЕТКИ.');
        this.hud.toast('СЕКТОР 41-B · ДВИЖЕНИЕ НА СЕВЕР', 3.4);
      } else {
        this.hud.objective('УНИЧТОЖИТЬ SCP-6789. ТЕХНИКА — ОСНОВНОЙ УРОН.');
      }
      if (!this.input.touch) this.input.requestLock();
    }

    contactCutscene() {
      this.state = 'cut';
      this.audio.dreadLoop(true);
      this.buildBattleLevel();
      const boss = this.world.boss;
      boss.setEmerge(0);
      this.audio.siren(boss, 4.4, 0.95);
      const px = this.player.x, pz = this.player.z;
      this.cinematic.play([
        {
          from: [px + 8, 2.2, pz + 6], to: [px + 4, 3.0, pz - 4], dur: 10,
          lookFrom: [boss.x, 2, boss.z], lookTo: [boss.x, 8, boss.z],
          onUpdate: k => boss.setEmerge(U.clamp01(k * 1.6))
        },
        {
          from: [boss.x + 16, 8, boss.z + 30], to: [boss.x + 6, 15, boss.z + 20], dur: 12,
          lookFrom: [boss.x, 8, boss.z], lookTo: [boss.x, 12, boss.z],
          onUpdate: () => boss.setEmerge(1)
        }
      ], STORY.contact, () => {
        boss.setEmerge(1);
        this.beginPlay(2);
      });
    }

    onBossPhase(phase) {
      if (phase === 3) {
        this.ragePhase();
      } else {
        this.hud.toast('ФАЗА II · ОН УСКОРЯЕТСЯ', 2.6);
        this.audio.siren(this.world.boss, 2.2, 0.7);
        this.voice.say('phase2', { profile: 'commander', who: 'КОМАНДИР', priority: 2, cooldown: 0 });
      }
    }

    ragePhase() {
      if (this.state !== 'play') return;
      const boss = this.world.boss;
      this.state = 'cut';
      this.input.releaseLock();
      boss.setGlow(1);
      this.audio.siren(boss, 3.6, 1.0);
      this.cinematic.play([
        {
          from: [boss.x + 10, 13.5, boss.z + 16], to: [boss.x + 4, 13.2, boss.z + 9], dur: 9,
          lookAt: () => ({ x: boss.x, y: boss.y + 12.6, z: boss.z })
        }
      ], STORY.rage, () => {
        boss.setGlow(0);
        this.state = 'play';
        this.hud.show();
        if (!this.input.touch) this.input.requestLock();
      });
    }

    onBossScreamStart() {
      this.radialTarget = 1;
      this.hud.toast('ОН КРИЧИТ — БЕЙ В ДИНАМИКИ!', 2.4);
      this.voice.say('scream', { profile: 'commander', who: 'КОМАНДИР', priority: 2, cooldown: 4 });
      if (this.touch) this.touch.haptic([0, 60, 40, 120]);
    }
    onBossScreamEnd() { this.radialTarget = 0; }

    onBossDown() {
      if (this.ended) return;
      this.ended = true;
      const boss = this.world.boss;
      this.hud.toast('ЦЕЛЬ НЕЙТРАЛИЗОВАНА', 3.5);
      this.voice.say('bossDown', { profile: 'commander', who: 'КОМАНДИР', priority: 2, cooldown: 0 });
      for (const h of this.world.husks) h.die();
      setTimeout(() => {
        this.state = 'cut';
        this.input.releaseLock();
        this.sky.transition('dawn', 12, { hemi: this.hemi, dir: this.sun }, this.renderer, this.scene.fog);
        this.audio.dreadLoop(false);
        this.cinematic.play([
          {
            from: [boss.x + 18, 6, boss.z + 26], to: [boss.x + 8, 3.4, boss.z + 16], dur: 11,
            lookAt: () => ({ x: boss.x, y: boss.y + 2, z: boss.z })
          },
          {
            from: [boss.x + 8, 3.4, boss.z + 16], to: [boss.x + 2, 14, boss.z + 40], dur: 13,
            lookFrom: [boss.x, 2, boss.z], lookTo: [boss.x - 40, 18, boss.z - 120]
          }
        ], STORY.victory, () => this.finish(true));
      }, 3200);
    }

    onSoldierDown(s) {
      this.stats.lost++;
      if (this.voice) {
        this.voice.shout('death', s, { gain: 0.9 });
        if (Math.random() < 0.4) {
          setTimeout(() => this.voice.say('manDown', { profile: 'commander', who: 'КОМАНДИР', cooldown: 9 }), 700);
        }
      }
      if (s === this.player) this.takeOverNextSoldier();
    }
    onVehicleLost(v) {
      this.stats.vehLost++;
      if (this.voice) this.voice.say('vehicleLost', { profile: 'commander', who: 'КОМАНДИР', cooldown: 8 });
      if (this.touch) this.touch.hapticExplosion();
      this.hud.toast(v.kind === 'heli' ? 'ВЕРТОЛЁТ СБИТ' : 'ТЕХНИКА ПОТЕРЯНА', 2.2);
    }

    takeOverNextSoldier() {
      const next = this.world.soldiers.find(s => !s.dead && s !== this.player);
      if (!next) { this.finish(false); return; }
      next.setFirstPerson(true);
      next.ammo = next.mag;
      this.player = next;
      this.hud.toast('БОЕЦ ПОГИБ · ПЕРЕХОД К СЛЕДУЮЩЕМУ', 2.6);
      this.hurt = 1;
      this.shake(1.0, 0);
      // строй продолжает идти сам — пересобирать ничего не нужно
    }

    finish(win) {
      this.state = 'end';
      this.hud.hide();
      this.viewmodel.visible = false;
      this.input.releaseLock();
      const acc = this.stats.shots ? Math.round(this.stats.hits / this.stats.shots * 100) : 0;
      document.getElementById('endTitle').textContent = win ? 'ЦЕЛЬ УНИЧТОЖЕНА' : 'ОТРЯД УНИЧТОЖЕН';
      document.getElementById('endText').textContent = win
        ? 'SCP-6789 нейтрализован. Квадрат оцеплен, свидетели амнезированы.'
        : 'Связь с группой потеряна. Объект остаётся в квадрате 41-B.';
      document.getElementById('endStats').innerHTML =
        `Выжило: <b>${this.world.aliveSoldiers()}</b> из 50<br>` +
        `Потери техники: <b>${this.stats.vehLost}</b><br>` +
        `Уничтожено сущностей: <b>${this.stats.kills}</b><br>` +
        `Точность: <b>${acc}%</b><br>` +
        `Время операции: <b>${U.fmtTime(this.stats.time)}</b>`;
      document.getElementById('endScreen').classList.remove('hidden');
      const best = U.Store.read('bestTime', null);
      if (win && (!best || this.stats.time < best)) U.Store.write('bestTime', this.stats.time);
    }

    togglePause() {
      if (this.state === 'play') {
        this.state = 'pause';
        document.getElementById('pause').classList.remove('hidden');
        this.input.releaseLock();
      } else if (this.state === 'pause') {
        this.state = 'play';
        document.getElementById('pause').classList.add('hidden');
        if (!this.input.touch) this.input.requestLock();
      }
    }

    restartLevel() {
      this.resetStats();
      if (this.level === 1) { this.buildSearchLevel(); this.beginPlay(1); }
      else { this.buildBattleLevel(); this.beginPlay(2); }
    }

    toMenu() {
      this.state = 'menu';
      this.hud.hide();
      this.viewmodel.visible = false;
      document.getElementById('menu').classList.remove('hidden');
      this.buildMenuScene();
    }

    buildMenuScene() {
      this.world.clearAll();
      this.audio.heliLoop(false);
      this.sky.apply('overcast', { hemi: this.hemi, dir: this.sun }, this.renderer, this.scene.fog);
      this.refreshEnvMap();
      this.scene.fog.density = 0.008;
      this.buildTerrain({
        size: 150, seed: 4242, segments: 96, amplitude: 6,
        treeCount: this.settings.quality === 'low' ? 240 : 520,
        grassCount: this.settings.quality === 'low' ? 0 : 5000,
        rockCount: 50, bushCount: 140, clearingRadius: 40
      });
      const boss = new Entities.Boss(this.ctx, 0, -34);
      boss.yaw = 0.5;
      this.world.boss = boss;
      this.menuT = 0;
    }

    /* ---------------- стрельба игрока ---------------- */
    reload() {
      const p = this.player;
      if (!p || p.dead || p.reloading > 0 || p.ammo === p.mag || p.reserve <= 0) return;
      p.reloading = p.reloadTime;
      this.vmState.reloadT = p.reloadTime;
      this.audio.reloadSound();
      if (this.voice && Math.random() < 0.45) {
        this.voice.say('reload', { unit: p, who: 'БОЕЦ', cooldown: 10, radio: 0.2 });
      }
    }

    playerShoot() {
      const p = this.player;
      const spread = this.playerSpread();
      const dir = new T.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      dir.x += U.gauss(0, spread); dir.y += U.gauss(0, spread); dir.z += U.gauss(0, spread * 0.4);
      dir.normalize();
      const origin = new T.Vector3();
      this.camera.getWorldPosition(origin);

      const hit = this.raycastWorld(origin, dir, 240);
      const muzzle = new T.Vector3();
      this.viewmodel.userData.muzzle.getWorldPosition(muzzle);

      this.fx.tracer(muzzle, hit.point, { speed: 600, len: 10 });
      this.fx.muzzleFlash(muzzle, dir, 1);
      this.fx.ejectCasing(muzzle, new T.Vector3(dir.z, 0, -dir.x));
      this.audio.rifleShot(p, { gain: 0.55 });
      this.viewmodel.userData.flash.material.opacity = 1;

      this.vmState.recoil = 1;
      if (this.touch) this.touch.hapticShot();
      this.vmState.kickX += U.rand(0.006, 0.014);
      this.vmState.kickY += U.rand(-0.006, 0.006);
      this.shake(0.06, 0);
      this.stats.shots++;

      if (hit.entity) {
        this.stats.hits++;
        if (this.touch) this.touch.hapticHit();
        const dmg = p.damage_ * (hit.mult || 1);
        const killed = hit.entity.damage(dmg, p, hit.point);
        this.hud.hit(killed);
        if (killed && hit.entity.type === 'husk' && Math.random() < 0.25) {
          this.voice.say('kill', { unit: p, who: 'БОЕЦ', cooldown: 7 });
        }
        if (hit.entity.type === 'boss') this.fx.impact(hit.point, dir.clone().negate(), 'metal');
        else this.fx.bloodHit(hit.point, dir);
        this.audio.impact(hit.entity, hit.entity.type === 'boss' ? 'metal' : 'flesh');
      } else {
        this.fx.impact(hit.point, hit.normal || new T.Vector3(0, 1, 0), 'dirt');
        if (hit.ground) this.fx.decal('crater', hit.point.x, hit.point.z, 0.5);
      }
    }

    playerSpread() {
      const p = this.player;
      const moving = Math.hypot(this.input.getMove().x, this.input.getMove().y) > 0.1;
      let s = 0.006;
      if (moving) s += 0.012;
      if (this.input.isSprinting() && moving) s += 0.012;
      if (this.vmState.ads > 0.5) s *= 0.35;
      s += this.vmState.recoil * 0.01;
      p.spreadVisual = U.clamp01(s / 0.03);
      return s;
    }

    /* луч по врагам + земле */
    raycastWorld(origin, dir, maxDist) {
      let best = maxDist, entity = null, mult = 1, normal = null;
      const tmp = new T.Vector3();
      const raySphere = (c, r) => {
        tmp.set(c.x - origin.x, c.y - origin.y, c.z - origin.z);
        const t = tmp.dot(dir);
        if (t < 0) return -1;
        const d2 = tmp.lengthSq() - t * t;
        if (d2 > r * r) return -1;
        return t - Math.sqrt(r * r - d2);
      };
      for (const h of this.world.husks) {
        if (h.dead) continue;
        const t1 = raySphere({ x: h.x, y: h.y + 1.9, z: h.z }, 0.34);   // голова
        if (t1 > 0 && t1 < best) { best = t1; entity = h; mult = 2.5; }
        const t2 = raySphere({ x: h.x, y: h.y + 1.15, z: h.z }, 0.62);  // корпус
        if (t2 > 0 && t2 < best) { best = t2; entity = h; mult = 1; }
      }
      const boss = this.world.boss;
      if (boss && !boss.dead) {
        for (const s of boss.hitSpheres()) {
          const t = raySphere(s, s.r);
          if (t > 0 && t < best) { best = t; entity = boss; mult = s.mult; }
        }
      }
      // земля — шаговый поиск
      let ground = false;
      if (!entity) {
        const step = 1.4;
        let d = 1;
        while (d < maxDist) {
          const px = origin.x + dir.x * d;
          const py = origin.y + dir.y * d;
          const pz = origin.z + dir.z * d;
          const gy = this.terrain.height(px, pz);
          if (py <= gy) {
            best = d; ground = true;
            normal = this.terrain.normal(px, pz);
            break;
          }
          d += step * (1 + d * 0.02);
        }
      }
      const point = origin.clone().addScaledVector(dir, Math.min(best, maxDist));
      return { point, entity, mult, ground, normal };
    }

    /* ---------------- обновление игрока ---------------- */
    updatePlayer(dt) {
      const p = this.player;
      if (!p || p.dead) return;
      const inp = this.input;
      const mv = inp.getMove();
      const mag = Math.min(1, Math.hypot(mv.x, mv.y));
      const sprinting = inp.isSprinting() && mv.y < -0.3 && this.vmState.ads < 0.5;
      const speed = p.speed * (sprinting ? p.sprintMul : 1) * (this.vmState.ads > 0.5 ? 0.55 : 1);

      if (mag > 0.05) {
        const yaw = inp.yaw;
        const sin = Math.sin(yaw), cos = Math.cos(yaw);
        // вперёд = -Z в системе камеры
        const dx = mv.x * cos + mv.y * sin;
        const dz = -mv.x * sin + mv.y * cos;
        const len = Math.hypot(dx, dz) || 1;
        p.x += (dx / len) * speed * mag * dt;
        p.z += (dz / len) * speed * mag * dt;
        p.walkPhase += dt * speed * 1.4;
        p.stepTimer -= dt;
        if (p.stepTimer <= 0) {
          p.stepTimer = sprinting ? 0.32 : 0.46;
          this.audio.footstep(sprinting ? 0.22 : 0.15);
          this.fx.footstepDust(new T.Vector3(p.x, p.y + 0.05, p.z));
        }
      }
      const lim = this.terrain.opts.size * 0.95;
      p.x = U.clamp(p.x, -lim, lim);
      p.z = U.clamp(p.z, -lim, lim);
      p.yaw = inp.yaw;
      p.y = this.terrain.height(p.x, p.z);

      // прицеливание
      const adsTarget = inp.ads ? 1 : 0;
      this.vmState.ads = U.damp(this.vmState.ads, adsTarget, 12, dt);

      // стрельба
      p.cd -= dt;
      if (p.reloading > 0) {
        p.reloading -= dt;
        if (p.reloading <= 0) {
          const need = p.mag - p.ammo;
          const take = Math.min(need, p.reserve);
          p.ammo += take; p.reserve -= take;
        }
      } else if (inp.firing && p.cd <= 0) {
        if (p.ammo > 0) {
          p.ammo--;
          p.cd = p.fireRate;
          this.playerShoot();
          if (p.ammo === 0) this.reload();
        } else this.reload();
      }

      // камера
      const eye = p.y + 1.68 - this.vmState.ads * 0.04;
      const bobAmt = mag > 0.05 ? (sprinting ? 1.5 : 1) : 0;
      this.vmState.bob += dt * (sprinting ? 12 : 8) * bobAmt;
      const bobY = Math.sin(this.vmState.bob * 2) * 0.035 * bobAmt;
      const bobX = Math.cos(this.vmState.bob) * 0.03 * bobAmt;

      this.camera.position.set(
        p.x + bobX * 0.4 + this.shakeOffset.x,
        eye + bobY + this.shakeOffset.y,
        p.z + this.shakeOffset.z);
      this.camera.rotation.set(
        inp.pitch + this.vmState.kickX + this.shakeOffset.pitch,
        inp.yaw + this.vmState.kickY + this.shakeOffset.yaw,
        Math.sin(this.vmState.bob) * 0.008 * bobAmt + this.shakeOffset.roll);

      // отдача возвращается
      this.vmState.kickX = U.damp(this.vmState.kickX, 0, 6, dt);
      this.vmState.kickY = U.damp(this.vmState.kickY, 0, 6, dt);
      this.vmState.recoil = Math.max(0, this.vmState.recoil - dt * 8);

      // viewmodel
      const vm = this.viewmodel;
      const ads = this.vmState.ads;
      const rec = this.vmState.recoil;
      vm.position.set(
        U.lerp(0.17, 0.0, ads) + Math.sin(this.vmState.bob) * 0.008 * bobAmt,
        U.lerp(-0.16, -0.075, ads) + Math.abs(Math.cos(this.vmState.bob)) * 0.008 * bobAmt - rec * 0.012,
        U.lerp(-0.34, -0.24, ads) + rec * 0.06);
      vm.rotation.set(rec * 0.22, U.lerp(0.04, 0, ads), U.lerp(0.02, 0, ads));
      const flashMat = vm.userData.flash.material;
      if (flashMat.opacity > 0) flashMat.opacity = Math.max(0, flashMat.opacity - dt * 22);

      // анимация перезарядки: ствол вниз
      if (this.vmState.reloadT > 0) {
        this.vmState.reloadT -= dt;
        const k = 1 - Math.abs(this.vmState.reloadT / p.reloadTime - 0.5) * 2;
        vm.position.y -= k * 0.1;
        vm.rotation.x += k * 0.5;
        vm.rotation.z += k * 0.25;
      }

      // FOV: бег/прицел
      const targetFov = (innerHeight > innerWidth ? 82 : 75) + (sprinting ? 6 : 0) - ads * 16;
      this.camera.fov = U.damp(this.camera.fov, targetFov, 8, dt);
      this.camera.updateProjectionMatrix();

      this.audio.setListener(p.x, p.y + 1.6, p.z, inp.yaw);
    }

    /* ---------------- тряска ---------------- */
    shake(amount, distance = 0) {
      const falloff = distance > 0 ? U.clamp01(1 - distance / 90) : 1;
      this.shakeAmt = Math.min(2.2, this.shakeAmt + amount * falloff);
    }
    updateShake(dt) {
      this.shakeTime += dt * 28;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
      const a = this.shakeAmt * this.shakeAmt;
      const n = Math.sin(this.shakeTime) * Math.sin(this.shakeTime * 0.7);
      this.shakeOffset = {
        x: n * a * 0.06,
        y: Math.sin(this.shakeTime * 1.3) * a * 0.06,
        z: Math.cos(this.shakeTime * 0.9) * a * 0.04,
        pitch: Math.sin(this.shakeTime * 1.7) * a * 0.012,
        yaw: Math.cos(this.shakeTime * 1.1) * a * 0.012,
        roll: Math.sin(this.shakeTime * 0.6) * a * 0.02
      };
    }

    /* ---------------- уровень 1: логика поиска ---------------- */
    updateSearch(dt) {
      const p = this.player;
      const wp = this.currentWaypoint();
      if (!p || !wp) return;
      if (Math.hypot(p.x - wp.x, p.z - wp.z) < 8) {
        this.wpIndex++;
        if (wp.label) {
          this.hud.toast(wp.label + ' · НИКОГО', 2.8);
          this.hud.objective(wp.next);
          this.audio.radio(1.0, 0.3);
          this.markWaypoint();
        } else {
          if (this.wpMarker) { this.scene.remove(this.wpMarker); this.wpMarker = null; }
          this.contactCutscene();
        }
      }
      this.voiceTimer -= dt;
      if (this.voiceTimer <= 0 && this.wpIndex > 0) {
        this.voiceTimer = U.rand(10, 18);
        const p2 = this.player;
        const a = U.rand(U.TAU), r = U.rand(25, 45);
        this.voice.lure({ x: p2.x + Math.cos(a) * r, z: p2.z + Math.sin(a) * r });
      }
    }

    /* ---------------- главный цикл ---------------- */
    start() {
      this.shakeOffset = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
      this.toMenu();
      this.lastTime = performance.now();
      const loop = (now) => {
        requestAnimationFrame(loop);
        let dt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        dt = Math.min(dt, 0.05);
        this.update(dt);
        this.render(dt);
      };
      requestAnimationFrame(loop);
    }

    update(dt) {
      this.time += dt;
      this.perf.tick(dt);
      this.updateShake(dt);
      this.sky.update(dt, this.camera);
      if (this.terrain) this.terrain.update(dt, this.camera, this.time);
      if (this.fx) this.fx.update(dt, this.camera);
      if (this.props) this.props.update(dt, this.time);
      if (this.ambience) this.ambience.update(dt, this.camera, Math.sin(this.time * 0.3) * 0.6);
      if (this.voice) this.voice.update(dt);
      if (this.touch) this.touch.update(dt);

      // авто-снижение качества, если совсем плохо
      if (this.perf.history.length > 6 && this.settings.quality !== 'low' && this.perf.avg() < 24) {
        this.settings.quality = this.settings.quality === 'high' ? 'medium' : 'low';
        U.Store.write('quality', this.settings.quality);
        this.applyQuality();
        this.hud.toast('КАЧЕСТВО СНИЖЕНО ДЛЯ ПЛАВНОСТИ', 2.4);
        this.perf.history.length = 0;
      }

      switch (this.state) {
        case 'play': {
          this.stats.time += dt;
          this.updatePlayer(dt);
          this.updateFormation(dt);
          this.world.update(dt);
          if (this.level === 1) this.updateSearch(dt);
          if (this.world.aliveSoldiers() === 0 && !this.ended) { this.ended = true; this.finish(false); }
          this.hud.update(dt, this);
          // тень следует за игроком
          if (this.sun.castShadow && this.player) {
            this.sun.target.position.set(this.player.x, 0, this.player.z);
            const d = this.sky.uniforms.uSunDir.value;
            this.sun.position.set(this.player.x + d.x * 90, d.y * 90, this.player.z + d.z * 90);
          }
          // гул вертолётов
          const heli = this.world.vehicles.find(v => v.kind === 'heli' && !v.wrecked);
          if (heli && this.player) {
            const d = Math.hypot(heli.x - this.player.x, heli.z - this.player.z);
            this.audio.setHeliVolume(U.clamp01(1 - d / 90));
          } else this.audio.setHeliVolume(0);
          break;
        }
        case 'cut': {
          this.cinematic.update(dt);
          this.world.update(dt);
          break;
        }
        case 'menu': {
          this.menuT = (this.menuT || 0) + dt;
          const r = 40, a = this.menuT * 0.06;
          this.camera.position.set(Math.sin(a) * r, 14 + Math.sin(this.menuT * 0.2) * 2, -6 + Math.cos(a) * r);
          this.camera.lookAt(0, 8, -34);
          if (this.world.boss) {
            this.world.boss.time += dt;
            this.world.boss.walkPhase += dt * 0.4;
            this.world.boss.updatePose(dt);
            this.world.boss.mesh.rotation.y = 0.4 + Math.sin(this.menuT * 0.1) * 0.3;
          }
          break;
        }
        case 'end':
        case 'pause':
        default:
          break;
      }

      // пост-эффекты
      this.hurt = Math.max(0, this.hurt - dt * 1.6);
      if (this.player && this.state === 'play') {
        const lowHp = 1 - U.clamp01(this.player.hp / this.player.maxHp);
        this.composer.set('uHurt', Math.max(this.hurt, lowHp * 0.35));
        this.composer.set('uVignette', 0.6 + lowHp * 0.4);
      } else {
        this.composer.set('uHurt', this.hurt);
      }
      this.radialFx = U.damp(this.radialFx, this.radialTarget || 0, 3, dt);
      this.composer.set('uRadial', this.radialFx);
    }

    render(dt) {
      this.composer.render(dt);
    }
  }

  return { Engine, World, STORY, InputManager, HUD, Cinematic };
})();
