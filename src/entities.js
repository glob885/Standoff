/* ============================================================
   src/entities.js — сущности: боец, хаск, техника, босс.
   Каждая сущность = логика + процедурная анимация модели.
   ============================================================ */
'use strict';

const Entities = (() => {
  const T = THREE;

  /* базовый класс */
  class Entity {
    constructor(ctx, x, z) {
      this.ctx = ctx;               // { scene, terrain, fx, audio, game }
      this.x = x; this.z = z; this.y = 0;
      this.yaw = 0;
      this.hp = 100; this.maxHp = 100;
      this.dead = false;
      this.mesh = null;
      this.radius = 0.5;
      this.height = 1.8;
      this.time = U.rand(0, 10);
    }
    groundY(x, z) { return this.ctx.terrain ? this.ctx.terrain.height(x === undefined ? this.x : x, z === undefined ? this.z : z) : 0; }
    distTo(o) { return Math.hypot(o.x - this.x, o.z - this.z); }
    angleTo(o) { return Math.atan2(o.x - this.x, o.z - this.z); }
    damage(amount, source, hitPos) {
      if (this.dead) return false;
      this.hp -= amount;
      this.onDamage(amount, source, hitPos);
      if (this.hp <= 0) { this.hp = 0; this.die(source); return true; }
      return false;
    }
    onDamage() { }
    die() { this.dead = true; }
    remove() {
      if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
  }

  /* ============================================================
     БОЕЦ (игрок и союзники используют один класс)
     ============================================================ */
  class Soldier extends Entity {
    constructor(ctx, x, z, opts = {}) {
      super(ctx, x, z);
      this.type = 'soldier';
      this.isPlayer = !!opts.isPlayer;
      this.index = opts.index || 0;
      this.maxHp = this.isPlayer ? 150 : 120;
      this.hp = this.maxHp;
      this.radius = 0.42;
      this.height = 1.8;
      this.speed = this.isPlayer ? 5.4 : 4.6;
      this.sprintMul = 1.75;

      this.mag = 30; this.ammo = 30; this.reserve = 240;
      this.fireRate = 0.085;
      this.reloadTime = 1.9;
      this.cd = 0; this.reloading = 0;
      this.damage_ = this.isPlayer ? 34 : 9;
      this.range = this.isPlayer ? 220 : 85;

      this.walkPhase = U.rand(0, U.TAU);
      this.walkAmt = 0;
      this.aimPitch = 0;
      this.stun = 0;
      this.suppression = 0;
      this.regenDelay = 0;
      this.stepTimer = 0;
      this.target = null;
      this.formation = { x: 0, z: 0 };
      this.state = 'idle';       // idle | move | fire | dead
      this.spreadVisual = 0;
      this.deathT = 0;
      this.morale = 1;

      this.mesh = Models.makeSoldier({ leader: opts.leader, dark: opts.dark });
      this.parts = this.mesh.userData;
      this.mesh.position.set(x, this.groundY(), z);
      this.ctx.scene.add(this.mesh);
      this.mesh.visible = !this.isPlayer;
      this._v = new T.Vector3();
    }

    setFirstPerson(on) {
      this.isPlayer = on;
      this.mesh.visible = !on;
      if (on) { this.maxHp = 150; this.hp = Math.max(this.hp, 120); this.damage_ = 34; this.range = 220; }
    }

    /* --- боевая логика союзника --- */
    updateAI(dt, world) {
      if (this.dead) return;
      this.stun = Math.max(0, this.stun - dt);
      this.suppression = Math.max(0, this.suppression - dt * 0.5);

      // цель: ближайший враг в радиусе
      if (!this.target || this.target.dead || this.time % 0.7 < dt) {
        this.target = world.findEnemyNear(this, this.range);
      }

      // движение к точке в строю
      const fx = this.formation.x, fz = this.formation.z;
      let dx = fx - this.x, dz = fz - this.z;
      let d = Math.hypot(dx, dz);

      // отойти от босса, если слишком близко
      const boss = world.boss;
      if (boss && !boss.dead) {
        const db = this.distTo(boss);
        if (db < 16) {
          dx -= (boss.x - this.x) * (16 - db) * 0.25;
          dz -= (boss.z - this.z) * (16 - db) * 0.25;
          d = Math.hypot(dx, dz) || 1;
        }
      }
      // разойтись с соседями
      const near = world.querySoldiers(this.x, this.z, 1.6);
      for (const o of near) {
        if (o === this || o.dead) continue;
        const ox = this.x - o.x, oz = this.z - o.z;
        const od = Math.hypot(ox, oz) || 0.001;
        if (od < 1.4) { dx += (ox / od) * (1.4 - od) * 2.2; dz += (oz / od) * (1.4 - od) * 2.2; d = Math.hypot(dx, dz) || 1; }
      }

      const moving = d > 1.0 && this.stun <= 0;
      if (moving) {
        const sp = Math.min(this.speed * (this.suppression > 0.4 ? 0.6 : 1), d * 2.2);
        this.x += (dx / d) * sp * dt;
        this.z += (dz / d) * sp * dt;
        this.walkAmt = U.damp(this.walkAmt, 1, 8, dt);
        this.walkPhase += dt * sp * 1.7;
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) { this.stepTimer = 0.42; this.onStep(); }
      } else {
        this.walkAmt = U.damp(this.walkAmt, 0, 8, dt);
      }

      // поворот
      let wantYaw;
      if (this.target) wantYaw = this.angleTo(this.target);
      else if (moving) wantYaw = Math.atan2(dx, dz);
      else wantYaw = this.yaw;
      this.yaw = U.angleDamp(this.yaw, wantYaw, 7, dt);

      // стрельба
      this.cd -= dt;
      if (this.reloading > 0) {
        this.reloading -= dt;
        if (this.reloading <= 0) { this.ammo = this.mag; }
      } else if (this.target && this.stun <= 0 && this.cd <= 0) {
        const dist = this.distTo(this.target);
        if (dist < this.range) {
          this.fireAt(this.target, world);
          this.cd = U.rand(0.16, 0.3) + (this.suppression > 0.5 ? 0.25 : 0);
        }
      }
      this.updatePose(dt);
      this.syncMesh();
    }

    fireAt(target, world) {
      this.ammo--;
      if (this.ammo <= 0) { this.reloading = U.rand(2.0, 3.0); }
      const muzzle = new T.Vector3();
      this.parts.muzzle.getWorldPosition(muzzle);
      const aimY = target.type === 'boss'
        ? target.y + U.rand(2, target.height * 0.75)
        : target.y + 1.1;
      const to = new T.Vector3(
        target.x + U.rand(-0.5, 0.5),
        aimY,
        target.z + U.rand(-0.5, 0.5));
      const fx = this.ctx.fx;
      fx.tracer(muzzle, to, { speed: 380, len: 6 });
      const dir = to.clone().sub(muzzle).normalize();
      fx.muzzleFlash(muzzle, dir, 0.55);
      fx.ejectCasing(muzzle, dir);
      if (Math.random() < 0.35) this.ctx.audio.rifleShot(this, { gain: 0.28 });

      // попадание с вероятностью, зависящей от дистанции
      const dist = this.distTo(target);
      const acc = U.clamp01(1.05 - dist / (this.range * 1.15)) * (this.suppression > 0.5 ? 0.6 : 1);
      if (Math.random() < acc) {
        target.damage(this.damage_, this, to);
        if (target.type === 'boss') fx.impact(to, dir.clone().negate(), 'metal');
        else fx.bloodHit(to, dir);
      } else {
        fx.impact(to, dir.clone().negate(), 'dirt');
      }
    }

    onStep() {
      if (this.ctx.fx && !this.isPlayer) {
        const p = new T.Vector3(this.x, this.groundY() + 0.05, this.z);
        if (Math.random() < 0.4) this.ctx.fx.footstepDust(p);
      }
    }

    onDamage(amount, source, hitPos) {
      this.suppression = Math.min(1.5, this.suppression + 0.5);
      this.regenDelay = 6;
      if (this.isPlayer && this.ctx.game) {
        this.ctx.game.hurt = Math.min(1, this.ctx.game.hurt + amount / 60);
        this.ctx.game.shake(0.25, 0);
      }
      if (hitPos && this.ctx.fx) {
        this.ctx.fx.bloodHit(hitPos, new T.Vector3(0, 1, 0));
      }
    }

    die(source) {
      if (this.dead) return;
      this.dead = true;
      this.state = 'dead';
      this.deathT = 0;
      this.mesh.visible = true;
      const fx = this.ctx.fx;
      if (fx) {
        fx.bloodHit(new T.Vector3(this.x, this.y + 1.2, this.z), new T.Vector3(0, 1, 0));
        fx.decal('blood', this.x, this.z, U.rand(1.4, 2.4));
      }
      if (this.ctx.game) this.ctx.game.onSoldierDown(this);
    }

    /* анимация тела */
    updatePose(dt) {
      const p = this.parts;
      const w = this.walkAmt;
      const ph = this.walkPhase;

      if (this.dead) {
        this.deathT += dt;
        const k = U.clamp01(this.deathT / 0.8);
        this.mesh.rotation.x = -k * Math.PI / 2 * 0.92;
        this.mesh.position.y = this.groundY() + U.lerp(0, 0.25, k);
        return;
      }

      // ноги
      p.legL.hip.rotation.x = Math.sin(ph) * 0.75 * w;
      p.legR.hip.rotation.x = -Math.sin(ph) * 0.75 * w;
      p.legL.knee.rotation.x = Math.max(0, -Math.sin(ph + 0.6)) * 1.0 * w;
      p.legR.knee.rotation.x = Math.max(0, Math.sin(ph + 0.6)) * 1.0 * w;
      // корпус
      p.hips.position.y = 0.92 + Math.abs(Math.sin(ph)) * 0.05 * w;
      p.hips.rotation.z = Math.sin(ph) * 0.04 * w;
      p.torso.rotation.y = Math.sin(ph) * 0.08 * w;
      p.torso.rotation.x = 0.06 + w * 0.06;
      // руки: держат оружие, лёгкая раскачка
      const aim = this.target ? 1 : 0.65;
      p.armR.shoulder.rotation.x = -1.15 * aim - Math.sin(ph) * 0.06 * w;
      p.armR.shoulder.rotation.z = -0.28;
      p.armR.elbow.rotation.x = 0.55;
      p.armL.shoulder.rotation.x = -1.25 * aim + Math.sin(ph) * 0.06 * w;
      p.armL.shoulder.rotation.z = 0.5;
      p.armL.elbow.rotation.x = 0.85;
      // голова смотрит на цель
      if (this.target) {
        const dy = (this.target.y + 1.4) - (this.y + 1.6);
        const dist = this.distTo(this.target);
        p.neck.rotation.x = U.clamp(Math.atan2(dy, dist), -0.5, 0.5);
      } else {
        p.neck.rotation.x = U.damp(p.neck.rotation.x, 0, 4, dt);
      }
      // оружие в руках
      p.weapon.position.set(0.2, 0.3, 0.28);
      p.weapon.rotation.set(0.05, -0.12, 0);
    }

    syncMesh() {
      this.y = this.groundY();
      this.mesh.position.set(this.x, this.y, this.z);
      if (!this.dead) this.mesh.rotation.set(0, this.yaw, 0);
      else this.mesh.rotation.y = this.yaw;
    }

    update(dt, world) {
      this.time += dt;
      if (this.dead) { this.updatePose(dt); return; }
      if (!this.isPlayer) this.updateAI(dt, world);
      else {
        this.regenDelay -= dt;
        if (this.regenDelay <= 0 && this.hp < this.maxHp) {
          this.hp = Math.min(this.maxHp, this.hp + 9 * dt);
        }
        this.y = this.groundY();
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y = this.yaw;
      }
    }
  }

  /* ============================================================
     ХАСК
     ============================================================ */
  class Husk extends Entity {
    constructor(ctx, x, z) {
      super(ctx, x, z);
      this.type = 'husk';
      this.maxHp = 90; this.hp = 90;
      this.radius = 0.5; this.height = 2.1;
      this.speed = U.rand(4.6, 6.8);
      this.attackCd = 0;
      this.walkPhase = U.rand(0, U.TAU);
      this.target = null;
      this.spawnT = 0;
      this.mesh = Models.makeHusk();
      this.parts = this.mesh.userData;
      this.mesh.position.set(x, this.groundY(), z);
      this.ctx.scene.add(this.mesh);
      this.mesh.scale.setScalar(0.01);
    }

    update(dt, world) {
      if (this.dead) return;
      this.time += dt;
      this.spawnT = Math.min(1, this.spawnT + dt * 1.6);
      this.mesh.scale.setScalar(U.Ease.outBack(this.spawnT));

      if (!this.target || this.target.dead || this.time % 0.9 < dt) {
        this.target = world.findSoldierNear(this.x, this.z, 200);
      }
      if (this.target) {
        const d = this.distTo(this.target);
        this.yaw = U.angleDamp(this.yaw, this.angleTo(this.target), 9, dt);
        if (d > 1.6) {
          this.x += Math.sin(this.yaw) * this.speed * dt;
          this.z += Math.cos(this.yaw) * this.speed * dt;
          this.walkPhase += dt * this.speed * 2.4;
        } else {
          this.attackCd -= dt;
          if (this.attackCd <= 0) {
            this.attackCd = 0.75;
            this.target.damage(15, this, new T.Vector3(this.target.x, this.target.y + 1.2, this.target.z));
            this.ctx.audio.impact(this, 'flesh');
          }
        }
      }
      this.y = this.groundY();
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.y = this.yaw;

      // анимация бега на четырёх-двух
      const p = this.parts, ph = this.walkPhase;
      p.legL.hip.rotation.x = Math.sin(ph) * 1.1;
      p.legR.hip.rotation.x = -Math.sin(ph) * 1.1;
      p.legL.knee.rotation.x = Math.max(0, -Math.sin(ph + 0.5)) * 1.3;
      p.legR.knee.rotation.x = Math.max(0, Math.sin(ph + 0.5)) * 1.3;
      p.armL.sh.rotation.x = -0.8 - Math.sin(ph) * 0.6;
      p.armR.sh.rotation.x = -0.8 + Math.sin(ph) * 0.6;
      p.armL.el.rotation.x = 0.5;
      p.armR.el.rotation.x = 0.5;
      p.torso.rotation.x = 0.35 + Math.sin(ph * 2) * 0.05;
      p.neck.rotation.x = -0.35;
      p.hips.position.y = 1.0 + Math.abs(Math.sin(ph)) * 0.09;
    }

    onDamage(amount, source, hitPos) {
      if (hitPos) this.ctx.fx.bloodHit(hitPos, new T.Vector3(0, 1, 0));
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      const p = new T.Vector3(this.x, this.y + 1, this.z);
      this.ctx.fx.bloodHit(p, new T.Vector3(0, 1, 0));
      this.ctx.fx.decal('blood', this.x, this.z, U.rand(1.2, 2));
      this.ctx.audio.impact(this, 'flesh');
      this.remove();
      if (this.ctx.game) this.ctx.game.stats.kills++;
    }
  }

  /* ============================================================
     ТЕХНИКА
     ============================================================ */
  class Vehicle extends Entity {
    constructor(ctx, kind, x, z) {
      super(ctx, x, z);
      this.type = kind;             // tank | btr | heli
      this.kind = kind;
      this.wrecked = false;
      this.turretYaw = 0;
      this.barrelPitch = 0;
      this.cd = U.rand(1, 3);
      this.target = null;
      this.smokeT = 0;

      if (kind === 'tank') {
        this.maxHp = 2600; this.speed = 6.5; this.rate = 4.4; this.dmg = 850;
        this.radius = 2.2; this.height = 3.0; this.keepRange = 62; this.shellSpeed = 130;
      } else if (kind === 'btr') {
        this.maxHp = 1300; this.speed = 9.5; this.rate = 0.28; this.dmg = 26;
        this.radius = 1.8; this.height = 2.6; this.keepRange = 44; this.shellSpeed = 0;
      } else {
        this.maxHp = 850; this.speed = 26; this.rate = 2.6; this.dmg = 320;
        this.radius = 3.0; this.height = 3.0; this.keepRange = 55; this.shellSpeed = 105;
        this.alt = U.rand(24, 30); this.orbit = U.rand(0, U.TAU);
      }
      this.hp = this.maxHp;

      this.mesh = kind === 'tank' ? Models.makeTank() : kind === 'btr' ? Models.makeBTR() : Models.makeHeli();
      this.parts = this.mesh.userData;
      this.mesh.position.set(x, kind === 'heli' ? this.alt : this.groundY(), z);
      this.ctx.scene.add(this.mesh);

      // фары как прожекторы (только у наземной техники и только на «high»)
      this.headlights = [];
      if (kind !== 'heli' && ctx.quality === 'high') {
        for (const s of [-1, 1]) {
          const sl = new T.SpotLight(0xffe6bb, 90, 90, 0.42, 0.5, 1.4);
          sl.position.set(s * 1.1, 1.8, 3.2);
          const tgt = new T.Object3D();
          tgt.position.set(s * 1.1, 0.5, 40);
          this.mesh.add(sl, tgt);
          sl.target = tgt;
          this.headlights.push(sl);
        }
      }
    }

    update(dt, world) {
      this.time += dt;
      if (this.wrecked) { this.updateWreck(dt); return; }

      const target = world.boss && !world.boss.dead ? world.boss : world.findEnemyNear(this, 120);
      this.target = target;

      if (this.kind === 'heli') this.updateHeli(dt, world, target);
      else this.updateGround(dt, world, target);
    }

    updateGround(dt, world, target) {
      if (target) {
        const d = this.distTo(target);
        const ang = this.angleTo(target);
        const move = d > this.keepRange + 6 ? 1 : d < this.keepRange - 8 ? -0.55 : 0;
        if (move !== 0) {
          const nx = this.x + Math.sin(ang) * this.speed * move * dt;
          const nz = this.z + Math.cos(ang) * this.speed * move * dt;
          this.x = nx; this.z = nz;
        }
        this.yaw = U.angleDamp(this.yaw, ang, 2.2, dt);
        // башня
        const rel = U.wrapPi(ang - this.yaw);
        this.turretYaw = U.angleDamp(this.turretYaw, rel, 3.2, dt);
        this.parts.turret.rotation.y = this.turretYaw;
        const dy = (target.y + (target.type === 'boss' ? target.height * 0.55 : 1)) - (this.y + 2.2);
        this.barrelPitch = U.damp(this.barrelPitch, U.clamp(Math.atan2(dy, d), -0.2, 0.45), 3, dt);
        if (this.parts.barrel) this.parts.barrel.rotation.z = 0;
        this.parts.turret.rotation.x = -this.barrelPitch * 0.4;

        this.cd -= dt;
        if (this.cd <= 0 && d < 150) {
          this.cd = this.rate * U.rand(0.9, 1.1);
          this.fire(target, world);
        }
      }

      // посадка на рельеф + наклон по нормали
      const gy = this.groundY();
      this.y = U.damp(this.y, gy, 8, dt);
      this.mesh.position.set(this.x, this.y, this.z);
      const n = this.ctx.terrain ? this.ctx.terrain.normal(this.x, this.z) : new T.Vector3(0, 1, 0);
      const pitch = Math.atan2(n.z, n.y) * 0.8;
      const roll = -Math.atan2(n.x, n.y) * 0.8;
      this.mesh.rotation.set(pitch, this.yaw, roll, 'YXZ');
      this.mesh.rotation.order = 'YXZ';
      this.mesh.rotation.y = this.yaw;
      this.mesh.rotation.x = pitch;
      this.mesh.rotation.z = roll;

      // колёса БТР
      if (this.kind === 'btr' && this.parts.wheels) {
        for (const w of this.parts.wheels) w.rotation.x += dt * 6;
      }
      // вспышка гаснет
      if (this.parts.flash.material.opacity > 0) {
        this.parts.flash.material.opacity = Math.max(0, this.parts.flash.material.opacity - dt * 12);
      }
    }

    updateHeli(dt, world, target) {
      this.orbit += dt * 0.32;
      let gx, gz;
      if (target) {
        gx = target.x + Math.cos(this.orbit) * this.keepRange;
        gz = target.z + Math.sin(this.orbit) * this.keepRange;
      } else { gx = this.x; gz = this.z; }
      const dx = gx - this.x, dz = gz - this.z;
      const d = Math.hypot(dx, dz) || 1;
      const k = Math.min(this.speed * dt, d) / d;
      this.x += dx * k; this.z += dz * k;
      const desiredAlt = (this.ctx.terrain ? this.ctx.terrain.height(this.x, this.z) : 0) + this.alt;
      this.y = U.damp(this.y, desiredAlt, 2, dt);
      if (target) this.yaw = U.angleDamp(this.yaw, this.angleTo(target), 2.4, dt);
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.set(-0.12, this.yaw, Math.sin(this.orbit) * 0.18, 'YXZ');
      this.parts.blades.rotation.y += dt * 34;
      this.parts.tailBlades.rotation.x += dt * 40;
      // мигалка
      this.parts.beacon.visible = Math.sin(this.time * 6) > 0;

      if (target) {
        this.cd -= dt;
        if (this.cd <= 0) {
          this.cd = this.rate;
          this.fireRockets(target, world);
        }
      }
    }

    fire(target, world) {
      const muzzleWorld = new T.Vector3();
      this.parts.muzzle.getWorldPosition(muzzleWorld);
      const aimY = target.type === 'boss' ? target.y + U.rand(3, target.height * 0.8) : target.y + 1;
      const to = new T.Vector3(target.x, aimY, target.z);
      const dir = to.clone().sub(muzzleWorld).normalize();

      this.parts.flash.material.opacity = 1;
      this.ctx.fx.muzzleFlash(muzzleWorld, dir, this.kind === 'tank' ? 3 : 1.4);

      if (this.kind === 'tank') {
        world.spawnShell(muzzleWorld, to, this.shellSpeed, this.dmg, 9, this);
        this.ctx.audio.cannonShot(this, 1);
        this.ctx.fx.dustBurst(new T.Vector3(this.x, this.y + 0.3, this.z), 4, 5);
        if (this.ctx.game) this.ctx.game.shake(0.35, this.distTo(this.ctx.game.player || this));
      } else {
        // очередь автопушки — мгновенный луч
        this.ctx.fx.tracer(muzzleWorld, to, { speed: 500, len: 5 });
        this.ctx.audio.rifleShot(this, { gain: 0.35 });
        target.damage(this.dmg, this, to);
        this.ctx.fx.impact(to, dir.clone().negate(), target.type === 'boss' ? 'metal' : 'dirt');
      }
    }

    fireRockets(target, world) {
      const aimY = target.type === 'boss' ? target.y + target.height * 0.6 : target.y + 1;
      for (const m of [this.parts.muzzleL, this.parts.muzzleR]) {
        const p = new T.Vector3();
        m.getWorldPosition(p);
        const to = new T.Vector3(target.x + U.rand(-2, 2), aimY, target.z + U.rand(-2, 2));
        world.spawnRocket(p, to, this.shellSpeed, this.dmg, 8, this);
        this.ctx.fx.muzzleFlash(p, to.clone().sub(p).normalize(), 1.6);
      }
      this.ctx.audio.cannonShot(this, 0.55);
    }

    onDamage(amount, source, hitPos) {
      if (hitPos) this.ctx.fx.impact(hitPos, new T.Vector3(0, 1, 0), 'metal');
      if (this.hp / this.maxHp < 0.45 && Math.random() < 0.15) {
        this.ctx.fx.smokeColumn(new T.Vector3(this.x, this.y + 1.5, this.z), 0.6);
      }
    }

    die() {
      if (this.wrecked) return;
      this.wrecked = true; this.dead = true;
      const pos = new T.Vector3(this.x, this.y + 1.2, this.z);
      this.ctx.fx.explosion(pos, this.kind === 'tank' ? 12 : 9);
      this.ctx.audio.explosion(this, 1.2);
      this.ctx.fx.spawnDebris(pos, 6, 12);
      for (const l of this.headlights) l.visible = false;
      if (this.ctx.game) this.ctx.game.onVehicleLost(this);
      if (this.kind === 'heli') this.fallVel = 0;
      // почернение
      this.mesh.traverse(o => {
        if (o.isMesh && o.material && o.material.color) {
          o.material = o.material.clone();
          o.material.color.multiplyScalar(0.22);
          if (o.material.emissive) o.material.emissive.setHex(0x000000);
        }
      });
    }

    updateWreck(dt) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = U.rand(0.15, 0.4);
        this.ctx.fx.smokeColumn(new T.Vector3(this.x + U.rand(-1, 1), this.y + 1.5, this.z + U.rand(-1, 1)), 1.1);
      }
      if (this.kind === 'heli') {
        this.fallVel = (this.fallVel || 0) + 16 * dt;
        this.y -= this.fallVel * dt;
        this.mesh.rotation.z += dt * 2.4;
        this.mesh.rotation.x += dt * 1.1;
        this.parts.blades.rotation.y += dt * 8;
        const gy = this.groundY();
        if (this.y <= gy + 1) {
          this.y = gy + 1;
          if (!this.crashed) {
            this.crashed = true;
            this.ctx.fx.explosion(new T.Vector3(this.x, this.y, this.z), 14);
            this.ctx.audio.explosion(this, 1.5);
          }
        }
        this.mesh.position.set(this.x, this.y, this.z);
      }
    }
  }

  /* ============================================================
     СИРЕНОГОЛОВЫЙ
     ============================================================ */
  class Boss extends Entity {
    constructor(ctx, x, z) {
      super(ctx, x, z);
      this.type = 'boss';
      this.maxHp = 150000; this.hp = this.maxHp;
      this.radius = 2.2;
      this.height = 13.2;
      this.speed = 5.2;
      this.phase = 1;
      this.state = 'idle';
      this.stateT = 0;
      this.walkPhase = 0;
      this.vuln = 0;
      this.target = null;
      this.cdScream = 8;
      this.cdSummon = 12;
      this.cdSwipe = 0;
      this.cdSlam = 6;
      this.stepSide = 1;
      this.deathT = 0;
      this.emerge = 0;             // 0..1 — «вырастает» в катсцене
      this.mesh = Models.makeSirenHead();
      this.parts = this.mesh.userData;
      this.mesh.position.set(x, this.groundY(), z);
      this.ctx.scene.add(this.mesh);

      // свет из рупоров
      this.glowLight = new T.PointLight(0xff3a20, 0, 90, 2);
      this.glowLight.position.set(0, 12, 0);
      this.mesh.add(this.glowLight);
    }

    setEmerge(k) {
      this.emerge = k;
      this.mesh.position.y = this.groundY() - (1 - k) * this.height * 1.05;
    }

    hitSpheres() {
      const y = this.mesh.position.y;
      return [
        { x: this.x, y: y + 3.0, z: this.z, r: 1.9, mult: 0.8, part: 'legs' },
        { x: this.x, y: y + 8.4, z: this.z, r: 2.1, mult: 1.0, part: 'torso' },
        { x: this.x, y: y + 12.6, z: this.z, r: 2.6, mult: 3.2, part: 'head' }
      ];
    }

    update(dt, world) {
      this.time += dt;
      if (this.dead) { this.updateDeath(dt); return; }
      this.stateT += dt;
      this.vuln = Math.max(0, this.vuln - dt);

      // фаза по здоровью
      const frac = this.hp / this.maxHp;
      const want = frac > 0.66 ? 1 : frac > 0.3 ? 2 : 3;
      if (want !== this.phase) {
        this.phase = want;
        if (this.ctx.game) this.ctx.game.onBossPhase(want);
      }
      const speedMul = this.phase === 1 ? 1 : this.phase === 2 ? 1.28 : 1.6;

      // выбор цели
      if (!this.target || this.target.dead || this.time % 1.2 < dt) {
        this.target = world.findBossTarget(this);
      }

      switch (this.state) {
        case 'idle':
        case 'walk': this.updateWalk(dt, world, speedMul); break;
        case 'scream': this.updateScream(dt, world); break;
        case 'summon': this.updateSummon(dt, world); break;
        case 'swipe': this.updateSwipe(dt, world); break;
        case 'slam': this.updateSlam(dt, world); break;
      }

      this.y = this.groundY();
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.y = this.yaw;
      this.updatePose(dt);

      // «ужас» вблизи
      if (this.ctx.game && this.ctx.game.player) {
        const d = this.distTo(this.ctx.game.player);
        this.ctx.audio.setDread(U.clamp01(1 - d / 60));
      }
    }

    updateWalk(dt, world, speedMul) {
      const t = this.target;
      if (t) {
        const ang = this.angleTo(t);
        this.yaw = U.angleDamp(this.yaw, ang, 2.4, dt);
        const d = this.distTo(t);
        if (d > 11) {
          const sp = this.speed * speedMul;
          this.x += Math.sin(this.yaw) * sp * dt;
          this.z += Math.cos(this.yaw) * sp * dt;
          this.walkPhase += dt * sp * 0.42;
          // шаги
          const s = Math.sin(this.walkPhase);
          if (s * this.stepSide < 0) {
            this.stepSide *= -1;
            this.onFootfall();
          }
        } else if (this.cdSwipe <= 0) {
          this.state = 'swipe'; this.stateT = 0; this.cdSwipe = 4.5; this.swiped = false;
        }
      }
      this.cdScream -= dt; this.cdSummon -= dt; this.cdSwipe -= dt; this.cdSlam -= dt;
      if (this.cdScream <= 0) {
        this.state = 'scream'; this.stateT = 0; this.screamed = false; this.waved = 0;
        this.cdScream = this.phase === 3 ? 9 : 13;
      } else if (this.cdSummon <= 0) {
        this.state = 'summon'; this.stateT = 0; this.summoned = false;
        this.cdSummon = this.phase === 3 ? 11 : 16;
      } else if (this.cdSlam <= 0 && this.target && this.distTo(this.target) < 30) {
        this.state = 'slam'; this.stateT = 0; this.slammed = false;
        this.cdSlam = this.phase === 3 ? 8 : 12;
      }
    }

    onFootfall() {
      this.ctx.audio.stomp(this, 1);
      const foot = new T.Vector3(
        this.x + Math.sin(this.yaw + this.stepSide * 0.4) * 1.4,
        this.groundY(),
        this.z + Math.cos(this.yaw + this.stepSide * 0.4) * 1.4);
      this.ctx.fx.dustBurst(foot, 3.2, 5);
      this.ctx.fx.decal('crater', foot.x, foot.z, 3.4);
      if (this.ctx.game) this.ctx.game.shake(0.35, this.distTo(this.ctx.game.player || this));
    }

    updateScream(dt, world) {
      const t = this.stateT;
      // 0.0–1.4: замах, рупоры разгораются
      if (t < 1.4) {
        if (!this.screamed) {
          this.screamed = true;
          this.ctx.audio.siren(this, 3.4, 0.9);
          if (this.ctx.game) this.ctx.game.onBossScreamStart();
        }
        const k = t / 1.4;
        this.setGlow(k);
        if (this.target) this.yaw = U.angleDamp(this.yaw, this.angleTo(this.target), 3, dt);
      } else if (t < 4.0) {
        this.setGlow(1);
        this.vuln = 0.35;             // окно уязвимости, пока кричит
        const waves = this.phase === 3 ? 3 : 2;
        const step = 0.55;
        while (this.waved < waves && t > 1.4 + this.waved * step) {
          this.waved++;
          world.bossShockwave(this.x, this.z, 60, 24 + this.phase * 8);
        }
        if (this.ctx.game) this.ctx.game.shake(0.12, this.distTo(this.ctx.game.player || this));
      } else {
        this.setGlow(0);
        this.state = 'walk'; this.stateT = 0;
        if (this.ctx.game) this.ctx.game.onBossScreamEnd();
      }
    }

    updateSummon(dt, world) {
      if (this.stateT > 0.9 && !this.summoned) {
        this.summoned = true;
        const n = 5 + this.phase * 3;
        for (let i = 0; i < n; i++) {
          const a = U.rand(U.TAU), r = U.rand(8, 26);
          world.spawnHusk(this.x + Math.cos(a) * r, this.z + Math.sin(a) * r);
        }
        this.ctx.audio.siren(this, 1.6, 0.5);
        if (this.ctx.game) this.ctx.game.toast('ОН ЗОВЁТ ИХ · ДЕРЖАТЬ ФЛАНГИ', 2.2);
      }
      if (this.stateT > 2.0) { this.state = 'walk'; this.stateT = 0; }
    }

    updateSwipe(dt, world) {
      const k = U.clamp01(this.stateT / 1.0);
      const swing = Math.sin(k * Math.PI);
      this.parts.armR.sh.rotation.x = -swing * 2.2;
      this.parts.armR.sh.rotation.z = -swing * 1.1;
      this.parts.torso.rotation.y = -swing * 0.5;
      if (this.stateT > 0.55 && !this.swiped) {
        this.swiped = true;
        const hx = this.x + Math.sin(this.yaw) * 9;
        const hz = this.z + Math.cos(this.yaw) * 9;
        world.bossMelee(hx, hz, 9, 70);
        this.ctx.fx.dustBurst(new T.Vector3(hx, this.groundY(), hz), 7, 8);
        this.ctx.audio.stomp(this, 1.3);
        if (this.ctx.game) this.ctx.game.shake(0.8, this.distTo(this.ctx.game.player || this));
      }
      if (this.stateT > 1.4) {
        this.parts.armR.sh.rotation.set(0, 0, 0);
        this.parts.torso.rotation.y = 0;
        this.state = 'walk'; this.stateT = 0;
      }
    }

    updateSlam(dt, world) {
      const k = U.clamp01(this.stateT / 1.2);
      // поднимает обе руки и бьёт по земле
      const lift = Math.sin(Math.min(1, k / 0.55) * Math.PI * 0.5);
      const drop = k > 0.55 ? U.Ease.inCubic((k - 0.55) / 0.45) : 0;
      const ang = -lift * 2.6 + drop * 3.0;
      this.parts.armL.sh.rotation.x = ang;
      this.parts.armR.sh.rotation.x = ang;
      if (k > 0.92 && !this.slammed) {
        this.slammed = true;
        world.bossShockwave(this.x, this.z, 34, 55, 0xffc060);
        this.ctx.fx.dustBurst(new T.Vector3(this.x, this.groundY(), this.z), 12, 14);
        this.ctx.fx.decal('crater', this.x, this.z, 9);
        this.ctx.audio.explosion(this, 1.0);
        if (this.ctx.game) this.ctx.game.shake(1.2, this.distTo(this.ctx.game.player || this));
      }
      if (this.stateT > 1.8) {
        this.parts.armL.sh.rotation.x = 0;
        this.parts.armR.sh.rotation.x = 0;
        this.state = 'walk'; this.stateT = 0;
      }
    }

    setGlow(k) {
      for (const g of this.parts.glows) g.material.opacity = k * 0.9;
      this.glowLight.intensity = k * 400;
      const s = 1 + k * 0.06;
      for (const h of this.parts.horns) h.scale.setScalar(s);
    }

    updatePose(dt) {
      const p = this.parts;
      const ph = this.walkPhase;
      const moving = this.state === 'walk' || this.state === 'idle';
      const amt = moving ? 1 : 0.25;
      // ноги — широкий шаг
      p.legL.hip.rotation.x = Math.sin(ph) * 0.55 * amt;
      p.legR.hip.rotation.x = -Math.sin(ph) * 0.55 * amt;
      p.legL.knee.rotation.x = Math.max(0, -Math.sin(ph + 0.7)) * 0.9 * amt;
      p.legR.knee.rotation.x = Math.max(0, Math.sin(ph + 0.7)) * 0.9 * amt;
      // корпус качается
      p.hips.position.y = 6.6 + Math.abs(Math.sin(ph)) * 0.35 * amt;
      p.hips.rotation.z = Math.sin(ph) * 0.05 * amt;
      p.torso.rotation.x = 0.06 + Math.sin(ph * 2) * 0.02;
      // руки болтаются
      if (this.state === 'walk' || this.state === 'idle') {
        p.armL.sh.rotation.x = -Math.sin(ph) * 0.42;
        p.armR.sh.rotation.x = Math.sin(ph) * 0.42;
        p.armL.sh.rotation.z = 0.14;
        p.armR.sh.rotation.z = -0.14;
        p.armL.el.rotation.x = 0.25 + Math.sin(ph + 1) * 0.12;
        p.armR.el.rotation.x = 0.25 - Math.sin(ph + 1) * 0.12;
      }
      // голова слегка «ищет»
      p.neck.rotation.y = Math.sin(this.time * 0.6) * 0.25;
      p.head.rotation.z = Math.sin(this.time * 0.43) * 0.08;
      p.head.rotation.x = Math.sin(this.time * 0.31) * 0.06;
    }

    onDamage(amount, source, hitPos) {
      if (hitPos && Math.random() < 0.5) this.ctx.fx.impact(hitPos, new T.Vector3(0, 1, 0), 'metal');
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      this.deathT = 0;
      this.setGlow(0);
      this.ctx.audio.siren(this, 3.6, 0.9);
      if (this.ctx.game) this.ctx.game.onBossDown();
    }

    updateDeath(dt) {
      this.deathT += dt;
      const k = U.clamp01(this.deathT / 3.0);
      // падение назад с ускорением
      const fall = U.Ease.inCubic(k) * Math.PI / 2;
      this.mesh.rotation.x = -fall;
      this.mesh.position.y = this.groundY() - Math.sin(fall) * 0.4;
      const p = this.parts;
      p.armL.sh.rotation.x = U.lerp(p.armL.sh.rotation.x, 0.6, dt * 2);
      p.armR.sh.rotation.x = U.lerp(p.armR.sh.rotation.x, 0.6, dt * 2);
      if (!this.impacted && k > 0.85) {
        this.impacted = true;
        this.ctx.fx.dustBurst(new T.Vector3(this.x, this.groundY(), this.z), 18, 22);
        this.ctx.audio.explosion(this, 1.6);
        if (this.ctx.game) this.ctx.game.shake(1.6, 0);
      }
      if (this.deathT < 6 && Math.random() < dt * 6) {
        this.ctx.fx.smokeColumn(new T.Vector3(
          this.x + U.rand(-3, 3), this.groundY() + 1, this.z + U.rand(-3, 3)), 1.4);
      }
    }
  }

  return { Entity, Soldier, Husk, Vehicle, Boss };
})();
