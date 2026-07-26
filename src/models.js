/* ============================================================
   src/models.js — детальные процедурные модели.
   Ключевая оптимизация: геометрия каждой «кости» сливается
   в один буфер с вершинными цветами → 1 draw call на кость.
   Боец = 7 мешей вместо 30, техника = 2-3, босс = 9.
   ============================================================ */
'use strict';

const Models = (() => {
  const T = THREE;

  /* ---------- материалы ---------- */
  const M = {};
  function initMaterials() {
    M.soldier = new T.MeshStandardMaterial({
      map: TEX.get('camo'), vertexColors: true, roughness: 0.85, metalness: 0.06
    });
    M.soldierDark = new T.MeshStandardMaterial({
      map: TEX.get('camoDark'), vertexColors: true, roughness: 0.85, metalness: 0.06
    });
    M.husk = new T.MeshStandardMaterial({
      map: TEX.get('flesh'), vertexColors: true, roughness: 0.9, metalness: 0.0
    });
    M.armor = new T.MeshStandardMaterial({
      map: TEX.get('armor'), normalMap: TEX.get('armorN'), vertexColors: true,
      roughness: 0.75, metalness: 0.3
    });
    M.rust = new T.MeshStandardMaterial({
      map: TEX.get('rust'), normalMap: TEX.get('rustN'), vertexColors: true,
      roughness: 0.85, metalness: 0.35
    });
    M.grille = new T.MeshStandardMaterial({
      map: TEX.get('grille'), roughness: 0.65, metalness: 0.7, color: 0x9aa0a4
    });
    M.glass = new T.MeshStandardMaterial({
      color: 0x1d3a44, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.6
    });
    M.gun = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
    M.lamp = new T.MeshBasicMaterial({ color: 0xfff2cf });
    M.lampRed = new T.MeshBasicMaterial({ color: 0xff3b28 });
    M.eye = new T.MeshBasicMaterial({ color: 0xff4432 });
  }

  /* ============================================================
     СЛИЯНИЕ ГЕОМЕТРИИ С ВЕРШИННЫМИ ЦВЕТАМИ
     ============================================================ */
  const _c = new T.Color();

  function mergeColored(parts) {
    let vCount = 0, iCount = 0;
    for (const p of parts) {
      const g = p.geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      vCount += g.attributes.position.count;
      iCount += g.index ? g.index.count : g.attributes.position.count;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const col = new Float32Array(vCount * 3);
    const idx = (vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount));
    let vo = 0, io = 0;
    for (const p of parts) {
      const g = p.geo;
      const gp = g.attributes.position.array;
      const gn = g.attributes.normal.array;
      const gu = g.attributes.uv ? g.attributes.uv.array : null;
      const n = g.attributes.position.count;
      pos.set(gp, vo * 3);
      nor.set(gn, vo * 3);
      if (gu) uv.set(gu, vo * 2);
      _c.set(p.color === undefined ? 0xffffff : p.color);
      if ('convertSRGBToLinear' in _c) _c.convertSRGBToLinear();
      for (let i = 0; i < n; i++) {
        col[(vo + i) * 3] = _c.r;
        col[(vo + i) * 3 + 1] = _c.g;
        col[(vo + i) * 3 + 2] = _c.b;
      }
      if (g.index) {
        const gi = g.index.array;
        for (let i = 0; i < gi.length; i++) idx[io++] = gi[i] + vo;
      } else {
        for (let i = 0; i < n; i++) idx[io++] = i + vo;
      }
      vo += n;
      g.dispose();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  /* ---------- конструкторы примитивов (в локальных координатах) ---------- */
  function gBox(w, h, d, x = 0, y = 0, z = 0, rot) {
    const g = new T.BoxGeometry(w, h, d);
    if (rot) g.rotateX(rot.x || 0), g.rotateY(rot.y || 0), g.rotateZ(rot.z || 0);
    g.translate(x, y, z);
    return g;
  }
  function gCyl(rt, rb, h, seg, x = 0, y = 0, z = 0, rot) {
    const g = new T.CylinderGeometry(rt, rb, h, seg);
    if (rot) g.rotateX(rot.x || 0), g.rotateY(rot.y || 0), g.rotateZ(rot.z || 0);
    g.translate(x, y, z);
    return g;
  }
  function gSph(r, seg, x = 0, y = 0, z = 0, scale) {
    const g = new T.SphereGeometry(r, seg, Math.max(4, Math.floor(seg / 2)));
    if (scale) g.scale(scale.x || 1, scale.y || 1, scale.z || 1);
    g.translate(x, y, z);
    return g;
  }
  function gCone(r, h, seg, x = 0, y = 0, z = 0, rot, open) {
    const g = new T.ConeGeometry(r, h, seg, 1, !!open);
    if (rot) g.rotateX(rot.x || 0), g.rotateY(rot.y || 0), g.rotateZ(rot.z || 0);
    g.translate(x, y, z);
    return g;
  }
  function gTorus(r, tube, seg, x = 0, y = 0, z = 0, rot) {
    const g = new T.TorusGeometry(r, tube, 5, seg);
    if (rot) g.rotateX(rot.x || 0), g.rotateY(rot.y || 0), g.rotateZ(rot.z || 0);
    g.translate(x, y, z);
    return g;
  }
  function pivot(x, y, z) {
    const o = new T.Object3D();
    o.position.set(x, y, z);
    return o;
  }
  function boneMesh(parts, mat, castShadow) {
    const m = new T.Mesh(mergeColored(parts), mat);
    m.castShadow = castShadow !== false;
    m.receiveShadow = true;
    return m;
  }

  /* ---------- палитра ---------- */
  const C = {
    camo: 0xffffff,       // берётся с текстуры
    vest: 0x59604c,
    strap: 0x33372c,
    helmet: 0x6d7560,
    skin: 0xb99a7c,
    visor: 0x2a3338,
    boot: 0x3a352e,
    gunA: 0x4a4f52,
    gunB: 0x2c3032,
    hull: 0xdfe6d8,
    hullDark: 0x7d8577,
    track: 0x3a3d3e,
    rust: 0xffffff,
    rustDark: 0x7a736c,
    flesh: 0xffffff,
    fleshDark: 0x6c5f58
  };

  /* ============================================================
     БОЕЦ — 7 мешей (таз+торс, голова, 2 руки, 2 ноги, оружие)
     ============================================================ */
  function makeSoldier(opts = {}) {
    const mat = opts.dark ? M.soldierDark : M.soldier;
    const root = new T.Group();

    const hips = pivot(0, 0.92, 0);
    root.add(hips);
    const torso = pivot(0, 0, 0);
    hips.add(torso);

    /* --- торс (одна геометрия) --- */
    const torsoParts = [
      { geo: gBox(0.46, 0.58, 0.28, 0, 0.29), color: C.camo },
      { geo: gBox(0.5, 0.44, 0.34, 0, 0.3, 0.01), color: C.vest },       // броня
      { geo: gBox(0.11, 0.14, 0.09, -0.15, 0.17, 0.19), color: C.strap },
      { geo: gBox(0.11, 0.14, 0.09, 0, 0.17, 0.19), color: C.strap },
      { geo: gBox(0.11, 0.14, 0.09, 0.15, 0.17, 0.19), color: C.strap },
      { geo: gBox(0.36, 0.42, 0.2, 0, 0.3, -0.23), color: C.vest },       // рюкзак
      { geo: gCyl(0.06, 0.06, 0.26, 6, 0.13, 0.4, -0.33, { z: 0.2 }), color: C.strap },
      { geo: gBox(0.5, 0.05, 0.36, 0, 0.45, 0), color: C.strap },
      { geo: gBox(0.3, 0.2, 0.24, 0, 0.02, 0), color: C.camo },           // пояс
      { geo: gBox(0.12, 0.1, 0.1, -0.2, 0.06, 0.1), color: C.strap },     // подсумки
      { geo: gBox(0.12, 0.1, 0.1, 0.2, 0.06, 0.1), color: C.strap }
    ];
    const torsoMesh = boneMesh(torsoParts, mat, false);
    torso.add(torsoMesh);

    /* --- голова + каска --- */
    const neck = pivot(0, 0.58, 0);
    torso.add(neck);
    const head = pivot(0, 0, 0);
    neck.add(head);
    const headParts = [
      { geo: gBox(0.2, 0.24, 0.22, 0, 0.12), color: C.skin },
      { geo: gSph(0.16, 10, 0, 0.22, 0, { y: 0.82, z: 1.1 }), color: C.helmet },
      { geo: gBox(0.32, 0.05, 0.07, 0, 0.2, 0.15), color: C.helmet },
      { geo: gBox(0.06, 0.07, 0.06, 0.13, 0.25, 0.02), color: C.gunB },
      { geo: gBox(0.22, 0.07, 0.05, 0, 0.14, 0.12), color: C.visor },
      { geo: gBox(0.17, 0.11, 0.07, 0, 0.03, 0.1), color: C.vest }
    ];
    if (opts.leader) headParts.push({ geo: gBox(0.06, 0.03, 0.03, -0.14, 0.24, 0.03), color: 0xff2a1a });
    head.add(boneMesh(headParts, mat, false));

    /* --- руки --- */
    function makeArm(side) {
      const shoulder = pivot(side * 0.28, 0.46, 0);
      shoulder.add(boneMesh([
        { geo: gBox(0.17, 0.13, 0.17, 0, -0.02, 0), color: C.vest },
        { geo: gCyl(0.07, 0.065, 0.33, 6, 0, -0.17, 0), color: C.camo }
      ], mat, false));
      const elbow = pivot(0, -0.33, 0);
      shoulder.add(elbow);
      elbow.add(boneMesh([
        { geo: gCyl(0.062, 0.055, 0.3, 6, 0, -0.15, 0), color: C.camo },
        { geo: gBox(0.1, 0.11, 0.13, 0, -0.33, 0.02), color: C.boot }
      ], mat, false));
      return { shoulder, elbow };
    }
    const armL = makeArm(-1), armR = makeArm(1);
    torso.add(armL.shoulder, armR.shoulder);

    /* --- ноги --- */
    function makeLeg(side) {
      const hip = pivot(side * 0.13, 0, 0);
      hip.add(boneMesh([
        { geo: gCyl(0.095, 0.085, 0.46, 6, 0, -0.23, 0), color: C.camo },
        { geo: gBox(0.19, 0.13, 0.2, 0, -0.42, 0.03), color: C.vest }
      ], mat, false));
      const knee = pivot(0, -0.46, 0);
      hip.add(knee);
      knee.add(boneMesh([
        { geo: gCyl(0.08, 0.07, 0.44, 6, 0, -0.22, 0), color: C.camo },
        { geo: gBox(0.17, 0.14, 0.3, 0, -0.47, 0.06), color: C.boot }
      ], mat, false));
      return { hip, knee };
    }
    const legL = makeLeg(-1), legR = makeLeg(1);
    hips.add(legL.hip, legR.hip);

    /* --- оружие --- */
    const weapon = new T.Group();
    weapon.add(boneMesh([
      { geo: gBox(0.06, 0.09, 0.6, 0, 0, 0.08), color: C.gunA },
      { geo: gCyl(0.018, 0.018, 0.44, 6, 0, 0.015, 0.5, { x: Math.PI / 2 }), color: C.gunB },
      { geo: gBox(0.05, 0.16, 0.11, 0, -0.11, -0.02, { x: 0.15 }), color: C.gunB },
      { geo: gBox(0.05, 0.12, 0.2, 0, -0.03, -0.24), color: C.gunA },
      { geo: gBox(0.04, 0.05, 0.15, 0, 0.07, 0.05), color: C.gunB },
      { geo: gBox(0.05, 0.06, 0.16, 0, -0.05, 0.28), color: C.gunA }
    ], M.gun, false));
    weapon.position.set(0.2, 0.3, 0.28);
    torso.add(weapon);

    const muzzle = pivot(0, 0.02, 0.62);
    weapon.add(muzzle);

    root.userData = { hips, torso, neck, head, armL, armR, legL, legR, weapon, muzzle };
    return root;
  }

  /* ============================================================
     ХАСК — 6 мешей
     ============================================================ */
  function makeHusk() {
    const mat = M.husk;
    const root = new T.Group();
    const hips = pivot(0, 1.0, 0);
    root.add(hips);
    const torso = pivot(0, 0, 0);
    hips.add(torso);
    torso.add(boneMesh([
      { geo: gBox(0.38, 0.62, 0.24, 0, 0.3), color: C.flesh },
      { geo: gBox(0.44, 0.16, 0.28, 0, 0.58), color: C.fleshDark },
      { geo: gBox(0.4, 0.03, 0.26, 0, 0.2, 0.02), color: C.fleshDark },
      { geo: gBox(0.4, 0.03, 0.26, 0, 0.32, 0.02), color: C.fleshDark },
      { geo: gBox(0.4, 0.03, 0.26, 0, 0.44, 0.02), color: C.fleshDark },
      { geo: gBox(0.3, 0.22, 0.22, 0, 0.02), color: C.flesh }
    ], mat));

    const neck = pivot(0, 0.62, 0);
    torso.add(neck);
    const head = pivot(0, 0, 0);
    neck.add(head);
    head.add(boneMesh([
      { geo: gSph(0.14, 8, 0, 0.1, 0, { x: 0.9, y: 1.15 }), color: C.flesh },
      { geo: gBox(0.15, 0.05, 0.04, 0, 0.06, 0.1), color: 0x2a1a18 },
      { geo: gBox(0.1, 0.05, 0.03, 0, 0.0, 0.09), color: 0x2a1a18 }
    ], mat));
    const eyes = new T.Mesh(mergeColored([
      { geo: gBox(0.035, 0.035, 0.03, -0.05, 0.14, 0.12), color: 0xffffff },
      { geo: gBox(0.035, 0.035, 0.03, 0.05, 0.14, 0.12), color: 0xffffff }
    ]), M.eye);
    head.add(eyes);

    function arm(side) {
      const sh = pivot(side * 0.22, 0.5, 0);
      sh.add(boneMesh([{ geo: gCyl(0.05, 0.042, 0.44, 5, 0, -0.22, 0), color: C.flesh }], mat));
      const el = pivot(0, -0.44, 0);
      sh.add(el);
      el.add(boneMesh([
        { geo: gCyl(0.042, 0.032, 0.5, 5, 0, -0.25, 0), color: C.flesh },
        { geo: gCyl(0.018, 0.004, 0.2, 4, -0.04, -0.58, 0, { z: 0.3 }), color: C.fleshDark },
        { geo: gCyl(0.018, 0.004, 0.22, 4, 0, -0.6, 0), color: C.fleshDark },
        { geo: gCyl(0.018, 0.004, 0.2, 4, 0.04, -0.58, 0, { z: -0.3 }), color: C.fleshDark }
      ], mat));
      return { sh, el };
    }
    const armL = arm(-1), armR = arm(1);
    torso.add(armL.sh, armR.sh);

    function leg(side) {
      const hip = pivot(side * 0.11, 0, 0);
      hip.add(boneMesh([{ geo: gCyl(0.06, 0.05, 0.5, 5, 0, -0.25, 0), color: C.flesh }], mat));
      const knee = pivot(0, -0.5, 0);
      hip.add(knee);
      knee.add(boneMesh([
        { geo: gCyl(0.05, 0.04, 0.48, 5, 0, -0.24, 0), color: C.flesh },
        { geo: gBox(0.12, 0.07, 0.24, 0, -0.5, 0.05), color: C.fleshDark }
      ], mat));
      return { hip, knee };
    }
    const legL = leg(-1), legR = leg(1);
    hips.add(legL.hip, legR.hip);

    root.userData = { hips, torso, neck, head, armL, armR, legL, legR };
    return root;
  }

  /* ============================================================
     ТАНК — 2 меша (корпус + башня) + фары
     ============================================================ */
  function makeTank() {
    const root = new T.Group();
    const hullParts = [
      { geo: gBox(3.3, 0.85, 6.4, 0, 1.15), color: C.hull },
      { geo: gBox(3.3, 0.9, 1.9, 0, 1.02, 3.0, { x: -0.5 }), color: C.hull },
      { geo: gBox(3.0, 0.34, 5.4, 0, 1.62, -0.2), color: C.hullDark },
      { geo: gBox(0.62, 0.42, 1.2, 1.52, 1.78, -1.6), color: C.hullDark },
      { geo: gBox(0.62, 0.42, 1.0, -1.52, 1.78, -1.2), color: C.hullDark },
      { geo: gBox(2.6, 0.2, 0.4, 0, 1.5, 3.35), color: C.hullDark }
    ];
    for (const s of [-1, 1]) {
      hullParts.push({ geo: gBox(0.74, 1.08, 6.7, s * 1.62, 0.72), color: C.track });
      for (let i = 0; i < 6; i++) {
        hullParts.push({ geo: gCyl(0.44, 0.44, 0.3, 10, s * 1.62, 0.56, -2.5 + i * 1.0, { z: Math.PI / 2 }), color: C.hullDark });
      }
      hullParts.push({ geo: gCyl(0.54, 0.54, 0.34, 10, s * 1.62, 0.82, 3.05, { z: Math.PI / 2 }), color: C.hullDark });
      hullParts.push({ geo: gCyl(0.5, 0.5, 0.34, 10, s * 1.62, 0.82, -3.05, { z: Math.PI / 2 }), color: C.hullDark });
      // крылья
      hullParts.push({ geo: gBox(0.9, 0.1, 2.2, s * 1.62, 1.35, 1.9), color: C.hullDark });
    }
    const hull = boneMesh(hullParts, M.armor);
    root.add(hull);

    const turret = new T.Group();
    turret.position.set(0, 2.05, -0.3);
    root.add(turret);
    const turretParts = [
      { geo: gBox(2.5, 0.8, 3.0, 0, 0, 0), color: C.hull },
      { geo: gBox(2.1, 0.45, 1.2, 0, 0.55, -0.4), color: C.hull },
      { geo: gCyl(0.42, 0.42, 0.3, 10, -0.5, 0.72, -0.5), color: C.hullDark },
      { geo: gBox(0.5, 0.35, 0.5, 0.75, 0.7, -0.6), color: C.hullDark },
      { geo: gCyl(0.05, 0.05, 1.1, 6, 0.75, 0.78, -0.1, { x: Math.PI / 2 }), color: C.track },
      { geo: gBox(1.1, 0.7, 0.6, 0, 0, 1.5), color: C.hullDark },
      { geo: gCyl(0.15, 0.17, 4.4, 10, 0, 0, 3.6, { x: Math.PI / 2 }), color: C.hullDark },
      { geo: gCyl(0.22, 0.22, 0.55, 10, 0, 0, 5.6, { x: Math.PI / 2 }), color: C.hullDark },
      { geo: gBox(2.2, 0.5, 0.9, 0, 0.05, -1.85), color: C.track },
      // дымовые гранатомёты
      { geo: gCyl(0.08, 0.08, 0.3, 6, -0.9, 0.2, 1.0, { x: 0.4 }), color: C.hullDark },
      { geo: gCyl(0.08, 0.08, 0.3, 6, -0.7, 0.2, 1.0, { x: 0.4 }), color: C.hullDark },
      { geo: gCyl(0.08, 0.08, 0.3, 6, 0.9, 0.2, 1.0, { x: 0.4 }), color: C.hullDark },
      { geo: gCyl(0.08, 0.08, 0.3, 6, 0.7, 0.2, 1.0, { x: 0.4 }), color: C.hullDark }
    ];
    turret.add(boneMesh(turretParts, M.armor));

    const lamps = new T.Mesh(mergeColored([
      { geo: gBox(0.24, 0.18, 0.1, -1.1, 1.72, 3.28), color: 0xffffff },
      { geo: gBox(0.24, 0.18, 0.1, 1.1, 1.72, 3.28), color: 0xffffff }
    ]), M.lamp);
    root.add(lamps);

    const flash = new T.Sprite(new T.SpriteMaterial({
      map: TEX.get('flash'), color: 0xffd9a0, transparent: true,
      blending: T.AdditiveBlending, depthWrite: false, opacity: 0
    }));
    flash.scale.set(5, 5, 1);
    flash.position.set(0, 0, 6.1);
    turret.add(flash);
    const muzzle = pivot(0, 0, 6.0);
    turret.add(muzzle);

    root.userData = { hull, turret, muzzle, flash, lamps };
    return root;
  }

  /* ============================================================
     БТР
     ============================================================ */
  function makeBTR() {
    const root = new T.Group();
    const parts = [
      { geo: gBox(2.7, 1.0, 6.6, 0, 1.35), color: C.hull },
      { geo: gBox(2.7, 0.9, 1.6, 0, 1.12, 3.3, { x: -0.42 }), color: C.hull },
      { geo: gBox(2.4, 0.5, 4.4, 0, 1.95, -0.4), color: C.hull },
      { geo: gBox(2.5, 0.12, 6.4, 0, 0.85), color: C.hullDark },
      { geo: gBox(2.2, 0.1, 0.9, 0, 1.9, 3.1), color: C.hullDark }
    ];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) parts.push({ geo: gBox(0.06, 0.18, 0.3, s * 1.37, 1.5, -1.2 + i * 1.1), color: C.hullDark });
      for (let i = 0; i < 4; i++) {
        parts.push({ geo: gCyl(0.62, 0.62, 0.42, 12, s * 1.42, 0.64, -2.4 + i * 1.6, { z: Math.PI / 2 }), color: C.track });
        parts.push({ geo: gCyl(0.3, 0.3, 0.46, 8, s * 1.42, 0.64, -2.4 + i * 1.6, { z: Math.PI / 2 }), color: C.hullDark });
      }
    }
    const hull = boneMesh(parts, M.armor);
    root.add(hull);

    const turret = new T.Group();
    turret.position.set(0, 2.35, -0.2);
    root.add(turret);
    turret.add(boneMesh([
      { geo: gCone(0.85, 0.75, 10, 0, 0.15, 0, { x: Math.PI }), color: C.hull },
      { geo: gBox(1.2, 0.5, 1.3, 0, -0.05, 0), color: C.hull },
      { geo: gCyl(0.075, 0.085, 2.3, 8, 0, 0.05, 1.3, { x: Math.PI / 2 }), color: C.hullDark },
      { geo: gCyl(0.04, 0.04, 1.3, 6, 0.28, -0.06, 0.9, { x: Math.PI / 2 }), color: C.hullDark }
    ], M.armor));

    const lamps = new T.Mesh(mergeColored([
      { geo: gBox(0.2, 0.16, 0.1, -1.0, 1.78, 3.62), color: 0xffffff },
      { geo: gBox(0.2, 0.16, 0.1, 1.0, 1.78, 3.62), color: 0xffffff }
    ]), M.lamp);
    root.add(lamps);

    const flash = new T.Sprite(new T.SpriteMaterial({
      map: TEX.get('flash'), color: 0xffe0b0, transparent: true,
      blending: T.AdditiveBlending, depthWrite: false, opacity: 0
    }));
    flash.scale.set(2.4, 2.4, 1);
    flash.position.set(0, 0.05, 2.5);
    turret.add(flash);
    const muzzle = pivot(0, 0.05, 2.45);
    turret.add(muzzle);

    root.userData = { hull, turret, muzzle, flash, lamps, wheels: null };
    return root;
  }

  /* ============================================================
     ВЕРТОЛЁТ
     ============================================================ */
  function makeHeli() {
    const root = new T.Group();
    const body = new T.Group();
    root.add(body);

    const parts = [
      { geo: gSph(1.1, 12, 0, 0, 0.6, { x: 1.0, y: 1.05, z: 2.3 }), color: C.hull },
      { geo: gBox(1.5, 1.1, 2.6, 0, 0.05, -1.4), color: C.hull },
      { geo: gCyl(0.28, 0.16, 5.2, 8, 0, 0.45, -4.2, { x: Math.PI / 2 }), color: C.hull },
      { geo: gBox(0.14, 1.5, 0.9, 0, 1.1, -6.4), color: C.hull },
      { geo: gBox(2.0, 0.1, 0.7, 0, 0.9, -5.9), color: C.hull },
      { geo: gCyl(0.2, 0.24, 0.5, 8, 0, 1.3, 0.2), color: C.hullDark }
    ];
    for (const s of [-1, 1]) {
      parts.push({ geo: gBox(0.16, 0.5, 0.5, s * 1.0, -0.35, 0.4), color: C.hullDark });
      parts.push({ geo: gCyl(0.3, 0.3, 1.4, 10, s * 1.5, -0.5, 0.5, { x: Math.PI / 2 }), color: C.hullDark });
      parts.push({ geo: gBox(0.1, 0.7, 0.1, s * 0.8, -1.1, 0.9), color: C.hullDark });
      parts.push({ geo: gBox(0.14, 0.14, 2.6, s * 0.8, -1.45, 0.6), color: C.hullDark });
    }
    body.add(boneMesh(parts, M.armor));

    const cockpit = new T.Mesh(new T.SphereGeometry(0.85, 12, 8), M.glass);
    cockpit.scale.set(0.95, 0.85, 1.3);
    cockpit.position.set(0, 0.25, 2.3);
    body.add(cockpit);

    const blades = new T.Group();
    blades.position.set(0, 1.5, 0.2);
    body.add(blades);
    const bladeParts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * U.TAU;
      bladeParts.push({
        geo: gBox(0.34, 0.05, 8.2, Math.sin(a) * 4.0, 0, Math.cos(a) * 4.0, { y: a }),
        color: 0x2a2d2f
      });
    }
    blades.add(new T.Mesh(mergeColored(bladeParts), M.armor));
    const disc = new T.Mesh(
      new T.CircleGeometry(8.4, 24),
      new T.MeshBasicMaterial({ color: 0xa8b6bd, transparent: true, opacity: 0.07, side: T.DoubleSide, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    blades.add(disc);

    const tailBlades = new T.Group();
    tailBlades.position.set(0.25, 1.1, -6.4);
    body.add(tailBlades);
    const tbParts = [];
    for (let i = 0; i < 3; i++) {
      tbParts.push({ geo: gBox(0.06, 1.7, 0.16, 0, 0, 0, { x: (i / 3) * U.TAU }), color: 0x2a2d2f });
    }
    tailBlades.add(new T.Mesh(mergeColored(tbParts), M.armor));

    const beacon = new T.Mesh(new T.BoxGeometry(0.14, 0.14, 0.14), M.lampRed);
    beacon.position.set(0, 1.05, -1.4);
    body.add(beacon);

    const muzzleL = pivot(-1.5, -0.5, 1.3);
    const muzzleR = pivot(1.5, -0.5, 1.3);
    body.add(muzzleL, muzzleR);

    root.userData = { body, blades, tailBlades, beacon, muzzleL, muzzleR };
    return root;
  }

  /* ============================================================
     СИРЕНОГОЛОВЫЙ (~13 м) — 9 мешей
     ============================================================ */
  function makeSirenHead() {
    const root = new T.Group();

    const hips = pivot(0, 6.6, 0);
    root.add(hips);
    const torso = pivot(0, 0, 0);
    hips.add(torso);

    const torsoParts = [
      { geo: gCyl(0.42, 0.55, 4.4, 8, 0, 2.2, 0), color: C.rust },
      { geo: gBox(1.1, 0.6, 0.7, 0, 0.05, 0), color: C.rustDark }
    ];
    for (let i = 0; i < 6; i++) {
      const r = 0.58 + Math.sin(i * 0.8) * 0.1;
      const g = gTorus(r, 0.06, 10, 0, 0.7 + i * 0.62, 0, { x: Math.PI / 2 });
      g.scale(1, 1, 0.55);
      torsoParts.push({ geo: g, color: C.rustDark });
    }
    // свисающие провода
    for (let i = 0; i < 7; i++) {
      torsoParts.push({
        geo: gCyl(0.028, 0.028, U.rand(1.2, 3.0), 4,
          U.rand(-0.4, 0.4), U.rand(1.2, 3.4), U.rand(-0.35, 0.35), { z: U.rand(-0.2, 0.2) }),
        color: 0x24262a
      });
    }
    torso.add(boneMesh(torsoParts, M.rust));

    const shoulders = pivot(0, 4.4, 0);
    torso.add(shoulders);
    shoulders.add(boneMesh([
      { geo: gCyl(0.28, 0.28, 3.9, 8, 0, 0, 0, { z: Math.PI / 2 }), color: C.rust },
      { geo: gBox(0.9, 0.5, 0.6, 0, 0.1, 0), color: C.rustDark }
    ], M.rust));

    const neck = pivot(0, 0.5, 0);
    shoulders.add(neck);
    neck.add(boneMesh([{ geo: gCyl(0.17, 0.2, 1.5, 8, 0, 0.75, 0), color: C.rust }], M.rust));

    const head = pivot(0, 1.5, 0);
    neck.add(head);
    head.add(boneMesh([
      { geo: gCyl(0.14, 0.14, 2.5, 8, 0, 0, 0, { z: Math.PI / 2 }), color: C.rust },
      { geo: gBox(0.42, 0.42, 0.42, 0, 0, 0), color: C.rustDark }
    ], M.rust));

    const horns = [], glows = [];
    for (const s of [-1, 1]) {
      const horn = new T.Group();
      horn.position.set(s * 1.15, 0.35, 0);
      horn.rotation.z = s * -0.45;
      horn.rotation.x = -0.12;
      head.add(horn);
      horn.add(boneMesh([
        { geo: gCone(1.05, 2.0, 12, 0, 0.9, 0, { x: Math.PI }, true), color: C.rust },
        { geo: gCyl(0.2, 0.3, 0.7, 8, 0, 0.1, 0), color: C.rustDark },
        { geo: gTorus(0.62, 0.07, 10, 0, 1.1, 0, { x: Math.PI / 2 }), color: C.rustDark }
      ], M.rust));
      const grille = new T.Mesh(new T.CircleGeometry(0.95, 14), M.grille);
      grille.position.y = 1.86;
      grille.rotation.x = -Math.PI / 2;
      horn.add(grille);
      const glow = new T.Mesh(new T.CircleGeometry(0.92, 14), new T.MeshBasicMaterial({
        color: 0xff3a24, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false
      }));
      glow.position.y = 1.9;
      glow.rotation.x = -Math.PI / 2;
      horn.add(glow);
      horns.push(horn); glows.push(glow);
    }

    function arm(side) {
      const sh = pivot(side * 1.9, 0, 0);
      shoulders.add(sh);
      sh.add(boneMesh([
        { geo: gSph(0.36, 8), color: C.rustDark },
        { geo: gCyl(0.24, 0.2, 4.2, 8, 0, -2.1, 0), color: C.rust }
      ], M.rust));
      const el = pivot(0, -4.2, 0);
      sh.add(el);
      const foreParts = [
        { geo: gSph(0.28, 8), color: C.rustDark },
        { geo: gCyl(0.2, 0.16, 4.0, 8, 0, -2.0, 0), color: C.rust },
        { geo: gBox(0.5, 0.35, 0.35, 0, -4.15, 0), color: C.rustDark }
      ];
      for (let i = 0; i < 4; i++) {
        foreParts.push({
          geo: gCyl(0.06, 0.03, 1.1, 4, (i - 1.5) * 0.14, -4.85, 0, { z: (i - 1.5) * 0.12 }),
          color: C.rustDark
        });
      }
      el.add(boneMesh(foreParts, M.rust));
      return { sh, el };
    }
    const armL = arm(-1), armR = arm(1);

    function leg(side) {
      const hip = pivot(side * 0.6, 0, 0);
      hips.add(hip);
      hip.add(boneMesh([
        { geo: gSph(0.4, 8), color: C.rustDark },
        { geo: gCyl(0.3, 0.24, 3.5, 8, 0, -1.75, 0), color: C.rust }
      ], M.rust));
      const knee = pivot(0, -3.5, 0);
      hip.add(knee);
      knee.add(boneMesh([
        { geo: gSph(0.3, 8), color: C.rustDark },
        { geo: gCyl(0.22, 0.16, 3.3, 8, 0, -1.65, 0), color: C.rust },
        { geo: gBox(0.5, 0.28, 1.5, 0, -3.45, 0.35), color: C.rustDark },
        { geo: gCyl(0.1, 0.04, 0.6, 5, 0, -3.5, 1.1, { x: Math.PI / 2 }), color: C.rustDark }
      ], M.rust));
      return { hip, knee, ankle: knee };
    }
    const legL = leg(-1), legR = leg(1);

    root.userData = {
      hips, torso, shoulders, neck, head, horns, glows,
      armL, armR, legL, legR, height: 13.2
    };
    return root;
  }

  /* ============================================================
     ОРУЖИЕ ОТ ПЕРВОГО ЛИЦА — 2 меша
     ============================================================ */
  function makeViewmodel() {
    const g = new T.Group();

    const gunParts = [
      { geo: gBox(0.09, 0.12, 0.62, 0, 0, -0.05), color: C.gunA },
      { geo: gBox(0.085, 0.1, 0.3, 0, 0.015, -0.42), color: C.gunB },
      { geo: gCyl(0.022, 0.022, 0.52, 8, 0, 0.02, -0.62, { x: Math.PI / 2 }), color: C.gunB },
      { geo: gCyl(0.035, 0.035, 0.12, 8, 0, 0.02, -0.92, { x: Math.PI / 2 }), color: C.gunB },
      { geo: gBox(0.08, 0.09, 0.34, 0, -0.01, -0.42), color: C.gunA },
      { geo: gBox(0.05, 0.02, 0.5, 0, 0.075, -0.3), color: C.gunB },
      { geo: gBox(0.07, 0.24, 0.12, 0, -0.17, -0.02, { x: 0.18 }), color: C.gunA },
      { geo: gBox(0.07, 0.2, 0.1, 0, -0.14, 0.12, { x: -0.3 }), color: C.gunA },
      { geo: gBox(0.08, 0.14, 0.3, 0, -0.02, 0.32), color: C.gunA },
      { geo: gBox(0.07, 0.09, 0.1, 0, -0.06, 0.48), color: C.gunA },
      { geo: gBox(0.07, 0.06, 0.12, 0, 0.11, -0.12), color: C.gunB }
    ];
    const gun = new T.Mesh(mergeColored(gunParts), M.gun);
    g.add(gun);

    // руки
    const handParts = [
      { geo: gBox(0.1, 0.12, 0.14, 0.02, -0.11, 0.14, { x: -0.3 }), color: C.boot },
      { geo: gBox(0.12, 0.12, 0.34, 0.05, -0.16, 0.36, { x: -0.25 }), color: C.camo },
      { geo: gBox(0.1, 0.11, 0.16, -0.01, -0.09, -0.4), color: C.boot },
      { geo: gBox(0.12, 0.12, 0.3, -0.09, -0.16, -0.28, { y: 0.35, x: -0.1 }), color: C.camo }
    ];
    const hands = new T.Mesh(mergeColored(handParts), M.soldier);
    g.add(hands);

    // коллиматор: линза и точка
    const lens = new T.Mesh(new T.CircleGeometry(0.028, 12),
      new T.MeshBasicMaterial({ color: 0x2a4a4a, transparent: true, opacity: 0.5 }));
    lens.position.set(0, 0.13, -0.18);
    g.add(lens);
    const dot = new T.Mesh(new T.CircleGeometry(0.005, 8), new T.MeshBasicMaterial({ color: 0xff3020 }));
    dot.position.set(0, 0.13, -0.176);
    g.add(dot);

    const flash = new T.Sprite(new T.SpriteMaterial({
      map: TEX.get('flash'), color: 0xffd9a0, transparent: true,
      blending: T.AdditiveBlending, depthWrite: false, opacity: 0
    }));
    flash.scale.set(0.42, 0.42, 1);
    flash.position.set(0, 0.02, -1.02);
    g.add(flash);

    const muzzle = pivot(0, 0.02, -1.0);
    g.add(muzzle);

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    g.userData = { flash, muzzle, gun, hands, dot };
    return g;
  }

  function makeCasing() {
    return new T.Mesh(
      new T.CylinderGeometry(0.012, 0.014, 0.05, 5),
      new T.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.9 })
    );
  }

  function makeDebris(mat) {
    const m = new T.Mesh(
      new T.BoxGeometry(1, 1, 1),
      mat || new T.MeshStandardMaterial({ color: 0x33383a, roughness: 0.85, metalness: 0.3 })
    );
    m.castShadow = true;
    return m;
  }

  return {
    initMaterials, M, C,
    makeSoldier, makeHusk, makeTank, makeBTR, makeHeli, makeSirenHead,
    makeViewmodel, makeCasing, makeDebris,
    mergeColored, gBox, gCyl, gSph, gCone, gTorus, pivot, boneMesh
  };
})();
