/* training.js — научная база тренировок (методика Джека Дэниелса, VDOT).
   Уровень (VDOT) считается по недавнему реальному результату, из него —
   тренировочные темпы и прогноз на другие дистанции. План ведёт от текущей
   формы к цели с прогрессией нагрузки. */

const Training = (() => {

  function vo2FromV(v) { return -4.60 + 0.182258 * v + 0.000104 * v * v; }
  function vFromVO2(vo2) {
    const a = 0.000104, b = 0.182258, c = -(4.60 + vo2);
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  function pctVO2max(tMin) {
    return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  }
  function vdot(distM, timeSec) {
    const tMin = timeSec / 60;
    const v = distM / tMin;
    return vo2FromV(v) / pctVO2max(tMin);
  }
  function paces(vd) {
    const zones = { E: 0.70, M: 0.84, T: 0.88, I: 0.975, R: 1.05 };
    const out = {};
    for (const k in zones) out[k] = 60 / (vFromVO2(zones[k] * vd) / 1000);
    out.M = predict(vd, 42195) / 42.195; // марафонский = прогнозный темп марафона
    return out; // сек/км
  }
  function riegel(baseDistM, baseSec, targetM) { return baseSec * Math.pow(targetM / baseDistM, 1.06); }
  function predict(vd, distM) {
    let lo = 60, hi = 6 * 3600;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (vdot(distM, mid) > vd) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function distName(m) {
    if (Math.abs(m - 21097) < 60) return 'Полумарафон';
    if (Math.abs(m - 42195) < 80) return 'Марафон';
    return (m / 1000).toFixed(m % 1000 === 0 ? 0 : 1) + ' км';
  }

  const ZONE_META = {
    E: { name: 'Лёгкий (E)', color: '#00b16a', desc: 'Восстановление, база выносливости' },
    M: { name: 'Марафонский (M)', color: '#2f7bff', desc: 'Целевой темп на длинных' },
    T: { name: 'Пороговый (T)', color: '#f5a623', desc: 'Темповый бег, «комфортно тяжело»' },
    I: { name: 'Интервальный (I)', color: '#fc4c02', desc: 'МПК, отрезки 3–5 мин' },
    R: { name: 'Повторный (R)', color: '#e0245e', desc: 'Скорость и экономичность' },
  };

  /* cfg: {currentDistM, currentTimeSec, goalDistM, goalTimeSec, days, weeks, startVolume, longDay} */
  function buildPlan(cfg) {
    const currentVDOT = (cfg.currentTimeSec > 0)
      ? vdot(cfg.currentDistM, cfg.currentTimeSec)
      : vdot(cfg.goalDistM, cfg.goalTimeSec);
    const goalVDOT = vdot(cfg.goalDistM, cfg.goalTimeSec);

    const p = paces(currentVDOT);
    const goalP = paces(goalVDOT);
    const dists = [5000, 10000, 21097, 42195];
    if (!dists.some(d => Math.abs(d - cfg.goalDistM) < 60)) dists.push(cfg.goalDistM);
    const predictions = dists.sort((a, b) => a - b).map(d => ({ distM: d, name: distName(d), sec: predict(currentVDOT, d) }));

    // базовый объём
    const auto = { 5000: 25, 10000: 35, 21097: 50, 42195: 70 };
    let baseVol = cfg.startVolume > 0 ? cfg.startVolume
      : (auto[Math.round(cfg.goalDistM)] || Math.max(20, Math.round(cfg.goalDistM / 1000 * 3.5)));

    const weeksN = cfg.weeks, daysN = cfg.days;
    const weeks = [];
    for (let w = 1; w <= weeksN; w++) {
      const isTaper = w === weeksN;
      const isCutback = (w % 4 === 0) && !isTaper;
      const phase = w <= weeksN * 0.35 ? 1 : w <= weeksN * 0.75 ? 2 : 3;

      // прогрессия VDOT от текущего к целевому (тренируемся всё быстрее)
      const prog = weeksN > 1 ? (w - 1) / (weeksN - 1) : 0;
      const vdW = Math.max(currentVDOT, currentVDOT + (goalVDOT - currentVDOT) * prog);
      const pw = paces(vdW);

      let vol = baseVol * Math.pow(1.08, w - 1);
      if (isCutback) vol *= 0.75;
      if (isTaper) vol *= 0.55;
      vol = Math.round(vol);

      const days = buildWeek({ phase, isTaper, daysN, cfg, p: pw, vol, weekNo: w });
      const totalKm = days.reduce((s, d) => s + (d.km || 0), 0);
      weeks.push({ n: w, totalKm: Math.round(totalKm), phase, isTaper, isCutback, days });
    }

    return { currentVDOT, goalVDOT, vdot: currentVDOT, paces: p, goalPaces: goalP, predictions, cfg, weeks };
  }

  function buildWeek({ phase, isTaper, daysN, cfg, p, vol, weekNo }) {
    const longKm = Math.max(6, Math.round(vol * (cfg.goalDistM >= 21097 ? 0.35 : 0.3)));
    const qType = phase === 1 ? 'T' : phase === 2 ? 'I' : (weekNo % 2 ? 'I' : 'M');
    const qCount = daysN >= 4 ? 2 : 1;

    // шаблоны с длинной (L) в воскресенье (индекс 6), затем поворот на нужный день
    const templates = {
      3: ['Q', 'R', 'E', 'R', 'Q', 'R', 'L'],
      4: ['Q', 'E', 'R', 'Q', 'R', 'E', 'L'],
      5: ['Q', 'E', 'E', 'Q', 'R', 'E', 'L'],
      6: ['Q', 'E', 'E', 'Q', 'E', 'E', 'L'],
      7: ['E', 'Q', 'E', 'E', 'Q', 'E', 'L'],
    };
    const base = templates[daysN] || templates[4];
    const k = ((cfg.longDay - 6) % 7 + 7) % 7; // сдвиг, чтобы L попал на выбранный день
    const tpl = new Array(7);
    for (let i = 0; i < 7; i++) tpl[(i + k) % 7] = base[i];

    const easyBudget = Math.max(0, vol - longKm);
    const easyDaysCount = tpl.filter(x => x === 'E').length || 1;
    const easyKm = Math.max(4, Math.round((easyBudget * 0.55) / easyDaysCount));

    const dowNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    let qUsed = 0;
    return tpl.map((slot, i) => {
      const dow = dowNames[i];
      if (slot === 'R') return { dow, type: 'rest', title: 'Отдых', desc: 'Восстановление. Лёгкая растяжка или ходьба.', km: 0 };
      if (slot === 'L') return {
        dow, type: 'long', title: `Долгая ${longKm} км`,
        desc: `Ровный лёгкий темп ${Stats.fmtPace(p.E)}/км. Последние 2–3 км можно ускориться до ${Stats.fmtPace(p.M)}/км.`, km: longKm
      };
      if (slot === 'E') return {
        dow, type: 'easy', title: `Лёгкий бег ${easyKm} км`,
        desc: `Разговорный темп ${Stats.fmtPace(p.E)}/км. Строит базу и восстанавливает.`, km: easyKm
      };
      // Q
      qUsed++;
      if (qUsed > qCount) return {
        dow, type: 'easy', title: `Лёгкий бег ${easyKm} км`,
        desc: `Разговорный темп ${Stats.fmtPace(p.E)}/км.`, km: easyKm
      };
      return keyWorkout(qType, dow, p, isTaper, cfg);
    });
  }

  function keyWorkout(type, dow, p, isTaper, cfg) {
    const wu = 'разминка 10–15 мин трусцой + суставная гимнастика';
    const cd = 'заминка 10 мин трусцой';
    if (type === 'T') {
      const reps = isTaper ? 2 : 3, min = 8;
      return {
        dow, type: 'tempo', title: `Пороговый: ${reps}×${min} мин`,
        desc: `${wu}. Затем ${reps} отрезка по ${min} мин в темпе ${Stats.fmtPace(p.T)}/км через 2 мин трусцы. ${cd}.`,
        km: Math.round(reps * min * (1000 / (p.T / 60)) / 1000) + 4
      };
    }
    if (type === 'I') {
      const reps = isTaper ? 4 : 5;
      return {
        dow, type: 'interval', title: `Интервалы: ${reps}×1000 м`,
        desc: `${wu}. Затем ${reps}×1000 м в темпе ${Stats.fmtPace(p.I)}/км, отдых 400 м трусцой. ${cd}.`,
        km: reps + Math.round(reps * 0.4) + 4
      };
    }
    if (type === 'R') {
      const reps = 8;
      return {
        dow, type: 'rep', title: `Повторы: ${reps}×400 м`,
        desc: `${wu}. Затем ${reps}×400 м в темпе ${Stats.fmtPace(p.R)}/км, полный отдых 400 м. ${cd}.`, km: 8
      };
    }
    const mkm = cfg.goalDistM >= 42195 ? 16 : 10;
    return {
      dow, type: 'mtempo', title: `Марафонский темп ${mkm} км`,
      desc: `${wu}. ${mkm} км в целевом темпе ${Stats.fmtPace(p.M)}/км. ${cd}.`, km: mkm + 3
    };
  }

  return { vdot, paces, riegel, predict, buildPlan, distName, ZONE_META };
})();
