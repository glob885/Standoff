/* ============================================================
   src/detail.js — детализация мира (v3):
   военные пропсы (ящики, мешки с песком, бочки, антенна),
   поваленные стволы, пни, папоротник, следы техники,
   костёр с живым светом, стаи птиц, летящая листва и пыльца,
   порывы ветра. Всё инстансится и почти не грузит кадр.
   ============================================================ */
'use strict';

const Detail = (() => {
  const T = THREE;

  /* ---------- материалы ---------- */
  function makeMaterials() {
    return {
      wood: new T.MeshStandardMaterial({ map: TEX.get('bark'), color: 0xa08a6a, roughness: 0.95, metalness: 0 }),
      crate: new T.MeshStandardMaterial({ map: TEX.get('armor'), color: 0x8f9a72, roughness: 0.85, metalness: 0.05 }),
      sand: new T.MeshStandardMaterial({ color: 0x8d7f5f, roughness: 1.0, metalness: 0 }),
      barrel: new T.MeshStandardMaterial({ map: TEX.get('rust'), color: 0x9a6a4a, roughness: 0.8, metalness: 0.35 }),
      fern: new T.MeshStandardMaterial({
        map: TEX.get('grass'), color: 0x7fa05c, roughness: 0.9,
        transparent: true, alphaTest: 0.4, side: T.DoubleSide
      }),
      metal: new T.MeshStandardMaterial({ color: 0x5c6468, roughness: 0.6, metalness: 0.6 }),
      ember: new T.MeshBasicMaterial({ color: 0xff8a3a })
    };
  }

  /* ============================================================
     ПРОПСЫ
     ============================================================ */
  class Props {
    constructor(scene, terrain, opts = {}) {
      this.scene = scene;
      this.terrain = terrain;
      this.opts = Object.assign({
        seed: 99, quality: 'high', camp: true,
        logs: 40, stumps: 26, ferns: 220, crates: 18, sandbags: 26, barrels: 12
      }, opts);
      this.rng = U.makeRNG(this.opts.seed);
      this.objects = [];
      this.mats = makeMaterials();
      this.lights = [];
      this.build();
    }

    add(obj) { this.scene.add(obj); this.objects.push(obj); return obj; }

    place(x, z, obj, yOffset = 0, alignToSlope = true) {
      const y = this.terrain.height(x, z) + yOffset;
      obj.position.set(x, y, z);
      if (alignToSlope) {
        const n = this.terrain.normal(x, z);
        obj.rotation.x = Math.atan2(n.z, n.y) * 0.8;
        obj.rotation.z = -Math.atan2(n.x, n.y) * 0.8;
      }
      return obj;
    }

    randomSpot(minR, maxR) {
      const rng = this.rng;
      const a = rng.range(0, U.TAU);
      const r = U.lerp(minR, maxR, Math.sqrt(rng()));
      return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }

    build() {
      this.buildOutpost();
      this.buildPowerLine();
      this.buildWrecks();
      this.buildLogs();
      this.buildStumps();
      if (this.opts.quality !== 'low') this.buildFerns();
      this.buildMilitary();
      if (this.opts.camp) this.buildCamp();
      this.buildTracks();
    }

    /* --- поваленные стволы --- */
    buildLogs() {
      const rng = this.rng;
      const count = this.opts.logs;
      const geo = new T.CylinderGeometry(0.35, 0.42, 6, 7);
      geo.rotateZ(Math.PI / 2);
      const inst = new T.InstancedMesh(geo, this.mats.wood, count);
      inst.castShadow = true; inst.receiveShadow = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      for (let i = 0; i < count; i++) {
        const spot = this.randomSpot(12, this.terrain.opts.size * 0.85);
        const sc = rng.range(0.7, 1.5);
        e.set(rng.range(-0.12, 0.12), rng.range(0, U.TAU), rng.range(-0.1, 0.1));
        q.setFromEuler(e);
        p.set(spot.x, this.terrain.height(spot.x, spot.z) + 0.35 * sc, spot.z);
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.add(inst);
    }

    /* --- пни --- */
    buildStumps() {
      const rng = this.rng;
      const count = this.opts.stumps;
      const geo = new T.CylinderGeometry(0.5, 0.62, 1.0, 8);
      const inst = new T.InstancedMesh(geo, this.mats.wood, count);
      inst.castShadow = true; inst.receiveShadow = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      for (let i = 0; i < count; i++) {
        const spot = this.randomSpot(10, this.terrain.opts.size * 0.9);
        const sc = rng.range(0.7, 1.4);
        e.set(rng.range(-0.08, 0.08), rng.range(0, U.TAU), rng.range(-0.08, 0.08));
        q.setFromEuler(e);
        p.set(spot.x, this.terrain.height(spot.x, spot.z) + 0.4 * sc, spot.z);
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.add(inst);
    }

    /* --- папоротник (крест из двух плоскостей) --- */
    buildFerns() {
      const rng = this.rng;
      const count = this.opts.ferns;
      const a = new T.PlaneGeometry(1.6, 1.2);
      a.translate(0, 0.6, 0);
      const b = a.clone();
      b.rotateY(Math.PI / 2);
      const merged = Models.mergeColored([
        { geo: a, color: 0xffffff },
        { geo: b, color: 0xdff0d0 }
      ]);
      const mat = this.mats.fern.clone();
      mat.vertexColors = true;
      const inst = new T.InstancedMesh(merged, mat, count);
      inst.receiveShadow = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      for (let i = 0; i < count; i++) {
        const spot = this.randomSpot(6, this.terrain.opts.size * 0.8);
        if (this.terrain.field.slope(spot.x, spot.z) > 0.4) continue;
        const sc = rng.range(0.7, 1.6);
        e.set(0, rng.range(0, U.TAU), rng.range(-0.1, 0.1));
        q.setFromEuler(e);
        p.set(spot.x, this.terrain.height(spot.x, spot.z), spot.z);
        s.set(sc, sc * rng.range(0.8, 1.3), sc);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.add(inst);
    }

    /* --- военные пропсы: ящики, мешки, бочки --- */
    buildMilitary() {
      const rng = this.rng;

      // ящики с боеприпасами
      const crateGeo = Models.mergeColored([
        { geo: Models.gBox(1.2, 0.7, 0.8), color: 0xffffff },
        { geo: Models.gBox(1.24, 0.08, 0.84, 0, 0.32, 0), color: 0xb9c39a },
        { geo: Models.gBox(0.1, 0.72, 0.84, -0.5, 0, 0), color: 0x6f7a5c },
        { geo: Models.gBox(0.1, 0.72, 0.84, 0.5, 0, 0), color: 0x6f7a5c }
      ]);
      const crates = new T.InstancedMesh(crateGeo, this.mats.crate, this.opts.crates);
      crates.castShadow = true; crates.receiveShadow = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      for (let i = 0; i < this.opts.crates; i++) {
        const spot = this.randomSpot(8, 60);
        const stack = rng.int(0, 3);
        e.set(0, rng.range(0, U.TAU), 0);
        q.setFromEuler(e);
        p.set(spot.x, this.terrain.height(spot.x, spot.z) + 0.35 + stack * 0.72, spot.z);
        s.setScalar(1);
        m.compose(p, q, s);
        crates.setMatrixAt(i, m);
      }
      crates.instanceMatrix.needsUpdate = true;
      this.add(crates);

      // мешки с песком — полукруглые брустверы
      const bagGeo = new T.SphereGeometry(0.42, 7, 5);
      bagGeo.scale(1.5, 0.75, 1);
      const bags = new T.InstancedMesh(bagGeo, this.mats.sand, this.opts.sandbags * 7);
      bags.castShadow = true; bags.receiveShadow = true;
      let bi = 0;
      for (let w = 0; w < this.opts.sandbags; w++) {
        const spot = this.randomSpot(10, 70);
        const dir = rng.range(0, U.TAU);
        const len = rng.int(3, 6);
        for (let i = 0; i < len && bi < bags.count; i++) {
          for (let row = 0; row < 2; row++) {
            if (bi >= bags.count) break;
            const off = (i - len / 2) * 0.86 + (row ? 0.4 : 0);
            const x = spot.x + Math.cos(dir) * off;
            const z = spot.z + Math.sin(dir) * off;
            e.set(0, dir + rng.range(-0.15, 0.15), 0);
            q.setFromEuler(e);
            p.set(x, this.terrain.height(x, z) + 0.28 + row * 0.5, z);
            s.setScalar(rng.range(0.9, 1.1));
            m.compose(p, q, s);
            bags.setMatrixAt(bi++, m);
          }
        }
      }
      bags.count = bi;
      bags.instanceMatrix.needsUpdate = true;
      this.add(bags);

      // бочки
      const barrelGeo = Models.mergeColored([
        { geo: Models.gCyl(0.42, 0.42, 1.1, 10), color: 0xffffff },
        { geo: Models.gTorus(0.43, 0.05, 10, 0, 0.28, 0, { x: Math.PI / 2 }), color: 0xd0d0d0 },
        { geo: Models.gTorus(0.43, 0.05, 10, 0, -0.28, 0, { x: Math.PI / 2 }), color: 0xd0d0d0 }
      ]);
      const barrels = new T.InstancedMesh(barrelGeo, this.mats.barrel, this.opts.barrels);
      barrels.castShadow = true; barrels.receiveShadow = true;
      for (let i = 0; i < this.opts.barrels; i++) {
        const spot = this.randomSpot(10, 80);
        const fallen = rng.chance(0.35);
        e.set(fallen ? Math.PI / 2 : 0, rng.range(0, U.TAU), 0);
        q.setFromEuler(e);
        p.set(spot.x, this.terrain.height(spot.x, spot.z) + (fallen ? 0.42 : 0.55), spot.z);
        s.setScalar(1);
        m.compose(p, q, s);
        barrels.setMatrixAt(i, m);
      }
      barrels.instanceMatrix.needsUpdate = true;
      this.add(barrels);
    }

    /* --- лагерь: костёр, антенна, палатка --- */
    buildCamp() {
      const rng = this.rng;
      const spot = this.randomSpot(20, 45);
      const gy = this.terrain.height(spot.x, spot.z);

      // кострище
      const fire = new T.Group();
      const stones = Models.mergeColored(
        Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * U.TAU;
          return {
            geo: Models.gSph(0.22, 6, Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75),
            color: 0xb9bcc0
          };
        }));
      fire.add(new T.Mesh(stones, this.mats.metal));
      const wood = Models.mergeColored([
        { geo: Models.gCyl(0.08, 0.08, 1.1, 5, 0, 0.25, 0, { x: 0.9, z: 0.3 }), color: 0xffffff },
        { geo: Models.gCyl(0.08, 0.08, 1.1, 5, 0, 0.25, 0, { x: -0.9, z: -0.4 }), color: 0xe0d0c0 },
        { geo: Models.gCyl(0.07, 0.07, 1.0, 5, 0, 0.2, 0, { z: 1.2 }), color: 0xd0c0b0 }
      ]);
      fire.add(new T.Mesh(wood, this.mats.wood));
      const emberMesh = new T.Mesh(new T.SphereGeometry(0.3, 8, 6), this.mats.ember);
      emberMesh.position.y = 0.16;
      fire.add(emberMesh);
      fire.position.set(spot.x, gy, spot.z);
      this.add(fire);

      const light = new T.PointLight(0xff8a3a, 60, 26, 2);
      light.position.set(spot.x, gy + 0.7, spot.z);
      this.add(light);
      this.lights.push({ light, base: 60, phase: rng.range(0, 10) });
      this.campfire = { x: spot.x, y: gy, z: spot.z, ember: emberMesh };

      // радиоантенна
      const ax = spot.x + rng.range(-8, 8), az = spot.z + rng.range(-8, 8);
      const mast = Models.mergeColored([
        { geo: Models.gCyl(0.09, 0.12, 7, 6, 0, 3.5, 0), color: 0xffffff },
        { geo: Models.gBox(1.4, 0.06, 0.06, 0, 6.2, 0), color: 0xcfd4d8 },
        { geo: Models.gBox(1.0, 0.06, 0.06, 0, 5.7, 0), color: 0xcfd4d8 },
        { geo: Models.gBox(0.7, 0.06, 0.06, 0, 5.2, 0), color: 0xcfd4d8 },
        { geo: Models.gBox(0.9, 0.5, 0.9, 0, 0.25, 0), color: 0x9aa2a6 }
      ]);
      const mastMesh = new T.Mesh(mast, this.mats.metal);
      mastMesh.castShadow = true;
      this.place(ax, az, mastMesh, 0, false);
      this.add(mastMesh);
      const blink = new T.PointLight(0xff3020, 12, 14, 2);
      blink.position.set(ax, this.terrain.height(ax, az) + 7.1, az);
      this.add(blink);
      this.lights.push({ light: blink, base: 12, phase: 0, blink: true });

      // палатка
      const tx = spot.x + rng.range(-12, 12), tz = spot.z + rng.range(-12, 12);
      const tent = Models.mergeColored([
        { geo: Models.gBox(3.4, 0.12, 4.2, 0, 0.06, 0), color: 0x8a9070 },
        { geo: Models.gCyl(1.7, 1.7, 4.2, 3, 0, 0.95, 0, { x: Math.PI / 2, y: 0 }), color: 0xffffff }
      ]);
      const tentMesh = new T.Mesh(tent, this.mats.crate);
      tentMesh.castShadow = true;
      tentMesh.rotation.y = rng.range(0, U.TAU);
      this.place(tx, tz, tentMesh, 0, false);
      this.add(tentMesh);
    }

    /* --- блокпост: бетонные блоки, шлагбаум, вышка, сетка --- */
    buildOutpost() {
      const rng = this.rng;
      const spot = this.randomSpot(35, 80);
      const dir = rng.range(0, U.TAU);
      const grp = new T.Group();

      // бетонные блоки поперёк дороги
      for (let i = -3; i <= 3; i++) {
        const block = new T.Mesh(Models.mergeColored([
          { geo: Models.gBox(1.6, 1.0, 0.9, 0, 0.5, 0), color: 0xc9c9c2 },
          { geo: Models.gBox(1.9, 0.16, 1.1, 0, 0.06, 0), color: 0xb0b0a8 },
          { geo: Models.gBox(1.2, 0.2, 0.7, 0, 1.02, 0), color: 0xd6d6cc }
        ]), this.mats.metal);
        block.castShadow = true; block.receiveShadow = true;
        const x = spot.x + Math.cos(dir) * i * 2.2;
        const z = spot.z + Math.sin(dir) * i * 2.2;
        block.position.set(x, this.terrain.height(x, z), z);
        block.rotation.y = dir + rng.range(-0.15, 0.15);
        grp.add(block);
      }

      // шлагбаум
      const gate = new T.Mesh(Models.mergeColored([
        { geo: Models.gCyl(0.12, 0.14, 1.4, 8, 0, 0.7, 0), color: 0x8f9a8a },
        { geo: Models.gBox(5.2, 0.16, 0.16, 2.4, 1.3, 0), color: 0xd8443a },
        { geo: Models.gBox(0.9, 0.18, 0.18, 0.6, 1.3, 0), color: 0xeeeee6 },
        { geo: Models.gBox(0.9, 0.18, 0.18, 2.4, 1.3, 0), color: 0xeeeee6 },
        { geo: Models.gBox(0.9, 0.18, 0.18, 4.2, 1.3, 0), color: 0xeeeee6 }
      ]), this.mats.metal);
      gate.castShadow = true;
      const gx = spot.x + Math.cos(dir + 1.5) * 6, gz = spot.z + Math.sin(dir + 1.5) * 6;
      gate.position.set(gx, this.terrain.height(gx, gz), gz);
      gate.rotation.y = dir;
      gate.rotation.z = -0.35;   // поднятая стрела
      grp.add(gate);

      // наблюдательная вышка
      const towerX = spot.x + Math.cos(dir - 1.4) * 9, towerZ = spot.z + Math.sin(dir - 1.4) * 9;
      const legs = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        legs.push({ geo: Models.gCyl(0.11, 0.13, 6.4, 6, sx * 1.1, 3.2, sz * 1.1, { x: sz * 0.05, z: -sx * 0.05 }), color: 0xa08a68 });
      }
      const tower = new T.Mesh(Models.mergeColored([
        ...legs,
        { geo: Models.gBox(3.0, 0.2, 3.0, 0, 6.4, 0), color: 0xb59a76 },
        { geo: Models.gBox(3.2, 0.12, 3.2, 0, 6.5, 0), color: 0x9d8464 },
        // перила
        { geo: Models.gBox(3.2, 0.9, 0.12, 0, 6.9, 1.5), color: 0xa89070 },
        { geo: Models.gBox(3.2, 0.9, 0.12, 0, 6.9, -1.5), color: 0xa89070 },
        { geo: Models.gBox(0.12, 0.9, 3.2, 1.5, 6.9, 0), color: 0xa89070 },
        // навес
        { geo: Models.gBox(3.4, 0.14, 3.4, 0, 8.6, 0), color: 0x7f8a6a },
        { geo: Models.gCyl(0.08, 0.08, 2.0, 5, 1.4, 7.6, 1.4), color: 0x8f9a7a },
        { geo: Models.gCyl(0.08, 0.08, 2.0, 5, -1.4, 7.6, -1.4), color: 0x8f9a7a },
        // лестница
        ...Array.from({ length: 9 }, (_, i) => ({
          geo: Models.gBox(1.2, 0.08, 0.2, 0, 0.6 + i * 0.65, 2.2 - i * 0.12),
          color: 0xa08a68
        }))
      ]), this.mats.wood);
      tower.castShadow = true; tower.receiveShadow = true;
      tower.position.set(towerX, this.terrain.height(towerX, towerZ), towerZ);
      tower.rotation.y = dir;
      grp.add(tower);

      // прожектор на вышке
      const beam = new T.SpotLight(0xffe9c0, 120, 60, 0.5, 0.6, 1.5);
      beam.position.set(towerX, this.terrain.height(towerX, towerZ) + 8, towerZ);
      const beamTarget = new T.Object3D();
      beamTarget.position.set(towerX + Math.cos(dir) * 40, 0, towerZ + Math.sin(dir) * 40);
      grp.add(beam, beamTarget);
      beam.target = beamTarget;
      this.lights.push({ light: beam, base: 120, phase: rng.range(0, 6) });

      // сетка-рабица с колючкой
      const fenceParts = [];
      for (let i = 0; i < 10; i++) {
        const fx = -9 + i * 2;
        fenceParts.push({ geo: Models.gCyl(0.06, 0.06, 2.4, 5, fx, 1.2, 0), color: 0x8d938f });
        fenceParts.push({ geo: Models.gBox(2.0, 0.04, 0.04, fx + 1, 2.3, 0), color: 0x9aa09c });
        fenceParts.push({ geo: Models.gBox(2.0, 0.04, 0.04, fx + 1, 1.2, 0), color: 0x9aa09c });
        fenceParts.push({ geo: Models.gBox(2.0, 0.04, 0.04, fx + 1, 0.3, 0), color: 0x9aa09c });
      }
      const fence = new T.Mesh(Models.mergeColored(fenceParts), this.mats.metal);
      const fx2 = spot.x + Math.cos(dir + 3) * 12, fz2 = spot.z + Math.sin(dir + 3) * 12;
      fence.position.set(fx2, this.terrain.height(fx2, fz2), fz2);
      fence.rotation.y = dir + Math.PI / 2;
      fence.castShadow = true;
      grp.add(fence);

      this.add(grp);
      this.outpost = { x: spot.x, z: spot.z };
    }

    /* --- линия электропередачи через карту --- */
    buildPowerLine() {
      const rng = this.rng;
      const count = 7;
      const dir = rng.range(0, U.TAU);
      const step = (this.terrain.opts.size * 1.7) / count;
      const poleParts = i => ([
        { geo: Models.gCyl(0.22, 0.3, 11, 6, 0, 5.5, 0), color: 0xa89070 },
        { geo: Models.gBox(4.6, 0.22, 0.22, 0, 9.6, 0), color: 0x9d8464 },
        { geo: Models.gBox(3.4, 0.2, 0.2, 0, 8.6, 0), color: 0x9d8464 },
        { geo: Models.gBox(0.2, 1.2, 0.2, -2.2, 10.1, 0), color: 0x8a7458 },
        { geo: Models.gBox(0.2, 1.2, 0.2, 2.2, 10.1, 0), color: 0x8a7458 },
        // изоляторы
        { geo: Models.gCyl(0.12, 0.12, 0.26, 6, -2.2, 9.85, 0), color: 0xd8d2c0 },
        { geo: Models.gCyl(0.12, 0.12, 0.26, 6, 2.2, 9.85, 0), color: 0xd8d2c0 },
        { geo: Models.gCyl(0.12, 0.12, 0.26, 6, 0, 8.85, 0), color: 0xd8d2c0 }
      ]);
      const poles = [];
      for (let i = 0; i < count; i++) {
        const t = (i - (count - 1) / 2) * step;
        const x = Math.cos(dir) * t, z = Math.sin(dir) * t;
        const y = this.terrain.height(x, z);
        const pole = new T.Mesh(Models.mergeColored(poleParts(i)), this.mats.wood);
        pole.castShadow = true;
        pole.position.set(x, y, z);
        pole.rotation.y = dir + Math.PI / 2;
        this.add(pole);
        poles.push({ x, y, z });
      }
      // провода между опорами — провисающие линии
      const wireMat = new T.LineBasicMaterial({ color: 0x1b1e20, transparent: true, opacity: 0.75 });
      for (let i = 0; i < poles.length - 1; i++) {
        const a = poles[i], b = poles[i + 1];
        for (const off of [-2.2, 0, 2.2]) {
          const pts = [];
          const oxA = Math.cos(dir + Math.PI / 2) * off, ozA = Math.sin(dir + Math.PI / 2) * off;
          for (let s = 0; s <= 8; s++) {
            const k = s / 8;
            const sag = Math.sin(k * Math.PI) * 1.4;
            pts.push(new T.Vector3(
              U.lerp(a.x, b.x, k) + oxA,
              U.lerp(a.y + (off === 0 ? 8.85 : 9.85), b.y + (off === 0 ? 8.85 : 9.85), k) - sag,
              U.lerp(a.z, b.z, k) + ozA));
          }
          const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), wireMat);
          this.add(line);
        }
      }
    }

    /* --- брошенная и сгоревшая техника --- */
    buildWrecks() {
      const rng = this.rng;
      for (let i = 0; i < 3; i++) {
        const spot = this.randomSpot(25, 90);
        const truck = new T.Mesh(Models.mergeColored([
          { geo: Models.gBox(2.4, 1.1, 5.4, 0, 1.1, 0), color: 0x4a4640 },
          { geo: Models.gBox(2.2, 1.3, 1.8, 0, 1.9, 1.8), color: 0x413d38 },
          { geo: Models.gBox(2.3, 1.6, 3.2, 0, 2.1, -1.2), color: 0x38352f },
          { geo: Models.gCyl(0.6, 0.6, 0.4, 8, -1.2, 0.6, 1.6, { z: Math.PI / 2 }), color: 0x1c1c1a },
          { geo: Models.gCyl(0.6, 0.6, 0.4, 8, 1.2, 0.6, 1.6, { z: Math.PI / 2 }), color: 0x1c1c1a },
          { geo: Models.gCyl(0.6, 0.6, 0.4, 8, -1.2, 0.6, -1.8, { z: Math.PI / 2 }), color: 0x1c1c1a }
        ]), this.mats.barrel);
        truck.castShadow = true; truck.receiveShadow = true;
        truck.position.set(spot.x, this.terrain.height(spot.x, spot.z), spot.z);
        truck.rotation.set(rng.range(-0.1, 0.1), rng.range(0, U.TAU), rng.range(-0.15, 0.15));
        this.add(truck);
        this.wreckSmoke = this.wreckSmoke || [];
        this.wreckSmoke.push({ x: spot.x, y: this.terrain.height(spot.x, spot.z) + 2, z: spot.z });
      }
    }

    /* --- следы гусениц на земле --- */
    buildTracks() {
      const rng = this.rng;
      const count = this.opts.quality === 'low' ? 10 : 26;
      const geo = new T.PlaneGeometry(2.6, 9);
      geo.rotateX(-Math.PI / 2);
      const mat = new T.MeshBasicMaterial({
        map: TEX.get('crater'), transparent: true, opacity: 0.28,
        depthWrite: false, color: 0x3a3026
      });
      for (let i = 0; i < count; i++) {
        const spot = this.randomSpot(10, 90);
        const m = new T.Mesh(geo, mat);
        m.position.set(spot.x, this.terrain.height(spot.x, spot.z) + 0.05, spot.z);
        m.rotation.y = rng.range(0, U.TAU);
        m.renderOrder = 1;
        this.add(m);
      }
    }

    update(dt, time) {
      // мерцание костра и мигалка антенны
      for (const l of this.lights) {
        if (l.blink) {
          l.light.intensity = (Math.sin(time * 3) > 0.6) ? l.base : 0;
        } else {
          const f = 0.75 + 0.25 * Math.sin(time * 9 + l.phase) * Math.sin(time * 3.7 + l.phase * 2);
          l.light.intensity = l.base * f;
        }
      }
      if (this.campfire && this.campfire.ember) {
        const s = 0.9 + 0.15 * Math.sin(time * 8);
        this.campfire.ember.scale.setScalar(s);
      }
    }

    dispose() {
      for (const o of this.objects) {
        this.scene.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      }
      this.objects.length = 0;
      this.lights.length = 0;
    }
  }

  /* ============================================================
     ЖИВНОСТЬ И АТМОСФЕРА: птицы, листва, пыльца
     ============================================================ */
  class Ambience {
    constructor(scene, terrain, quality) {
      this.scene = scene;
      this.terrain = terrain;
      this.quality = quality;
      this.objects = [];
      this.time = 0;
      this.buildBirds();
      this.buildMotes();
    }

    buildBirds() {
      const flocks = this.quality === 'low' ? 1 : 3;
      const perFlock = this.quality === 'low' ? 6 : 12;
      const geo = Models.mergeColored([
        { geo: Models.gBox(0.6, 0.05, 0.16, -0.3, 0, 0, { z: 0.35 }), color: 0x2a2c30 },
        { geo: Models.gBox(0.6, 0.05, 0.16, 0.3, 0, 0, { z: -0.35 }), color: 0x2a2c30 },
        { geo: Models.gBox(0.18, 0.08, 0.34), color: 0x1e2024 }
      ]);
      const mat = new T.MeshBasicMaterial({ vertexColors: true });
      this.flocks = [];
      for (let f = 0; f < flocks; f++) {
        const inst = new T.InstancedMesh(geo, mat, perFlock);
        inst.frustumCulled = false;
        this.scene.add(inst);
        this.objects.push(inst);
        this.flocks.push({
          mesh: inst,
          center: new T.Vector3(U.rand(-120, 120), U.rand(45, 80), U.rand(-120, 120)),
          radius: U.rand(20, 45),
          speed: U.rand(0.12, 0.28),
          phase: U.rand(0, U.TAU),
          birds: Array.from({ length: perFlock }, () => ({
            off: new T.Vector3(U.rand(-8, 8), U.rand(-4, 4), U.rand(-8, 8)),
            flap: U.rand(0, U.TAU),
            flapSpeed: U.rand(7, 13)
          }))
        });
      }
    }

    buildMotes() {
      const count = this.quality === 'low' ? 0 : this.quality === 'medium' ? 120 : 260;
      if (!count) { this.motes = null; return; }
      const geo = new T.PlaneGeometry(0.09, 0.09);
      const mat = new T.MeshBasicMaterial({
        map: TEX.get('spark'), color: 0xd8e4c0, transparent: true,
        opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending
      });
      const inst = new T.InstancedMesh(geo, mat, count);
      inst.frustumCulled = false;
      this.scene.add(inst);
      this.objects.push(inst);
      this.motes = {
        mesh: inst,
        data: Array.from({ length: count }, () => ({
          p: new T.Vector3(U.rand(-40, 40), U.rand(0.5, 14), U.rand(-40, 40)),
          v: new T.Vector3(U.rand(-0.3, 0.3), U.rand(-0.1, 0.25), U.rand(-0.3, 0.3)),
          phase: U.rand(0, U.TAU)
        }))
      };
    }

    update(dt, camera, wind) {
      this.time += dt;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(1, 1, 1);
      const e = new T.Euler();

      for (const f of this.flocks) {
        f.phase += dt * f.speed;
        const cx = f.center.x + Math.cos(f.phase) * f.radius;
        const cz = f.center.z + Math.sin(f.phase * 1.3) * f.radius;
        const heading = Math.atan2(
          -Math.sin(f.phase) * f.radius * f.speed,
          Math.cos(f.phase * 1.3) * f.radius * f.speed * 1.3);
        f.birds.forEach((b, i) => {
          b.flap += dt * b.flapSpeed;
          const flap = Math.sin(b.flap) * 0.5;
          p.set(cx + b.off.x, f.center.y + b.off.y + Math.sin(this.time + i) * 0.6, cz + b.off.z);
          e.set(flap * 0.6, heading + Math.PI / 2, flap);
          q.setFromEuler(e);
          m.compose(p, q, s);
          f.mesh.setMatrixAt(i, m);
        });
        f.mesh.instanceMatrix.needsUpdate = true;
      }

      if (this.motes && camera) {
        const cam = camera.position;
        const md = this.motes.data;
        for (let i = 0; i < md.length; i++) {
          const d = md[i];
          d.p.x += (d.v.x + wind * 0.7) * dt;
          d.p.y += d.v.y * dt + Math.sin(this.time * 1.4 + d.phase) * 0.05 * dt;
          d.p.z += (d.v.z + wind * 0.35) * dt;
          // держим рой вокруг камеры
          if (Math.abs(d.p.x - cam.x) > 30) d.p.x = cam.x + (d.p.x > cam.x ? -30 : 30);
          if (Math.abs(d.p.z - cam.z) > 30) d.p.z = cam.z + (d.p.z > cam.z ? -30 : 30);
          const gy = this.terrain.height(d.p.x, d.p.z);
          if (d.p.y < gy + 0.3) d.p.y = gy + U.rand(4, 12);
          if (d.p.y > gy + 16) d.p.y = gy + 0.5;
          p.copy(d.p);
          q.copy(camera.quaternion);
          m.compose(p, q, s);
          this.motes.mesh.setMatrixAt(i, m);
        }
        this.motes.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    dispose() {
      for (const o of this.objects) {
        this.scene.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      }
      this.objects.length = 0;
      this.flocks = [];
      this.motes = null;
    }
  }

  return { Props, Ambience };
})();
