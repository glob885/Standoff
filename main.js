/* ============================================================
   main.js — точка входа: прогрев текстур, старт движка,
   обработка ошибок, регистрация полноэкранного режима.
   ============================================================ */
'use strict';

(function boot() {
  const loadingEl = document.getElementById('loading');
  const barEl = document.getElementById('loadBar');
  const statusEl = document.getElementById('loadStatus');

  function setProgress(p, text) {
    if (barEl) barEl.style.width = Math.round(p * 100) + '%';
    if (statusEl && text) statusEl.textContent = text;
  }

  function fail(err) {
    console.error(err);
    if (statusEl) {
      statusEl.innerHTML = 'ОШИБКА ЗАПУСКА:<br><span style="font-size:11px;opacity:.7">' +
        (err && err.message ? err.message : err) + '</span>';
    }
  }

  // шаги загрузки: генерация текстур блоками, чтобы не вешать поток
  const steps = [
    ['Генерация грунта…', () => TEX.preload(['ground', 'groundN'])],
    ['Генерация растительности…', () => TEX.preload(['bark', 'needle', 'grass'])],
    ['Пошив формы…', () => TEX.preload(['camo', 'camoDark'])],
    ['Броня и техника…', () => TEX.preload(['armor', 'armorN'])],
    ['Ржавчина объекта…', () => TEX.preload(['rust', 'rustN', 'grille'])],
    ['Эффекты…', () => TEX.preload(['smoke', 'flash', 'spark', 'blood', 'crater', 'fog', 'flesh'])],
    ['Сборка материалов…', () => Models.initMaterials()],
    ['Запуск движка…', () => {
      window.GAME = new Game.Engine();
      window.GAME.start();
    }]
  ];

  let i = 0;
  function next() {
    if (i >= steps.length) {
      setProgress(1, 'ГОТОВО');
      setTimeout(() => loadingEl && loadingEl.classList.add('hidden'), 250);
      return;
    }
    const [label, fn] = steps[i];
    setProgress(i / steps.length, label);
    // даём браузеру отрисовать прогресс
    requestAnimationFrame(() => {
      setTimeout(() => {
        try { fn(); } catch (e) { fail(e); return; }
        i++;
        next();
      }, 16);
    });
  }

  if (typeof THREE === 'undefined') {
    fail(new Error('three.js не загрузился (проверь vendor/three.min.js)'));
    return;
  }

  // WebGL доступен?
  try {
    const test = document.createElement('canvas');
    const gl = test.getContext('webgl2') || test.getContext('webgl');
    if (!gl) throw new Error('WebGL недоступен в этом браузере');
  } catch (e) { fail(e); return; }

  next();

  /* --- полноэкранный режим по кнопке --- */
  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn) {
    fsBtn.onclick = () => {
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen || function () { }).call(el);
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => { });
        }
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || function () { }).call(document);
      }
    };
  }

  /* --- подсказка «поверни телефон» --- */
  function checkOrientation() {
    const hint = document.getElementById('rotateHint');
    if (!hint) return;
    const portrait = innerHeight > innerWidth;
    const mobile = U.isMobile();
    hint.classList.toggle('hidden', !(portrait && mobile));
  }
  addEventListener('resize', checkOrientation);
  addEventListener('orientationchange', checkOrientation);
  setTimeout(checkOrientation, 400);

  /* --- пауза при уходе со вкладки --- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.GAME && window.GAME.state === 'play') window.GAME.togglePause();
  });

  window.addEventListener('error', e => {
    if (loadingEl && !loadingEl.classList.contains('hidden')) fail(e.error || e.message);
  });
})();
