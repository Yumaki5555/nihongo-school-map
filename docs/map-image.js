/* 保存用の画像（PNG 1600×900）を端末の中だけで描く。
   背景の地図タイルは使わず、都道府県の境界（国土数値情報を加工）と学校の点から作る。
   通信はしない。 */
window.MapImage = (function () {
  "use strict";
  const W = 1600, H = 900;
  const M = { x: 24, y: 104, w: 1130, h: 590 };
  const P = { x: 1172, y: 104, w: 404, h: 590 };
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

  function drawWrapped(ctx, text, x, y, maxW, lh, maxLines) {
    const lines = wrap(ctx, text, maxW).slice(0, maxLines);
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    return y + lines.length * lh;
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

  // 都道府県ごとの数の小さなラベル（色分けを隠さないよう、丸より小さくする）
  function drawPill(ctx, x, y, label, px) {
    ctx.font = font(px, true);
    const w = ctx.measureText(label).width + 12, h = px + 9, r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + r, y - r);
    ctx.lineTo(x + w / 2 - r, y - r);
    ctx.arc(x + w / 2 - r, y, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x - w / 2 + r, y + r);
    ctx.arc(x - w / 2 + r, y, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,.94)"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.muted; ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + 1);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }

  function drawMap(ctx, spec) {
    const crs = L.CRS.EPSG3857;
    const world = (la, ln) => crs.latLngToPoint(L.latLng(la, ln), 0);
    const project = (f, R) => {
      const nw = world(f.n, f.w), se = world(f.s, f.e);
      const k = Math.min(R.w / (se.x - nw.x), R.h / (se.y - nw.y));
      const cx = (nw.x + se.x) / 2, cy = (nw.y + se.y) / 2;
      return { k, px: (la, ln) => { const p = world(la, ln); return [R.x + R.w / 2 + (p.x - cx) * k, R.y + R.h / 2 + (p.y - cy) * k]; } };
    };
    // 全国を見ているときは決まった範囲で大きく描き、沖縄は左上の枠に入れる
    const b = spec.bounds;
    const main = project(spec.home ? { n: 45.8, s: 30.0, w: 128.2, e: 146.4 } : { n: b.getNorth(), s: b.getSouth(), w: b.getWest(), e: b.getEast() }, M);
    const k = main.k;
    let px = main.px;
    const zoom = Math.log2(k);

    ctx.save();
    ctx.beginPath();
    ctx.rect(M.x, M.y, M.w, M.h);
    ctx.clip();
    ctx.fillStyle = C.sea;
    ctx.fillRect(M.x, M.y, M.w, M.h);

    const path = (f) => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      ctx.beginPath();
      polys.forEach((poly) => poly.forEach((ring) => {
        ring.forEach((c, i) => { const [x, y] = px(c[1], c[0]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath();
      }));
    };
    const land = () => spec.geo.features.forEach((f) => {
      path(f);
      ctx.fillStyle = C.land;
      ctx.fill("evenodd");
      if (spec.fill) {
        // サイトの地図と同じ濃さで塗る（近づくほど薄く）
        ctx.globalAlpha = spec.fillOpacity;
        ctx.fillStyle = spec.fill(f.properties.code);
        ctx.fill("evenodd");
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 1.2; ctx.strokeStyle = C.border; ctx.stroke();
    });
    land();
    if (spec.selected) {
      const f = spec.geo.features.find((x) => x.properties.code === spec.selected);
      path(f);
      ctx.lineWidth = 3.5; ctx.strokeStyle = C.ink; ctx.stroke();
    }

    if (spec.bubbles) {
      const c = {};
      spec.points.forEach((p) => { c[p.p] = (c[p.p] || 0) + 1; });
      const OKI = "47";
      const items = Object.keys(c).filter((code) => !(spec.home && code === OKI)).map((code) => {
        const a = px(spec.rep[code][0], spec.rep[code][1]);
        return { code, n: c[code], ax: a[0], ay: a[1], r: c[code] < 100 ? 15 : c[code] < 1000 ? 19 : 23 };
      });
      spec.relax(items, 1);
      items.forEach((i) => {
        if (Math.hypot(i.x - i.ax, i.y - i.ay) > 10) {
          ctx.beginPath(); ctx.moveTo(i.ax, i.ay); ctx.lineTo(i.x, i.y);
          ctx.lineWidth = 1.2; ctx.strokeStyle = C.muted; ctx.stroke();
        }
      });
      items.forEach((i) => drawPill(ctx, i.x, i.y, fmt(i.n), 16));
      if (spec.home) {
        const I = { x: M.x + 14, y: M.y + 14, w: 250, h: 150 };
        ctx.save();
        ctx.beginPath(); ctx.rect(I.x, I.y, I.w, I.h); ctx.clip();
        ctx.fillStyle = C.sea; ctx.fillRect(I.x, I.y, I.w, I.h);
        px = project({ n: 28.6, s: 24.0, w: 122.7, e: 131.4 }, I).px;
        land();
        if (c[OKI]) { const a = px(spec.rep[OKI][0], spec.rep[OKI][1]); drawPill(ctx, a[0], a[1], fmt(c[OKI]), 16); }
        ctx.fillStyle = C.ink; ctx.font = font(18, true);
        ctx.fillText("沖縄県", I.x + 10, I.y + 25);
        ctx.restore();
        ctx.lineWidth = 1.5; ctx.strokeStyle = C.muted; ctx.strokeRect(I.x, I.y, I.w, I.h);
      }
    } else {
      const R = zoom < 12 ? 66 : zoom < 14 ? 40 : 14;
      const groups = [];
      spec.points.forEach((p) => {
        const [x, y] = px(p.la, p.ln);
        if (x < M.x - 40 || x > M.x + M.w + 40 || y < M.y - 40 || y > M.y + M.h + 40) return;
        let near = null, best = R;
        groups.forEach((g) => { const d = Math.hypot(g.x - x, g.y - y); if (d < best) { best = d; near = g; } });
        if (near) { near.items.push(p); near.sx += x; near.sy += y; } else groups.push({ x, y, sx: x, sy: y, items: [p] });
      });
      groups.filter((g) => g.items.length === 1).forEach((g) => { const p = g.items[0]; drawShape(ctx, spec.groups[p.g], g.x, g.y, 26, p.rough); });
      groups.filter((g) => g.items.length > 1).forEach((g) => {
        const n = g.items.length;
        drawBubble(ctx, g.sx / n, g.sy / n, n < 10 ? 17 : n < 100 ? 20 : n < 1000 ? 24 : 28, fmt(n), 18);
      });
    }
    ctx.restore();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.line;
    ctx.strokeRect(M.x, M.y, M.w, M.h);
  }

  function drawPanel(ctx, spec) {
    let y = P.y + 30;
    ctx.fillStyle = C.brand; ctx.font = font(26, true);
    ctx.fillText(`${spec.region}の学校の数`.slice(0, 22), P.x, y);
    y += 16;
    spec.rows.forEach((r) => {
      const g = spec.groups[r.key];
      const on = spec.on.has(r.key);
      y += r.sub ? 34 : 38;
      drawShape(ctx, g, P.x + 14, y - 9, 26, false);
      ctx.fillStyle = on ? C.ink : C.muted; ctx.font = font(24, true);
      ctx.fillText(g.label, P.x + 36, y);
      ctx.textAlign = "right";
      if (on) { ctx.fillStyle = C.ink; ctx.font = font(30, true); ctx.fillText(`${fmt(r.n)}校`, P.x + P.w, y); } else { ctx.fillStyle = C.muted; ctx.font = font(21); ctx.fillText("表示していません", P.x + P.w, y); }
      ctx.textAlign = "left";
      if (r.sub && on) { y += 26; ctx.fillStyle = C.muted; ctx.font = font(20); ctx.fillText(r.sub, P.x + 36, y); }
      y += 10;
      ctx.beginPath(); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); ctx.lineWidth = 1; ctx.strokeStyle = C.line; ctx.stroke();
    });
    y += 30;
    ctx.fillStyle = C.muted; ctx.font = font(20);
    y = drawWrapped(ctx, spec.partial ? `地図は一部の範囲です。校数は${spec.region}全体の数で、種類をまたいだ合計は出していません。` : "国の一覧に載っている学校の数です。日本語学校でもある専門学校があるため、種類をまたいだ合計は出していません。", P.x, y, P.w, 27, 3);
    y += 14;
    const m = spec.metric;
    const top = y;
    ctx.fillStyle = C.soft;
    ctx.fillRect(P.x, top, P.w, P.y + P.h - top);
    ctx.fillStyle = C.brand; ctx.fillRect(P.x, top, 5, P.y + P.h - top);
    y += 34;
    if (m) {
      ctx.fillStyle = C.ink; ctx.font = font(23, true);
      y = drawWrapped(ctx, m.label, P.x + 18, y, P.w - 28, 30, 2);
      y += 14;
      ctx.font = font(40, true);
      ctx.fillText(m.value, P.x + 18, y + 2);
      y += 32;
      ctx.fillStyle = C.muted; ctx.font = font(20);
      y = drawWrapped(ctx, `${m.area}・${m.period}${m.extra ? `（${m.extra}）` : ""}`, P.x + 18, y, P.w - 28, 26, 2);
      y = drawWrapped(ctx, m.note, P.x + 18, y + 2, P.w - 28, 26, 3);
    } else {
      ctx.fillStyle = C.muted; ctx.font = font(22);
      drawWrapped(ctx, "人数の色分けは表示していません。都道府県の色に意味はありません。", P.x + 18, y, P.w - 28, 30, 3);
    }
  }

  function drawFoot(ctx, spec) {
    // 点の凡例
    let x = M.x, y = M.y + M.h + 34;
    ctx.font = font(21);
    const item = (w, draw, label) => {
      draw(x + w / 2, y - 8);
      ctx.fillStyle = C.ink; ctx.font = font(21);
      ctx.fillText(label, x + w + 6, y);
      x += w + 6 + ctx.measureText(label).width + 24;
    };
    Object.keys(spec.groups).forEach((k) => item(26, (a, b) => drawShape(ctx, spec.groups[k], a, b, 24, false), spec.groups[k].label));
    item(26, (a, b) => drawShape(ctx, spec.groups.jp, a, b, 24, true), "白抜き＝町名の代表点");
    item(30, (a, b) => { if (spec.bubbles) drawPill(ctx, a, b, "12", 15); else drawBubble(ctx, a, b, 15, "12", 15); ctx.font = font(21); }, spec.bubbles ? "数字＝都道府県ごとの点の数" : "数字＝まとめた点の数");
    // 人数の凡例
    y += 40; x = M.x;
    if (spec.metric) {
      const rows = spec.metric.scale;
      const head = "人数の色：";
      let px = 21;
      ctx.font = font(px);
      const total = () => ctx.measureText(head).width + rows.reduce((s, r) => s + 28 + 5 + ctx.measureText(r.label).width + 20, 0);
      while (total() > W - 48 && px > 17) { px -= 1; ctx.font = font(px); }
      ctx.fillStyle = C.ink; ctx.fillText(head, x, y);
      x += ctx.measureText(head).width;
      rows.forEach((r) => {
        ctx.fillStyle = C.land; ctx.fillRect(x, y - 18, 28, 20);
        ctx.globalAlpha = spec.fillOpacity; ctx.fillStyle = r.color; ctx.fillRect(x, y - 18, 28, 20); ctx.globalAlpha = 1;
        ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.strokeRect(x, y - 18, 28, 20);
        ctx.fillStyle = C.ink; ctx.fillText(r.label, x + 33, y);
        x += 28 + 5 + ctx.measureText(r.label).width + 20;
      });
    } else {
      ctx.fillStyle = C.muted; ctx.font = font(21);
      ctx.fillText("人数の色分け：なし", x, y);
    }
    // 出典
    y += 36;
    ctx.fillStyle = C.muted;
    const sources = spec.metric ? `統計：${spec.metric.source}（基準日 ${spec.metric.period}）。色の濃さは人数の多さだけを表します。` : "学校の点と人数は別の情報です。";
    fitFont(ctx, sources, W - 48, 20, 16);
    ctx.fillText(sources, M.x, y);
    y += 30;
    const credit = `学校：国の一覧をもとに作成（確認日 ${spec.checked}）／境界：国土数値情報（行政区域データ）国土交通省を加工／位置：位置参照情報 国土交通省を加工`;
    fitFont(ctx, credit, W - 48, 20, 16);
    ctx.fillText(credit, M.x, y);
  }

  function render(spec) {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = C.brand; ctx.font = font(26, true);
    ctx.fillText(spec.siteName, M.x, 44);
    ctx.textAlign = "right"; ctx.fillStyle = C.brand; ctx.font = font(22, true);
    ctx.fillText(spec.siteUrl, W - 24, 44);
    ctx.textAlign = "left";
    ctx.fillStyle = C.ink;
    fitFont(ctx, spec.region, W - 48, 42, 28, true);
    ctx.fillText(spec.region, M.x, 92);
    drawMap(ctx, spec);
    drawPanel(ctx, spec);
    drawFoot(ctx, spec);
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
    });
  }

  return { render };
})();
