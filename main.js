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

  /* ============================================================
     PWA: установка на экран «Домой», standalone-режим, офлайн
     ============================================================ */
  const isStandalone = () =>
    window.navigator.standalone === true ||                      // iOS Safari
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches;

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isSafari = () =>
    /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(navigator.userAgent);

  function applyStandalone() {
    const on = isStandalone();
    document.body.classList.toggle('standalone', on);
    if (on) {
      // запущено с экрана «Домой»: адресной строки нет — это и есть полный экран
      document.documentElement.style.setProperty('--app-mode', 'standalone');
      // прячем подсказку об установке
      const tip = document.getElementById('a2hsTip');
      if (tip) tip.classList.add('hidden');
      // держим экран включённым, пока играем
      requestWakeLock();
    }
    return on;
  }

  /* не давать экрану гаснуть во время игры */
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* не критично */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !wakeLock && isStandalone()) requestWakeLock();
  });

  /* Android/Chrome: системное приглашение установить */
  let deferredPrompt = null;
  const installBtn = document.getElementById('installBtn');
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
  });
  if (installBtn) {
    installBtn.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    };
  }
  addEventListener('appinstalled', () => {
    if (installBtn) installBtn.classList.add('hidden');
    const tip = document.getElementById('a2hsTip');
    if (tip) tip.classList.add('hidden');
  });

  /* iOS: своей кнопки установки нет — показываем инструкцию */
  function maybeShowIosTip() {
    const tip = document.getElementById('a2hsTip');
    if (!tip) return;
    const dismissed = U.Store.read('a2hsDismissed', false);
    if (isIOS() && isSafari() && !isStandalone() && !dismissed) {
      tip.classList.remove('hidden');
    }
    const close = document.getElementById('a2hsClose');
    if (close) close.onclick = () => {
      tip.classList.add('hidden');
      U.Store.write('a2hsDismissed', true);
    };
  }

  /* ============================================================
     ОБНОВЛЕНИЕ: сброс кэша и жёсткая перезагрузка
     ============================================================ */
  const APP_VERSION = '3.1.0';
  const verLine = document.getElementById('verLine');
  if (verLine) verLine.textContent = 'версия ' + APP_VERSION;

  let swRegistration = null;

  /* полный сброс: чистим Cache Storage, снимаем сервис-воркер,
     перезагружаем страницу с новым query, чтобы браузер не взял из HTTP-кэша */
  async function forceUpdate() {
    const overlay = document.createElement('div');
    overlay.className = 'updating';
    overlay.textContent = 'ОБНОВЛЕНИЕ… СБРАСЫВАЮ КЭШ';
    document.body.appendChild(overlay);
    try {
      if (window.speechSynthesis) speechSynthesis.cancel();
      // 1) все кэши сервис-воркера
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // 2) снимаем регистрации сервис-воркеров
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      // 3) локальные настройки не трогаем — они полезные; чистим только флаги версии
      try { localStorage.removeItem('siren_swVersion'); } catch (e) { /* ок */ }
    } catch (e) {
      console.warn('update:', e);
    }
    // 4) перезагрузка с обходом HTTP-кэша
    const url = new URL(location.href);
    url.searchParams.set('v', Date.now().toString(36));
    location.replace(url.toString());
  }

  for (const id of ['updateBtn', 'updateBtn2', 'updateNowBtn']) {
    const el = document.getElementById(id);
    if (el) el.onclick = forceUpdate;
  }
  const laterBtn = document.getElementById('updateLaterBtn');
  if (laterBtn) laterBtn.onclick = () => {
    const b = document.getElementById('updateBanner');
    if (b) b.classList.add('hidden');
  };

  function showUpdateBanner() {
    const b = document.getElementById('updateBanner');
    if (b) b.classList.remove('hidden');
  }

  /* сервис-воркер — офлайн-режим + автопроверка обновлений */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('sw.js').then(reg => {
      swRegistration = reg;

      // если уже стоит новый воркер и ждёт — предлагаем обновиться
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // «installed» + уже есть контроллер = приехала новая версия
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });

      // проверяем обновления при запуске и при возврате во вкладку
      const check = () => { try { reg.update(); } catch (e) { /* ок */ } };
      setTimeout(check, 4000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 5 * 60 * 1000);
    }).catch(() => { /* не критично */ });

    // когда воркер сменился — страница уже работает на новой версии
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
    });
  }

  applyStandalone();
  maybeShowIosTip();
  registerSW();
  addEventListener('resize', applyStandalone);
  matchMedia('(display-mode: standalone)').addEventListener?.('change', applyStandalone);

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
