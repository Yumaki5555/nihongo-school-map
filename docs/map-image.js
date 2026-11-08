/* 保存用の画像（PNG 1600×900）を端末の中だけで描く。種類：
   schools＝全国の学校分布（都道府県ごとの校数の色分け）／stats＝全国の人数分布（国の統計）／
   region＝選択した地域（市区町村の境界・線路・駅・地名と学校の点）／chart＝地域の地図データが読めないときの校数のグラフ／
   ranking＝ランキングのページの上位（ranking.js が渡す。これだけ縦長 1080×1350）。
   地図タイルは使わない。境界・線路・駅は国土数値情報（国土交通省）を加工したデータで、site.js が同じサイトから読み込んで渡す。
   外部への通信はしない。数字はすべて site.js が画面と同じデータから渡す。
   スマホで縮めて見ても読めるよう、文字は大きめにする（いちばん小さい出典でも17px）。 */
window.MapImage = (function () {
  "use strict";
  const W = 1600, H = 900;
  const TOP = 168, BOT = 806; // 地図と説明の欄の上端・下端
  const LAYOUT = {
    nation: { M: { x: 24, y: TOP, w: 780, h: BOT - TOP }, P: { x: 838, y: TOP, w: 738, h: BOT - TOP } },
    region: { M: { x: 24, y: TOP, w: 1010, h: BOT - TOP }, P: { x: 1066, y: TOP, w: 510, h: BOT - TOP } },
  };
  const NATION = { n: 45.8, s: 30.0, w: 128.2, e: 146.4 };
  const OKINAWA = { n: 28.6, s: 24.0, w: 122.7, e: 131.4 };
  const OKI = "47";
  const MAX_SCALE = Math.pow(2, 15);
  const FONT = '"Yu Gothic UI","Hiragino Sans","Meiryo","Noto Sans CJK JP","Noto Sans JP",system-ui,sans-serif';
  const C = { bg: "#FFFDF6", ink: "#352D20", muted: "#5C5140", brand: "#79591F", accent: "#E5C66E", line: "#D5BA79", soft: "#FFF5D9", sea: "#D9E6EF", land: "#F6F1E4", border: "#8A7A55", white: "#FFFFFF", rail: "#9C9384", city: "#B3A483", bar: "#4580B5" };
  // 地図の出典（国土交通省の指示どおり、加工したことを書く）
  const CREDIT = {
    border: "境界：国土数値情報（行政区域データ）国土交通省を加工",
    region: "地図：国土数値情報（行政区域データ 2021年・鉄道データ 2024年）国土交通省を加工／位置：位置参照情報 国土交通省を加工",
  };
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const font = (px, bold) => `${bold ? 700 : 500} ${px}px ${FONT}`;

  // 幅に入るまで文字を小さくする（下限より小さくはしない）
  function fitFont(ctx, text, maxW, px, min, bold) {
    let p = px;
    ctx.font = font(p, bold);
    while (ctx.measureText(text).width > maxW && p > min) { p -= 1; ctx.font = font(p, bold); }
    return p;
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    let cur = "";
    for (const ch of text) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // 注意書き：全文が bottom までに入る大きさで書く（17pxでも入らなければ書かない）。次の行の位置を返す
  function drawNote(ctx, text, x, y, maxW, px, bottom, bold) {
    for (let p = px; p >= 17; p--) {
      ctx.font = font(p, bold);
      const lh = Math.round(p * 1.38);
      const lines = wrap(ctx, text, maxW);
      if (y + (lines.length - 1) * lh <= bottom) { lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh)); return y + lines.length * lh; }
    }
    return y;
  }

  function hr(ctx, x, y, w) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y);
    ctx.lineWidth = 1; ctx.strokeStyle = C.line; ctx.stroke();
  }

  // 白い縁取りの文字（地図の上の地名・駅名）
  function haloText(ctx, text, x, y, px, bold, color) {
    ctx.font = font(px, bold);
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(4, px * 0.28); ctx.strokeStyle = "rgba(255,255,255,.94)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function drawShape(ctx, g, x, y, size, rough) {
    const s = size / 2;
    ctx.beginPath();
    if (g.shape === "circle") ctx.arc(x, y, s * 0.82, 0, Math.PI * 2);
    else if (g.shape === "square") ctx.rect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
    else { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
    const lw = Math.max(1.4, size / 9);
    if (rough) {
      ctx.fillStyle = C.white; ctx.fill();
      ctx.lineWidth = lw * 1.4; ctx.strokeStyle = g.color; ctx.stroke();
    } else {
      ctx.fillStyle = g.color; ctx.fill();
      ctx.lineWidth = lw; ctx.strokeStyle = C.white; ctx.stroke();
    }
  }

  // 緯度経度の範囲 f を枠 R にちょうど収める変換
  function projector(f, R) {
    const crs = L.CRS.EPSG3857;
    const world = (la, ln) => crs.latLngToPoint(L.latLng(la, ln), 0);
    const nw = world(f.n, f.w), se = world(f.s, f.e);
    const k = Math.min(R.w / Math.max(se.x - nw.x, 1e-9), R.h / Math.max(se.y - nw.y, 1e-9), MAX_SCALE);
    const cx = (nw.x + se.x) / 2, cy = (nw.y + se.y) / 2;
    const px = (la, ln) => { const p = world(la, ln); return [R.x + R.w / 2 + (p.x - cx) * k, R.y + R.h / 2 + (p.y - cy) * k]; };
    const ll = (x, y) => crs.pointToLatLng(L.point(cx + (x - R.x - R.w / 2) / k, cy + (y - R.y - R.h / 2) / k), 0);
    return { k, px, ll };
  }

  function path(ctx, f, px) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    ctx.beginPath();
    polys.forEach((poly) => poly.forEach((ring) => {
      ring.forEach((c, i) => { const [x, y] = px(c[1], c[0]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }));
  }

  // 都道府県を描く。opt.fill＝色分け
  function drawLand(ctx, spec, px, opt) {
    spec.geo.features.forEach((f) => {
      const code = f.properties.code;
      path(ctx, f, px);
      ctx.fillStyle = C.land; ctx.fill("evenodd");
      if (opt.fill) { ctx.globalAlpha = opt.fillOpacity; ctx.fillStyle = opt.fill(code); ctx.fill("evenodd"); ctx.globalAlpha = 1; }
      ctx.lineWidth = 1.3; ctx.strokeStyle = C.border; ctx.stroke();
    });
    if (opt.selected) {
      const f = spec.geo.features.find((x) => x.properties.code === opt.selected);
      if (f) { path(ctx, f, px); ctx.lineWidth = opt.selWidth || 4; ctx.strokeStyle = C.ink; ctx.stroke(); }
    }
  }

  // 枠の中だけに描く
  function frame(ctx, R, draw, bg) {
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
    ctx.fillStyle = bg || C.sea; ctx.fillRect(R.x, R.y, R.w, R.h);
    draw();
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.line; ctx.strokeRect(R.x, R.y, R.w, R.h);
  }

  // 全国の地図（A・B）。沖縄県は左上の枠に入れる。数字の丸は使わず、色の濃さだけで表す
  function drawNation(ctx, spec, M) {
    const opt = { fill: spec.fill, fillOpacity: spec.fillOpacity, selected: spec.selected };
    const I = { x: M.x + 12, y: M.y + 12, w: 300, h: 176 };
    frame(ctx, M, () => {
      drawLand(ctx, spec, projector(NATION, M).px, opt);
      frame(ctx, I, () => {
        drawLand(ctx, spec, projector(OKINAWA, I).px, Object.assign({}, opt, { selWidth: 2.5 }));
        ctx.fillStyle = C.ink; ctx.font = font(22, true);
        ctx.fillText("沖縄県", I.x + 10, I.y + 30);
      });
    });
  }

  // ---- 選択した地域（C） ----
  // 市区町村の形：線（arc）の番号から輪を組み立てる
  function cityPath(ctx, c, arcs, px) {
    ctx.beginPath();
    c.r.forEach((poly) => poly.forEach((ring) => {
      let first = true;
      ring.forEach((a) => {
        const seq = a >= 0 ? arcs[a] : arcs[~a].slice().reverse();
        seq.forEach((p, i) => {
          if (i === 0 && !first) return;
          const [x, y] = px(p[1], p[0]);
          if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
        });
      });
      ctx.closePath();
    }));
  }

  function strokeArc(ctx, pts, px) {
    pts.forEach((p, i) => { const [x, y] = px(p[1], p[0]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  }

  // 点が多い所に文字を重ねないよう、候補の位置から点のいちばん少ない所を選ぶ（ほかの文字と重なる所は使わない）
  function placeLabel(ctx, taken, pts, M, text, px, bold, ax, ay, offsets) {
    ctx.font = font(px, bold);
    const w = ctx.measureText(text).width, h = px;
    let best = null;
    offsets.forEach(([dx, dy, align]) => {
      const x = align === "right" ? ax + dx - w : align === "center" ? ax + dx - w / 2 : ax + dx;
      const y = ay + dy;
      const r = { x: x - 4, y: y - h - 2, w: w + 8, h: h + 8 };
      if (r.x < M.x + 4 || r.x + r.w > M.x + M.w - 4 || r.y < M.y + 4 || r.y + r.h > M.y + M.h - 4) return;
      if (taken.some((t) => r.x < t.x + t.w && t.x < r.x + r.w && r.y < t.y + t.h && t.y < r.y + r.h)) return;
      const cover = pts.filter((q) => q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h).length;
      if (!best || cover < best.cover) best = { x, y, r, cover };
    });
    if (best) taken.push(best.r);
    return best;
  }

  // 縮尺の目盛りの長さ（切りのよい距離）
  function scaleBar(pr, M) {
    const mid = pr.ll(M.x + M.w / 2, M.y + M.h / 2);
    const mpp = (40075016.686 * Math.cos((mid.lat * Math.PI) / 180)) / (256 * pr.k);
    const target = mpp * 150;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const m = [1, 2, 5, 10].map((x) => x * p).filter((x) => x <= target * 1.4).pop();
    return { px: m / mpp, label: m >= 1000 ? `${fmt(m / 1000)}km` : `${fmt(m)}m` };
  }

  // 地域の地図。地域の外の学校は描かない。地図の外に出た地域内の学校の数を返す
  function drawRegion(ctx, spec, M) {
    const pr = projector(spec.bounds, M);
    const cityMode = !!spec.city;
    const own = spec.local[0];
    const selCity = cityMode ? own.cities.find((c) => c.c === spec.city) : null;
    const detailed = new Set(spec.local.map((f) => f.code));
    // 学校の点（同じ位置の学校は少しずつずらして、1校1つの印にする）
    const size = cityMode ? 20 : 13;
    let outside = 0;
    const pts = [];
    const seen = {};
    spec.points.forEach((p) => {
      let [x, y] = pr.px(p.la, p.ln);
      if (x < M.x || x > M.x + M.w || y < M.y || y > M.y + M.h) { outside++; return; }
      const key = Math.round(x / 3) + ":" + Math.round(y / 3);
      const n = seen[key] = (seen[key] || 0) + 1;
      if (n > 1) { const a = n * 2.4, r = size * 0.45 * Math.sqrt(n - 1); x += Math.cos(a) * r; y += Math.sin(a) * r; }
      pts.push({ x, y, p });
    });
    frame(ctx, M, () => {
      // 1) 地図データのない県は都道府県の形で（遠くの県だけなので粗くても目立たない）
      spec.geo.features.forEach((f) => {
        if (detailed.has(f.properties.code)) return;
        path(ctx, f, pr.px);
        ctx.fillStyle = C.land; ctx.fill("evenodd");
        ctx.globalAlpha = 0.5; ctx.fillStyle = C.white; ctx.fill("evenodd"); ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6; ctx.strokeStyle = C.border; ctx.stroke();
      });
      // 2) 市区町村（選んだ地域の外は白く薄める）
      spec.local.forEach((file) => file.cities.forEach((c) => {
        cityPath(ctx, c, file.arcs, pr.px);
        ctx.fillStyle = C.land; ctx.fill("evenodd");
        const inside = cityMode ? c.c === spec.city : file.code === spec.pref;
        if (!inside) { ctx.globalAlpha = 0.5; ctx.fillStyle = C.white; ctx.fill("evenodd"); ctx.globalAlpha = 1; }
      }));
      // 3) 線路
      const rw = cityMode ? 2.2 : 1.4;
      const drawn = new Set();
      spec.local.forEach((file) => file.rails.forEach((r) => {
        const key = r.p[0].join() + r.p[r.p.length - 1].join();
        if (drawn.has(key)) return;
        drawn.add(key);
        ctx.beginPath(); strokeArc(ctx, r.p, pr.px);
        ctx.lineWidth = r.k ? rw + 0.8 : rw; ctx.strokeStyle = C.rail; ctx.stroke();
      }));
      // 4) 境界線（市区町村の境は細く、県の外周は太く）
      spec.local.forEach((file) => {
        [0, 1].forEach((k) => {
          ctx.beginPath();
          file.lines.forEach(([a, kk]) => { if (kk === k) strokeArc(ctx, file.arcs[a], pr.px); });
          ctx.lineWidth = k ? 2.2 : cityMode ? 1.6 : 1.1; ctx.strokeStyle = k ? C.border : C.city; ctx.stroke();
        });
      });
      // 5) 選んだ地域の境界を太く
      ctx.lineJoin = "round";
      if (selCity) { cityPath(ctx, selCity, own.arcs, pr.px); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke(); }
      else {
        ctx.beginPath();
        own.lines.forEach(([a, k]) => { if (k) strokeArc(ctx, own.arcs[a], pr.px); });
        ctx.lineWidth = 4.5; ctx.strokeStyle = C.ink; ctx.stroke();
      }
      // 6) 学校の点
      pts.forEach((q) => drawShape(ctx, spec.groups[q.p.g], q.x, q.y, size, q.p.rough));
      // 7) 地名と駅名（点の少ない位置に置く）
      const taken = [];
      const legendBox = legendSize(ctx, spec, cityMode);
      const corner = bestCorner(M, legendBox, pts);
      taken.push({ x: corner[0], y: corner[1], w: legendBox.w, h: legendBox.h });
      const around = (d) => [[0, d * 0.4, "center"], [0, -d * 1.3, "center"], [0, d * 2.1, "center"], [d * 1.6, d * 0.4, "left"], [-d * 1.6, d * 0.4, "right"]];
      const labels = [];
      const cities = [];
      spec.local.forEach((file) => file.cities.forEach((c) => cities.push(c)));
      if (cityMode) {
        labels.push({ text: selCity ? selCity.n : "", la: selCity ? selCity.lp[0] : 0, ln: selCity ? selCity.lp[1] : 0, px: 34, color: C.ink });
        cities.filter((c) => c !== selCity).forEach((c) => labels.push({ text: c.n, la: c.lp[0], ln: c.lp[1], px: 24, color: C.muted }));
      } else {
        const counts = spec.cityCounts;
        cities.filter((c) => counts[c.c]).sort((a, b) => counts[b.c] - counts[a.c]).slice(0, 10)
          .forEach((c) => labels.push({ text: c.n, la: c.lp[0], ln: c.lp[1], px: 24, color: C.ink }));
      }
      const placed = [];
      labels.forEach((l) => {
        if (!l.text) return;
        const [x, y] = pr.px(l.la, l.ln);
        const b = placeLabel(ctx, taken, pts, M, l.text, l.px, true, x, y, around(l.px * 0.5));
        if (b) placed.push(Object.assign(b, l));
      });
      // 駅：乗り入れる路線の多い順（市区町村の画像では、その市区町村の中の駅を先に）
      const stations = [];
      const seenSt = new Set();
      spec.local.forEach((file) => file.stations.forEach((s) => {
        const key = s.n + Math.round(s.la * 200) + Math.round(s.ln * 200);
        if (seenSt.has(key)) return;
        seenSt.add(key);
        const [x, y] = pr.px(s.la, s.ln);
        if (x < M.x + 10 || x > M.x + M.w - 10 || y < M.y + 10 || y > M.y + M.h - 10) return;
        const bonus = (cityMode ? s.c === spec.city : file.code === spec.pref && !!s.c) ? 3 : 0;
        stations.push({ s, x, y, score: s.k + bonus });
      }));
      stations.sort((a, b) => b.score - a.score || a.s.n.localeCompare(b.s.n));
      const maxSt = cityMode ? 9 : 5;
      const r = cityMode ? 7 : 5.5;
      let nSt = 0;
      stations.forEach((st) => {
        if (nSt >= maxSt) return;
        const px = cityMode ? 22 : 20;
        const b = placeLabel(ctx, taken, pts, M, st.s.n + "駅", px, true, st.x, st.y, [[r + 6, px * 0.36, "left"], [-r - 6, px * 0.36, "right"], [0, -r - 8, "center"], [0, r + px + 4, "center"]]);
        if (!b) return;
        nSt++;
        ctx.beginPath(); ctx.arc(st.x, st.y, r, 0, Math.PI * 2);
        ctx.fillStyle = C.white; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
        placed.push(Object.assign(b, { text: st.s.n + "駅", px, color: C.ink, station: true }));
      });
      placed.forEach((l) => haloText(ctx, l.text, l.x, l.y, l.px, true, l.color));
      drawLegend(ctx, spec, cityMode, corner, legendBox, scaleBar(pr, M), nSt > 0);
    });
    return outside;
  }

  // 地図の中の凡例（白抜き・駅・太線・縮尺）
  function legendRows(spec, cityMode) {
    const rows = [["rough", "白抜き＝町名の代表点"], ["station", "灰色の線＝線路"], ["bold", `太線＝${cityMode ? spec.cityName : spec.prefName}の境界`], ["scale", ""]];
    return rows;
  }
  function legendSize(ctx, spec, cityMode) {
    ctx.font = font(20);
    const rows = legendRows(spec, cityMode);
    return { w: 58 + Math.max(...rows.map((l) => ctx.measureText(l[1]).width), 150) + 18, h: rows.length * 32 + 12 };
  }
  function bestCorner(M, box, pts) {
    const corners = [[M.x + 10, M.y + M.h - box.h - 10], [M.x + M.w - box.w - 10, M.y + M.h - box.h - 10], [M.x + 10, M.y + 10], [M.x + M.w - box.w - 10, M.y + 10]];
    const busy = (c) => pts.filter((q) => q.x > c[0] - 40 && q.x < c[0] + box.w + 40 && q.y > c[1] - 40 && q.y < c[1] + box.h + 40).length;
    return corners.reduce((a, c) => (busy(c) < busy(a) ? c : a));
  }
  function drawLegend(ctx, spec, cityMode, [bx, by], box, bar, hasStation) {
    ctx.fillStyle = "rgba(255,255,255,.93)"; ctx.fillRect(bx, by, box.w, box.h);
    ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; ctx.strokeRect(bx, by, box.w, box.h);
    legendRows(spec, cityMode).forEach((l, i) => {
      const cy = by + 28 + i * 32, cx = bx + 28;
      ctx.fillStyle = C.ink; ctx.font = font(20);
      if (l[0] === "rough") drawShape(ctx, spec.groups.jp, cx, cy - 7, 20, true);
      else if (l[0] === "station") {
        // 駅名を1つも置けなかったときは、線路の見本だけにする
        ctx.beginPath(); ctx.moveTo(cx - 20, cy - 7); ctx.lineTo(cx + 20, cy - 7); ctx.lineWidth = 2.2; ctx.strokeStyle = C.rail; ctx.stroke();
        if (hasStation) { ctx.beginPath(); ctx.arc(cx, cy - 7, 6, 0, Math.PI * 2); ctx.fillStyle = C.white; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke(); }
        ctx.fillStyle = C.ink; ctx.font = font(20);
        ctx.fillText(hasStation ? "駅と線路" : "灰色の線＝線路", bx + 58, cy);
        return;
      } else if (l[0] === "bold") { ctx.beginPath(); ctx.moveTo(cx - 18, cy - 7); ctx.lineTo(cx + 18, cy - 7); ctx.lineWidth = 5; ctx.strokeStyle = C.ink; ctx.stroke(); }
      else {
        const w = Math.min(bar.px, box.w - 90);
        ctx.beginPath(); ctx.moveTo(bx + 14, cy - 10); ctx.lineTo(bx + 14, cy - 2); ctx.lineTo(bx + 14 + w, cy - 2); ctx.lineTo(bx + 14 + w, cy - 10);
        ctx.lineWidth = 3; ctx.strokeStyle = C.ink; ctx.stroke();
        ctx.fillStyle = C.ink; ctx.font = font(20, true); ctx.fillText(bar.label, bx + 24 + w, cy);
        return;
      }
      ctx.fillStyle = C.ink; ctx.font = font(20);
      ctx.fillText(l[1], bx + 58, cy);
    });
  }

  // ---- 説明の欄 ----
  // 学校の種類ごとの校数（形の見本を兼ねる）
  function drawSchoolRows(ctx, spec, P, y, z) {
    spec.rows.forEach((r) => {
      const g = spec.groups[r.key];
      const on = spec.on.has(r.key);
      y += z.row;
      drawShape(ctx, g, P.x + z.shape / 2 + 2, y - z.label * 0.36, z.shape, false);
      ctx.fillStyle = on ? C.ink : C.muted; ctx.font = font(z.label, true);
      ctx.fillText(g.label, P.x + z.shape + 14, y);
      ctx.textAlign = "right";
      if (on) { ctx.fillStyle = C.ink; ctx.font = font(z.num, true); ctx.fillText(`${fmt(r.n)}校`, P.x + P.w, y); } else { ctx.fillStyle = C.muted; ctx.font = font(z.sub); ctx.fillText("表示していません", P.x + P.w, y); }
      ctx.textAlign = "left";
      if (r.sub && on) { y += z.sub + 12; ctx.fillStyle = C.muted; ctx.font = font(z.sub); ctx.fillText(r.sub, P.x + z.shape + 14, y); }
      y += 14;
      hr(ctx, P.x, y, P.w);
    });
    return y;
  }

  // 色の凡例（左）と多い都道府県（右）
  function drawScaleAndTop(ctx, P, y, title, scale, top, fillOpacity) {
    const lx = P.x, rx = P.x + 400, rw = P.w - 400;
    let ly = y, ry = y;
    ctx.fillStyle = C.brand; ctx.font = font(24, true);
    ctx.fillText(title, lx, ly);
    ctx.fillText(top.title, rx, ry);
    ly += 30;
    ctx.fillStyle = C.ink; ctx.font = font(21, true);
    ctx.fillText("色が濃いほど多い", lx, ly);
    scale.forEach((r) => {
      ly += 35;
      ctx.fillStyle = C.land; ctx.fillRect(lx, ly - 21, 34, 25);
      ctx.globalAlpha = fillOpacity; ctx.fillStyle = r.color; ctx.fillRect(lx, ly - 21, 34, 25); ctx.globalAlpha = 1;
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.strokeRect(lx, ly - 21, 34, 25);
      ctx.fillStyle = C.ink; ctx.font = font(23); ctx.fillText(r.label, lx + 46, ly);
    });
    ry += 30;
    top.rows.forEach((t) => {
      ry += 38;
      ctx.fillStyle = C.ink; ctx.font = font(24, true);
      ctx.fillText(`${t.rank}位`, rx, ry);
      ctx.font = font(24); ctx.fillText(t.name, rx + 58, ry);
      ctx.textAlign = "right"; ctx.font = font(24, true); ctx.fillText(t.value, rx + rw, ry); ctx.textAlign = "left";
    });
    return Math.max(ly, ry);
  }

  // A：全国の学校分布の説明欄
  function panelSchools(ctx, spec, P) {
    const bottom = P.y + P.h;
    let y = P.y + 30;
    ctx.fillStyle = C.brand; ctx.font = font(28, true);
    ctx.fillText("全国の学校の数", P.x, y);
    y = drawSchoolRows(ctx, spec, P, y - 4, { row: 56, label: 30, num: 46, sub: 21, shape: 32 });
    y = drawScaleAndTop(ctx, P, y + 40, "色：都道府県ごとの校数", spec.scale, { title: "校数の多い都道府県", rows: spec.top }, spec.fillOpacity) + 20;
    hr(ctx, P.x, y, P.w);
    y += 30;
    ctx.fillStyle = C.muted;
    spec.notes.forEach((t) => { y = drawNote(ctx, t, P.x, y, P.w, 20, bottom - 6) + 2; });
  }

  // B：全国の人数分布の説明欄
  function panelStats(ctx, spec, P) {
    const m = spec.metric;
    const bottom = P.y + P.h;
    let y = P.y + 30;
    ctx.fillStyle = C.muted; ctx.font = font(24, true);
    ctx.fillText("都道府県別の人数（国の統計）", P.x, y);
    y += 62;
    ctx.fillStyle = C.ink; ctx.font = font(32, true);
    ctx.fillText("全国", P.x, y);
    ctx.font = font(58, true);
    ctx.fillText(m.national, P.x + 84, y + 4);
    y += 44;
    ctx.font = font(26, true);
    ctx.fillText(`基準日 ${m.period}`, P.x, y);
    if (m.extra) { const w = ctx.measureText(`基準日 ${m.period}`).width; ctx.fillStyle = C.muted; ctx.font = font(22); ctx.fillText(`（${m.extra}）`, P.x + w + 8, y); }
    y += 22;
    hr(ctx, P.x, y, P.w);
    y = drawScaleAndTop(ctx, P, y + 40, "色の凡例", m.scale, { title: "人数の多い都道府県", rows: m.top }, spec.fillOpacity) + 20;
    hr(ctx, P.x, y, P.w);
    y += 32;
    if (m.pick) {
      ctx.fillStyle = C.ink;
      y = drawNote(ctx, `選んだ地域（太線）：${m.pick}`, P.x, y, P.w, 23, bottom - 6, true) + 4;
    }
    ctx.fillStyle = C.muted;
    [m.note, "色の濃さは都道府県の人数の多さです。学校ごとの人数ではありません。"].forEach((t) => { y = drawNote(ctx, t, P.x, y, P.w, 21, bottom - 6) + 2; });
  }

  // C：選択した地域の説明欄（学校の数／国の統計を分ける）
  function panelRegion(ctx, spec, P, outside) {
    const m = spec.metric;
    const bottom = P.y + P.h;
    let y = P.y + 32;
    ctx.fillStyle = C.brand; ctx.font = font(26, true);
    ctx.fillText("学校の数（所在地）", P.x, y);
    y = drawSchoolRows(ctx, spec, P, y - 2, { row: 56, label: 28, num: 44, sub: 21, shape: 30 });
    y += 30;
    ctx.fillStyle = C.muted;
    const notes = [];
    if (spec.unmapped) notes.push(`位置が分からない${fmt(spec.unmapped)}校は地図に出していませんが、校数に含みます。`);
    if (outside) notes.push(`地図の範囲の外（離島など）の${fmt(outside)}校も校数に含みます。`);
    notes.push("大学・短大・高専・専門学校は本部・本校の所在地で数えています。");
    const noteBottom = m ? bottom - 216 : bottom - 6;
    notes.forEach((t) => { y = drawNote(ctx, t, P.x, y, P.w, 20, noteBottom) + 2; });
    if (!m) {
      // 市区町村の画像：空いた所に、都道府県の中のどこかを示す小さな地図
      const top = Math.max(y + 20, bottom - 290);
      if (spec.locator && bottom - top > 150) drawLocator(ctx, spec, { x: P.x, y: top, w: P.w, h: bottom - top });
      return;
    }
    // 都道府県の人数（国の統計）。市区町村の画像では「参考：○○全体」と分ける
    const top = bottom - 206;
    ctx.fillStyle = C.soft; ctx.fillRect(P.x, top, P.w, bottom - top);
    ctx.fillStyle = C.brand; ctx.fillRect(P.x, top, 5, bottom - top);
    const x = P.x + 20, w = P.w - 30;
    y = top + 32;
    ctx.fillStyle = m.ref ? C.brand : C.muted; ctx.font = font(21, true);
    ctx.fillText(m.ref ? `参考：${m.area}全体（国の統計）` : "国の統計（学校の所在地とは別の資料）", x, y);
    y += 34;
    ctx.fillStyle = C.ink;
    fitFont(ctx, `${m.area}${m.ref ? "全体" : ""}の${m.label}`, w, 24, 18, true);
    ctx.fillText(`${m.area}${m.ref ? "全体" : ""}の${m.label}`, x, y);
    y += 46;
    ctx.font = font(42, true);
    ctx.fillText(m.value, x, y);
    y += 30;
    ctx.font = font(21, true);
    ctx.fillText(`基準日 ${m.period}${m.rank ? `・全国${m.rank}位／47` : ""}`, x, y);
    y += 28;
    ctx.fillStyle = C.muted;
    drawNote(ctx, (m.ref ? `${spec.cityName}内の人数ではありません。` : "") + m.note, x, y, w, 19, bottom - 8);
  }

  // 都道府県の中の位置（選んだ市区町村を濃く塗る）
  function drawLocator(ctx, spec, R) {
    ctx.fillStyle = C.brand; ctx.font = font(22, true);
    ctx.fillText(`${spec.prefName}の中の位置`, R.x, R.y + 22);
    const F = { x: R.x, y: R.y + 36, w: R.w, h: R.h - 36 };
    const own = spec.local[0];
    const pr = projector(spec.locator, F);
    frame(ctx, F, () => {
      own.cities.forEach((c) => {
        cityPath(ctx, c, own.arcs, pr.px);
        ctx.fillStyle = c.c === spec.city ? C.ink : C.land; ctx.fill("evenodd");
        ctx.lineWidth = 0.8; ctx.strokeStyle = C.city; ctx.stroke();
      });
    });
  }

  // 地図データが読めないとき：校数の横棒グラフ
  function drawChart(ctx, spec, M) {
    frame(ctx, M, () => {
      const bars = spec.bars;
      let y = M.y + 50;
      ctx.fillStyle = C.brand; ctx.font = font(28, true);
      ctx.fillText(spec.barsTitle, M.x + 30, y);
      ctx.fillStyle = C.muted; ctx.font = font(20);
      ctx.fillText("地図データを読み込めなかったため、グラフで表しています。", M.x + 30, y + 34);
      y += 70;
      const max = Math.max(1, ...bars.map((b) => b.n));
      const lw = 230, bw = M.w - lw - 150, gap = Math.min(52, (M.y + M.h - y - 20) / Math.max(1, bars.length));
      bars.forEach((b) => {
        y += gap;
        ctx.fillStyle = C.ink;
        fitFont(ctx, b.name, lw - 10, 24, 17, true);
        ctx.fillText(b.name, M.x + 30, y);
        const w = Math.max(3, (bw * b.n) / max);
        ctx.fillStyle = b.color || C.bar; ctx.fillRect(M.x + 30 + lw, y - 24, w, 30);
        ctx.fillStyle = C.ink; ctx.font = font(24, true);
        ctx.fillText(`${fmt(b.n)}校`, M.x + 30 + lw + w + 12, y);
      });
    }, C.white);
    return 0;
  }

  // ランキング（ranking.js が渡す）：縦長 1080×1350 の横棒グラフ。地名は左、数は右、棒の始まりはそろえる。
  // 棒は画像に入れた中でいちばん大きい数に対する長さ（0より大きければ最低8px）。順位の数字や飾りは描かない
  const RW = 1080, RH = 1350, RM = 48;
  const RC = { bg: "#FFFDF8", ink: "#2B2621", muted: "#625A50", line: "#E2DBCF", rule: "#EFEAE1", bar: "#C8692A", value: "#7E3E14", url: "#7A5A3A" };

  // 日本語の折り返し：数字・英字のまとまり（10,000、e-Stat など）は切らず、「。」「）」などは行の頭に置かない
  function wrapJa(ctx, text, maxW) {
    const lines = [];
    let cur = "";
    for (const t of text.match(/[0-9A-Za-z.,:\/-]+|./gu) || []) {
      if (cur && ctx.measureText(cur + t).width > maxW && !/^[、。，．）」』・：]/.test(t)) { lines.push(cur); cur = t; } else cur += t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // 題名：1行に入らなければ、言葉の切れ目（空白・｜・「の」・」の後）で2行に分ける。いちばん大きく書ける分け方を選ぶ
  function titleLines(ctx, text, cw) {
    const best = (lines) => { for (let p = 58; p >= 40; p--) { ctx.font = font(p, true); if (lines.every((l) => ctx.measureText(l).width <= cw)) return p; } return 0; };
    let pick = { lines: [text], p: best([text]) };
    if (pick.p >= 46) return pick;
    for (let i = 1; i < text.length; i++) {
      if (!/[ ｜の」]/.test(text[i - 1])) continue;
      const lines = [text.slice(0, i).trim(), text.slice(i).trim()];
      const p = best(lines);
      if (p > pick.p) pick = { lines, p };
    }
    if (!pick.p) { ctx.font = font(40, true); pick = { lines: wrapJa(ctx, text, cw).slice(0, 2), p: 40 }; }
    return pick;
  }

  function renderRanking(spec) {
    const canvas = document.createElement("canvas");
    canvas.width = RW; canvas.height = RH;
    const ctx = canvas.getContext("2d");
    const cw = RW - RM * 2;
    ctx.fillStyle = RC.bg; ctx.fillRect(0, 0, RW, RH);
    // 上：短い題名（入らなければ2行）と、集計対象・確認日
    let y = RM - 6;
    const tt = titleLines(ctx, spec.title, cw);
    ctx.fillStyle = RC.ink; ctx.font = font(tt.p, true);
    tt.lines.forEach((l) => { y += Math.round(tt.p * 1.2); ctx.fillText(l, RM, y); });
    ctx.fillStyle = RC.muted; ctx.font = font(27);
    wrapJa(ctx, spec.subtitle, cw).forEach((l) => { y += 40; ctx.fillText(l, RM, y); });
    y += 24;
    ctx.fillStyle = RC.line; ctx.fillRect(RM, y, cw, 2);
    const chartTop = y + 16;
    // 下：出典・集計条件・注意書き（省かずに全部）。いちばん下にサイト名とURLを控えめに
    const urlY = RH - 30;
    ctx.font = font(23);
    const notes = [];
    spec.foot.forEach((t) => wrapJa(ctx, t, cw).forEach((l) => notes.push(l)));
    const lh = 32;
    const fy = urlY - 46 - (notes.length - 1) * lh;
    ctx.fillStyle = RC.muted;
    notes.forEach((l, i) => ctx.fillText(l, RM, fy + i * lh));
    ctx.fillStyle = RC.url; ctx.font = font(20, true);
    ctx.fillText(`${spec.siteName}（テスト運用中）`, RM, urlY);
    ctx.textAlign = "right";
    ctx.fillText(spec.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""), RW - RM, urlY);
    ctx.textAlign = "left";
    const sepY = fy - 23 - 18;
    ctx.fillStyle = RC.line; ctx.fillRect(RM, sepY, cw, 2);
    // 中央：横棒グラフ。5件より少なくても5件分の大きさで描く
    const rows = spec.rows;
    const pitch = Math.min(200, (sepY - 14 - chartTop) / Math.max(5, rows.length));
    const fp = Math.round(Math.min(56, pitch * 0.46));
    const bh = Math.round(Math.min(74, pitch * 0.5));
    const pp = Math.round(fp * 0.6), pg = Math.round(fp * 0.25);
    const nameW = (r) => {
      ctx.font = font(fp, true);
      let w = ctx.measureText(r.name).width;
      if (r.pre) { ctx.font = font(pp); w += ctx.measureText(r.pre).width + pg; }
      return w;
    };
    const nw = Math.min(cw * 0.42, Math.max(...rows.map(nameW)));
    const vp = Math.round(fp * 1.04);
    ctx.font = font(vp, true);
    const vw = Math.max(...rows.map((r) => ctx.measureText(r.value).width));
    const x0 = RM + nw + 24, x1 = RW - RM - vw - 22;
    const max = Math.max(1e-9, ...rows.map((r) => r.n));
    rows.forEach((r, i) => {
      const cy = chartTop + pitch * (i + 0.5);
      const base = cy + fp * 0.36;
      if (i) { ctx.fillStyle = RC.rule; ctx.fillRect(RM, chartTop + pitch * i, cw, 1); }
      // 地名（全国の市区町村は県名を小さく前に。長ければ全体を少し小さく）
      const sc = Math.min(1, nw / nameW(r));
      let x = RM;
      if (r.pre) {
        ctx.font = font(Math.round(pp * sc)); ctx.fillStyle = RC.muted;
        ctx.fillText(r.pre, x, base);
        x += ctx.measureText(r.pre).width + pg * sc;
      }
      ctx.font = font(Math.floor(fp * sc), true); ctx.fillStyle = RC.ink;
      ctx.fillText(r.name, x, base);
      // 棒
      const w = r.n > 0 ? Math.max(8, ((x1 - x0) * r.n) / max) : 0;
      ctx.fillStyle = RC.bar; ctx.fillRect(x0, cy - bh / 2, w, bh);
      // 数（太字・右そろえ）
      ctx.font = font(vp, true); ctx.fillStyle = RC.value; ctx.textAlign = "right";
      ctx.fillText(r.value, RW - RM, base);
      ctx.textAlign = "left";
    });
    ctx.fillStyle = RC.line; ctx.fillRect(x0 - 2, chartTop, 2, pitch * rows.length);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
    });
  }

  // 2都道府県の比較（縦長 1080×1350）。項目ごとに2本の横棒を描き、棒の長さはその項目の中だけでそろえる
  // （ちがう資料の数を同じ物差しにしない）。棒の左に都道府県名を書くので凡例を見なくても分かる
  const CMPC = { x: "#2A78D6", y: "#EB6834" };
  function renderCompare(spec) {
    const canvas = document.createElement("canvas");
    canvas.width = RW; canvas.height = RH;
    const ctx = canvas.getContext("2d");
    const cw = RW - RM * 2;
    ctx.fillStyle = RC.bg; ctx.fillRect(0, 0, RW, RH);
    // 上：2つの都道府県名を大きく（色の四角を前に付ける）
    const gap = " と ";
    let p = 76;
    const width = (q) => { ctx.font = font(q, true); const w = (t) => ctx.measureText(t).width; return q * 0.72 + 12 + w(spec.names.x) + w(gap) + q * 0.72 + 12 + w(spec.names.y); };
    while (p > 44 && width(p) > cw) p -= 2;
    let y = RM + p - 4;
    let x = RM;
    const chip = (side) => { const s = Math.round(p * 0.72); ctx.fillStyle = CMPC[side]; ctx.fillRect(x, y - s + Math.round(p * 0.06), s, s); x += s + 12; };
    ctx.font = font(p, true);
    chip("x"); ctx.fillStyle = RC.ink; ctx.fillText(spec.names.x, x, y); x += ctx.measureText(spec.names.x).width;
    ctx.fillStyle = RC.muted; ctx.fillText(gap, x, y); x += ctx.measureText(gap).width;
    ctx.font = font(p, true);
    chip("y"); ctx.fillStyle = RC.ink; ctx.fillText(spec.names.y, x, y);
    ctx.fillStyle = RC.muted; ctx.font = font(28, true);
    y += 48; ctx.fillText(spec.subtitle, RM, y);
    y += 22;
    ctx.fillStyle = RC.line; ctx.fillRect(RM, y, cw, 2);
    const top = y + 8;
    // 下：出典・注意書き（省かずに全部）。いちばん下にサイト名と、この比較を開き直せるURL
    const urlY = RH - 30;
    ctx.font = font(22);
    const notes = [];
    spec.foot.forEach((t) => wrapJa(ctx, t, cw).forEach((l) => notes.push(l)));
    const lh = 30;
    const fy = urlY - 44 - (notes.length - 1) * lh;
    ctx.fillStyle = RC.muted;
    notes.forEach((l, i) => ctx.fillText(l, RM, fy + i * lh));
    ctx.fillStyle = RC.url;
    const url = (spec.pageUrl || spec.siteUrl).replace(/^https?:\/\//, "");
    fitFont(ctx, url, cw, 22, 16, true);
    ctx.fillText(url, RM, urlY);
    const sepY = fy - 22 - 14;
    ctx.fillStyle = RC.line; ctx.fillRect(RM, sepY, cw, 2);
    // 中央：項目ごとに 見出し（右に「〇〇が約3.0倍」）・基準日など・2本の横棒
    const n = spec.sections.length;
    const per = (sepY - top) / Math.max(1, n);
    ctx.font = font(30, true);
    const nw = Math.max(...["x", "y"].map((s) => ctx.measureText(spec.names[s]).width));
    spec.sections.forEach((sec, i) => {
      const y0 = top + per * i;
      if (i) { ctx.fillStyle = RC.rule; ctx.fillRect(RM, y0, cw, 2); }
      ctx.font = font(30, true);
      const tw = ctx.measureText(sec.tag).width;
      ctx.fillStyle = RC.ink; ctx.textAlign = "right"; ctx.fillText(sec.tag, RW - RM, y0 + 42); ctx.textAlign = "left";
      const tp = fitFont(ctx, sec.title, cw - tw - 24, 30, 20, true);
      ctx.fillStyle = RC.ink; ctx.font = font(tp, true); ctx.fillText(sec.title, RM, y0 + 42);
      ctx.fillStyle = RC.muted; fitFont(ctx, sec.sub, cw, 22, 17); ctx.fillText(sec.sub, RM, y0 + 74);
      const rowsTop = y0 + 88, rh = Math.min(58, (per - 96) / 2);
      ctx.font = font(30, true);
      const vw = Math.max(...sec.bars.map((b) => ctx.measureText(b.value).width));
      const x0 = RM + nw + 18, x1 = RW - RM - vw - 18;
      const max = Math.max(1e-9, ...sec.bars.map((b) => (typeof b.n === "number" ? b.n : 0)));
      sec.bars.forEach((b, j) => {
        const cy = rowsTop + rh * (j + 0.5), base = cy + 11;
        ctx.font = font(30, true); ctx.fillStyle = RC.ink; ctx.fillText(b.name, RM, base);
        const w = typeof b.n === "number" && b.n > 0 ? Math.max(6, ((x1 - x0) * b.n) / max) : 0;
        ctx.fillStyle = CMPC[b.side]; ctx.fillRect(x0, cy - rh * 0.32, w, rh * 0.64);
        ctx.fillStyle = RC.value; ctx.textAlign = "right"; ctx.fillText(b.value, RW - RM, base); ctx.textAlign = "left";
      });
      ctx.fillStyle = RC.line; ctx.fillRect(x0 - 2, rowsTop + rh * 0.1, 2, rh * 1.8);
    });
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
    });
  }

  function drawHead(ctx, spec) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = C.brand; ctx.font = font(22, true);
    ctx.fillText(`${spec.siteName}（テスト運用中）`, 24, 42);
    ctx.fillStyle = C.ink;
    fitFont(ctx, spec.title, W - 48, 56, 36, true);
    ctx.fillText(spec.title, 24, 104);
    if (spec.subtitle) {
      ctx.fillStyle = C.muted;
      fitFont(ctx, spec.subtitle, W - 48, 28, 20, true);
      ctx.fillText(spec.subtitle, 24, 146);
    }
  }

  // 出典（機関名・統計名・基準日）。サイトのURLは右下に小さく
  function drawFoot(ctx, spec) {
    const lines = spec.foot.concat(spec.kind === "region" ? [CREDIT.region] : spec.kind === "chart" ? [] : [CREDIT.border + (spec.footExtra || "")]);
    ctx.font = font(19, true);
    const uw = ctx.measureText(spec.siteUrl).width;
    let y = H - 20 - (lines.length - 1) * 27;
    lines.forEach((l, i) => {
      const last = i === lines.length - 1;
      ctx.fillStyle = C.muted;
      fitFont(ctx, l, W - 48 - (last ? uw + 28 : 0), 20, 17);
      ctx.fillText(l, 24, y);
      y += 27;
    });
    ctx.textAlign = "right"; ctx.fillStyle = C.brand; ctx.font = font(19, true);
    ctx.fillText(spec.siteUrl, W - 24, H - 20);
    ctx.textAlign = "left";
  }

  function render(spec) {
    if (spec.kind === "ranking") return renderRanking(spec);
    if (spec.kind === "compare") return renderCompare(spec);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    drawHead(ctx, spec);
    if (spec.kind === "region" || spec.kind === "chart") {
      const { M, P } = LAYOUT.region;
      const outside = spec.kind === "chart" ? drawChart(ctx, spec, M) : drawRegion(ctx, spec, M);
      panelRegion(ctx, spec, P, outside);
    } else {
      const { M, P } = LAYOUT.nation;
      drawNation(ctx, spec, M);
      if (spec.kind === "stats") panelStats(ctx, spec, P); else panelSchools(ctx, spec, P);
    }
    drawFoot(ctx, spec);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
    });
  }

  return { render };
})();
