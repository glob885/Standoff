/* ============================================================
   src/touch.js — управление для телефона (v3).

   Что умеет:
   • динамический левый стик (появляется там, где коснулся)
   • обзор свайпом со сглаживанием и «ускорением» пальца
   • автоогонь при наведении на врага (настраиваемо)
   • аим-ассист: мягкое притягивание прицела к ближайшей цели
   • тап-огонь, удержание, отдельная кнопка прицела (тумблер/удержание)
   • вибро-отклик (haptics) на попадание, выстрел, урон
   • редактор раскладки: кнопки можно двигать пальцем, позиции
     сохраняются в localStorage
   • левша-режим (зеркальная раскладка)
   ============================================================ */
'use strict';

const TouchUI = (() => {

  const DEFAULT_LAYOUT = {
    stick: { x: 0.14, y: 0.74 },
    fire: { x: 0.87, y: 0.74 },
    ads: { x: 0.72, y: 0.55 },
    reload: { x: 0.72, y: 0.80 },
    sprint: { x: 0.60, y: 0.86 },
    jumpToggle: { x: 0.60, y: 0.62 }
  };

  class TouchController {
    constructor(game) {
      this.game = game;
      this.enabled = U.isMobile();
      this.root = document.getElementById('touch');
      this.lookArea = document.getElementById('lookArea');
      this.stickEl = document.getElementById('stickL');
      this.knobEl = this.stickEl ? this.stickEl.querySelector('.knob') : null;

      /* настройки */
      this.settings = {
        dynamicStick: U.Store.read('t_dynStick', true),
        autoFire: U.Store.read('t_autoFire', true),
        aimAssist: U.Store.read('t_aimAssist', 0.65),
        adsToggle: U.Store.read('t_adsToggle', true),
        haptics: U.Store.read('t_haptics', true),
        leftHanded: U.Store.read('t_leftHanded', false),
        lookSmoothing: U.Store.read('t_lookSmooth', 0.35),
        gyro: U.Store.read('t_gyro', false),
        uiScale: U.Store.read('t_uiScale', 1.0)
      };
      this.layout = U.Store.read('t_layout', null) || JSON.parse(JSON.stringify(DEFAULT_LAYOUT));

      /* состояние */
      this.move = { x: 0, y: 0 };
      this.lookVel = { x: 0, y: 0 };
      this.firing = false;
      this.ads = false;
      this.sprint = false;
      this.editing = false;
      this.stickTouch = null;
      this.lookTouch = null;
      this.stickOrigin = { x: 0, y: 0 };
      this.autoFireTarget = false;
      this.gyroBase = null;

      if (!this.enabled) return;
      this.root.classList.remove('hidden');
      this.applyLayout();
      this.bindStick();
      this.bindLook();
      this.bindButtons();
      if (this.settings.gyro) this.enableGyro();
    }

    /* ---------------- раскладка ---------------- */
    applyLayout() {
      const mirror = this.settings.leftHanded;
      const place = (el, pos) => {
        if (!el) return;
        const x = mirror ? 1 - pos.x : pos.x;
        el.style.left = (x * 100) + '%';
        el.style.top = (pos.y * 100) + '%';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = `translate(-50%, -50%) scale(${this.settings.uiScale})`;
      };
      place(this.stickEl, this.layout.stick);
      place(document.getElementById('fireBtn'), this.layout.fire);
      place(document.getElementById('adsBtn'), this.layout.ads);
      place(document.getElementById('reloadBtn'), this.layout.reload);
      place(document.getElementById('sprintBtn'), this.layout.sprint);
      if (this.lookArea) {
        // зона обзора — половина экрана со стороны, противоположной стику
        this.lookArea.style.left = mirror ? '0' : 'auto';
        this.lookArea.style.right = mirror ? 'auto' : '0';
      }
      U.Store.write('t_layout', this.layout);
    }

    resetLayout() {
      this.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
      this.applyLayout();
    }

    setSetting(key, value) {
      this.settings[key] = value;
      const map = {
        dynamicStick: 't_dynStick', autoFire: 't_autoFire', aimAssist: 't_aimAssist',
        adsToggle: 't_adsToggle', haptics: 't_haptics', leftHanded: 't_leftHanded',
        lookSmoothing: 't_lookSmooth', gyro: 't_gyro', uiScale: 't_uiScale'
      };
      if (map[key]) U.Store.write(map[key], value);
      if (key === 'leftHanded' || key === 'uiScale') this.applyLayout();
      if (key === 'gyro') value ? this.enableGyro() : this.disableGyro();
    }

    /* ---------------- вибрация ---------------- */
    haptic(pattern) {
      if (!this.settings.haptics) return;
      if (navigator.vibrate) {
        try { navigator.vibrate(pattern); } catch (e) { /* не критично */ }
      }
    }
    hapticShot() { this.haptic(8); }
    hapticHit() { this.haptic([0, 12, 20, 12]); }
    hapticHurt() { this.haptic(45); }
    hapticExplosion() { this.haptic([0, 30, 40, 60]); }

    /* ---------------- левый стик ---------------- */
    bindStick() {
      const R = 58;
      const area = document.createElement('div');
      area.id = 'stickArea';
      area.className = 'stick-area';
      this.root.appendChild(area);
      this.stickArea = area;
      this.applyStickArea();

      const start = e => {
        for (const t of e.changedTouches) {
          if (this.stickTouch !== null) continue;
          this.stickTouch = t.identifier;
          if (this.settings.dynamicStick) {
            this.stickOrigin.x = t.clientX;
            this.stickOrigin.y = t.clientY;
            this.stickEl.style.left = t.clientX + 'px';
            this.stickEl.style.top = t.clientY + 'px';
            this.stickEl.style.transform = `translate(-50%, -50%) scale(${this.settings.uiScale})`;
          } else {
            const r = this.stickEl.getBoundingClientRect();
            this.stickOrigin.x = r.left + r.width / 2;
            this.stickOrigin.y = r.top + r.height / 2;
          }
          this.stickEl.classList.add('active');
          this.moveStick(t);
        }
      };
      const move = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== this.stickTouch) continue;
          this.moveStick(t);
        }
      };
      const end = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== this.stickTouch) continue;
          this.stickTouch = null;
          this.move.x = this.move.y = 0;
          this.sprintFromStick = false;
          if (this.knobEl) this.knobEl.style.transform = 'translate(0,0)';
          this.stickEl.classList.remove('active');
          if (this.settings.dynamicStick) this.applyLayout();
        }
      };
      this._stickR = R;
      area.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, { passive: false });
      area.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, { passive: false });
      area.addEventListener('touchend', e => { e.preventDefault(); end(e); }, { passive: false });
      area.addEventListener('touchcancel', end);
      // стик остаётся и как отдельная цель касания
      this.stickEl.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, { passive: false });
      this.stickEl.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, { passive: false });
      this.stickEl.addEventListener('touchend', e => { e.preventDefault(); end(e); }, { passive: false });
    }

    applyStickArea() {
      if (!this.stickArea) return;
      const mirror = this.settings.leftHanded;
      this.stickArea.style.left = mirror ? '46%' : '0';
      this.stickArea.style.right = mirror ? '0' : '46%';
    }

    moveStick(t) {
      const R = this._stickR;
      let dx = t.clientX - this.stickOrigin.x;
      let dy = t.clientY - this.stickOrigin.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(d, R) / d;
      dx *= k; dy *= k;
      if (this.knobEl) this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = dx / R;
      this.move.y = dy / R;
      // бег: стик вперёд до упора
      this.sprintFromStick = (this.move.y < -0.85);
    }

    /* ---------------- обзор ---------------- */
    bindLook() {
      let lastX = 0, lastY = 0, lastT = 0, moved = 0;
      const start = e => {
        for (const t of e.changedTouches) {
          if (this.lookTouch !== null) continue;
          this.lookTouch = t.identifier;
          lastX = t.clientX; lastY = t.clientY;
          lastT = performance.now();
          moved = 0;
          this.tapStart = performance.now();
        }
      };
      const move = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== this.lookTouch) continue;
          const now = performance.now();
          const dt = Math.max(1, now - lastT) / 1000;
          const dx = t.clientX - lastX;
          const dy = t.clientY - lastY;
          moved += Math.abs(dx) + Math.abs(dy);
          // ускорение: быстрый свайп поворачивает сильнее
          const speed = Math.hypot(dx, dy) / dt;
          const accel = 1 + U.clamp01(speed / 2600) * 0.85;
          const sens = 0.0052 * (this.game.input ? this.game.input.sensitivity : 1) *
            (this.ads ? 0.6 : 1) * accel;
          this.lookVel.x -= dx * sens;
          this.lookVel.y -= dy * sens;
          lastX = t.clientX; lastY = t.clientY; lastT = now;
        }
      };
      const end = e => {
        for (const t of e.changedTouches) {
          if (t.identifier !== this.lookTouch) continue;
          this.lookTouch = null;
          // короткий тап по зоне обзора = выстрел
          if (moved < 14 && performance.now() - this.tapStart < 260 && !this.settings.autoFire) {
            this.tapFire = 0.12;
          }
        }
      };
      const el = this.lookArea;
      el.addEventListener('touchstart', e => { e.preventDefault(); start(e); }, { passive: false });
      el.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, { passive: false });
      el.addEventListener('touchend', e => { e.preventDefault(); end(e); }, { passive: false });
      el.addEventListener('touchcancel', end);
    }

    /* ---------------- кнопки ---------------- */
    bindButtons() {
      const bind = (id, onDown, onUp) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', e => {
          e.preventDefault();
          if (this.editing) { this.startDrag(id, e); return; }
          onDown();
        }, { passive: false });
        el.addEventListener('touchmove', e => {
          if (this.editing) { e.preventDefault(); this.dragMove(id, e); }
        }, { passive: false });
        el.addEventListener('touchend', e => {
          e.preventDefault();
          if (this.editing) { this.endDrag(id); return; }
          if (onUp) onUp();
        }, { passive: false });
        el.addEventListener('touchcancel', () => { if (onUp) onUp(); });
      };

      bind('fireBtn', () => { this.firing = true; this.haptic(6); }, () => { this.firing = false; });
      bind('adsBtn', () => {
        if (this.settings.adsToggle) { this.ads = !this.ads; this.haptic(10); }
        else { this.ads = true; }
      }, () => { if (!this.settings.adsToggle) this.ads = false; });
      bind('sprintBtn', () => { this.sprint = true; }, () => { this.sprint = false; });
      bind('reloadBtn', () => { this.game.reload(); this.haptic(12); });
    }

    /* ---------------- редактор раскладки ---------------- */
    setEditing(on) {
      this.editing = on;
      this.root.classList.toggle('editing', on);
      const hint = document.getElementById('layoutHint');
      if (hint) hint.classList.toggle('hidden', !on);
    }
    startDrag(id, e) {
      const t = e.changedTouches[0];
      this.drag = { id, id_: t.identifier };
    }
    dragMove(id, e) {
      if (!this.drag || this.drag.id !== id) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this.drag.id_) continue;
        const key = id === 'fireBtn' ? 'fire' : id === 'adsBtn' ? 'ads'
          : id === 'reloadBtn' ? 'reload' : id === 'sprintBtn' ? 'sprint' : 'stick';
        const x = U.clamp01(t.clientX / innerWidth);
        const y = U.clamp01(t.clientY / innerHeight);
        this.layout[key] = { x: this.settings.leftHanded ? 1 - x : x, y };
        this.applyLayout();
      }
    }
    endDrag() { this.drag = null; }

    /* ---------------- гироскоп ---------------- */
    enableGyro() {
      if (this._gyroHandler) return;
      const start = () => {
        this._gyroHandler = e => {
          if (!e.rotationRate) return;
          const rr = e.rotationRate;
          // beta — наклон вверх/вниз, alpha — поворот
          this.lookVel.x -= (rr.alpha || 0) * 0.00022;
          this.lookVel.y -= (rr.beta || 0) * 0.00016;
        };
        addEventListener('devicemotion', this._gyroHandler);
      };
      if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().then(res => {
          if (res === 'granted') start();
        }).catch(() => { });
      } else start();
    }
    disableGyro() {
      if (this._gyroHandler) {
        removeEventListener('devicemotion', this._gyroHandler);
        this._gyroHandler = null;
      }
    }

    /* ---------------- аим-ассист + автоогонь ---------------- */
    updateAim(dt) {
      const game = this.game;
      const strength = this.settings.aimAssist;
      this.autoFireTarget = false;
      if (!game.player || game.state !== 'play') return;

      const cam = game.camera;
      const camPos = new THREE.Vector3();
      cam.getWorldPosition(camPos);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

      let best = null, bestDot = 0.986, bestDist = 0;
      const consider = (x, y, z, radiusBonus) => {
        const dx = x - camPos.x, dy = y - camPos.y, dz = z - camPos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1 || dist > 140) return;
        const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
        const need = bestDot - radiusBonus / Math.max(8, dist);
        if (dot > need) { bestDot = dot; best = { x, y, z }; bestDist = dist; }
      };

      for (const h of game.world.husks) {
        if (h.dead) continue;
        consider(h.x, h.y + 1.3, h.z, 1.6);
      }
      const boss = game.world.boss;
      if (boss && !boss.dead) {
        consider(boss.x, boss.y + 8.5, boss.z, 4.0);
        consider(boss.x, boss.y + 12.6, boss.z, 3.0);
      }

      if (!best) return;
      this.autoFireTarget = true;

      if (strength <= 0.01) return;
      // мягко доворачиваем камеру к цели
      const dx = best.x - camPos.x, dy = best.y - camPos.y, dz = best.z - camPos.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const horiz = Math.hypot(dx, dz);
      const targetPitch = Math.atan2(dy, horiz);
      const input = game.input;
      // сила зависит от того, движется ли игрок пальцем (не мешаем ручному прицеливанию)
      const manual = Math.hypot(this.lookVel.x, this.lookVel.y) > 0.002 ? 0.35 : 1;
      const k = strength * manual * (this.ads ? 1.5 : 1) * dt * 3.4 * U.clamp01(1 - bestDist / 150);
      input.yaw += U.angleDelta(input.yaw, targetYaw) * U.clamp01(k);
      input.pitch += (targetPitch - input.pitch) * U.clamp01(k);
    }

    /* ---------------- цикл ---------------- */
    update(dt) {
      if (!this.enabled) return;
      const input = this.game.input;
      if (!input) return;

      // инерция обзора
      const smooth = U.clamp01(this.settings.lookSmoothing);
      const decay = Math.exp(-dt * U.lerp(60, 9, smooth));
      input.yaw += this.lookVel.x;
      input.pitch = U.clamp(input.pitch + this.lookVel.y, -1.35, 1.3);
      this.lookVel.x *= decay;
      this.lookVel.y *= decay;
      if (Math.abs(this.lookVel.x) < 1e-5) this.lookVel.x = 0;
      if (Math.abs(this.lookVel.y) < 1e-5) this.lookVel.y = 0;

      this.updateAim(dt);

      // передаём состояние в общий ввод
      input.move.x = this.move.x;
      input.move.y = this.move.y;
      input.ads = this.ads;
      input.sprint = this.sprint || this.sprintFromStick;

      if (this.tapFire > 0) {
        this.tapFire -= dt;
        input.firing = true;
      } else if (this.settings.autoFire) {
        input.firing = this.firing || (this.autoFireTarget && this.ads);
      } else {
        input.firing = this.firing;
      }

      // подсветка кнопок
      const fb = document.getElementById('fireBtn');
      if (fb) fb.classList.toggle('locked', this.autoFireTarget);
      const ab = document.getElementById('adsBtn');
      if (ab) ab.classList.toggle('on', this.ads);
    }
  }

  return { TouchController, DEFAULT_LAYOUT };
})();
