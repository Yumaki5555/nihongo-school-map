/* 保存用の画像（PNG 1600×900）を端末の中だけで描く。3種類から選ぶ：
   schools＝全国の学校分布／stats＝全国の人数分布／region＝選択した地域。
   背景の地図タイルは使わず、都道府県の境界（国土数値情報を加工）と学校の点から作る。
   通信はしない。数字はすべて site.js が画面と同じデータから渡す。
   スマホの画面で縮めて見ても読めるよう、文字は大きめにする（いちばん小さい出典でも17px）。 */
window.MapImage = (function () {
  "use strict";
  const W = 1600, H = 900;
  // 全国の2種類は日本列島に合わせて地図を細く、説明の欄を広くする
  const LAYOUT = {
    nation: { M: { x: 24, y: 150, w: 800, h: 620 }, P: { x: 856, y: 150, w: 720, h: 620 } },
    region: { M: { x: 24, y: 150, w: 1010, h: 620 }, P: { x: 1062, y: 150, w: 514, h: 620 } },
  };
  const NATION = { n: 45.8, s: 30.0, w: 128.2, e: 146.4 };
  const OKINAWA = { n: 28.6, s: 24.0, w: 122.7, e: 131.4 };
  const OKI = "47";
  const MAX_SCALE = Math.pow(2, 14); // 学校が1校だけの市区町村でも拡大しすぎない（サイトの地図と同じ上限）
  const VEIL = 0.38; // 選んだ地域の外にかける白い膜（サイトの地図と同じ）
  const FONT = '"Yu Gothic UI","Hiragino Sans","Meiryo","Noto Sans CJK JP","Noto Sans JP",system-ui,sans-serif';
  const C = { bg: "#FFFDF6", ink: "#352D20", muted: "#5C5140", brand: "#79591F", accent: "#E5C66E", line: "#D5BA79", soft: "#FFF5D9", sea: "#D9E6EF", land: "#F6F1E4", border: "#8A7A55", white: "#FFFFFF" };
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

  // 折り返して書く。bottom を超える行は書かない。次の行の位置を返す
  function drawWrapped(ctx, text, x, y, maxW, lh, maxLines, bottom) {
    const room = bottom ? Math.max(0, Math.floor((bottom - y) / lh) + 1) : maxLines;
    const lines = wrap(ctx, text, maxW).slice(0, Math.min(maxLines, room));
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    return y + lines.length * lh;
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

  function drawShape(ctx, g, x, y, size, rough) {
    const s = size / 2;
    ctx.beginPath();
    if (g.shape === "circle") ctx.arc(x, y, s * 0.82, 0, Math.PI * 2);
    else if (g.shape === "square") ctx.rect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
    else { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
    if (rough) {
      ctx.fillStyle = C.white; ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = g.color; ctx.stroke();
    } else {
      ctx.fillStyle = g.color; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = C.white; ctx.stroke();
    }
  }

  function drawBubble(ctx, x, y, r, label, px) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.muted; ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = font(px, true);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  // 都道府県ごとの校数のラベル
  function drawPill(ctx, x, y, label, px) {
    ctx.font = font(px, true);
    const w = ctx.measureText(label).width + 14, h = px + 10, r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + r, y - r);
    ctx.lineTo(x + w / 2 - r, y - r);
    ctx.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x - w / 2 + r, y + r);
    ctx.arc(x - w / 2 + r, y, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.fill();
    ctx.lineWidth = 1.8; ctx.strokeStyle = C.muted; ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  // 緯度経度の範囲 f を枠 R にちょうど収める変換
  function projector(f, R) {
    const crs = L.CRS.EPSG3857;
    const world = (la, ln) => crs.latLngToPoint(L.latLng(la, ln), 0);
    const nw = world(f.n, f.w), se = world(f.s, f.e);
    const k = Math.min(R.w / Math.max(se.x - nw.x, 1e-9), R.h / Math.max(se.y - nw.y, 1e-9), MAX_SCALE);
    const cx = (nw.x + se.x) / 2, cy = (nw.y + se.y) / 2;
    return { k, px: (la, ln) => { const p = world(la, ln); return [R.x + R.w / 2 + (p.x - cx) * k, R.y + R.h / 2 + (p.y - cy) * k]; } };
  }

  function path(ctx, f, px) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    ctx.beginPath();
    polys.forEach((poly) => poly.forEach((ring) => {
      ring.forEach((c, i) => { const [x, y] = px(c[1], c[0]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }));
  }

  // 都道府県を描く。opt.fill＝人数の色、opt.veil＝選んだ地域の外を白く薄める
  function drawLand(ctx, spec, px, opt) {
    spec.geo.features.forEach((f) => {
      const code = f.properties.code;
      path(ctx, f, px);
      ctx.fillStyle = C.land; ctx.fill("evenodd");
      if (opt.fill) { ctx.globalAlpha = opt.fillOpacity; ctx.fillStyle = opt.fill(code); ctx.fill("evenodd"); ctx.globalAlpha = 1; }
      if (opt.veil && code !== opt.selected) { ctx.globalAlpha = opt.veil; ctx.fillStyle = C.white; ctx.fill("evenodd"); ctx.globalAlpha = 1; }
      ctx.lineWidth = 1.2; ctx.strokeStyle = C.border; ctx.stroke();
    });
    if (opt.selected) {
      const f = spec.geo.features.find((x) => x.properties.code === opt.selected);
      if (f) { path(ctx, f, px); ctx.lineWidth = opt.selWidth || 4; ctx.strokeStyle = C.ink; ctx.stroke(); }
    }
  }

  // 枠の中だけに描く
  function frame(ctx, R, draw) {
    ctx.save();
    ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
    ctx.fillStyle = C.sea; ctx.fillRect(R.x, R.y, R.w, R.h);
    draw();
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.line; ctx.strokeRect(R.x, R.y, R.w, R.h);
  }

  function pillItems(spec, px, codes) {
    return codes.map((code) => {
      const a = px(spec.rep[code][0], spec.rep[code][1]);
      const n = spec.counts[code];
      return { code, n, ax: a[0], ay: a[1], r: n < 100 ? 18 : n < 1000 ? 22 : 26 };
    });
  }

  // 全国の地図（A・B）。沖縄県は左上の枠に入れる
  function drawNation(ctx, spec, M) {
    const opt = { fill: spec.fill, fillOpacity: spec.fillOpacity, selected: spec.selected };
    const I = { x: M.x + 12, y: M.y + 12, w: 300, h: 176 };
    frame(ctx, M, () => {
      const main = projector(NATION, M);
      drawLand(ctx, spec, main.px, opt);
      if (spec.counts) {
        const items = pillItems(spec, main.px, Object.keys(spec.counts).filter((c) => c !== OKI));
        spec.relax(items, 2);
        items.forEach((i) => {
          if (Math.hypot(i.x - i.ax, i.y - i.ay) > 10) {
            ctx.beginPath(); ctx.moveTo(i.ax, i.ay); ctx.lineTo(i.x, i.y);
            ctx.lineWidth = 1.4; ctx.strokeStyle = C.muted; ctx.stroke();
          }
        });
        items.forEach((i) => drawPill(ctx, i.x, i.y, fmt(i.n), 20));
      }
      frame(ctx, I, () => {
        const oki = projector(OKINAWA, I);
        drawLand(ctx, spec, oki.px, Object.assign({}, opt, { selWidth: 2.5 }));
        if (spec.counts && spec.counts[OKI]) {
          const a = oki.px(spec.rep[OKI][0], spec.rep[OKI][1]);
          drawPill(ctx, a[0], a[1], fmt(spec.counts[OKI]), 20);
        }
        ctx.fillStyle = C.ink; ctx.font = font(22, true);
        ctx.fillText("沖縄県", I.x + 10, I.y + 30);
      });
    });
  }

  // 近い点をまとめる（サイトの地図のまとめ方に近い半径）
  function clusterPts(list, R) {
    const groups = [];
    list.forEach((q) => {
      let near = null, best = R;
      groups.forEach((g) => { const d = Math.hypot(g.x - q.x, g.y - q.y); if (d < best) { best = d; near = g; } });
      if (near) { near.items.push(q.p); near.sx += q.x; near.sy += q.y; } else groups.push({ x: q.x, y: q.y, sx: q.x, sy: q.y, items: [q.p] });
    });
    return groups;
  }

  // 選んだ地域の地図（C）。地域の外の学校は薄く描く。地図の外に出た地域内の学校の数を返す
  function drawRegion(ctx, spec, M) {
    const pr = projector(spec.bounds, M);
    const zoom = Math.log2(pr.k);
    const R = zoom < 12 ? 66 : zoom < 14 ? 40 : 14;
    let outside = 0;
    const sets = { out: [], in: [] };
    spec.points.forEach((p) => {
      const [x, y] = pr.px(p.la, p.ln);
      const inside = x >= M.x && x <= M.x + M.w && y >= M.y && y <= M.y + M.h;
      if (p.r && !inside) outside++;
      if (x < M.x - 40 || x > M.x + M.w + 40 || y < M.y - 40 || y > M.y + M.h + 40) return;
      sets[p.r ? "in" : "out"].push({ x, y, p });
    });
    frame(ctx, M, () => {
      drawLand(ctx, spec, pr.px, { selected: spec.selected, veil: VEIL });
      const draw = (list, alpha) => {
        ctx.globalAlpha = alpha;
        const groups = clusterPts(list, R);
        groups.filter((g) => g.items.length === 1).forEach((g) => { const p = g.items[0]; drawShape(ctx, spec.groups[p.g], g.x, g.y, 28, p.rough); });
        groups.filter((g) => g.items.length > 1).forEach((g) => {
          const n = g.items.length;
          drawBubble(ctx, g.sx / n, g.sy / n, n < 10 ? 19 : n < 100 ? 22 : n < 1000 ? 26 : 30, fmt(n), 20);
        });
        ctx.globalAlpha = 1;
      };
      draw(sets.out, 0.35);
      draw(sets.in, 1);
      // 点の見方（点がいちばん少ない角に置く）
      const lines = [["rough", "白抜き＝町名の代表点"], ["bubble", "数字＝まとめた学校の数"]];
      if (sets.out.length) lines.push(["faint", "薄い色＝ほかの地域の学校"]);
      ctx.font = font(21);
      const bw = 58 + Math.max(...lines.map((l) => ctx.measureText(l[1]).width)) + 16, bh = lines.length * 34 + 14;
      const corners = [[M.x + 10, M.y + M.h - bh - 10], [M.x + M.w - bw - 10, M.y + M.h - bh - 10], [M.x + 10, M.y + 10], [M.x + M.w - bw - 10, M.y + 10]];
      const busy = (c) => sets.in.concat(sets.out).filter((q) => q.x > c[0] - 20 && q.x < c[0] + bw + 20 && q.y > c[1] - 20 && q.y < c[1] + bh + 20).length;
      const [bx, by] = corners.reduce((a, c) => (busy(c) < busy(a) ? c : a));
      ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(bx, by, bw, bh);
      ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; ctx.strokeRect(bx, by, bw, bh);
      lines.forEach((l, i) => {
        const cy = by + 26 + i * 34, cx = bx + 28;
        if (l[0] === "rough") drawShape(ctx, spec.groups.jp, cx, cy - 7, 24, true);
        else if (l[0] === "bubble") drawBubble(ctx, cx, cy - 7, 15, "12", 15);
        else { ctx.globalAlpha = 0.35; drawShape(ctx, spec.groups.jp, cx, cy - 7, 24, false); ctx.globalAlpha = 1; }
        ctx.fillStyle = C.ink; ctx.font = font(21);
        ctx.fillText(l[1], bx + 58, cy);
      });
    });
    return outside;
  }

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
      if (r.sub && on) { y += z.sub + 14; ctx.fillStyle = C.muted; ctx.font = font(z.sub); ctx.fillText(r.sub, P.x + z.shape + 14, y); }
      y += 16;
      hr(ctx, P.x, y, P.w);
    });
    return y;
  }

  // A：全国の学校分布の説明欄
  function panelSchools(ctx, spec, P) {
    const bottom = P.y + P.h;
    let y = P.y + 32;
    ctx.fillStyle = C.brand; ctx.font = font(32, true);
    ctx.fillText("全国の学校の数", P.x, y);
    y = drawSchoolRows(ctx, spec, P, y + 6, { row: 66, label: 34, num: 56, sub: 26, shape: 36 });
    y += 44;
    ctx.fillStyle = C.muted;
    spec.notes.forEach((t) => { y = drawNote(ctx, t, P.x, y, P.w, 24, bottom - 8) + 10; });
  }

  // B：全国の人数分布の説明欄
  function panelStats(ctx, spec, P) {
    const m = spec.metric;
    const bottom = P.y + P.h;
    let y = P.y + 30;
    ctx.fillStyle = C.muted; ctx.font = font(24, true);
    ctx.fillText("都道府県別の人数（国の統計）", P.x, y);
    y += 64;
    ctx.fillStyle = C.ink; ctx.font = font(32, true);
    ctx.fillText("全国", P.x, y);
    ctx.font = font(60, true);
    ctx.fillText(m.national, P.x + 84, y + 4);
    y += 46;
    ctx.font = font(26, true);
    ctx.fillText(`基準日 ${m.period}`, P.x, y);
    if (m.extra) { const w = ctx.measureText(`基準日 ${m.period}`).width; ctx.fillStyle = C.muted; ctx.font = font(22); ctx.fillText(`（${m.extra}）`, P.x + w + 8, y); }
    y += 24;
    hr(ctx, P.x, y, P.w);
    // 左：人数の多い都道府県 ／ 右：色の凡例
    const lx = P.x, lw = 370, rx = P.x + 410;
    let ly = y + 40, ry = y + 40;
    ctx.fillStyle = C.brand; ctx.font = font(24, true);
    ctx.fillText("人数の多い都道府県", lx, ly);
    ctx.fillText("色の凡例", rx, ry);
    m.top.forEach((t) => {
      ly += 40;
      ctx.fillStyle = C.ink; ctx.font = font(26, true);
      ctx.fillText(`${t.rank}位`, lx, ly);
      ctx.font = font(26); ctx.fillText(t.name, lx + 62, ly);
      ctx.textAlign = "right"; ctx.font = font(26, true); ctx.fillText(t.value, lx + lw, ly); ctx.textAlign = "left";
    });
    m.scale.forEach((r) => {
      ry += 36;
      ctx.fillStyle = C.land; ctx.fillRect(rx, ry - 21, 34, 25);
      ctx.globalAlpha = spec.fillOpacity; ctx.fillStyle = r.color; ctx.fillRect(rx, ry - 21, 34, 25); ctx.globalAlpha = 1;
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.strokeRect(rx, ry - 21, 34, 25);
      ctx.fillStyle = C.ink; ctx.font = font(24); ctx.fillText(r.label, rx + 44, ry);
    });
    y = Math.max(ly, ry) + 22;
    hr(ctx, P.x, y, P.w);
    y += 36;
    if (m.pick) {
      ctx.fillStyle = C.ink;
      y = drawNote(ctx, `選んだ地域（太線）：${m.pick}`, P.x, y, P.w, 24, bottom - 8, true) + 6;
    }
    ctx.fillStyle = C.muted;
    [m.note, "色の濃さは都道府県の人数の多さです。学校ごとの人数ではありません。"].forEach((t) => { y = drawNote(ctx, t, P.x, y, P.w, 22, bottom - 8) + 4; });
  }

  // C：選択した地域の説明欄
  function panelRegion(ctx, spec, P, outside) {
    const m = spec.metric;
    const bottom = P.y + P.h;
    let y = P.y + 28;
    ctx.fillStyle = C.brand; ctx.font = font(28, true);
    ctx.fillText(`${spec.region}の学校の数`.slice(0, 18), P.x, y);
    y = drawSchoolRows(ctx, spec, P, y + 2, { row: 54, label: 28, num: 44, sub: 22, shape: 30 });
    y += 30;
    ctx.fillStyle = C.muted;
    const notes = [];
    if (spec.unmapped) notes.push(`位置が分からない${fmt(spec.unmapped)}校は地図に出していませんが、校数に含みます。`);
    if (outside) notes.push(`地図の外（離島など）の${fmt(outside)}校も校数に含みます。`);
    if (!notes.length) notes.push("大学などは本部・本校の所在地で数えています。");
    notes.forEach((t) => { y = drawNote(ctx, t, P.x, y, P.w, 21, bottom - 200) + 2; });
    // 都道府県の人数（国の統計）
    const top = y + 4;
    ctx.fillStyle = C.soft; ctx.fillRect(P.x, top, P.w, bottom - top);
    ctx.fillStyle = C.brand; ctx.fillRect(P.x, top, 5, bottom - top);
    const x = P.x + 20, w = P.w - 30;
    y = top + 34;
    ctx.fillStyle = C.muted; ctx.font = font(21, true);
    ctx.fillText("都道府県の人数（国の統計）", x, y);
    y += 36;
    ctx.fillStyle = C.ink; ctx.font = font(25, true);
    y = drawWrapped(ctx, `${m.area}の${m.label}`, x, y, w, 33, 2, bottom);
    y += 16;
    ctx.font = font(46, true);
    ctx.fillText(m.value, x, y + 4);
    y += 38;
    ctx.font = font(22, true);
    ctx.fillText(`基準日 ${m.period}${m.rank ? `・全国${m.rank}位／47` : ""}`, x, y);
    y += 32;
    ctx.fillStyle = C.muted;
    drawNote(ctx, (m.city ? "市区町村ごとの人数ではありません。" : "") + m.note, x, y, w, 20, bottom - 10);
  }

  function drawHead(ctx, spec) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = C.brand; ctx.font = font(30, true);
    ctx.fillText(spec.siteName, 24, 56);
    const nw = ctx.measureText(spec.siteName).width;
    ctx.fillStyle = C.muted; ctx.font = font(22, true);
    ctx.fillText("テスト運用中", 24 + nw + 16, 55);
    ctx.textAlign = "right"; ctx.fillStyle = C.brand; ctx.font = font(24, true);
    ctx.fillText(spec.siteUrl, W - 24, 56);
    ctx.textAlign = "left";
    ctx.fillStyle = C.ink;
    fitFont(ctx, spec.title, W - 48, 58, 38, true);
    ctx.fillText(spec.title, 24, 126);
    if (spec.subtitle) {
      const tw = ctx.measureText(spec.title).width;
      ctx.font = font(28, true);
      if (24 + tw + 28 + ctx.measureText(spec.subtitle).width <= W - 24) { ctx.fillStyle = C.muted; ctx.fillText(spec.subtitle, 24 + tw + 28, 124); }
    }
  }

  // 出典（出典機関と基準日・確認日）
  function drawFoot(ctx, spec) {
    const school = `学校：${spec.agencies}の公表資料をもとに作成（確認日 ${spec.checked}）`;
    const border = "境界：国土数値情報（行政区域データ）国土交通省を加工";
    const pos = "位置：位置参照情報 国土交通省を加工";
    const stat = spec.metric ? `統計：${spec.metric.source}／基準日 ${spec.metric.period}` : "";
    const lines = spec.kind === "schools" ? [school, `${border}／${pos}。点と数字は学校の所在地で、人数ではありません。`]
      : spec.kind === "stats" ? [stat, `${border}。色は都道府県ごとの人数（国の統計）で、学校の所在地とは別の情報です。`]
        : [school, stat, `${border}／${pos}。学校の所在地と都道府県の人数は別の情報です。`];
    let y = H - 24 - (lines.length - 1) * 32;
    lines.forEach((l) => {
      ctx.fillStyle = C.muted;
      fitFont(ctx, l, W - 48, 22, 17);
      ctx.fillText(l, 24, y);
      y += 32;
    });
  }

  function render(spec) {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    drawHead(ctx, spec);
    if (spec.kind === "region") {
      const { M, P } = LAYOUT.region;
      const outside = drawRegion(ctx, spec, M);
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
