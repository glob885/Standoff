/* ============================================================
   src/world.js — ландшафт, лес, трава, камни, туманные карты.
   Рельеф — реальный heightmap: юниты и техника ходят по нему.
   ============================================================ */
'use strict';

const WorldGen = (() => {
  const T = THREE;

  /* --------------------------------------------------------
     ВЫСОТНОЕ ПОЛЕ
     -------------------------------------------------------- */
  class HeightField {
    constructor(size, seed, amplitude = 6) {
      this.size = size;                 // половина стороны (мир: [-size, size])
      this.noise = U.makeNoise(seed);
      this.amp = amplitude;
      this.flatRadius = 0;              // радиус выровненной площадки в центре
    }
    height(x, z) {
      const n = this.noise;
      let h = 0;
      h += n.fbm(x * 0.0045, z * 0.0045, 4) * this.amp;
      h += n.fbm(x * 0.02, z * 0.02, 3) * this.amp * 0.28;
      h += n.ridged(x * 0.008, z * 0.008, 3) * this.amp * 0.35;
      // мягкая «чаша» к краям, чтобы карта не выглядела обрезанной
      const d = Math.hypot(x, z) / this.size;
      h -= U.smoothstep(U.clamp01((d - 0.75) / 0.25)) * this.amp * 2.2;
      if (this.flatRadius > 0) {
        const k = U.smoothstep(U.clamp01((Math.hypot(x, z) - this.flatRadius) / (this.flatRadius * 0.6)));
        h *= k;
      }
      return h;
    }
    normal(x, z, eps = 1.2) {
      const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
      const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
      const v = new T.Vector3(hL - hR, 2 * eps, hD - hU);
      return v.normalize();
    }
    slope(x, z) {
      const n = this.normal(x, z);
      return 1 - n.y;                  // 0 = плоско
    }
  }

  /* --------------------------------------------------------
     ШЕЙДЕР ТРАВЫ (инстансы с ветром)
     -------------------------------------------------------- */
  const GRASS_VERT = `
    uniform float uTime;
    uniform float uWind;
    varying vec2 vUv;
    varying float vShade;
    void main() {
      vUv = uv;
      #ifdef USE_INSTANCING
        vec4 mvPosition = vec4(position, 1.0);
        // изгиб от ветра: только верхушка
        float sway = sin(uTime * 1.7 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.21);
        float bend = sway * uWind * uv.y * uv.y;
        mvPosition.x += bend * 0.35;
        mvPosition.z += bend * 0.22;
        mvPosition = instanceMatrix * mvPosition;
        vShade = 0.55 + 0.45 * uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * mvPosition;
      #else
        vShade = 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #endif
    }
  `;
  const GRASS_FRAG = `
    precision highp float;
    uniform sampler2D uMap;
    uniform vec3 uTint;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec2 vUv;
    varying float vShade;
    void main() {
      vec4 c = texture2D(uMap, vUv);
      if (c.a < 0.35) discard;
      vec3 col = c.rgb * uTint * vShade;
      float depth = gl_FragCoord.z / gl_FragCoord.w;
      float f = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
      col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  /* --------------------------------------------------------
     ГЕНЕРАТОР ДЕРЕВЬЕВ (несколько пород, меши для инстансинга)
     -------------------------------------------------------- */
  function buildConiferGeo(rng) {
    // ствол + 5 ярусов хвои, слитые в одну геометрию
    const parts = [];
    const h = rng.range(9, 15);
    const trunk = new T.CylinderGeometry(0.16, 0.34, h, 6, 1);
    trunk.translate(0, h / 2, 0);
    parts.push({ geo: trunk, group: 0 });
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const r = U.lerp(2.6, 0.7, t) * rng.range(0.85, 1.15);
      const ch = U.lerp(4.4, 2.2, t);
      const cone = new T.ConeGeometry(r, ch, 7, 1);
      cone.translate(0, h * 0.32 + t * h * 0.55 + ch * 0.3, 0);
      parts.push({ geo: cone, group: 1 });
    }
    return mergeWithGroups(parts);
  }

  function buildBirchGeo(rng) {
    const parts = [];
    const h = rng.range(10, 16);
    const trunk = new T.CylinderGeometry(0.13, 0.24, h, 6, 1);
    trunk.translate(0, h / 2, 0);
    parts.push({ geo: trunk, group: 0 });
    // крона из нескольких сфер
    for (let i = 0; i < 4; i++) {
      const r = rng.range(1.6, 2.8);
      const s = new T.IcosahedronGeometry(r, 0);
      s.translate(rng.range(-1.4, 1.4), h * rng.range(0.72, 1.0), rng.range(-1.4, 1.4));
      parts.push({ geo: s, group: 1 });
    }
    return mergeWithGroups(parts);
  }

  function buildDeadTreeGeo(rng) {
    const parts = [];
    const h = rng.range(7, 12);
    const trunk = new T.CylinderGeometry(0.12, 0.3, h, 5, 1);
    trunk.translate(0, h / 2, 0);
    parts.push({ geo: trunk, group: 0 });
    for (let i = 0; i < 5; i++) {
      const len = rng.range(1.5, 3.6);
      const br = new T.CylinderGeometry(0.05, 0.1, len, 4, 1);
      br.translate(0, len / 2, 0);
      const m = new T.Matrix4();
      const e = new T.Euler(rng.range(0.6, 1.2), rng.range(0, U.TAU), 0);
      m.makeRotationFromEuler(e);
      m.setPosition(0, h * rng.range(0.45, 0.9), 0);
      br.applyMatrix4(m);
      parts.push({ geo: br, group: 0 });
    }
    return mergeWithGroups(parts);
  }

  /* слияние геометрий с сохранением групп материалов (без BufferGeometryUtils) */
  function mergeWithGroups(parts) {
    let posCount = 0, idxCount = 0;
    for (const p of parts) {
      posCount += p.geo.attributes.position.count;
      idxCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    }
    const pos = new Float32Array(posCount * 3);
    const nor = new Float32Array(posCount * 3);
    const uv = new Float32Array(posCount * 2);
    const idx = new Uint32Array(idxCount);
    let po = 0, io = 0, vertBase = 0;
    const groups = [];
    for (const p of parts) {
      const g = p.geo;
      if (!g.attributes.normal) g.computeVertexNormals();
      const gp = g.attributes.position.array;
      const gn = g.attributes.normal.array;
      const gu = g.attributes.uv ? g.attributes.uv.array : null;
      const count = g.attributes.position.count;
      pos.set(gp, po * 3);
      nor.set(gn, po * 3);
      if (gu) uv.set(gu, po * 2);
      const gi = g.index ? g.index.array : null;
      const start = io;
      if (gi) {
        for (let i = 0; i < gi.length; i++) idx[io++] = gi[i] + vertBase;
      } else {
        for (let i = 0; i < count; i++) idx[io++] = i + vertBase;
      }
      groups.push({ start, count: io - start, group: p.group });
      po += count; vertBase += count;
      g.dispose();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    // объединяем группы по материалу
    for (const g of groups) geo.addGroup(g.start, g.count, g.group);
    geo.computeBoundingSphere();
    return geo;
  }

  /* --------------------------------------------------------
     МИР
     -------------------------------------------------------- */
  class Terrain {
    constructor(scene, opts) {
      this.scene = scene;
      this.opts = Object.assign({
        size: 220, seed: 1234, segments: 128, amplitude: 6,
        treeCount: 900, grassCount: 12000, rockCount: 90, bushCount: 260,
        clearingRadius: 0, quality: 'high', avoid: null
      }, opts);
      this.objects = [];
      this.field = new HeightField(this.opts.size, this.opts.seed, this.opts.amplitude);
      this.field.flatRadius = this.opts.clearingRadius;
      this.rng = U.makeRNG(this.opts.seed);
      this.build();
    }

    height(x, z) { return this.field.height(x, z); }
    normal(x, z) { return this.field.normal(x, z); }

    build() {
      this.buildGround();
      this.buildTrees();
      this.buildRocks();
      this.buildBushes();
      if (this.opts.quality !== 'low') this.buildGrass();
      this.buildFogCards();
    }

    /* ---- рельеф ---- */
    buildGround() {
      const { size, segments } = this.opts;
      const geo = new T.PlaneGeometry(size * 2, size * 2, segments, segments);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cGrass = new T.Color(0xe8f0dc);
      const cDirt = new T.Color(0xd8c8a8);
      const cRock = new T.Color(0xc8ccd0);
      const tmp = new T.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = this.field.height(x, z);
        pos.setY(i, h);
        const slope = this.field.slope(x, z);
        const dirtMix = U.clamp01(slope * 3.2 + this.field.noise.fbm(x * 0.03, z * 0.03, 2) * 0.35);
        tmp.copy(cGrass).lerp(cDirt, U.clamp01(dirtMix));
        if (slope > 0.35) tmp.lerp(cRock, U.clamp01((slope - 0.35) * 2.4));
        // затемнение впадин
        const ao = U.clamp01(0.92 + h * 0.012);
        colors[i * 3] = tmp.r * ao;
        colors[i * 3 + 1] = tmp.g * ao;
        colors[i * 3 + 2] = tmp.b * ao;
      }
      geo.setAttribute('color', new T.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const mat = new T.MeshStandardMaterial({
        map: TEX.get('ground'),
        normalMap: TEX.get('groundN'),
        normalScale: new T.Vector2(0.7, 0.7),
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.0,
        dithering: true
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.name = 'terrain';
      this.scene.add(mesh);
      this.objects.push(mesh);
      this.ground = mesh;
    }

    /* ---- деревья (инстансинг по породам) ---- */
    buildTrees() {
      const { treeCount, size, clearingRadius } = this.opts;
      const rng = this.rng;
      const species = [
        { geo: buildConiferGeo(rng), weight: 0.55 },
        { geo: buildConiferGeo(rng), weight: 0.2 },
        { geo: buildBirchGeo(rng), weight: 0.17 },
        { geo: buildDeadTreeGeo(rng), weight: 0.08 }
      ];
      const barkMat = new T.MeshStandardMaterial({
        map: TEX.get('bark'), roughness: 0.94, metalness: 0
      });
      const leafMat = new T.MeshStandardMaterial({
        map: TEX.get('needle'), roughness: 0.85, metalness: 0,
        color: 0xdff0cc
      });
      const mats = [barkMat, leafMat];

      const counts = species.map(s => Math.floor(treeCount * s.weight));
      this.trees = [];
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3();
      const e = new T.Euler();
      for (let si = 0; si < species.length; si++) {
        const inst = new T.InstancedMesh(species[si].geo, mats, counts[si]);
        inst.castShadow = true;
        inst.receiveShadow = false;
        inst.frustumCulled = true;
        let placed = 0;
        let guard = 0;
        while (placed < counts[si] && guard < counts[si] * 30) {
          guard++;
          const a = rng.range(0, U.TAU);
          const r = Math.sqrt(rng()) * size * 0.96;
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (clearingRadius > 0 && Math.hypot(x, z) < clearingRadius) continue;
          if (this.opts.avoid && this.opts.avoid(x, z)) continue;
          if (this.field.slope(x, z) > 0.45) continue;
          const y = this.field.height(x, z);
          const sc = rng.range(0.7, 1.35);
          e.set(rng.range(-0.05, 0.05), rng.range(0, U.TAU), rng.range(-0.05, 0.05));
          q.setFromEuler(e);
          p.set(x, y - 0.2, z);
          s.set(sc, sc * rng.range(0.9, 1.2), sc);
          m.compose(p, q, s);
          inst.setMatrixAt(placed, m);
          this.trees.push({ x, z, r: 0.6 * sc });
          placed++;
        }
        inst.count = placed;
        inst.instanceMatrix.needsUpdate = true;
        this.scene.add(inst);
        this.objects.push(inst);
      }
    }

    /* ---- камни ---- */
    buildRocks() {
      const rng = this.rng;
      const geo = new T.IcosahedronGeometry(1, 0);
      // «помять» вершины
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i,
          pos.getX(i) * rng.range(0.7, 1.3),
          pos.getY(i) * rng.range(0.6, 1.2),
          pos.getZ(i) * rng.range(0.7, 1.3));
      }
      geo.computeVertexNormals();
      const mat = new T.MeshStandardMaterial({ color: 0x9fa4a8, roughness: 0.92, metalness: 0.02 });
      const inst = new T.InstancedMesh(geo, mat, this.opts.rockCount);
      inst.castShadow = true; inst.receiveShadow = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      for (let i = 0; i < this.opts.rockCount; i++) {
        const a = rng.range(0, U.TAU), r = Math.sqrt(rng()) * this.opts.size * 0.9;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const sc = rng.range(0.5, 2.6);
        e.set(rng.range(0, 1), rng.range(0, U.TAU), rng.range(0, 1));
        q.setFromEuler(e);
        p.set(x, this.field.height(x, z) + sc * 0.25, z);
        s.set(sc, sc * rng.range(0.5, 0.9), sc);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
      this.objects.push(inst);
    }

    /* ---- кусты ---- */
    buildBushes() {
      const rng = this.rng;
      const geo = new T.IcosahedronGeometry(1, 0);
      const mat = new T.MeshStandardMaterial({
        map: TEX.get('needle'), color: 0xc8e0b0, roughness: 0.9, metalness: 0
      });
      const inst = new T.InstancedMesh(geo, mat, this.opts.bushCount);
      inst.castShadow = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      for (let i = 0; i < this.opts.bushCount; i++) {
        const a = rng.range(0, U.TAU), r = Math.sqrt(rng()) * this.opts.size * 0.95;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (this.opts.avoid && this.opts.avoid(x, z)) { continue; }
        const sc = rng.range(0.6, 1.8);
        e.set(rng.range(0, 0.4), rng.range(0, U.TAU), rng.range(0, 0.4));
        q.setFromEuler(e);
        p.set(x, this.field.height(x, z) + sc * 0.4, z);
        s.set(sc, sc * 0.7, sc);
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
      this.objects.push(inst);
    }

    /* ---- трава ---- */
    buildGrass() {
      const count = this.opts.grassCount;
      const geo = new T.PlaneGeometry(0.9, 0.9, 1, 1);
      geo.translate(0, 0.45, 0);
      this.grassMat = new T.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: 0.35 },
          uMap: { value: TEX.get('grass') },
          uTint: { value: new T.Color(0xf0f7e2) },
          uFogColor: { value: new T.Color(0x121c24) },
          uFogDensity: { value: 0.012 }
        },
        vertexShader: GRASS_VERT,
        fragmentShader: GRASS_FRAG,
        side: T.DoubleSide,
        transparent: false
      });
      const inst = new T.InstancedMesh(geo, this.grassMat, count);
      const rng = this.rng;
      const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, U.TAU);
        const r = Math.sqrt(rng()) * this.opts.size * 0.95;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (this.field.slope(x, z) > 0.4) continue;
        const sc = rng.range(0.7, 1.9);
        e.set(0, rng.range(0, U.TAU), 0);
        q.setFromEuler(e);
        p.set(x, this.field.height(x, z), z);
        s.set(sc, sc * rng.range(0.8, 1.5), sc);
        m.compose(p, q, s);
        inst.setMatrixAt(placed++, m);
      }
      inst.count = placed;
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
      this.objects.push(inst);
      this.grass = inst;
    }

    /* ---- слоистый туман (билборды) ---- */
    buildFogCards() {
      const rng = this.rng;
      const count = this.opts.quality === 'low' ? 26 : 60;
      const mat = new T.MeshBasicMaterial({
        map: TEX.get('fog'),
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: T.NormalBlending,
        color: 0xa8bccb
      });
      this.fogCards = [];
      const geo = new T.PlaneGeometry(1, 1);
      for (let i = 0; i < count; i++) {
        const m = new T.Mesh(geo, mat);
        const a = rng.range(0, U.TAU), r = Math.sqrt(rng()) * this.opts.size * 0.8;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const sc = rng.range(14, 42);
        m.position.set(x, this.field.height(x, z) + rng.range(0.6, 3.4), z);
        m.scale.set(sc, sc * rng.range(0.25, 0.5), 1);
        m.renderOrder = 5;
        this.scene.add(m);
        this.objects.push(m);
        this.fogCards.push({ mesh: m, drift: rng.range(0.1, 0.5), phase: rng.range(0, U.TAU) });
      }
    }

    setFog(color, density) {
      if (this.grassMat) {
        this.grassMat.uniforms.uFogColor.value.copy(color);
        this.grassMat.uniforms.uFogDensity.value = density;
      }
    }

    update(dt, camera, time) {
      if (this.grassMat) {
        this.grassMat.uniforms.uTime.value = time;
        this.grassMat.uniforms.uWind.value = 0.28 + Math.sin(time * 0.35) * 0.14;
      }
      if (this.fogCards && camera) {
        for (const f of this.fogCards) {
          f.mesh.lookAt(camera.position.x, f.mesh.position.y, camera.position.z);
          f.mesh.position.x += Math.sin(time * 0.1 + f.phase) * f.drift * dt;
        }
      }
    }

    dispose() {
      for (const o of this.objects) {
        this.scene.remove(o);
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      }
      this.objects.length = 0;
      this.trees = [];
    }
  }

  return { Terrain, HeightField };
})();
