/* ============================================================
   src/sky.js — небо: градиентный купол, звёзды, луна/солнце,
   слоистые облака, туман по высоте. Всё на шейдерах.
   ============================================================ */
'use strict';

const SkyRig = (() => {
  const T = THREE;

  const SKY_VERT = `
    varying vec3 vWorld;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const SKY_FRAG = `
    precision highp float;
    varying vec3 vWorld;
    varying vec2 vUv;

    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uGround;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uSunSize;
    uniform float uSunIntensity;
    uniform float uStarAmount;
    uniform float uTime;
    uniform float uCloud;
    uniform vec3 uCloudColor;

    // хеш-шум
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i+vec2(0,0)), hash(i+vec2(1,0)), u.x),
                 mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main() {
      vec3 dir = normalize(vWorld);
      float h = dir.y;

      // базовый градиент
      float t = clamp(h * 1.15 + 0.08, 0.0, 1.0);
      vec3 col = mix(uHorizon, uZenith, pow(t, 0.65));
      // «земляная» полусфера
      col = mix(uGround, col, smoothstep(-0.12, 0.05, h));

      // звёзды (только вверху и когда небо тёмное)
      if (uStarAmount > 0.001 && h > 0.02) {
        vec2 sp = dir.xz / max(0.15, dir.y) * 2.2;
        float star = pow(hash(floor(sp * 180.0)), 42.0);
        float twinkle = 0.65 + 0.35 * sin(uTime * 2.4 + hash(floor(sp * 180.0)) * 40.0);
        col += vec3(star * twinkle) * uStarAmount * smoothstep(0.02, 0.35, h);
      }

      // светило (солнце/луна)
      float sd = max(dot(dir, normalize(uSunDir)), 0.0);
      float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, sd);
      float glow = pow(sd, 26.0) * 0.55 + pow(sd, 6.0) * 0.16;
      col += uSunColor * (disc * 2.2 + glow) * uSunIntensity;

      // облачный слой
      if (uCloud > 0.001 && h > 0.0) {
        vec2 cuv = dir.xz / max(0.08, dir.y) * 0.35 + vec2(uTime * 0.004, uTime * 0.002);
        float c = fbm(cuv * 1.6);
        c = smoothstep(0.45, 0.85, c);
        float fade = smoothstep(0.0, 0.35, h);
        col = mix(col, uCloudColor, c * uCloud * fade);
      }

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  class Sky {
    constructor(scene) {
      this.scene = scene;
      this.uniforms = {
        uZenith: { value: new T.Color(0x0a1626) },
        uHorizon: { value: new T.Color(0x1b2b38) },
        uGround: { value: new T.Color(0x0a0f12) },
        uSunDir: { value: new T.Vector3(-0.4, 0.55, 0.6) },
        uSunColor: { value: new T.Color(0xbcd4ee) },
        uSunSize: { value: 0.006 },
        uSunIntensity: { value: 1.0 },
        uStarAmount: { value: 0.85 },
        uTime: { value: 0 },
        uCloud: { value: 0.35 },
        uCloudColor: { value: new T.Color(0x243444) }
      };
      const geo = new T.SphereGeometry(1, 32, 20);
      const mat = new T.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: T.BackSide,
        depthWrite: false,
        fog: false
      });
      this.mesh = new T.Mesh(geo, mat);
      this.mesh.scale.setScalar(1200);
      this.mesh.renderOrder = -1000;
      this.mesh.frustumCulled = false;
      scene.add(this.mesh);

      /* пресеты времени суток */
      this.presets = {
        night: {
          zenith: 0x14243c, horizon: 0x33495c, ground: 0x080c0f,
          sunDir: [-0.35, 0.5, 0.65], sunColor: 0xcfe0f5, sunSize: 0.010,
          sunIntensity: 0.85, stars: 0.9, cloud: 0.30, cloudColor: 0x1c2a36,
          fogColor: 0x2b3d4d, fogDensity: 0.0065,
          hemiSky: 0x7396b8, hemiGround: 0x38452f, hemiInt: 2.6,
          dirColor: 0xdcebff, dirInt: 3.8, exposure: 1.55
        },
        stormNight: {
          zenith: 0x11202e, horizon: 0x2a3c4d, ground: 0x06090c,
          sunDir: [-0.3, 0.42, 0.7], sunColor: 0xb8cbe0, sunSize: 0.008,
          sunIntensity: 0.5, stars: 0.35, cloud: 0.72, cloudColor: 0x18222c,
          fogColor: 0x28394a, fogDensity: 0.011,
          hemiSky: 0x67839f, hemiGround: 0x333f2c, hemiInt: 2.2,
          dirColor: 0xd0e2f5, dirInt: 3.1, exposure: 1.48
        },
        dawn: {
          zenith: 0x1e3350, horizon: 0xd98a4a, ground: 0x241a14,
          sunDir: [0.55, 0.12, -0.72], sunColor: 0xffd9a0, sunSize: 0.020,
          sunIntensity: 1.6, stars: 0.06, cloud: 0.42, cloudColor: 0xc08a66,
          fogColor: 0x9a7458, fogDensity: 0.010,
          hemiSky: 0x9ab4d6, hemiGround: 0x4a3a26, hemiInt: 1.6,
          dirColor: 0xffcf9a, dirInt: 3.4, exposure: 1.18
        },
        day: {
          zenith: 0x4a86c8, horizon: 0xbcd4e6, ground: 0x3a422f,
          sunDir: [0.35, 0.7, -0.55], sunColor: 0xfff6e2, sunSize: 0.016,
          sunIntensity: 2.0, stars: 0.0, cloud: 0.42, cloudColor: 0xeef4f8,
          fogColor: 0xa8bfd0, fogDensity: 0.0035,
          hemiSky: 0xbcd8f2, hemiGround: 0x59613f, hemiInt: 2.4,
          dirColor: 0xfff2dc, dirInt: 3.6, exposure: 1.12
        },
        overcast: {
          zenith: 0x6d8296, horizon: 0xa9b8c2, ground: 0x424a38,
          sunDir: [0.3, 0.62, -0.6], sunColor: 0xdfe8ee, sunSize: 0.03,
          sunIntensity: 0.9, stars: 0.0, cloud: 0.85, cloudColor: 0xc2cdd6,
          fogColor: 0x9aacb8, fogDensity: 0.0075,
          hemiSky: 0xc3d3de, hemiGround: 0x5a6244, hemiInt: 2.6,
          dirColor: 0xe8eef2, dirInt: 2.2, exposure: 1.15
        }
      };
      this.current = null;
      this.blend = null;
    }

    /* мгновенно применить пресет */
    apply(name, lights, renderer, fog) {
      const p = typeof name === 'string' ? this.presets[name] : name;
      if (!p) return;
      const u = this.uniforms;
      u.uZenith.value.setHex(p.zenith);
      u.uHorizon.value.setHex(p.horizon);
      u.uGround.value.setHex(p.ground);
      u.uSunDir.value.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize();
      u.uSunColor.value.setHex(p.sunColor);
      u.uSunSize.value = p.sunSize;
      u.uSunIntensity.value = p.sunIntensity;
      u.uStarAmount.value = p.stars;
      u.uCloud.value = p.cloud;
      u.uCloudColor.value.setHex(p.cloudColor);
      if (fog) { fog.color.setHex(p.fogColor); if ('density' in fog) fog.density = p.fogDensity; }
      if (lights) {
        if (lights.hemi) {
          lights.hemi.color.setHex(p.hemiSky);
          lights.hemi.groundColor.setHex(p.hemiGround);
          lights.hemi.intensity = p.hemiInt;
        }
        if (lights.dir) {
          lights.dir.color.setHex(p.dirColor);
          lights.dir.intensity = p.dirInt;
          const d = u.uSunDir.value;
          lights.dir.position.set(d.x * 260, d.y * 260, d.z * 260);
          if (lights.dir.target) lights.dir.target.position.set(0, 0, 0);
        }
      }
      if (renderer) renderer.toneMappingExposure = p.exposure;
      this.current = Object.assign({}, p);
    }

    /* плавный переход между пресетами (для рассвета в финале) */
    transition(toName, duration, lights, renderer, fog) {
      const from = Object.assign({}, this.current || this.presets.night);
      const to = typeof toName === 'string' ? this.presets[toName] : toName;
      this.blend = { from, to, t: 0, dur: duration, lights, renderer, fog };
    }

    update(dt, camera) {
      this.uniforms.uTime.value += dt;
      if (camera) this.mesh.position.copy(camera.position);

      if (this.blend) {
        const b = this.blend;
        b.t += dt;
        const k = U.smoothstep(U.clamp01(b.t / b.dur));
        const mixHex = (a, c) => new T.Color(a).lerp(new T.Color(c), k);
        const mixNum = (a, c) => U.lerp(a, c, k);
        const u = this.uniforms;
        u.uZenith.value.copy(mixHex(b.from.zenith, b.to.zenith));
        u.uHorizon.value.copy(mixHex(b.from.horizon, b.to.horizon));
        u.uGround.value.copy(mixHex(b.from.ground, b.to.ground));
        u.uSunColor.value.copy(mixHex(b.from.sunColor, b.to.sunColor));
        u.uCloudColor.value.copy(mixHex(b.from.cloudColor, b.to.cloudColor));
        u.uSunDir.value.set(
          mixNum(b.from.sunDir[0], b.to.sunDir[0]),
          mixNum(b.from.sunDir[1], b.to.sunDir[1]),
          mixNum(b.from.sunDir[2], b.to.sunDir[2])).normalize();
        u.uSunSize.value = mixNum(b.from.sunSize, b.to.sunSize);
        u.uSunIntensity.value = mixNum(b.from.sunIntensity, b.to.sunIntensity);
        u.uStarAmount.value = mixNum(b.from.stars, b.to.stars);
        u.uCloud.value = mixNum(b.from.cloud, b.to.cloud);
        if (b.fog) {
          b.fog.color.copy(mixHex(b.from.fogColor, b.to.fogColor));
          if ('density' in b.fog) b.fog.density = mixNum(b.from.fogDensity, b.to.fogDensity);
        }
        if (b.lights) {
          if (b.lights.hemi) {
            b.lights.hemi.color.copy(mixHex(b.from.hemiSky, b.to.hemiSky));
            b.lights.hemi.groundColor.copy(mixHex(b.from.hemiGround, b.to.hemiGround));
            b.lights.hemi.intensity = mixNum(b.from.hemiInt, b.to.hemiInt);
          }
          if (b.lights.dir) {
            b.lights.dir.color.copy(mixHex(b.from.dirColor, b.to.dirColor));
            b.lights.dir.intensity = mixNum(b.from.dirInt, b.to.dirInt);
            const d = u.uSunDir.value;
            b.lights.dir.position.set(d.x * 260, d.y * 260, d.z * 260);
          }
        }
        if (b.renderer) b.renderer.toneMappingExposure = mixNum(b.from.exposure, b.to.exposure);
        if (b.t >= b.dur) { this.current = Object.assign({}, b.to); this.blend = null; }
      }
    }

    dispose() {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
  }

  return { Sky };
})();
