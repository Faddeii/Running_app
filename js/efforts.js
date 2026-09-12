/* efforts.js — «Лучшие результаты» как в Strava.
   Для каждой стандартной дистанции ищем самый быстрый отрезок ВНУТРИ пробежки
   (скользящее окно), затем ранжируем среди всех пробежек: 1-е место = PR (золото),
   2-е = серебро, 3-е = бронза. */

const Efforts = (() => {
  const DISTS = [
    { m: 400, label: '400 м' },
    { m: 1000, label: '1 км' },
    { m: 2000, label: '2 км' },
    { m: 5000, label: '5 км' },
    { m: 10000, label: '10 км' },
    { m: 15000, label: '15 км' },
    { m: 21097, label: 'Полумарафон' },
    { m: 42195, label: 'Марафон' },
  ];

  // Самый быстрый отрезок длиной >= D внутри пробежки (сек). null если короче.
  function bestEffort(points, D) {
    if (!points || points.length < 2) return null;
    const total = points[points.length - 1].d;
    if (total < D - 1) return null;
    let best = Infinity;
    let j = 0;
    for (let i = 0; i < points.length; i++) {
      if (j < i) j = i;
      while (j < points.length && points[j].d - points[i].d < D) j++;
      if (j >= points.length) break;
      // интерполируем точное время прохождения ровно D от точки i
      const a = points[j - 1], b = points[j];
      const need = points[i].d + D;
      const frac = (need - a.d) / ((b.d - a.d) || 1);
      const tEnd = a.t + (b.t - a.t) * frac;
      const sec = (tEnd - points[i].t) / 1000;
      if (sec > 0 && sec < best) best = sec;
    }
    return isFinite(best) ? best : null;
  }

  // Все лучшие результаты одной пробежки: [{m,label,sec}]
  function runEfforts(run) {
    const out = [];
    for (const d of DISTS) {
      const s = bestEffort(run.points, d.m);
      if (s != null) out.push({ m: d.m, label: d.label, sec: s });
    }
    return out;
  }

  /* Ранжирование по всем пробежкам.
     Возвращает Map runId -> [{m,label,sec,rank}] (rank 1..n, только топ-3 значимы). */
  function computeRanks(runs) {
    const byDist = {}; // m -> [{runId, sec}]
    const cache = {};  // runId -> efforts
    for (const r of runs) {
      const eff = runEfforts(r);
      cache[r.id] = eff;
      for (const e of eff) {
        (byDist[e.m] = byDist[e.m] || []).push({ runId: r.id, sec: e.sec });
      }
    }
    for (const m in byDist) byDist[m].sort((a, b) => a.sec - b.sec);
    const rankOf = {}; // m -> {runId: rank}
    for (const m in byDist) {
      rankOf[m] = {};
      byDist[m].forEach((x, i) => { rankOf[m][x.runId] = i + 1; });
    }
    const perRun = {};
    for (const r of runs) {
      perRun[r.id] = cache[r.id].map(e => ({ ...e, rank: rankOf[e.m][r.id] }));
    }
    return perRun;
  }

  // Медаль по рангу
  function medal(rank) {
    if (rank === 1) return { emj: '🥇', cls: 'gold', label: 'PR' };
    if (rank === 2) return { emj: '🥈', cls: 'silver', label: '2' };
    if (rank === 3) return { emj: '🥉', cls: 'bronze', label: '3' };
    return null;
  }

  return { DISTS, bestEffort, runEfforts, computeRanks, medal };
})();
