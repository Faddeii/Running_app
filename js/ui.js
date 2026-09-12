/* ui.js — интерфейс в стиле Strava */

const UI = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '© OpenStreetMap';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_CAP = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  const startIcon = () => L.divIcon({ className: '', html: markerHtml('#00b16a'), iconSize: [20, 20], iconAnchor: [10, 10] });
  const endIcon = () => L.divIcon({ className: '', html: markerHtml('#fc4c02'), iconSize: [20, 20], iconAnchor: [10, 10] });
  function markerHtml(c) { return `<div style="width:16px;height:16px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 0 2px ${c}55"></div>`; }

  let recMap = null, recLine = null, recDot = null;
  let detMap = null;

  function ensureRecMap() {
    if (recMap) return recMap;
    recMap = L.map('map', { zoomControl: false, attributionControl: false }).setView([55.751, 37.618], 15);
    L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(recMap);
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(recMap).addAttribution(TILE_ATTR);
    recLine = L.polyline([], { color: '#fc4c02', weight: 6, opacity: .95, lineJoin: 'round', lineCap: 'round' }).addTo(recMap);
    recDot = L.circleMarker([55.751, 37.618], { radius: 8, color: '#fff', weight: 3, fillColor: '#fc4c02', fillOpacity: 1 });
    setTimeout(() => recMap.invalidateSize(), 200);
    return recMap;
  }
  function centerRec(lat, lng) {
    ensureRecMap();
    recMap.setView([lat, lng], Math.max(recMap.getZoom(), 16), { animate: true });
    if (!recMap.hasLayer(recDot)) recDot.addTo(recMap);
    recDot.setLatLng([lat, lng]);
  }
  function drawRecLine(latlngs, lastPoint) {
    ensureRecMap();
    recLine.setLatLngs(latlngs);
    if (lastPoint) { if (!recMap.hasLayer(recDot)) recDot.addTo(recMap); recDot.setLatLng([lastPoint.lat, lastPoint.lng]); }
  }
  function resetRecLine() { if (recLine) recLine.setLatLngs([]); }

  function showDetailMap(points) {
    if (detMap) { detMap.remove(); detMap = null; }
    detMap = L.map('detail-map', {
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, touchZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false
    }).setView([55.751, 37.618], 14);
    L.tileLayer(TILE_URL, { maxZoom: 19 }).addTo(detMap);
    L.control.attribution({ prefix: false }).addTo(detMap).addAttribution(TILE_ATTR);
    const ll = points.map(p => [p.lat, p.lng]);
    if (ll.length) {
      L.polyline(ll, { color: '#fc4c02', weight: 5, opacity: .95, lineJoin: 'round' }).addTo(detMap);
      L.marker(ll[0], { icon: startIcon() }).addTo(detMap);
      L.marker(ll[ll.length - 1], { icon: endIcon() }).addTo(detMap);
      const b = Geo.bounds(points);
      detMap.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
      setTimeout(() => { detMap.invalidateSize(); detMap.fitBounds(b, { padding: [30, 30], maxZoom: 17 }); }, 200);
    } else setTimeout(() => detMap.invalidateSize(), 200);
  }

  // Мини-карта маршрута (SVG)
  function routeThumb(points, w = 64, h = 64, bg = '#e8e8ee', sw = 3) {
    if (!points || points.length < 2) return `<svg viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/></svg>`;
    const [[minLat, minLng], [maxLat, maxLng]] = Geo.bounds(points);
    const pad = Math.max(8, w * 0.06);
    const latScale = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    const gw = Math.max(1e-6, (maxLng - minLng) * latScale), gh = Math.max(1e-6, maxLat - minLat);
    const scale = Math.min((w - 2 * pad) / gw, (h - 2 * pad) / gh);
    const offX = (w - gw * scale) / 2, offY = (h - gh * scale) / 2;
    const pts = points.map(p => {
      const x = offX + (p.lng - minLng) * latScale * scale;
      const y = h - (offY + (p.lat - minLat) * scale);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"><rect width="${w}" height="${h}" fill="${bg}"/>` +
      `<polyline points="${pts}" fill="none" stroke="#fc4c02" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${pts.split(' ')[0].split(',')[0]}" cy="${pts.split(' ')[0].split(',')[1]}" r="${sw + 1}" fill="#00b16a" stroke="#fff" stroke-width="1.5"/>` +
      `</svg>`;
  }

  // ---------- Даты ----------
  function dateKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function fmtFull(ts) {
    const d = new Date(ts);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} г. в ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function currentStreak(runs) {
    const days = new Set(runs.map(r => dateKey(r.start)));
    let streak = 0; const d = new Date();
    let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (!days.has(`${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`)) cur.setDate(cur.getDate() - 1);
    while (days.has(`${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`)) { streak++; cur.setDate(cur.getDate() - 1); }
    return streak;
  }
  // недели подряд с хотя бы одной пробежкой
  function weekStreak(runs) {
    if (!runs.length) return 0;
    const weekKeys = new Set(runs.map(r => weekKey(r.start)));
    let n = 0; let cur = new Date();
    // если на этой неделе нет — начинаем с прошлой
    if (!weekKeys.has(weekKey(cur.getTime()))) cur.setDate(cur.getDate() - 7);
    while (weekKeys.has(weekKey(cur.getTime()))) { n++; cur.setDate(cur.getDate() - 7); }
    return n;
  }
  function weekKey(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // Пн=0
    d.setDate(d.getDate() - dow);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  // ---------- Серии тренировок (лента) ----------
  function renderStreakStrip(runs) {
    const wk = weekStreak(runs);
    $('#streak-weeks').textContent = wk;
    const fl = document.querySelector('.fire-badge .fl');
    if (fl) fl.textContent = (wk % 10 === 1 && wk % 100 !== 11) ? 'Неделя' : ((wk % 10 >= 2 && wk % 10 <= 4 && (wk % 100 < 10 || wk % 100 >= 20)) ? 'Недели' : 'Недель');
    const days = new Set(runs.map(r => dateKey(r.start)));
    const letters = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - dow);
    let html = '';
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday); day.setDate(monday.getDate() + i);
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const on = days.has(key);
      const isToday = day.getTime() === today.getTime();
      html += `<div class="d ${on ? 'on' : ''} ${isToday ? 'today' : ''}"><span class="lb">${letters[i]}</span>` +
        `<span class="dot">${on ? '👟' : day.getDate()}</span></div>`;
    }
    $('#dow-strip').innerHTML = html;
  }

  // ---------- Лента ----------
  function initial(name) { return (name || 'Б').trim().charAt(0).toUpperCase() || 'Б'; }

  function renderFeed(runs, ranks, onOpen) {
    const list = $('#feed-list');
    const s = DB.settings();
    if (!runs.length) {
      list.innerHTML = `<div class="empty"><div class="big">🏃</div>Здесь появятся твои тренировки.<br>Нажми «Запись» и начни первую!</div>`;
      return;
    }
    list.innerHTML = runs.map(r => feedCard(r, ranks[r.id] || [], s)).join('');
    $$('.feed-card', list).forEach(el => {
      const open = () => onOpen(el.dataset.id);
      el.querySelector('.fc-title').onclick = open;
      el.querySelector('.fc-map').onclick = open;
      el.querySelector('.fc-stats').onclick = open;
    });
  }

  function feedCard(r, eff, s) {
    const medals = eff.filter(e => e.rank <= 3);
    const awards = medals.length;
    const meta = `${fmtFull(r.start)} · Ритм${r.place ? ' · ' + r.place : ''}`;
    // строки лучших результатов (2 самые длинные дистанции)
    const longEff = eff.slice().sort((a, b) => b.m - a.m).slice(0, 2);
    const effLines = longEff.map(e => `Лучшее примерное время <b>(${e.label})</b> ${Stats.fmtTime(e.sec)}`).join('<br>');
    // PR-плашка: самый значимый результат
    let prBanner = '';
    const best = eff.filter(e => e.rank <= 3).sort((a, b) => a.rank - b.rank || b.m - a.m)[0];
    if (best) {
      const word = best.rank === 1 ? 'самый лучший' : best.rank === 2 ? 'второй лучший' : 'третий лучший';
      const badge = best.rank === 1 ? 'PR' : best.rank;
      prBanner = `<div class="fc-pr"><span class="pr-badge">${badge}</span> Твой ${word} результат на дистанции ${best.label}!</div>`;
    }
    return `<div class="feed-card" data-id="${r.id}">
      <div class="fc-head">
        <div class="avatar">${initial(s.name)}</div>
        <div class="fc-who"><div class="name">${escapeHtml(s.name || 'Бегун')}</div><div class="meta">${meta}</div></div>
      </div>
      <div class="fc-title"><span class="rico">👟</span> ${Stats.runName(r.start)}</div>
      <div class="fc-stats">
        <div class="s"><div class="l">Расстояние</div><div class="v mono">${Stats.fmtKm(r.distance)}<small> км</small></div></div>
        <div class="s"><div class="l">Темп</div><div class="v mono">${Stats.fmtPace(r.pace)}<small> /км</small></div></div>
        <div class="s"><div class="l">Время</div><div class="v mono">${Stats.fmtTime(r.duration)}</div></div>
        <div class="s"><div class="l">Награды</div><div class="v">🏆 ${awards}</div></div>
      </div>
      ${effLines ? `<div class="fc-efforts">${effLines}</div>` : ''}
      ${prBanner}
      <div class="fc-map">${routeThumb(r.points, 400, 190, '#e8e8ee', 4)}</div>
      <div class="fc-actions"><button title="Нравится">👍</button><button title="Комментарий">💬</button></div>
    </div>`;
  }
  function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- Профиль ----------
  function renderProfile(runs) {
    const s = DB.settings();
    $('#profile-avatar').textContent = initial(s.name);
    $('#profile-name').textContent = s.name || 'Бегун';
    $('#profile-city').textContent = s.city || '';
    $('#pc-runs').textContent = runs.length;
    $('#pc-km').textContent = (runs.reduce((a, r) => a + r.distance, 0) / 1000).toFixed(0);
    $('#pc-streak').textContent = currentStreak(runs);
    $('#detail-name') && ($('#detail-name').textContent = s.name || 'Бегун');
  }

  // ---------- Календарь ----------
  let calDate = new Date();
  function renderCalendar(runs) {
    const runDays = new Set(runs.map(r => dateKey(r.start)));
    $('#cal-dows').innerHTML = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="cal-dow">${d}</div>`).join('');
    $('#cal-title').textContent = `${MONTHS_CAP[calDate.getMonth()]} ${calDate.getFullYear()}`;
    const y = calDate.getFullYear(), m = calDate.getMonth();
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const dim = new Date(y, m + 1, 0).getDate();
    const today = new Date();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let day = 1; day <= dim; day++) {
      const isRun = runDays.has(`${y}-${m}-${day}`);
      const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === day;
      const isFuture = new Date(y, m, day) > today;
      let cls = 'cal-cell' + (isRun ? ' run' : '') + (isToday ? ' today' : '') + (isFuture ? ' future' : '');
      cells += `<div class="${cls}">${isRun ? '🏃' : day}</div>`;
    }
    $('#cal-grid').innerHTML = cells;
  }
  function calShift(delta) { calDate.setMonth(calDate.getMonth() + delta); }

  // ---------- Круги (запись) ----------
  function lapRowsHtml(laps) {
    if (!laps || !laps.length) return '';
    const paces = laps.filter(l => l.pace > 0).map(l => l.pace);
    const fastest = paces.length ? Math.min(...paces) : 1;
    const slowest = paces.length ? Math.max(...paces) : 1;
    return laps.map(l => {
      const w = l.pace > 0 ? (30 + 70 * (1 - (l.pace - fastest) / ((slowest - fastest) || 1))) : 30;
      return `<div class="lap-row"><div class="n">Круг ${l.n}${l.manual ? ' ✋' : ''}</div>` +
        `<div class="bar"><i style="width:${w}%"></i></div><div class="pv mono">${Stats.fmtTime(l.sec)}</div></div>`;
    }).join('');
  }
  function updateRecordLaps(u) {
    const panel = $('#lap-panel');
    const active = u.state === 'running' || u.state === 'paused';
    if (!active && (!u.laps || !u.laps.length)) { panel.hidden = true; return; }
    panel.hidden = false;
    const cl = u.curLap || { n: 1, dist: 0, sec: 0 };
    $('#lap-cur').innerHTML = `Круг ${cl.n} <small>${cl.dist} м · ${Stats.fmtTime(cl.sec)}</small>`;
    $('#lap-list').innerHTML = lapRowsHtml((u.laps || []).slice().reverse().slice(0, 8));
  }

  // ---------- График темпа ----------
  function paceChart(points) {
    const buckets = Stats.paceBuckets(points, points[points.length - 1].d > 6000 ? 200 : 100);
    if (buckets.length < 2) return '';
    const W = 340, H = 150, pl = 44, pr = 8, pt = 10, pb = 22;
    const cw = W - pl - pr, ch = H - pt - pb;
    const totalD = buckets[buckets.length - 1].d;
    const paces = buckets.map(b => b.pace);
    let minP = Math.min(...paces), maxP = Math.max(...paces);
    const padP = (maxP - minP) * 0.15 || 15; minP -= padP; maxP += padP;
    const x = d => pl + (d / totalD) * cw;
    const y = p => pt + (p - minP) / ((maxP - minP) || 1) * ch; // быстрее (меньше сек) = выше
    const line = buckets.map((b, i) => `${i ? 'L' : 'M'}${x(b.d).toFixed(1)},${y(b.pace).toFixed(1)}`).join(' ');
    const area = `M${x(buckets[0].d).toFixed(1)},${(pt + ch).toFixed(1)} ` +
      buckets.map(b => `L${x(b.d).toFixed(1)},${y(b.pace).toFixed(1)}`).join(' ') +
      ` L${x(totalD).toFixed(1)},${(pt + ch).toFixed(1)} Z`;
    // подписи оси Y (темп)
    const yl = [minP + (maxP - minP) * 0.15, (minP + maxP) / 2, maxP - (maxP - minP) * 0.15];
    const yLabels = yl.map(p => `<text x="${pl - 6}" y="${(y(p) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#a0a0ab">${Stats.fmtPace(p)}</text>` +
      `<line x1="${pl}" y1="${y(p).toFixed(1)}" x2="${W - pr}" y2="${y(p).toFixed(1)}" stroke="#eee" stroke-width="1"/>`).join('');
    // подписи оси X (км)
    const kmStep = totalD > 10000 ? 2000 : 1000;
    let xLabels = '';
    for (let d = kmStep; d <= totalD; d += kmStep) {
      xLabels += `<text x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#a0a0ab">${d / 1000}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fc4c02" stop-opacity="0.28"/><stop offset="1" stop-color="#fc4c02" stop-opacity="0"/></linearGradient></defs>
      ${yLabels}
      <path d="${area}" fill="url(#pg)"/>
      <path d="${line}" fill="none" stroke="#fc4c02" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${xLabels}
    </svg>`;
  }

  // ---------- Детали тренировки ----------
  function renderDetail(run, eff) {
    const s = DB.settings();
    $('#detail-avatar').textContent = initial(s.name);
    $('#detail-name').textContent = s.name || 'Бегун';
    $('#detail-date').textContent = `${fmtFull(run.start)} · Ритм${run.place ? ' · ' + run.place : ''}`;
    $('#detail-title').textContent = Stats.runName(run.start);

    $('#detail-bigstats').innerHTML = `
      <div class="bs"><div class="v mono">${Stats.fmtKm(run.distance)}<small> км</small></div><div class="l">Дистанция</div></div>
      <div class="bs"><div class="v mono">${Stats.fmtTime(run.duration)}</div><div class="l">Время</div></div>
      <div class="bs"><div class="v mono">${Stats.fmtPace(run.pace)}<small> /км</small></div><div class="l">Темп</div></div>`;

    // Лучшие результаты с медалями
    eff = eff || [];
    const prCard = $('#detail-pr-card');
    if (eff.length) {
      prCard.hidden = false;
      $('#detail-efforts').innerHTML = eff.slice().sort((a, b) => a.m - b.m).map(e => {
        const med = Efforts.medal(e.rank);
        const medHtml = med ? `<div class="med">${med.emj}</div>` : `<div class="med none"></div>`;
        return `<div class="effort-row">${medHtml}<div class="lbl">${e.label}</div><div class="tm mono">${Stats.fmtTime(e.sec)}</div></div>`;
      }).join('');
    } else prCard.hidden = true;

    // График темпа
    const chartCard = $('#detail-chart-card');
    const chart = paceChart(run.points);
    if (chart) { chartCard.hidden = false; $('#detail-chart').innerHTML = chart; } else chartCard.hidden = true;

    // Круги
    const lapsCard = $('#detail-laps-card');
    if (run.laps && run.laps.length) {
      lapsCard.hidden = false;
      const paces = run.laps.filter(l => l.pace > 0).map(l => l.pace);
      const fastest = paces.length ? Math.min(...paces) : 1, slowest = paces.length ? Math.max(...paces) : 1;
      $('#detail-laps').innerHTML = run.laps.map(l => {
        const w = l.pace > 0 ? (30 + 70 * (1 - (l.pace - fastest) / ((slowest - fastest) || 1))) : 30;
        return `<div class="lap-row"><div class="n">Круг ${l.n}${l.manual ? ' ✋' : ''}</div>` +
          `<div class="bar"><i style="width:${w}%"></i></div><div class="pv mono">${Stats.fmtTime(l.sec)} · ${Stats.fmtPace(l.pace)}</div></div>`;
      }).join('');
    } else lapsCard.hidden = true;

    // Отрезки таблица
    const sp = Stats.splits(run.points, run.start);
    if (sp.length) {
      const maxP = Math.max(...sp.map(x => x.pace)), minP = Math.min(...sp.map(x => x.pace));
      $('#detail-splits').innerHTML =
        `<div class="st-row head"><div>КМ</div><div>Темп</div><div class="st-pace">Мин/км</div></div>` +
        sp.map(x => {
          const w = 30 + 70 * (1 - (x.pace - minP) / ((maxP - minP) || 1));
          return `<div class="st-row"><div class="st-km">${x.partial ? (x.dist / 1000).toFixed(2) : x.km}</div>` +
            `<div class="st-bar"><i style="width:${w}%"></i></div><div class="st-pace mono">${Stats.fmtPace(x.pace)}</div></div>`;
        }).join('');
    } else $('#detail-splits').innerHTML = '<div class="small-note">Недостаточно данных.</div>';

    showDetailMap(run.points);
  }

  // ---------- Достижения / рекорды ----------
  function timeAtDistance(points, D) {
    if (!points.length) return null;
    for (let i = 1; i < points.length; i++) {
      if (points[i].d >= D) { const a = points[i - 1], b = points[i]; const f = (D - a.d) / ((b.d - a.d) || 1); return (a.t + (b.t - a.t) * f - points[0].t) / 1000; }
    }
    return null;
  }
  function computeStats(runs) {
    const totalKm = runs.reduce((s, r) => s + r.distance, 0) / 1000;
    const longest = runs.reduce((m, r) => Math.max(m, r.distance), 0);
    const totalTime = runs.reduce((s, r) => s + r.duration, 0);
    const best = {};
    for (const D of [1000, 5000, 10000, 21097]) {
      best[D] = null;
      for (const r of runs) { const t = Efforts.bestEffort(r.points, D); if (t && (best[D] === null || t < best[D])) best[D] = t; }
    }
    return { totalKm, totalRuns: runs.length, longest, totalTime, best };
  }

  const ACHIEVEMENTS = [
    { id: 'first', emj: '🎉', t: 'Первый шаг', d: 'Первая пробежка', test: s => s.totalRuns >= 1, prog: s => s.totalRuns },
    { id: 'd5', emj: '5️⃣', t: 'Пятёрка', d: '5 км за раз', test: s => s.longest >= 5000, prog: s => s.longest / 5000 },
    { id: 'd10', emj: '🔟', t: 'Десятка', d: '10 км за раз', test: s => s.longest >= 10000, prog: s => s.longest / 10000 },
    { id: 'half', emj: '🏅', t: 'Полумарафон', d: '21.1 км за раз', test: s => s.longest >= 21097, prog: s => s.longest / 21097 },
    { id: 'runs10', emj: '👟', t: '10 пробежек', d: '10 тренировок', test: s => s.totalRuns >= 10, prog: s => s.totalRuns / 10 },
    { id: 'km50', emj: '📍', t: '50 км', d: 'Суммарно 50 км', test: s => s.totalKm >= 50, prog: s => s.totalKm / 50 },
    { id: 'km100', emj: '💯', t: 'Сотка', d: 'Суммарно 100 км', test: s => s.totalKm >= 100, prog: s => s.totalKm / 100 },
    { id: 'km500', emj: '🚀', t: '500 км', d: 'Суммарно 500 км', test: s => s.totalKm >= 500, prog: s => s.totalKm / 500 },
    { id: 'streak3', emj: '🔥', t: 'В огне', d: '3 дня подряд', test: (s, x) => x.streak >= 3, prog: (s, x) => x.streak / 3 },
    { id: 'streak7', emj: '⚡', t: 'Неделя силы', d: '7 дней подряд', test: (s, x) => x.streak >= 7, prog: (s, x) => x.streak / 7 },
    { id: 'fast5', emj: '💨', t: 'Быстрая пятёрка', d: '5 км быстрее 25:00', test: s => s.best[5000] && s.best[5000] < 1500, prog: s => s.best[5000] ? 1500 / s.best[5000] : 0 },
    { id: 'early', emj: '🌅', t: 'Ранняя пташка', d: 'Пробежка до 7 утра', test: (s, x) => x.early, prog: (s, x) => x.early ? 1 : 0 },
  ];

  function renderAchievements(runs) {
    const s = computeStats(runs);
    const extra = { streak: currentStreak(runs), early: runs.some(r => new Date(r.start).getHours() < 7) };
    $('#pr-list').innerHTML =
      [['1 км', s.best[1000]], ['5 км', s.best[5000]], ['10 км', s.best[10000]], ['Полумарафон', s.best[21097]]]
        .map(([n, t]) => `<div class="effort-row"><div class="med none"></div><div class="lbl">${n}</div><div class="tm mono">${t ? Stats.fmtTime(t) : '—'}</div></div>`).join('') +
      `<div class="effort-row"><div class="med none"></div><div class="lbl">Длиннейшая пробежка</div><div class="tm mono">${(s.longest / 1000).toFixed(2)} км</div></div>` +
      `<div class="effort-row"><div class="med none"></div><div class="lbl">Всего в движении</div><div class="tm mono">${Stats.fmtTime(s.totalTime)}</div></div>`;

    $('#ach-grid').innerHTML = ACHIEVEMENTS.map(a => {
      const done = a.test(s, extra);
      const pr = Math.max(0, Math.min(1, (a.prog(s, extra) || 0)));
      return `<div class="ach ${done ? 'unlocked' : 'locked'}"><div class="emj">${a.emj}</div><div class="t">${a.t}</div><div class="d">${a.d}</div>` +
        `<div class="prog"><i style="width:${(done ? 1 : pr) * 100}%"></i></div></div>`;
    }).join('');
  }

  // ---------- План ----------
  const TYPE_BADGE = { rest: ['#a0a0ab', '😴'], easy: ['#00b16a', '🟢'], long: ['#2f7bff', '🔵'], tempo: ['#f5a623', '🟡'], interval: ['#fc4c02', '🟠'], rep: ['#e0245e', '🔴'], mtempo: ['#2f7bff', '🔷'] };
  function renderPlan(plan) {
    const z = Training.ZONE_META;
    const delta = plan.goalVDOT - plan.currentVDOT;
    let goalNote;
    if (delta <= 0.2) goalNote = '✅ Цель в пределах твоей текущей формы. План закрепит результат и добавит запас.';
    else {
      const need = Math.ceil(delta * 2.5);
      goalNote = plan.weeks.length >= need
        ? `✅ Цель реалистична: прибавка ${delta.toFixed(1)} VDOT за ${plan.weeks.length} нед. достижима при регулярных тренировках.`
        : `⚠️ Цель амбициозна: прибавка ${delta.toFixed(1)} VDOT обычно требует ~${need} недель. За ${plan.weeks.length} нед. возможно, но с запасом усилий — добавь недель или смягчи цель.`;
    }
    const zonesHtml = ['E', 'M', 'T', 'I', 'R'].map(k => `<div class="zone"><div class="dot" style="background:${z[k].color}"></div>` +
      `<div class="info"><div class="n">${z[k].name}</div><div class="desc">${z[k].desc}</div></div>` +
      `<div class="pace mono">${Stats.fmtPace(plan.paces[k])}<small>/км</small></div></div>`).join('');
    const predHtml = plan.predictions.map(p => `<div class="zone"><div class="info"><div class="n">${p.name}</div></div><div class="pace mono">${Stats.fmtTime(p.sec)}</div></div>`).join('');
    const weeksHtml = plan.weeks.map(w => {
      const tag = w.isTaper ? '<span class="pill" style="background:#e6f0ff;color:#2f7bff">подводка</span>'
        : w.isCutback ? '<span class="pill" style="background:#e3f9ef;color:#00b16a">разгрузка</span>' : '';
      const daysHtml = w.days.map(day => {
        const [c, emj] = TYPE_BADGE[day.type] || TYPE_BADGE.easy;
        return `<div class="day ${day.type === 'rest' ? 'rest' : ''}"><div class="dtag"><div class="dn">${day.dow}</div><div class="badge" style="background:${c}22">${emj}</div></div>` +
          `<div class="dbody"><div class="h">${day.title}</div><div class="p">${day.desc}</div></div></div>`;
      }).join('');
      return `<div class="week"><div class="week-title"><span>Неделя ${w.n} ${tag}</span><span class="km">${w.totalKm} км</span></div>${daysHtml}</div>`;
    }).join('');

    $('#plan-result').innerHTML = `
      <div class="card"><h3>📊 Уровень и цель</h3>
        <div class="zone"><div class="info"><div class="n">Текущий уровень</div><div class="desc">по недавнему результату</div></div><div class="pace mono">VDOT ${plan.currentVDOT.toFixed(1)}</div></div>
        <div class="zone"><div class="info"><div class="n">Нужно для цели</div><div class="desc">${Training.distName(plan.cfg.goalDistM)} за ${Stats.fmtTime(plan.cfg.goalTimeSec)}</div></div><div class="pace mono">VDOT ${plan.goalVDOT.toFixed(1)}</div></div>
        <div class="warn" style="margin-top:12px">${goalNote}</div>
        <div class="small-note mt16">Прогноз результатов при текущей форме:</div>
        <div class="zones mt8">${predHtml}</div>
      </div>
      <div class="card"><h3>⏱ Тренировочные темпы</h3><div class="zones">${zonesHtml}</div>
        <div class="small-note mt8">Держи эти темпы на соответствующих тренировках — это ядро методики.</div></div>
      <div class="card"><h3>🗓 План на ${plan.weeks.length} недель</h3>
        <div class="small-note">Лёгкие пробежки строят базу, ключевые (Q) развивают форму, долгая — выносливость. Разгрузочные недели дают восстановиться.</div></div>
      ${weeksHtml}`;
  }

  // ---------- Прочее ----------
  let toastTimer = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400); }
  function switchView(name) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${name}`).classList.add('active');
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    if (name === 'record' && recMap) setTimeout(() => recMap.invalidateSize(), 100);
    window.scrollTo(0, 0);
  }

  return {
    $, $$, ensureRecMap, centerRec, drawRecLine, resetRecLine, routeThumb,
    renderFeed, renderStreakStrip, renderProfile, renderCalendar, calShift,
    renderDetail, renderAchievements, renderPlan, updateRecordLaps,
    toast, switchView, fmtDate, currentStreak
  };
})();
