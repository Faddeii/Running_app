/* app.js — связывает всё вместе */

(() => {
  const $ = UI.$, $$ = UI.$$;
  let firstFix = false;
  let ranks = {};       // runId -> [{m,label,sec,rank}]
  let currentPlan = null, currentDone = {};

  Tracker.init(onUpdate, onStatus);

  function onUpdate(u) {
    $('#hero-distance').textContent = Stats.fmtKm(u.distance);
    $('#hero-time').textContent = Stats.fmtTime(u.elapsedSec);
    $('#hero-pace').textContent = Stats.fmtPace(u.pace);
    $('#hero-kcal').textContent = u.kcal;
    if (u.latlngs && u.latlngs.length) UI.drawRecLine(u.latlngs, u.lastPoint);
    if (u.lastPoint && !firstFix) { firstFix = true; UI.centerRec(u.lastPoint.lat, u.lastPoint.lng); }
    UI.updateRecordLaps(u);
  }

  function onStatus(st) {
    const dot = $('#gps-dot'), txt = $('#gps-text'), warn = $('#gps-warn');
    if (st.error !== undefined) {
      dot.className = 'gps-dot bad';
      if (st.error === 1) { txt.textContent = 'GPS: нет доступа'; warn.hidden = false; warn.innerHTML = '⚠️ Разреши доступ к геолокации в браузере. Сайт должен быть открыт по HTTPS.'; }
      else txt.textContent = 'GPS: сигнал потерян';
      return;
    }
    warn.hidden = true;
    const acc = Math.round(st.accuracy || 0);
    if (st.quality === 'good') { dot.className = 'gps-dot good'; txt.textContent = `GPS: отличный (±${acc} м)`; }
    else if (st.quality === 'ok') { dot.className = 'gps-dot ok'; txt.textContent = `GPS: нормальный (±${acc} м)`; }
    else { dot.className = 'gps-dot bad'; txt.textContent = `GPS: слабый (±${acc} м)`; }
  }

  // ---------- Управление записью ----------
  function renderControls() {
    const s = Tracker.getState();
    const c = $('#controls'), sub = $('#record-sub2');
    if (s === 'idle') {
      c.innerHTML = `<button class="btn-round btn-start" id="btn-start">СТАРТ</button>`;
      $('#btn-start').onclick = doStart;
      sub.textContent = 'Запись'; $('#record-hint').hidden = false;
    } else if (s === 'running') {
      c.innerHTML = `<button class="btn-round small btn-pause" id="btn-pause">ПАУЗА</button>`;
      $('#btn-pause').onclick = () => { Tracker.pause(); renderControls(); };
      sub.textContent = '● Запись идёт'; $('#record-hint').hidden = true;
    } else if (s === 'paused') {
      c.innerHTML = `<button class="btn-round small btn-stop" id="btn-stop">ФИНИШ</button><button class="btn-round small btn-resume" id="btn-resume">ПУСК</button>`;
      $('#btn-resume').onclick = () => { Tracker.resume(); renderControls(); };
      $('#btn-stop').onclick = doStop;
      sub.textContent = '❚❚ Пауза';
    }
  }
  function doStart() {
    if (!window.isSecureContext) UI.toast('Нужен HTTPS для GPS. См. README.');
    firstFix = false; UI.resetRecLine(); Tracker.start(); renderControls();
  }
  async function doStop() {
    const run = await Tracker.stop();
    renderControls();
    if (!run) return;
    if (run.tooShort) { UI.toast('Слишком короткая пробежка — не сохранена'); resetHero(); return; }
    // определить место (город) — best-effort
    const s = DB.settings();
    if (s.geocode && run.points && run.points.length) {
      const mid = run.points[Math.floor(run.points.length / 2)];
      run.place = await lookupPlace(mid.lat, mid.lng);
    }
    await DB.saveRun(run);
    resetHero();
    await refreshAll();
    UI.switchView('feed');
    setTimeout(() => openRun(run.id), 250);
    UI.toast('Тренировка сохранена! 🎉');
  }
  function resetHero() {
    $('#hero-distance').textContent = '0.00'; $('#hero-time').textContent = '0:00';
    $('#hero-pace').textContent = '—:—'; $('#hero-kcal').textContent = '0';
    UI.resetRecLine(); $('#lap-panel').hidden = true; $('#lap-list').innerHTML = '';
  }
  $('#btn-lap').onclick = () => { const lap = Tracker.markLap(); if (lap) UI.toast(`Круг ${lap.n}: ${Stats.fmtTime(lap.sec)}`); };

  async function lookupPlace(lat, lng) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru&zoom=12`, { signal: ctrl.signal });
      clearTimeout(to);
      const j = await r.json();
      const a = j.address || {};
      return a.city || a.town || a.village || a.municipality || a.county || a.state || '';
    } catch { return ''; }
  }

  // ---------- Навигация ----------
  $$('.nav-item').forEach(n => n.onclick = () => UI.switchView(n.dataset.view));

  // ---------- Данные / детали ----------
  let currentRunId = null;
  async function refreshAll() {
    const runs = await DB.allRuns();
    ranks = Efforts.computeRanks(runs);
    UI.renderFeed(runs, ranks, openRun);
    UI.renderStreakStrip(runs);
    UI.renderProfile(runs);
    UI.renderCalendar(runs);
    UI.renderAchievements(runs);
  }
  async function openRun(id) {
    const run = await DB.getRun(id);
    if (!run) return;
    currentRunId = id;
    $('#detail-modal').classList.add('open');
    requestAnimationFrame(() => UI.renderDetail(run, ranks[id] || []));
  }
  $('#detail-back').onclick = () => $('#detail-modal').classList.remove('open');
  $('#detail-delete').onclick = async () => {
    if (!currentRunId) return;
    if (!confirm('Удалить эту тренировку? Действие необратимо.')) return;
    await DB.deleteRun(currentRunId);
    $('#detail-modal').classList.remove('open');
    await refreshAll(); UI.toast('Тренировка удалена');
  };
  $('#cal-prev').onclick = async () => { UI.calShift(-1); UI.renderCalendar(await DB.allRuns()); };
  $('#cal-next').onclick = async () => { UI.calShift(1); UI.renderCalendar(await DB.allRuns()); };

  // ---------- План ----------
  function bindDistChips(sel, input) {
    $$(sel + ' .chip').forEach(ch => ch.onclick = () => {
      $$(sel + ' .chip').forEach(c => c.classList.remove('active'));
      ch.classList.add('active'); $(input).value = ch.dataset.km;
    });
  }
  bindDistChips('#cur-dist-chips', '#cur-dist');
  bindDistChips('#goal-dist-chips', '#goal-dist');
  $('#btn-build-plan').onclick = () => {
    const curDistM = (parseFloat($('#cur-dist').value) || 0) * 1000;
    const curSec = (parseInt($('#cur-h').value) || 0) * 3600 + (parseInt($('#cur-m').value) || 0) * 60 + (parseInt($('#cur-s').value) || 0);
    const goalDistM = (parseFloat($('#goal-dist').value) || 0) * 1000;
    const goalSec = (parseInt($('#goal-h').value) || 0) * 3600 + (parseInt($('#goal-m').value) || 0) * 60 + (parseInt($('#goal-s').value) || 0);
    const days = Math.min(7, Math.max(3, parseInt($('#goal-days').value) || 4));
    const weeks = Math.min(24, Math.max(4, parseInt($('#goal-weeks').value) || 8));
    const startVolume = parseFloat($('#goal-vol').value) || 0;
    const longDay = parseInt($('#goal-longday').value);
    if (goalDistM < 400 || goalSec < 60) { UI.toast('Заполни целевую дистанцию и время'); return; }
    if (curDistM >= 400 && curSec < 30) { UI.toast('Укажи время недавнего результата'); return; }
    const wrPace = 142;
    if (goalSec / (goalDistM / 1000) < wrPace || (curDistM >= 400 && curSec / (curDistM / 1000) < wrPace)) { UI.toast('Это быстрее мирового рекорда 🙂 Проверь цифры'); return; }
    const cfg = { currentDistM: curDistM, currentTimeSec: curSec, goalDistM, goalTimeSec: goalSec, days, weeks, startVolume, longDay };
    currentPlan = Training.buildPlan(cfg);
    currentDone = {};
    UI.renderPlan(currentPlan, currentDone);
    DB.setSetting('plan', { cfg, ts: Date.now(), done: {} });
    $('#plan-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Отметки выполнения + сброс (делегирование на контейнере плана)
  $('#plan-result').addEventListener('click', e => {
    const chk = e.target.closest('.day-check');
    if (chk) {
      const key = chk.dataset.daykey;
      currentDone[key] = !currentDone[key];
      if (!currentDone[key]) delete currentDone[key];
      const dayEl = chk.closest('.day');
      if (dayEl) dayEl.classList.toggle('done', !!currentDone[key]);
      savePlanDone();
      if (currentPlan) UI.updatePlanProgress(currentPlan, currentDone);
      return;
    }
    if (e.target.closest('#btn-reset-plan')) {
      if (!confirm('Сбросить все отметки выполнения плана?')) return;
      currentDone = {};
      savePlanDone();
      if (currentPlan) UI.renderPlan(currentPlan, currentDone);
      UI.toast('Отметки сброшены');
    }
  });
  function savePlanDone() {
    const p = DB.settings().plan;
    if (p) { p.done = currentDone; DB.setSetting('plan', p); }
  }

  // Загрузка сохранённого плана при старте: восстановить форму и отрисовать с отметками
  function loadSavedPlan() {
    const p = DB.settings().plan;
    if (!p || !p.cfg) return;
    const c = p.cfg;
    const setKm = (id, m) => { const el = $(id); if (el) el.value = (m / 1000); };
    setKm('#cur-dist', c.currentDistM);
    setKm('#goal-dist', c.goalDistM);
    const setHMS = (pfx, sec) => { $(pfx + '-h').value = Math.floor(sec / 3600); $(pfx + '-m').value = Math.floor((sec % 3600) / 60); $(pfx + '-s').value = sec % 60; };
    setHMS('#cur', c.currentTimeSec || 0);
    setHMS('#goal', c.goalTimeSec || 0);
    $('#goal-days').value = c.days; $('#goal-weeks').value = c.weeks;
    if (c.startVolume) $('#goal-vol').value = c.startVolume;
    $('#goal-longday').value = c.longDay;
    currentPlan = Training.buildPlan(c);
    currentDone = p.done || {};
    UI.renderPlan(currentPlan, currentDone);
  }

  // ---------- Настройки ----------
  const setModal = $('#settings-modal');
  function openSettings() {
    const s = DB.settings();
    $('#set-name').value = s.name || '';
    $('#set-city').value = s.city || '';
    $('#set-weight').value = s.weight;
    $('#set-wakelock').value = s.wakelock;
    $('#set-geocode').value = s.geocode;
    $('#set-voice').value = s.voice;
    $('#set-voice-every').value = s.voiceEvery;
    $('#set-voice-content').value = s.voiceContent;
    $('#set-voice-laps').value = s.voiceLaps;
    $('#set-track').value = s.track;
    $('#set-lap-len').value = s.lapLen;
    setModal.classList.add('open');
  }
  ['#btn-settings', '#btn-settings2', '#btn-settings3'].forEach(id => { const b = $(id); if (b) b.onclick = openSettings; });
  $('#settings-back').onclick = async () => { setModal.classList.remove('open'); await refreshAll(); };
  $('#set-name').onchange = e => { DB.setSetting('name', e.target.value.trim() || 'Бегун'); };
  $('#set-city').onchange = e => DB.setSetting('city', e.target.value.trim());
  $('#set-weight').onchange = e => DB.setSetting('weight', Math.max(30, Math.min(200, +e.target.value || 70)));
  $('#set-wakelock').onchange = e => DB.setSetting('wakelock', +e.target.value);
  $('#set-geocode').onchange = e => DB.setSetting('geocode', +e.target.value);
  $('#set-voice').onchange = e => DB.setSetting('voice', +e.target.value);
  $('#set-voice-every').onchange = e => DB.setSetting('voiceEvery', e.target.value);
  $('#set-voice-content').onchange = e => DB.setSetting('voiceContent', e.target.value);
  $('#set-voice-laps').onchange = e => DB.setSetting('voiceLaps', +e.target.value);
  $('#set-track').onchange = e => DB.setSetting('track', +e.target.value);
  $('#set-lap-len').onchange = e => DB.setSetting('lapLen', +e.target.value);
  $('#btn-test-voice').onclick = () => Tracker.testVoice();

  $('#btn-export').onclick = async () => {
    const runs = await DB.allRuns();
    if (!runs.length) { UI.toast('Нет данных для экспорта'); return; }
    const blob = new Blob([JSON.stringify(runs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ritm-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast('Файл экспортирован');
  };
  $('#btn-wipe').onclick = async () => {
    if (!confirm('Стереть ВСЕ тренировки и настройки? Это необратимо.')) return;
    await DB.wipe(); localStorage.removeItem('ritm-settings');
    setModal.classList.remove('open'); await refreshAll(); UI.toast('Все данные стёрты');
  };

  // ---------- Инициализация ----------
  async function init() {
    UI.ensureRecMap();
    renderControls();
    await refreshAll();
    loadSavedPlan();
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => { UI.centerRec(pos.coords.latitude, pos.coords.longitude); const a = pos.coords.accuracy; onStatus({ quality: a <= 8 ? 'good' : a <= 20 ? 'ok' : 'bad', accuracy: a }); },
        err => onStatus({ error: err.code, message: err.message }),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }
    if (!window.isSecureContext) { const w = $('#gps-warn'); w.hidden = false; w.innerHTML = '⚠️ Открыто без HTTPS. GPS работает только по HTTPS или на localhost (см. README).'; }
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
