/* ============================================================
   src/postfx.js — собственный композитор пост-обработки:
   HDR-таргет → bright pass → 3 уровня блюра → финальный шейдер
   (bloom, виньетка, зерно, хром. аберрация, цветокоррекция,
    радиальное размытие при крике босса, красный флеш урона).
   Реализовано без внешних аддонов three.
   ============================================================ */
'use strict';

const PostFX = (() => {
  const T = THREE;

  const QUAD_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const BRIGHT_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uThreshold;
    uniform float uSoftKnee;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float br = max(c.r, max(c.g, c.b));
      float knee = uThreshold * uSoftKnee + 1e-5;
      float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee);
      float contrib = max(soft, br - uThreshold) / max(br, 1e-5);
      gl_FragColor = vec4(c * contrib, 1.0);
    }
  `;

  const BLUR_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;       // (1/w, 0) или (0, 1/h)
    void main() {
      vec3 sum = vec3(0.0);
      sum += texture2D(tDiffuse, vUv - uDir * 4.0).rgb * 0.051;
      sum += texture2D(tDiffuse, vUv - uDir * 3.0).rgb * 0.0918;
      sum += texture2D(tDiffuse, vUv - uDir * 2.0).rgb * 0.12245;
      sum += texture2D(tDiffuse, vUv - uDir * 1.0).rgb * 0.1531;
      sum += texture2D(tDiffuse, vUv).rgb                * 0.1633;
      sum += texture2D(tDiffuse, vUv + uDir * 1.0).rgb * 0.1531;
      sum += texture2D(tDiffuse, vUv + uDir * 2.0).rgb * 0.12245;
      sum += texture2D(tDiffuse, vUv + uDir * 3.0).rgb * 0.0918;
      sum += texture2D(tDiffuse, vUv + uDir * 4.0).rgb * 0.051;
      gl_FragColor = vec4(sum, 1.0);
    }
  `;

  const COMPOSE_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom0;
    uniform sampler2D tBloom1;
    uniform sampler2D tBloom2;
    uniform float uBloom;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uHurt;        // 0..1 красный флеш
    uniform float uRadial;      // 0..1 радиальное размытие (крик)
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3  uLift;
    uniform vec3  uGain;
    uniform float uFade;        // 0..1 затемнение (переходы)

    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

    vec3 sampleRadial(vec2 uv, float amount) {
      vec2 center = vec2(0.5);
      vec3 acc = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 6; i++) {
        float t = float(i) / 5.0;
        float scale = 1.0 - amount * 0.12 * t;
        vec2 suv = center + (uv - center) * scale;
        float w = 1.0 - t * 0.5;
        acc += texture2D(tDiffuse, suv).rgb * w;
        total += w;
      }
      return acc / total;
    }

    void main() {
      vec2 uv = vUv;
      float dist = distance(uv, vec2(0.5));

      // хроматическая аберрация по краям
      float ab = uAberration * (0.25 + dist * 1.6);
      vec2 dirc = normalize(uv - vec2(0.5) + 1e-6);
      vec3 col;
      if (uRadial > 0.01) {
        col = sampleRadial(uv, uRadial);
      } else {
        col.r = texture2D(tDiffuse, uv + dirc * ab * 0.0016).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - dirc * ab * 0.0016).b;
      }

      // bloom (три масштаба)
      vec3 b0 = texture2D(tBloom0, uv).rgb;
      vec3 b1 = texture2D(tBloom1, uv).rgb;
      vec3 b2 = texture2D(tBloom2, uv).rgb;
      vec3 bloom = b0 * 0.5 + b1 * 0.32 + b2 * 0.26;
      col += bloom * uBloom;

      // цветокоррекция: lift/gain, контраст, насыщенность
      col = col * uGain + uLift;
      col = (col - 0.5) * uContrast + 0.5;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSaturation);

      // флеш урона
      col = mix(col, vec3(0.55, 0.03, 0.04), uHurt * 0.55);

      // виньетка
      float vig = smoothstep(0.85, 0.25, dist);
      col *= mix(1.0, vig, uVignette);

      // зерно
      float g = hash(uv * vec2(1024.0, 768.0) + uTime * 60.0) - 0.5;
      col += g * uGrain;

      col *= (1.0 - uFade);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `;

  class Composer {
    constructor(renderer, scene, camera, opts = {}) {
      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.enabled = opts.enabled !== false;
      this.quality = opts.quality || 'high';   // high | medium | low

      this.quadScene = new T.Scene();
      this.quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quadGeo = new T.PlaneGeometry(2, 2);
      this.quad = new T.Mesh(quadGeo, new T.MeshBasicMaterial());
      this.quad.frustumCulled = false;
      this.quadScene.add(this.quad);

      const half = (renderer.capabilities && renderer.capabilities.isWebGL2) ? T.HalfFloatType : T.UnsignedByteType;
      this.type = half;

      this.matBright = new T.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uThreshold: { value: 0.78 },
          uSoftKnee: { value: 0.6 }
        },
        vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false
      });
      this.matBlur = new T.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uDir: { value: new T.Vector2() } },
        vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false
      });
      this.matCompose = new T.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tBloom0: { value: null },
          tBloom1: { value: null },
          tBloom2: { value: null },
          uBloom: { value: 0.55 },
          uTime: { value: 0 },
          uGrain: { value: 0.02 },
          uVignette: { value: 0.62 },
          uAberration: { value: 0.7 },
          uHurt: { value: 0 },
          uRadial: { value: 0 },
          uSaturation: { value: 1.06 },
          uContrast: { value: 1.06 },
          uLift: { value: new T.Vector3(0.004, 0.004, 0.012) },
          uGain: { value: new T.Vector3(1.02, 1.0, 0.99) },
          uFade: { value: 0 }
        },
        vertexShader: QUAD_VERT, fragmentShader: COMPOSE_FRAG, depthTest: false, depthWrite: false
      });

      this.targets = [];
      this.setSize(renderer.domElement.width, renderer.domElement.height);
    }

    makeRT(w, h) {
      const rt = new T.WebGLRenderTarget(Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)), {
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
        type: this.type,
        depthBuffer: false,
        stencilBuffer: false
      });
      this.targets.push(rt);
      return rt;
    }

    setSize(w, h) {
      for (const rt of this.targets) rt.dispose();
      this.targets.length = 0;

      const scene = new T.WebGLRenderTarget(w, h, {
        minFilter: T.LinearFilter, magFilter: T.LinearFilter,
        type: this.type, depthBuffer: true, stencilBuffer: false
      });
      this.targets.push(scene);
      this.rtScene = scene;

      const divs = this.quality === 'low' ? [4, 8, 16] : this.quality === 'medium' ? [2, 4, 8] : [2, 4, 8];
      this.rtBright = this.makeRT(w / divs[0], h / divs[0]);
      this.chain = divs.map(d => ({
        a: this.makeRT(w / d, h / d),
        b: this.makeRT(w / d, h / d),
        w: w / d, h: h / d
      }));
      this.width = w; this.height = h;
    }

    blit(material, target) {
      this.quad.material = material;
      this.renderer.setRenderTarget(target || null);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.quadScene, this.quadCam);
    }

    render(dt) {
      const r = this.renderer;
      this.matCompose.uniforms.uTime.value += dt;

      if (!this.enabled) {
        r.setRenderTarget(null);
        r.render(this.scene, this.camera);
        return;
      }

      // 1. сцена в HDR-таргет
      r.setRenderTarget(this.rtScene);
      r.clear(true, true, true);
      r.render(this.scene, this.camera);

      // 2. bright pass
      this.matBright.uniforms.tDiffuse.value = this.rtScene.texture;
      this.blit(this.matBright, this.rtBright);

      // 3. цепочка блюров (каждый уровень берёт предыдущий)
      let src = this.rtBright.texture;
      for (let i = 0; i < this.chain.length; i++) {
        const lvl = this.chain[i];
        this.matBlur.uniforms.tDiffuse.value = src;
        this.matBlur.uniforms.uDir.value.set(1 / lvl.w, 0);
        this.blit(this.matBlur, lvl.a);
        this.matBlur.uniforms.tDiffuse.value = lvl.a.texture;
        this.matBlur.uniforms.uDir.value.set(0, 1 / lvl.h);
        this.blit(this.matBlur, lvl.b);
        src = lvl.b.texture;
      }

      // 4. финальная сборка
      const u = this.matCompose.uniforms;
      u.tDiffuse.value = this.rtScene.texture;
      u.tBloom0.value = this.chain[0].b.texture;
      u.tBloom1.value = this.chain[1].b.texture;
      u.tBloom2.value = this.chain[2].b.texture;
      this.blit(this.matCompose, null);
    }

    /* --- параметры «на лету» --- */
    set(name, value) {
      const u = this.matCompose.uniforms[name];
      if (u) u.value = value;
    }
    get(name) {
      const u = this.matCompose.uniforms[name];
      return u ? u.value : undefined;
    }
    setQuality(q) {
      this.quality = q;
      this.setSize(this.width, this.height);
      if (q === 'low') { this.set('uBloom', 0.4); this.set('uGrain', 0.015); this.set('uAberration', 0.3); }
      else if (q === 'medium') { this.set('uBloom', 0.5); this.set('uGrain', 0.018); this.set('uAberration', 0.5); }
      else { this.set('uBloom', 0.58); this.set('uGrain', 0.02); this.set('uAberration', 0.7); }
    }
    dispose() {
      for (const rt of this.targets) rt.dispose();
      this.matBright.dispose(); this.matBlur.dispose(); this.matCompose.dispose();
    }
  }

  return { Composer };
})();
