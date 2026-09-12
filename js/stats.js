/* stats.js — форматирование и производные метрики */

const Stats = (() => {

  // Секунды -> "M:SS" или "H:MM:SS"
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Темп (сек на км) -> "M:SS"
  function fmtPace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '—:—';
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    if (s === 60) return `${m + 1}:00`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Дистанция в метрах -> км с 2 знаками
  function fmtKm(meters) { return (meters / 1000).toFixed(2); }

  // Темп = сек/км при дистанции (м) и времени (сек)
  function pace(meters, sec) {
    if (meters < 5) return 0;
    return sec / (meters / 1000);
  }

  // Скорость км/ч
  function speedKmh(meters, sec) {
    if (sec <= 0) return 0;
    return (meters / 1000) / (sec / 3600);
  }

  /* Калории для бега (формула по MET на основе скорости и веса).
     kcal = MET * вес(кг) * часы. MET оцениваем по скорости бега. */
  function kcal(meters, movingSec, weightKg) {
    if (movingSec <= 0 || meters < 10) return 0;
    const kmh = speedKmh(meters, movingSec);
    let met;
    if (kmh < 6.4) met = 6.0;
    else if (kmh < 8.0) met = 8.3;
    else if (kmh < 9.7) met = 9.8;
    else if (kmh < 11.3) met = 11.0;
    else if (kmh < 12.9) met = 11.8;
    else if (kmh < 14.5) met = 12.8;
    else if (kmh < 16.1) met = 14.5;
    else met = 16.0;
    return Math.round(met * weightKg * (movingSec / 3600));
  }

  /* Разбивка трека на отрезки по километрам.
     points: [{lat,lng,t,d}] где d — накопленная дистанция (м), t — время (мс).
     startTime — метка старта (мс). Возвращает массив сплитов с темпом. */
  function splits(points, startTime) {
    if (!points || points.length < 2) return [];
    const res = [];
    let target = 1000;         // следующая отметка км, м
    let prevTime = startTime;
    let prevDist = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      while (b.d >= target) {
        // линейно интерполируем момент пересечения отметки target
        const frac = (target - a.d) / (b.d - a.d || 1);
        const crossT = a.t + (b.t - a.t) * frac;
        const segSec = (crossT - prevTime) / 1000;
        res.push({ km: res.length + 1, dist: 1000, sec: segSec, pace: segSec });
        prevTime = crossT;
        prevDist = target;
        target += 1000;
      }
    }
    // остаток (неполный последний километр)
    const lastD = points[points.length - 1].d;
    if (lastD - prevDist > 50) {
      const segSec = (points[points.length - 1].t - prevTime) / 1000;
      const rem = lastD - prevDist;
      res.push({ km: res.length + 1, dist: rem, sec: segSec, pace: segSec / (rem / 1000), partial: true });
    }
    return res;
  }

  // Название пробежки по времени суток (как в Strava)
  function runName(ts) {
    const h = new Date(ts).getHours();
    if (h >= 5 && h < 12) return 'Утренний забег';
    if (h >= 12 && h < 17) return 'Дневной забег';
    if (h >= 17 && h < 22) return 'Вечерний забег';
    return 'Ночной забег';
  }

  // Абсолютное время (мс) прохождения дистанции D от старта — интерполяция
  function timeAt(points, D) {
    if (!points.length) return null;
    if (D <= 0) return points[0].t;
    for (let i = 1; i < points.length; i++) {
      if (points[i].d >= D) {
        const a = points[i - 1], b = points[i];
        const frac = (D - a.d) / ((b.d - a.d) || 1);
        return a.t + (b.t - a.t) * frac;
      }
    }
    return points[points.length - 1].t;
  }

  // Темп по бакетам дистанции для графика: [{d(м), pace(сек/км)}]
  function paceBuckets(points, bucket = 200) {
    if (!points || points.length < 2) return [];
    const total = points[points.length - 1].d;
    if (total < bucket) return [];
    const res = [];
    for (let d = 0; d + bucket <= total + 1; d += bucket) {
      const t1 = timeAt(points, d), t2 = timeAt(points, d + bucket);
      const sec = (t2 - t1) / 1000;
      if (sec > 0) res.push({ d: d + bucket, pace: sec / (bucket / 1000) });
    }
    return res;
  }

  return { fmtTime, fmtPace, fmtKm, pace, speedKmh, kcal, splits, runName, timeAt, paceBuckets };
})();
