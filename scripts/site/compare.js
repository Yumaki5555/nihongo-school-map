/* 都道府県比較のページ：2つの都道府県の学校の数と国の統計の人数を、資料ごとに横に並べる。
   倍率は丸める前の値（人口あたりは 人数÷人口 の分数のまま）で正確に計算し、表・「比較のポイント」・投稿文・画像で同じ値を使う。
   1.5倍などの目安で「多い／少ない」を判定しない。理由・移動・良し悪しは言わない。ちがう資料の数は足したり比べたりしない */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const dec = (n, d) => Number(n).toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SITE_NAME = "日本語学校・留学生 全国マップ";
  const SCHOOL = { jp: "日本語学校", univ: "大学", jc: "短大", kosen: "高専", senmon: "専門学校" };
  const KINDS = Object.keys(SCHOOL);
  const CMP = ["13", "27"]; // 比べる2県の初期値（東京都と大阪府）
  const SMALL = 5; // 表だけ：少ないほうがこれ未満の行は、1つの違いで倍率が大きく動くので色を付けない
  const STEPS = [1.5, 2, 3]; // 色の濃さの区切り（1.1倍〜／1.5倍〜／2倍〜／3倍〜の4段階）。評価ではなく開きの大きさだけ
  // 表と文で使う名前。外国籍の児童生徒の合計は義務教育学校・中等教育学校も含むので「小中高校生」とは言わない
  const NAME = { ryugaku: "在留資格「留学」の人数", foreign: "外国籍の児童生徒（小・中・高等学校など）", nihongo: "日本語指導が必要な児童生徒（公立学校）" };
  // 数えた場所：住んでいる場所か、学校のある場所か
  const BASIS = { ryugaku: "住んでいる都道府県で数えた人数", foreign: "学校のある都道府県で数えた人数", nihongo: "学校のある都道府県で数えた人数" };
  const state = { a: CMP[0], b: CMP[1] };
  let D, S, R, view = null, imageUrl = "", imageJob = 0;

  Promise.all(["data/schools.json", "data/stats.json", "data/regions.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([d, s, r]) => { D = d; S = s; R = r; init(); })
    .catch(() => { $("cmp-loading").hidden = true; $("cmp-main").hidden = true; $("cmp-error").hidden = false; });

  function init() {
    const cm = (new URLSearchParams(location.search).get("cmp") || "").split("-");
    if (R.prefs[cm[0]] && R.prefs[cm[1]]) { state.a = cm[0]; state.b = cm[1]; }
    // 都道府県コードの順（北海道〜沖縄県）
    const opts = Object.keys(R.prefs).sort().map((c) => `<option value="${c}">${esc(R.prefs[c].name)}</option>`).join("");
    ["a", "b"].forEach((k) => {
      const el = $("cmp-" + k);
      el.innerHTML = opts;
      el.addEventListener("change", () => { state[k] = el.value; draw(); });
    });
    $("cmp-swap").addEventListener("click", () => { [state.a, state.b] = [state.b, state.a]; draw(); });
    $("cmp-rank").addEventListener("change", (e) => { $("cmp-table").classList.toggle("no-rank", !e.target.checked); });
    $("cmp-img").addEventListener("click", openImage);
    $("img-close").addEventListener("click", () => $("img-dialog").close());
    $("img-save").addEventListener("click", () => { $("img-saved").hidden = false; });
    $("img-dialog").addEventListener("close", () => { imageJob++; $("img-preview").removeAttribute("src"); if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = ""; });
    $("cmp-loading").hidden = true;
    $("cmp-main").hidden = false;
    window.__cmpSet = (a, b) => { state.a = a; state.b = b; draw(); return window.__cmpCheck; }; // 点検用
    draw();
  }

  // 選んだ組み合わせを URL に cmp=13-27 の形で残す（そのまま共有すると同じ比較が開く）
  const query = () => `?cmp=${state.a}-${state.b}`;
  function syncUrl() { history.replaceState(null, "", location.pathname + query()); }

  // 2つの値 x/xd と y/yd の関係（人口あたりは 人数/人口 のまま渡す）。整数の分数で比べるので、丸めの誤差が出ない。
  // win：x（1つ目が多い）/ y / eq（同じ）/ near（四捨五入すると1.0倍）/ na（データなし）。
  // 倍率は多いほう÷少ないほう。10倍未満は小数第1位、10倍以上は整数（どちらも四捨五入）。0 で割る倍率は出さない
  function rel(x, y, xd, yd) {
    const good = (v) => Number.isInteger(v) && v >= 0;
    const hasD = xd !== undefined || yd !== undefined;
    const miss = [];
    if (!good(x) || (hasD && !(good(xd) && xd > 0))) miss.push("x");
    if (!good(y) || (hasD && !(good(yd) && yd > 0))) miss.push("y");
    if (miss.length) return { win: "na", miss };
    const X = BigInt(x) * BigInt(hasD ? yd : 1), Y = BigInt(y) * BigInt(hasD ? xd : 1);
    if (X === Y) return { win: "eq" };
    const side = X > Y ? "x" : "y";
    const hi = side === "x" ? X : Y, lo = side === "x" ? Y : X;
    if (lo === 0n) return { win: side, side, zero: true };
    const t10 = (20n * hi + lo) / (2n * lo); // 10×倍率 を四捨五入した整数
    let t, exact;
    if (t10 < 100n) { t = (Number(t10) / 10).toFixed(1); exact = (10n * hi) % lo === 0n; }
    else { t = String((2n * hi + lo) / (2n * lo)); exact = hi % lo === 0n; }
    return { win: t === "1.0" ? "near" : side, side, t, r: Number(t), exact };
  }
  const level = (q) => (q.win === "x" || q.win === "y") && !q.zero ? 1 + STEPS.filter((v) => q.r >= v).length : 0;
  const about = (q) => (q.exact ? "" : "約");
  const other = (s) => (s === "x" ? "y" : "x");
  const nm = (s) => R.prefs[s === "x" ? state.a : state.b].name;
  const codeOf = (s) => (s === "x" ? state.a : state.b);

  function jpDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : iso;
  }
  const popOf = () => (S.rates || []).map((r) => r.denominator).find((d) => d && d.values) || null;

  // 表の行。nums（と dens）で倍率を計算し、disp を表示と順位に使う（人口あたりは公表と同じ桁に丸めた計算値）
  function collect() {
    const groups = [];
    const mk = (o) => { o.disp = o.disp || o.nums; o.q = rel(o.nums[state.a], o.nums[state.b], o.dens && o.dens[state.a], o.dens && o.dens[state.b]); return o; };
    const pop = popOf();
    if (pop) {
      groups.push({ title: "住民の数", line: `${esc(pop.label)}・${esc(pop.period)}。住民1万人あたりの計算に使う人口です。`,
        about: `出典：<a href="${esc(pop.source_url)}" target="_blank" rel="noopener">${esc(pop.source_name)}</a>`,
        rows: [mk({ key: "pop", label: "住民の数", unit: "人", nums: pop.values, ref: true })] });
    }
    const cnt = {};
    KINDS.forEach((t) => { cnt[t] = {}; Object.keys(R.prefs).forEach((c) => { cnt[t][c] = 0; }); });
    D.schools.forEach((s) => { if (cnt[s.t]) cnt[s.t][s.p]++; });
    const agencies = [...new Set((D.bases || []).map((b) => b.name.split("「")[0]))].join("・");
    groups.push({ title: "学校の数", line: `確認日 ${esc(jpDate(D.generated))}・学校の所在地で数えた校数（学生の人数ではありません）`,
      about: `国の一覧（${esc(agencies)}）に載っている学校を数えました。大学・短大・高専・専門学校は本部・本校の所在地で数えています（キャンパスごとではありません）。`,
      rows: KINDS.map((t) => mk({ key: t, label: SCHOOL[t], unit: "校", nums: cnt[t] })) });
    S.indicators.forEach((ind) => {
      const g = { id: ind.id, title: NAME[ind.id] || ind.label, line: `${esc(ind.period)}・${esc(BASIS[ind.id] || ind.note)}`,
        about: `${esc(ind.scope)}<br>出典：<a href="${esc(ind.source_url)}" target="_blank" rel="noopener">${esc(ind.source_name)}</a>`,
        rows: ind.variants.map((v) => mk({ key: `${ind.id}:${v.id}`, label: v.id === "all" ? "合計" : v.label, unit: ind.unit, nums: v.values })) };
      const part = (k) => g.rows.find((r) => r.key === `${ind.id}:${k}`);
      const all = part("all");
      // 外国籍の児童生徒：合計は5種類の学校の表の和。内訳に出していない義務教育学校・中等教育学校の分を書く（合計は書き換えない）
      if (ind.id === "foreign" && all && ["elem", "mid", "high"].every(part)) {
        const rest = (c) => all.nums[c] - ["elem", "mid", "high"].reduce((s, k) => s + part(k).nums[c], 0);
        g.restOf = rest;
        g.note = `※合計には、内訳の3行にない義務教育学校・中等教育学校の児童生徒（${esc(nm("x"))} ${fmt(rest(state.a))}人、${esc(nm("y"))} ${fmt(rest(state.b))}人）も入っています。そのため3行を足しても合計になりません。`;
      }
      if (ind.id === "nihongo") g.note = `※合計＝外国籍＋日本国籍です。「日本国籍」は帰化した人の数ではありません（海外から帰国した子どもなども含みます）。外国籍の児童生徒の数とは別の調査なので、足したり引いたりできません。<a href="nihongo.html?cmp=${state.a}-${state.b}#trend">2つの都道府県の推移・内訳を見る</a>`;
      groups.push(g);
    });
    (S.rates || []).forEach((r) => {
      const n = S.indicators.find((i) => i.id === r.numerator.indicator);
      const nv = n && n.variants.find((v) => v.id === r.numerator.variant);
      if (!nv) return;
      groups.push({ title: r.label + "（当サイトの計算値）", line: "国の公表値ではありません。倍率は丸める前の値で計算しています。",
        about: `${esc(r.formula)}（${esc(r.rounding)}）。${esc(r.why)}`,
        rows: [mk({ key: "rate:" + r.id, label: "住民1万人あたり", unit: r.unit, nums: nv.values, dens: r.denominator.values, disp: r.values, digits: r.digits, ref: true })] });
    });
    return groups;
  }

  // 表示する値（データがなければ null）
  function shown(row, s) {
    const v = row.disp[codeOf(s)];
    return typeof v === "number" ? v : null;
  }
  const valText = (row, s) => { const v = shown(row, s); return v === null ? "データなし" : (row.digits ? dec(v, row.digits) : fmt(v)) + row.unit; };
  // 差（人口あたりは表示している桁の値どうしの差）
  function diffText(row) {
    if (!row.digits) return fmt(Math.abs(row.nums[state.a] - row.nums[state.b])) + row.unit;
    const k = Math.pow(10, row.digits), d = Math.abs(Math.round(shown(row, "x") * k) - Math.round(shown(row, "y") * k)) / k;
    return d ? dec(d, row.digits) + row.unit : `${dec(1 / k, row.digits)}${row.unit}未満`;
  }
  // 全国の順位（多い順。同じ数は同じ順位）
  function rankOf(values, code) { return 1 + Object.values(values).filter((x) => x > values[code]).length; }

  // 「何倍？」の欄
  function ratioCell(row) {
    const q = row.q;
    let main, sub = "", lv = level(q);
    if (q.win === "na") { main = "—"; sub = `${q.miss.map(nm).join("・")}のデータなし`; }
    else if (q.win === "eq") main = row.nums[state.a] === 0 ? "どちらも0" : row.unit === "校" ? "同数" : "同じ";
    else if (q.zero) { main = "—"; sub = `${nm(other(q.side))}が0${row.unit}のため倍率なし`; }
    else if (q.win === "near") { main = "ほぼ同じ"; sub = `差${diffText(row)}`; }
    else main = `${nm(q.side)} ${q.t}倍`;
    if (!row.ref && (q.win === "x" || q.win === "y") && !q.zero && Math.min(row.nums[state.a], row.nums[state.b]) < SMALL) { sub = "数が少ないので参考"; lv = 0; }
    return { main, sub, lv };
  }

  // ---- 比較のポイント（表と同じ値から、決まった手順で作る文。1項目1〜2文） ----
  // ひとつの数の比較：「〇〇は、A（x人）がB（y人）の約3.0倍です。」
  function say(subj, row) {
    const q = row.q, u = row.unit, v = (s) => valText(row, s);
    if (q.win === "na") return `${subj}は、${q.miss.map(nm).join("・")}のデータがないため比べられません。`;
    if (q.win === "eq") return row.nums[state.a] === 0 ? `${subj}は、どちらも0${u}です。` : `${subj}は、どちらも${v("x")}で同じです。`;
    const W = q.side, L = other(W);
    if (q.zero) return `${subj}は、${nm(W)}が${v(W)}、${nm(L)}は0${u}です（0${u}とは倍率を計算しません）。`;
    if (q.win === "near") return `${subj}は、${nm("x")}（${v("x")}）と${nm("y")}（${v("y")}）でほぼ同じです（${nm(W)}が${diffText(row)}多い）。`;
    return `${subj}は、${nm(W)}（${v(W)}）が${nm(L)}（${v(L)}）の${about(q)}${q.t}倍です。`;
  }

  // ① 在留資格「留学」：人数と、住民1万人あたり。大小が逆になるときは、住民の数の開きのほうが大きいことを書く
  function pointRyu(find) {
    const rw = find("ryugaku:all"), per = find("rate:ryugaku_pop"), pop = find("pop");
    if (!rw) return "";
    const s1 = say(NAME.ryugaku, rw);
    if (rw.q.win === "na") return s1;
    if (!per) return s1 + "住民1万人あたりは、人口のデータがないため計算していません。";
    const q = rw.q, p = per.q, pv = (s) => valText(per, s);
    if (p.win === "na") return s1 + "住民1万人あたりは、人口のデータがないため計算できません。";
    if (p.win === "eq" && rw.nums[state.a] === 0) return s1 + "住民1万人あたりも、どちらも0人です。";
    if (p.win === "eq" || p.win === "near") return s1 + `住民1万人あたりでは、${nm("x")} ${pv("x")}、${nm("y")} ${pv("y")}で、${p.win === "eq" ? "同じ" : "ほぼ同じ"}です。`;
    const W = p.side, L = other(W);
    if (p.zero) return s1 + `住民1万人あたりでは、${nm(W)}が${pv(W)}、${nm(L)}は0${per.unit}です。`;
    const tail = `${nm(W)}（${pv(W)}）が${nm(L)}（${pv(L)}）の${about(p)}${p.t}倍です。`;
    if ((q.win === "x" || q.win === "y") && q.side === W) return s1 + "住民1万人あたりでも、" + tail;
    if (q.win === "x" || q.win === "y") {
      // 逆転：人数は q.side が多いが、住民の数の開きがそれより大きい
      const pq = pop && pop.q;
      const gap = pq && (pq.win === "x" || pq.win === "y") && pq.side === q.side && pq.r > q.r ? `${nm(q.side)}が${nm(other(q.side))}の${about(pq)}${pq.t}倍で` : `${nm(q.side)}のほうが多く`;
      return s1 + `ただし住民の数は${gap}、人数の開きより大きいため、住民1万人あたりでは逆に` + tail;
    }
    return s1 + "住民1万人あたりでは、" + tail;
  }

  // ② 学校の数：何校多いか。差の大きい2種類まで（残りは表で）
  function pointSchools(find) {
    const list = KINDS.map(find).filter(Boolean);
    const ok = list.filter((r) => r.q.win !== "na").map((r) => ({ r, d: Math.abs(r.nums[state.a] - r.nums[state.b]) }));
    const miss = list.filter((r) => r.q.win === "na").map((r) => SCHOOL[r.key]);
    const missTx = miss.length ? `${miss.join("・")}はデータがありません。` : "";
    if (!ok.length) return "学校の数はデータがないため比べられません。";
    const diff = ok.filter((o) => o.d > 0).sort((p, q) => q.d - p.d || KINDS.indexOf(p.r.key) - KINDS.indexOf(q.r.key));
    if (!diff.length) return `${ok.map((o) => SCHOOL[o.r.key]).join("・")}の数は、どれも同数です。` + missTx;
    const top = diff.slice(0, 2);
    const one = (o) => `${SCHOOL[o.r.key]}（${nm("x")} ${fmt(o.r.nums[state.a])}校、${nm("y")} ${fmt(o.r.nums[state.b])}校で、${nm(o.r.q.side)}が${fmt(o.d)}校多い）`;
    const rest = ok.filter((o) => !top.includes(o));
    let s = rest.length && rest.every((o) => !o.d) && top.length === 1 ? `学校の数で差があるのは、${one(top[0])}です。` : `学校の数の差が大きいのは、${top.map(one).join("と")}です。`;
    if (rest.length) s += rest.every((o) => !o.d) ? `${rest.map((o) => SCHOOL[o.r.key]).join("・")}は同数です。` : `${rest.map((o) => SCHOOL[o.r.key]).join("・")}は下の表で確認できます。`;
    return s + missTx;
  }

  // ③ 外国籍の児童生徒・日本語指導：別の調査なので、それぞれ別の文にする（足さない）
  function pointKids(find) {
    const f = find("foreign:all"), n = find("nihongo:all");
    return (f ? say(NAME.foreign, f) : "") + (n ? say("日本語指導が必要な児童生徒（公立学校、日本国籍の子どもも含む）", n) : "");
  }

  // 投稿文用の短い言い方
  function short(row) {
    const q = row.q;
    if (q.win === "na") return "データなし";
    if (q.win === "eq") return row.unit === "校" ? "同数" : "同じ";
    if (q.zero) return `${nm(q.side)}のみ（${nm(other(q.side))}は0${row.unit}）`;
    if (q.win === "near") return "ほぼ同じ";
    return `${nm(q.side)}が${about(q)}${q.t}倍`;
  }
  // X の文字数（日本語などは2、URL は23として数える）
  const xLen = (t) => [...t].reduce((s, c) => s + (/[\u0000-ჿ -‍‐-‟′-‷]/.test(c) ? 1 : 2), 0);
  function shareText(find) {
    const lines = [`${nm("x")}と${nm("y")}をくらべると`];
    const rw = find("ryugaku:all"), per = find("rate:ryugaku_pop");
    if (rw) {
      let t = `・在留資格「留学」の人数：${short(rw)}`;
      if (per && per.q.win !== "na" && rw.q.win !== "na") {
        const p = per.q;
        t += p.win === "eq" || p.win === "near" ? "（住民1万人あたりではほぼ同じ）"
          : p.zero ? "" : `（住民1万人あたり${(rw.q.win === "x" || rw.q.win === "y") && rw.q.side === p.side ? "でも" : "では"}${nm(p.side)}が${about(p)}${p.t}倍）`;
      }
      lines.push(t);
    }
    const sc = KINDS.map(find).filter((r) => r && r.q.win !== "na").map((r) => ({ r, d: Math.abs(r.nums[state.a] - r.nums[state.b]) }))
      .sort((p, q) => q.d - p.d || KINDS.indexOf(p.r.key) - KINDS.indexOf(q.r.key))[0];
    if (sc) lines.push(sc.d ? `・${SCHOOL[sc.r.key]}の数：${nm(sc.r.q.side)}が${fmt(sc.d)}校多い` : "・学校の数：5種類とも同数");
    const f = find("foreign:all"), n = find("nihongo:all");
    if (f) lines.push(`・外国籍の児童生徒：${short(f)}`);
    if (n) lines.push(`・日本語指導が必要な児童生徒：${short(n)}`);
    while (lines.length > 2 && xLen(lines.join("\n")) + 24 > 270) lines.pop();
    return lines.join("\n");
  }

  function draw() {
    const { a, b } = state;
    $("cmp-a").value = a;
    $("cmp-b").value = b;
    syncUrl();
    const same = a === b;
    $("cmp-same").hidden = !same;
    $("cmp-same").textContent = same ? `異なる都道府県を選択してください（いまは2つとも${R.prefs[a].name}です）。` : "";
    $("cmp-result").hidden = same;
    if (same) { view = null; window.__cmpCheck = { a, b, same: true }; return; }
    $("cmp-ha").textContent = nm("x");
    $("cmp-hb").textContent = nm("y");
    const groups = collect();
    const all = groups.flatMap((g) => g.rows);
    const find = (k) => all.find((r) => r.key === k);
    let h = "";
    groups.forEach((g) => {
      h += `<tr class="cmp-group" role="row"><th scope="colgroup" colspan="4" role="cell">${esc(g.title)}<small>${g.line}</small>`
        + (g.about ? `<details class="cmp-about"><summary>資料と数え方</summary><p>${g.about}</p></details>` : "") + "</th></tr>";
      g.rows.forEach((r) => {
        const c = ratioCell(r);
        r.cell = c;
        const td = (s) => { const v = shown(r, s); return `<td class="num" role="cell">${valText(r, s)}${v === null ? "" : `<small class="rk">全国${rankOf(r.disp, codeOf(s))}位</small>`}</td>`; };
        h += `<tr role="row"${r.ref ? ' class="cmp-ref"' : ""}><th scope="row" role="rowheader">${esc(r.label)}</th>${td("x")}${td("y")}`
          + `<td role="cell" class="num cmp-ratio${c.lv ? ` s${r.q.side} lv${c.lv}` : ""}">${esc(c.main)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</td></tr>`;
      });
      if (g.note) h += `<tr class="cmp-note" role="row"><td colspan="4" role="cell">${g.note}</td></tr>`;
    });
    $("cmp-body").innerHTML = h;
    const sw = (s) => `<i class="cmp-sw">${[1, 2, 3, 4].map((l) => `<b class="s${s} lv${l}"></b>`).join("")}</i>`;
    $("cmp-legend").innerHTML = `<span>${sw("x")}${esc(nm("x"))}のほうが多い</span><span>${sw("y")}${esc(nm("y"))}のほうが多い</span>`;
    const points = [
      { h: "在留資格「留学」", t: pointRyu(find) },
      { h: "学校の数", t: pointSchools(find) },
      { h: "外国籍の児童生徒・日本語指導", t: pointKids(find) },
    ].filter((p) => p.t);
    $("cmp-points").innerHTML = points.map((p) => `<li><b>${esc(p.h)}</b>${esc(p.t)}</li>`).join("");
    const text = shareText(find);
    const url = document.body.dataset.site + "compare.html" + query();
    $("cmp-share").href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    view = { find, groups, text, url };
    const fg = groups.find((g) => g.id === "foreign");
    window.__cmpCheck = {
      a, b, points, text, url,
      rows: all.map((r) => ({ key: r.key, x: r.nums[a], y: r.nums[b], dx: shown(r, "x"), dy: shown(r, "y"), win: r.q.win, side: r.q.side || "", t: r.q.t || "", exact: !!r.q.exact, main: r.cell.main, sub: r.cell.sub, lv: r.cell.lv })),
      rest: fg && fg.restOf ? [fg.restOf(a), fg.restOf(b)] : null,
    };
  }

  // ---- 画像保存（縦長 1080×1350。2本の横棒は項目ごとの長さで、ちがう項目どうしは同じ物差しにしない） ----
  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function imageSpec() {
    const { find } = view;
    const ind = (id) => S.indicators.find((i) => i.id === id);
    const tag = (row) => {
      const q = row.q;
      if (row.unit === "校" && (q.win === "x" || q.win === "y" || q.win === "near")) return `${nm(q.side)}が${fmt(Math.abs(row.nums[state.a] - row.nums[state.b]))}校多い`;
      return short(row);
    };
    const sec = (title, sub, row) => row && { title, sub, tag: tag(row), bars: ["x", "y"].map((s) => ({ side: s, name: nm(s), n: shown(row, s), value: valText(row, s) })) };
    const ryu = ind("ryugaku"), fo = ind("foreign"), ni = ind("nihongo"), rt = (S.rates || [])[0], pop = popOf();
    const sections = [
      ryu && sec(NAME.ryugaku, `${ryu.period}・${BASIS.ryugaku}`, find("ryugaku:all")),
      rt && sec("住民1万人あたりの在留資格「留学」の人数", "当サイトの計算値（人数÷住民の数×1万）", find("rate:" + rt.id)),
      sec("日本語学校の数", `確認日 ${jpDate(D.generated)}・学校の所在地で数えた校数`, find("jp")),
      fo && sec(NAME.foreign, `${fo.period}・${BASIS.foreign}`, find("foreign:all")),
      ni && sec(NAME.nihongo, `${ni.period}・${BASIS.nihongo}（日本国籍の子どもを含む）`, find("nihongo:all")),
    ].filter(Boolean);
    const agencies = [...new Set((D.bases || []).filter((x) => !/学校コード/.test(x.name)).map((x) => x.name.split("「")[0]))].join("・");
    const foot = [
      ryu && `在留資格「留学」：${ryu.source_name}`,
      pop && `住民の数：${pop.source_name}`,
      `日本語学校の数：国の一覧（${agencies}）`,
      fo && `外国籍の児童生徒：${fo.source_name}`,
      ni && `日本語指導：${ni.source_name}`,
      "倍率は多いほう÷少ないほう。住民1万人あたりは国の公表値ではありません。項目ごとに資料・対象・基準日がちがうので、ちがう項目の数どうしは比べられません。",
    ].filter(Boolean);
    return {
      kind: "compare",
      siteName: SITE_NAME,
      siteUrl: document.body.dataset.site,
      pageUrl: view.url,
      names: { x: nm("x"), y: nm("y") },
      subtitle: `都道府県比較｜${SITE_NAME}`,
      sections, foot,
      file: `nihongo-map_compare_${state.a}-${state.b}_${dateStamp()}.png`,
    };
  }

  function openImage() {
    if (!view) return;
    $("img-saved").hidden = true;
    $("img-preview").hidden = true;
    $("img-x").href = $("cmp-share").href;
    $("img-x-text").textContent = view.text + "\n" + view.url;
    $("img-dialog").showModal();
    const img = $("img-preview"), save = $("img-save"), job = ++imageJob;
    save.hidden = true;
    $("img-status").textContent = "画像を作っています…";
    const spec = imageSpec();
    window.__cmpImage = spec;
    window.MapImage.render(spec).then((blob) => {
      if (job !== imageJob) return;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(blob);
      img.src = imageUrl;
      img.alt = `保存する画像のプレビュー：${spec.names.x}と${spec.names.y}の比較`;
      img.hidden = false;
      save.href = imageUrl;
      save.download = spec.file;
      save.hidden = false;
      $("img-status").textContent = `ファイル名：${spec.file}（1080×1350ピクセル）`;
    }).catch(() => { if (job === imageJob) $("img-status").textContent = "画像を作れませんでした。ページを開き直してお試しください。"; });
  }
})();
