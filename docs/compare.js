/* 都道府県比較のページ：2つの都道府県の学校の数と国の統計の人数を、資料ごとに横に並べる。
   倍率は多い側の色で塗る。「人口の割に」は人口と数え方がそろう留学生の行だけで判断する */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const dec = (n, d) => Number(n).toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SCHOOL = { jp: { label: "日本語学校の数" }, univ: { label: "大学の数" }, jc: { label: "短大の数" }, kosen: { label: "高専の数" }, senmon: { label: "専門学校の数" } };
  const KINDS = ["jp", "univ", "jc", "kosen", "senmon"];
  const CMP = ["13", "27"]; // 比べる2県の初期値（東京都と大阪府）
  const state = { a: CMP[0], b: CMP[1] };
  let D, S, R;

  Promise.all(["data/schools.json", "data/stats.json", "data/regions.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([d, s, r]) => { D = d; S = s; R = r; init(); })
    .catch(() => { $("cmp-error").hidden = false; });

  function init() {
    const cm = (new URLSearchParams(location.search).get("cmp") || "").split("-");
    if (R.prefs[cm[0]] && R.prefs[cm[1]]) { state.a = cm[0]; state.b = cm[1]; }
    const opts = Object.keys(R.prefs).sort().map((c) => `<option value="${c}">${esc(R.prefs[c].name)}</option>`).join("");
    ["a", "b"].forEach((k) => {
      const el = $("cmp-" + k);
      el.innerHTML = opts;
      el.addEventListener("change", () => { state[k] = el.value; drawCompare(); });
    });
    drawCompare();
  }

  // 初期の組み合わせ以外は、URL に cmp=13-27 の形で残す（そのまま共有できる）
  function syncUrl() { history.replaceState(null, "", location.pathname + (state.a !== CMP[0] || state.b !== CMP[1] ? `?cmp=${state.a}-${state.b}` : "")); }

  // 全国の順位（同じ数は同じ順位）
  function rankOf(values, code) { return 1 + Object.values(values).filter((x) => x > values[code]).length; }

  // 2つの都道府県：同じ資料・同じ基準日の数だけを、資料ごとの見出しの下で横に並べる。
  // 「何倍？」の列は、多い側の色（1つ目＝青、2つ目＝オレンジ）で、開きが大きいほど濃く塗る。
  // 人口（住民の数）を物差しにして、人口の差より大きく開いている項目を「人口の割に多い」とする。
  const CONC = 1.5; // 人口あたりにして、これ以上ちがえば「人口の割に多い」
  const SMALL = 5; // 少ないほうがこれ未満の行は、1つの違いで倍率が大きく動くので判断に使わない
  const STEPS = [1.5, 2, 3]; // 色の濃さの区切り（1.1倍〜／1.5倍〜／2倍〜／3倍〜の4段階）
  const SHORT = {
    jp: "日本語学校", univ: "大学", jc: "短大", kosen: "高専", senmon: "専門学校", "ryugaku:all": "留学生",
    "foreign:all": "外国籍の小中高校生", "foreign:elem": ["外国籍の小学生", "小学生"], "foreign:mid": ["外国籍の中学生", "中学生"], "foreign:high": ["外国籍の高校生", "高校生"],
    "nihongo:all": "日本語指導が必要な子ども", "nihongo:foreign": ["日本語指導が必要な外国籍の子ども", "外国籍"], "nihongo:japan": ["日本語指導が必要な日本国籍の子ども", "日本国籍"],
  };
  const shortOf = (i) => { const s = SHORT[i.key]; return Array.isArray(s) ? s[0] : s || i.full; };
  function level(q) { return !q.r || q.win === "near" ? 0 : 1 + STEPS.filter((v) => q.r >= v).length; }
  function popOf() { return (S.rates || []).map((r) => r.denominator).find((d) => d && d.values) || null; }

  function drawCompare() {
    const { a, b } = state;
    $("cmp-a").value = a;
    $("cmp-b").value = b;
    $("cmp-ha").textContent = R.prefs[a].name;
    $("cmp-hb").textContent = R.prefs[b].name;
    const check = [];
    const items = []; // 「ひとことで」を作るための行の一覧
    let gName = "";
    const name = (w) => R.prefs[w === "x" ? a : b].name;
    const pop = popOf();
    // 人口でくらべてよいのは、人口あたりの計算値（rates）の分子になっている行だけ（数え方が人口とそろうもの）
    const PERKEYS = (S.rates || []).map((r) => `${r.numerator.indicator}:${r.numerator.variant}`);
    const P = pop && pop.values[a] > 0 && pop.values[b] > 0 ? pop.values[a] / pop.values[b] : null; // 人口の比（1つ目÷2つ目）
    const cell = (values, code, show) => `<td class="num">${show(values[code])}<small>全国${rankOf(values, code)}位</small></td>`;
    const group = (title, sub, gname) => { gName = gname || ""; return `<tr class="cmp-group"><th scope="colgroup" colspan="4">${esc(title)}<small>${sub}</small></th></tr>`; };
    // ref：人口の行と人口あたりの行（それ自体が物差しなので「人口の割に」は付けない）
    const row = (label, values, show, full, key, ref) => {
      const x = values[a], y = values[b], q = rel(x, y);
      const k = P && x > 0 && y > 0 ? x / y / P : null; // 人口あたりにした比（1つ目÷2つ目）
      const usable = !ref && PERKEYS.includes(key) && k !== null && Math.min(x, y) >= SMALL;
      const conc = usable ? (k >= CONC ? "x" : k <= 1 / CONC ? "y" : "") : "";
      let main = q.win === "near" ? "ほぼ同じ" : q.t, sub = "";
      if (q.win === "na") { main = "—"; sub = "数がありません"; }
      else if (q.win === "eq") main = x === 0 ? "どちらも0" : "同じ";
      else if (q.zero) { main = "—"; sub = "片方が0で計算できません"; }
      // 少ないほうが SMALL 未満の行は、倍率が当てにならないので色を付けない
      const tiny = !ref && !q.zero && q.win !== "na" && q.win !== "eq" && Math.min(x, y) < SMALL;
      if (tiny) sub = "数が少ないので参考";
      // 人口の割に多い側が、数そのものが多い側（セルの色）と同じなら名前を省く
      if (conc) sub = conc === q.side && q.win !== "near" ? "★人口の割にも多い" : `★人口の割には${esc(name(conc))}`;
      const lv = tiny || q.zero || q.win === "na" || q.win === "eq" ? 0 : level(q);
      const more = q.side && q.win !== "eq" && q.win !== "na" ? `${name(q.side)}のほうが多い` : "";
      check.push([label, x, y, main, key, conc, lv]);
      items.push({ g: gName, label, full: full || label, key, x, y, q, k, usable, conc, ref: !!ref });
      return `<tr${ref ? ' class="cmp-ref"' : ""}><th scope="row">${esc(label)}</th>${cell(values, a, show)}${cell(values, b, show)}`
        + `<td class="num cmp-ratio${lv ? ` s${q.side} lv${lv}` : ""}${conc ? " conc" : ""}"${more ? ` title="${esc(more)}"` : ""}>${main}`
        + `${more ? `<span class="vh">（${esc(more)}）</span>` : ""}${sub ? `<small>${sub}</small>` : ""}</td></tr>`;
    };
    const cnt = {};
    KINDS.forEach((t) => { cnt[t] = {}; Object.keys(R.prefs).forEach((c) => { cnt[t][c] = 0; }); });
    D.schools.forEach((s) => { if (cnt[s.t]) cnt[s.t][s.p]++; });
    let h = "";
    if (pop) {
      h += group("人口（くらべる物差し）", `${esc(pop.source_name)}・基準日 ${esc(pop.period)}。在留資格「留学」の人数の開きが、この人口の差より大きいかどうかで「人口の割に多い」を決めています。学校の数や子どもの人数は、数える対象がちがうのでこの物差しを使いません。`, "");
      h += row("住民の数", pop.values, (n) => fmt(n) + "人", "住民の数", "pop", true);
    }
    h += group("学校の数", `国の一覧で数えた校数・確認日 ${esc(D.generated)}。大学・短大・高専・専門学校は本部・本校の所在地で数えています。`, "学校の数");
    KINDS.forEach((t) => { h += row(SCHOOL[t].label.replace(/の数$/, ""), cnt[t], (n) => fmt(n) + "校", SCHOOL[t].label, t); });
    S.indicators.forEach((ind) => {
      h += group(ind.label, `${esc(ind.source_name)}・基準日 ${esc(ind.period)}。${esc(ind.note)}`, ind.label);
      ind.variants.forEach((v) => { h += row(v.id === "all" ? "合計" : v.label, v.values, (n) => fmt(n) + "人", v.id === "all" ? (ind.variants.length > 1 ? `${ind.label}（合計）` : ind.label) : `${ind.label}（${v.label}）`, `${ind.id}:${v.id}`); });
    });
    (S.rates || []).forEach((r) => {
      h += group(r.label + "（計算値）", `国の公表値ではありません。${esc(r.formula)}（${esc(r.rounding)}）。`, "");
      h += row("住民1万人あたり", r.values, (n) => dec(n, r.digits) + "人", r.label, "rate:" + r.id, true);
    });
    $("cmp-body").innerHTML = h;
    $("cmp-same").hidden = a !== b;
    const sw = (s) => `<i class="cmp-sw">${[1, 2, 3, 4].map((l) => `<b class="s${s} lv${l}"></b>`).join("")}</i>`;
    $("cmp-legend").innerHTML = `<span>${sw("x")}${esc(name("x"))}のほうが多い</span><span>${sw("y")}${esc(name("y"))}のほうが多い</span><span>色が濃いほど開きが大きい（左から1.1倍〜・1.5倍〜・2倍〜・3倍〜）。色なしは、ほぼ同じか、数が少なくて倍率が当てにならない行。★は、人口の割にも多いこと（留学生の行だけで判断）。</span>`;
    const say = a === b ? null : sayCompare(items, name, P);
    $("cmp-say").hidden = !say;
    $("cmp-say").innerHTML = say ? `<h3>ひとことで言うと</h3><p class="cmp-lead">${say.lead}</p><ul>${say.li.map((s) => `<li>${s}</li>`).join("")}</ul>`
      + `<p class="fine">表の数字から決まった手順で作った文です（人が書いた解説ではありません）。「人口の割に多い」は、人口と数え方がそろう在留資格「留学」の人数だけで判断し、住民1万人あたりにしたとき${CONC}倍以上ちがうときです（どちらも住んでいる都道府県で数え、基準日の差は1日）。数の大きさをくらべているだけで、なぜ多いのかという理由や、地域・学校の良し悪しは、この数からは分かりません。</p>` : "";
    syncUrl();
    window.__cmpCheck = { a, b, P, rows: check, x: say ? say.X : [], y: say ? say.Y : [], lead: say ? say.lead.replace(/<[^>]+>/g, "") : "", li: say ? say.li.map((s) => s.replace(/<[^>]+>/g, "")) : [] };
  }

  // 2つの数の関係。win は x（1つ目が多い）/ y / eq（同じ）/ near（四捨五入で1.0倍）/ na（数がない）。
  // 倍率は多いほう÷少ないほう（10倍未満は小数第1位、10倍以上は整数に四捨五入）
  function rel(x, y) {
    if (typeof x !== "number" || typeof y !== "number") return { win: "na" };
    if (x === y) return { win: "eq" };
    const side = x > y ? "x" : "y";
    const small = Math.min(x, y);
    if (small <= 0) return { win: side, side, zero: true };
    const r = Math.max(x, y) / small;
    const t = r < 10 ? (Math.round(r * 10) / 10).toFixed(1) : String(Math.round(r));
    return { win: t === "1.0" ? "near" : side, side, r: Number(t), t: t + "倍" };
  }

  // 「ひとことで」：人口を物差しにして、留学生（人口と数え方がそろう行）が人口の差以上に開いているかを短く言う。
  // 学校の数や子どもの人数は、総人口とは数える対象がちがうので判断しない（第4段階の決まり）。理由や良し悪しは言わない
  function sayCompare(items, name, P) {
    if (!P) return null;
    const pq = rel(P, 1);
    const popTx = pq.win === "x" || pq.win === "y" ? `${esc(name(pq.side))}が${pq.t}` : "ほぼ同じ";
    const lead = [], li = [], X = [], Y = [];
    (S.rates || []).forEach((r) => {
      const raw = items.find((i) => i.key === `${r.numerator.indicator}:${r.numerator.variant}`);
      const per = items.find((i) => i.key === "rate:" + r.id);
      if (!raw || raw.q.win === "na") return;
      const nm = esc(shortOf(raw));
      if (!raw.usable) { lead.push(`${nm}の数が少ないので、人口とくらべた判断はできません。`); return; }
      const rt = raw.q.win === "near" || raw.q.win === "eq" ? "ほぼ同じ" : `${esc(name(raw.q.side))}が${raw.q.t}`;
      if (raw.conc) {
        (raw.conc === "x" ? X : Y).push(raw.key);
        const S2 = esc(name(raw.conc));
        if (raw.q.win === raw.conc) lead.push(`${nm}は、人口の差（${popTx}）を超えて、<b>${S2}に集まっています</b>（${raw.q.t}）。`);
        else if (raw.q.win === "x" || raw.q.win === "y") lead.push(`${nm}の数は${esc(name(raw.q.side))}のほうが多いものの（${raw.q.t}）、人口の差（${popTx}）ほどではなく、<b>人口の割には${S2}のほうが多い</b>です。`);
        else lead.push(`${nm}の数はほぼ同じですが、人口は${popTx}なので、<b>人口の割には${S2}のほうが多い</b>です。`);
      } else {
        lead.push(`${nm}の差（${rt}）は、人口の差（${popTx}）とくらべて大きくは変わらず、<b>人口の割にどちらかに特に多いとまでは言えません</b>。`);
      }
      if (per && typeof per.x === "number" && typeof per.y === "number") {
        const pt = per.q.win === "x" || per.q.win === "y" ? `${esc(name(per.q.side))}が${per.q.t}` : "ほぼ同じ";
        li.push(`住民1万人あたりの${nm}：${esc(name("x"))} ${dec(per.x, r.digits)}人、${esc(name("y"))} ${dec(per.y, r.digits)}人（${pt}）`);
      }
    });
    if (!lead.length) return null;
    li.push("学校の数や子どもの人数は、総人口とは数える対象がちがうので、人口の割に多いかどうかは判断していません。開きの大きさは表の色で見てください。");
    return { lead: lead.join(""), li, X, Y };
  }
})();
