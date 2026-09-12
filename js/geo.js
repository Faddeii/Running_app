/* geo.js — точная геометрия маршрута и сглаживание GPS.
   Задача: чтобы реально пробежанные 400 м показывались как ~400 м,
   а не раздувались из-за шума GPS и не занижались из-за пересглаживания. */

const Geo = (() => {
  const R = 6371008.8; // радиус Земли, м (средний)

  // Расстояние между двумя точками по формуле гаверсинуса, метры
  function haversine(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* Фильтр Калмана для GPS (стандартная реализация для координат).
     q — предполагаемая максимальная скорость движения (м/с), влияет на «доверие»
     новым замерам. Для бега 3 м/с — хороший баланс. */
  class GpsKalman {
    constructor(qMetersPerSecond = 3) {
      this.q = qMetersPerSecond;
      this.variance = -1; // отрицательная = ещё не инициализирован
      this.lat = 0; this.lng = 0; this.timestamp = 0;
    }
    reset() { this.variance = -1; }
    process(lat, lng, accuracy, timestamp) {
      if (accuracy < 1) accuracy = 1;
      if (this.variance < 0) {
        this.lat = lat; this.lng = lng;
        this.variance = accuracy * accuracy;
        this.timestamp = timestamp;
      } else {
        const dt = (timestamp - this.timestamp) / 1000;
        if (dt > 0) {
          this.variance += dt * this.q * this.q;
          this.timestamp = timestamp;
        }
        const k = this.variance / (this.variance + accuracy * accuracy);
        this.lat += k * (lat - this.lat);
        this.lng += k * (lng - this.lng);
        this.variance = (1 - k) * this.variance;
      }
      return { lat: this.lat, lng: this.lng };
    }
  }

  /* Обработчик трека в реальном времени: принимает сырые точки геолокации,
     фильтрует, сглаживает и накапливает достоверную дистанцию. */
  class TrackProcessor {
    constructor(opts = {}) {
      // максимальная точность (радиус ошибки), выше которой точка отбрасывается
      this.maxAccuracy = opts.maxAccuracy || 25;   // м
      // минимальный сдвиг, чтобы засчитать его как реальное движение (антидрожание)
      this.minStep = opts.minStep || 2.5;          // м
      // максимально правдоподобная скорость бега (защита от GPS-скачков)
      this.maxSpeed = opts.maxSpeed || 11;         // м/с (~40 км/ч)
      // сколько хороших замеров нужно на прогрев перед стартом счёта
      this.warmupNeeded = opts.warmup || 3;
      this.reset();
    }
    reset() {
      this.kalman = new GpsKalman(3);
      this.points = [];       // принятые сглаженные точки {lat,lng,t,d} для рисования
      this.distance = 0;      // суммарная дистанция, м
      this.last = null;       // последняя принятая точка
      this.warmup = 0;
      this.lastAccuracy = null;
    }
    // Пометить разрыв трека: следующая точка станет новой опорной
    // (без соединяющей прямой и без учёта пропущенной дистанции). Для авто-паузы.
    markBreak() { this._break = true; }

    // add(raw, storeT): storeT — метка времени для хранения точки (время «по движению»,
    // исключающее паузы). Для расчёта скорости/сглаживания используется реальное время GPS.
    add(raw, storeT) {
      const { latitude, longitude, accuracy } = raw.coords;
      const t = raw.timestamp;
      const pt = (storeT != null) ? storeT : t;
      this.lastAccuracy = accuracy;

      const quality = accuracy <= 8 ? 'good' : accuracy <= 20 ? 'ok' : 'bad';

      // 1) отбрасываем заведомо плохие по точности
      if (accuracy > this.maxAccuracy) {
        return { accepted: false, distance: this.distance, quality, reason: 'accuracy' };
      }

      // 0) разрыв после авто-паузы: переустанавливаем опору, дистанцию не копим
      if (this._break) {
        this.kalman.reset();
        const sm0 = this.kalman.process(latitude, longitude, accuracy, t);
        this.last = { lat: sm0.lat, lng: sm0.lng, t };
        this.points.push({ lat: sm0.lat, lng: sm0.lng, t: pt, d: this.distance, brk: true });
        this._break = false;
        return { accepted: false, distance: this.distance, quality, reason: 'break', point: sm0 };
      }

      // 2) прогрев — даём GPS «устаканиться», точки собираем, но дистанцию не копим
      const sm = this.kalman.process(latitude, longitude, accuracy, t);

      if (this.warmup < this.warmupNeeded) {
        this.warmup++;
        this.last = { lat: sm.lat, lng: sm.lng, t };
        if (this.warmup === this.warmupNeeded) {
          this.points.push({ lat: sm.lat, lng: sm.lng, t: pt, d: 0 });
        }
        return { accepted: false, distance: this.distance, quality, reason: 'warmup', point: sm };
      }

      const prev = this.last;
      const step = haversine(prev.lat, prev.lng, sm.lat, sm.lng);
      const dt = (t - prev.t) / 1000;
      const speed = dt > 0 ? step / dt : 0;

      // 3) защита от нереальных скачков GPS
      if (speed > this.maxSpeed) {
        return { accepted: false, distance: this.distance, quality, reason: 'jump', point: sm };
      }

      // 4) антидрожание: слишком маленький сдвиг — считаем стоянием на месте
      if (step < this.minStep) {
        this.last = { lat: sm.lat, lng: sm.lng, t };
        return { accepted: false, distance: this.distance, quality, reason: 'jitter', point: sm };
      }

      // 5) принимаем движение
      this.distance += step;
      this.last = { lat: sm.lat, lng: sm.lng, t };
      this.points.push({ lat: sm.lat, lng: sm.lng, t: pt, d: this.distance });
      return { accepted: true, distance: this.distance, step, speed, quality, point: sm };
    }
    latlngs() { return this.points.map(p => [p.lat, p.lng]); }
    // Сегменты трека, разбитые по разрывам (для рисования линии без прямых через паузы)
    latlngSegments() {
      const segs = []; let cur = [];
      for (const p of this.points) {
        if (p.brk && cur.length) { segs.push(cur); cur = []; }
        cur.push([p.lat, p.lng]);
      }
      if (cur.length) segs.push(cur);
      return segs;
    }
  }

  // Границы трека для вписывания карты
  function bounds(points) {
    if (!points.length) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const p of points) {
      const lat = p.lat ?? p[0], lng = p.lng ?? p[1];
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    }
    return [[minLat, minLng], [maxLat, maxLng]];
  }

  return { haversine, GpsKalman, TrackProcessor, bounds };
})();
