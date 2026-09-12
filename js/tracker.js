/* tracker.js — запись пробежки, голосовой помощник, круги.
   Состояния: idle -> running <-> paused -> (stop) -> saved */

const Tracker = (() => {
  let state = 'idle';
  let watchId = null;
  let proc = null;
  let startTime = 0;
  let elapsedBefore = 0;
  let segmentStart = 0;
  let tickTimer = null;
  let wakeLock = null;
  let onUpdate = null, onStatus = null, onState = null;
  let settings = null;
  let autoPaused = false;   // пауза из-за сворачивания приложения

  // голос
  let lastVoiceDist = 0;   // м, последняя озвученная отметка (дистанция)
  let lastVoiceTime = 0;   // сек, последняя озвученная отметка (время)
  // круги
  let laps = [];           // [{n, dist, sec, cumDist, cumSec, pace, manual}]
  let lapStartDist = 0;    // м на начало текущего круга
  let lapStartTime = 0;    // сек на начало текущего круга
  let nextAutoLap = 0;     // м, следующая отметка автокруга

  function now() { return Date.now(); }
  function elapsedMs() {
    if (state === 'running') return elapsedBefore + (now() - segmentStart);
    return elapsedBefore;
  }

  // ---------- Wake Lock ----------
  async function acquireWakeLock() {
    if (!settings.wakelock) return;
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
  async function releaseWakeLock() { try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch {} }
  // Авто-пауза при сворачивании / гашении экрана во время записи
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (state === 'running') autoPause();
    } else { // снова видимо
      if (state === 'running' && !wakeLock) acquireWakeLock();
      if (autoPaused) {
        if (!settings || settings.bgAlert !== 0) { vibrate([180]); speak('Запись на паузе. Нажми пуск, чтобы продолжить.'); }
        if (onState) onState('needresume');
      }
    }
  });
  window.addEventListener('pagehide', () => { if (state === 'running') autoPause(); });

  function autoPause() {
    if (state !== 'running') return;
    elapsedBefore += now() - segmentStart;
    state = 'paused';
    stopTick(); releaseWakeLock();
    autoPaused = true;
    alertBackgroundPause();
    if (onState) onState('autopaused');
    emit();
  }

  // ---------- Речь ----------
  function speak(text) {
    if (!settings || !settings.voice) return;
    try {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ru-RU'; u.rate = 1.0; u.pitch = 1.0;
        speechSynthesis.speak(u);
      }
    } catch {}
  }
  function forceSpeak(text) { // для теста, игнорирует настройку voice
    try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; speechSynthesis.speak(u); } } catch {}
  }

  // Звуковой сигнал (Web Audio) и вибрация — для оповещения об авто-паузе
  let audioCtx = null;
  function initAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch {}
  }
  function beep(pattern = [880, 0, 880]) {
    try {
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      pattern.forEach((f, i) => {
        if (!f) return;
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        const st = t0 + i * 0.22;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.35, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.2);
        o.connect(g).connect(audioCtx.destination);
        o.start(st); o.stop(st + 0.21);
      });
    } catch {}
  }
  function vibrate(pat) { try { if (navigator.vibrate) navigator.vibrate(pat); } catch {} }
  function alertBackgroundPause() {
    if (settings && settings.bgAlert === 0) return;
    vibrate([250, 120, 250, 120, 400]);
    beep([988, 0, 740]);
    speak('Внимание. Запись на паузе, приложение свёрнуто.');
  }

  function plur(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function spokenKm(meters) {
    const km = meters / 1000;
    if (Math.abs(km - Math.round(km)) < 0.01) {
      const n = Math.round(km);
      return `${n} ${plur(n, 'километр', 'километра', 'километров')}`;
    }
    const s = km.toFixed(1).replace('.', ',');
    return `${s} километра`;
  }
  function spokenDuration(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const parts = [];
    if (h > 0) parts.push(`${h} ${plur(h, 'час', 'часа', 'часов')}`);
    if (m > 0) parts.push(`${m} ${plur(m, 'минута', 'минуты', 'минут')}`);
    if (s > 0 || parts.length === 0) parts.push(`${s} ${plur(s, 'секунда', 'секунды', 'секунд')}`);
    return parts.join(' ');
  }
  function spokenPace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0) return 'темп пока не определён';
    const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    let r = `${m} ${plur(m, 'минута', 'минуты', 'минут')}`;
    if (s > 0) r += ` ${s} ${plur(s, 'секунда', 'секунды', 'секунд')}`;
    return `${r} на километр`;
  }

  function announceStats(dist, sec) {
    const pc = Stats.pace(dist, sec);
    const c = settings.voiceContent;
    let msg;
    if (c === 'pace') msg = `Темп ${spokenPace(pc)}.`;
    else if (c === 'dist') msg = `Дистанция ${spokenKm(dist)}. Время ${spokenDuration(sec)}.`;
    else msg = `Дистанция ${spokenKm(dist)}. Время ${spokenDuration(sec)}. Средний темп ${spokenPace(pc)}.`;
    speak(msg);
  }

  function maybeVoice(dist, sec) {
    if (!settings.voice) return;
    const every = settings.voiceEvery;
    if (every === 'km' || every === '0.5km' || every === '2km') {
      const interval = every === 'km' ? 1000 : every === '0.5km' ? 500 : 2000;
      while (dist >= lastVoiceDist + interval) {
        lastVoiceDist += interval;
        announceStats(lastVoiceDist, sec);
      }
    } else {
      const interval = every === '1min' ? 60 : every === '2min' ? 120 : 300;
      while (sec >= lastVoiceTime + interval) {
        lastVoiceTime += interval;
        announceStats(dist, sec);
      }
    }
  }

  // ---------- Круги ----------
  function recordLap(atDist, atSec, manual) {
    const lapDist = atDist - lapStartDist;
    const lapSec = atSec - lapStartTime;
    if (lapDist < 5 && !manual) return;
    const lap = {
      n: laps.length + 1,
      dist: Math.round(lapDist),
      sec: +lapSec.toFixed(1),
      cumDist: Math.round(atDist),
      cumSec: +atSec.toFixed(1),
      pace: lapDist > 5 ? lapSec / (lapDist / 1000) : 0,
      manual: !!manual,
    };
    laps.push(lap);
    lapStartDist = atDist;
    lapStartTime = atSec;
    if (settings.voiceLaps) {
      speak(`Круг ${lap.n}. ${spokenDuration(lap.sec)}. Темп ${spokenPace(lap.pace)}.`);
    }
    return lap;
  }

  function maybeAutoLap(dist, sec) {
    if (!settings.track) return;
    const len = settings.lapLen || 400;
    while (dist >= nextAutoLap + len) {
      // отмечаем круг на точной отметке (по времени интерполировать не будем — достаточно текущего)
      recordLap(nextAutoLap + len, sec * ((nextAutoLap + len) / (dist || 1)), false);
      nextAutoLap += len;
    }
  }

  // публичная: ручная отметка круга
  function markLap() {
    if (state === 'idle') return;
    const dist = proc ? proc.distance : 0;
    const sec = elapsedMs() / 1000;
    const lap = recordLap(dist, sec, true);
    // при ручной отметке в трек-режиме двигаем и авто-отметку
    if (settings.track) nextAutoLap = dist;
    emit();
    return lap;
  }

  // ---------- Тик и вывод ----------
  function startTick() { stopTick(); tickTimer = setInterval(() => { onTimeTick(); }, 1000); }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
  function onTimeTick() {
    const sec = elapsedMs() / 1000;
    const dist = proc ? proc.distance : 0;
    maybeVoice(dist, sec); // для времязависимой озвучки
    emit();
  }

  function currentLapInfo() {
    const dist = proc ? proc.distance : 0;
    const sec = elapsedMs() / 1000;
    return {
      n: laps.length + 1,
      dist: Math.round(dist - lapStartDist),
      sec: sec - lapStartTime,
    };
  }

  function emit(gps) {
    if (!onUpdate) return;
    const dist = proc ? proc.distance : 0;
    const sec = elapsedMs() / 1000;
    onUpdate({
      state,
      distance: dist,
      elapsedSec: sec,
      pace: Stats.pace(dist, sec),
      kcal: Stats.kcal(dist, sec, settings ? settings.weight : 70),
      latlngs: proc ? proc.latlngs() : [],
      segments: proc ? proc.latlngSegments() : [],
      autoPaused,
      lastPoint: gps && gps.point ? gps.point : (proc && proc.last ? { lat: proc.last.lat, lng: proc.last.lng } : null),
      laps: laps.slice(),
      curLap: currentLapInfo(),
      trackMode: settings ? !!settings.track : false,
    });
  }

  // ---------- GPS ----------
  function onPos(pos) {
    if (state !== 'running' || !proc) return;
    const vt = startTime + elapsedMs(); // метка времени «по движению» (без пауз)
    const r = proc.add(pos, vt);
    if (onStatus) onStatus({ quality: r.quality, accuracy: proc.lastAccuracy, reason: r.reason });
    const dist = proc.distance;
    const sec = elapsedMs() / 1000;
    maybeAutoLap(dist, sec);
    maybeVoice(dist, sec);
    emit(r);
  }
  function onPosErr(err) { if (onStatus) onStatus({ error: err.code, message: err.message }); }

  function startWatch() {
    if (!('geolocation' in navigator)) { if (onStatus) onStatus({ error: -1, message: 'Нет геолокации' }); return; }
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }
  function stopWatch() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }

  // ---------- Управление ----------
  function start() {
    if (state !== 'idle') return;
    settings = DB.settings();
    proc = new Geo.TrackProcessor();
    startTime = now(); elapsedBefore = 0; segmentStart = now();
    lastVoiceDist = 0; lastVoiceTime = 0;
    laps = []; lapStartDist = 0; lapStartTime = 0; nextAutoLap = 0;
    state = 'running'; autoPaused = false;
    initAudio(); // разрешаем звук по жесту старта
    startWatch(); startTick(); acquireWakeLock();
    speak('Поехали!');
    emit();
  }
  function pause() {
    if (state !== 'running') return;
    elapsedBefore += now() - segmentStart;
    state = 'paused'; autoPaused = false; stopTick(); releaseWakeLock();
    speak('Пауза');
    emit();
  }
  function resume() {
    if (state !== 'paused') return;
    if (autoPaused && proc) proc.markBreak(); // разорвать трек в месте авто-паузы
    autoPaused = false;
    segmentStart = now(); state = 'running';
    startTick(); acquireWakeLock();
    if (onState) onState('resumed');
    speak('Продолжаем');
    emit();
  }

  async function stop() {
    if (state === 'idle') return null;
    if (state === 'running') elapsedBefore += now() - segmentStart;
    stopTick(); stopWatch(); releaseWakeLock();

    const dist = proc.distance;
    const sec = elapsedMs() / 1000;
    // финальный (незавершённый) круг
    if (dist - lapStartDist > 5) recordLap(dist, sec, false);
    speak('Финиш! Отличная работа.');

    const points = proc.points.map(p => { const o = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), t: p.t, d: Math.round(p.d) }; if (p.brk) o.brk = true; return o; });
    const savedLaps = laps.slice();
    state = 'idle'; autoPaused = false;
    if (dist < 50 || points.length < 2) return { tooShort: true };

    return {
      id: 'r' + startTime, start: startTime, end: now(),
      distance: Math.round(dist), duration: Math.round(sec),
      pace: Stats.pace(dist, sec), kcal: Stats.kcal(dist, sec, settings.weight),
      points, laps: savedLaps,
      trackMode: !!settings.track, lapLen: settings.lapLen,
    };
  }

  function discard() { stopTick(); stopWatch(); releaseWakeLock(); state = 'idle'; proc = null; laps = []; autoPaused = false; }
  function getState() { return state; }
  function isAutoPaused() { return autoPaused; }
  function testVoice() {
    settings = DB.settings();
    forceSpeak('Голосовой помощник работает. Дистанция 3 километра. Средний темп 5 минут 30 секунд на километр.');
  }
  function init(cbUpdate, cbStatus, cbState) { onUpdate = cbUpdate; onStatus = cbStatus; onState = cbState; }

  return { init, start, pause, resume, stop, discard, getState, isAutoPaused, emit, markLap, testVoice };
})();
