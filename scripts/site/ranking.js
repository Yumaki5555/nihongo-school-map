/* ランキングのページ：都道府県（校数・人数）と市区町村（校数のみ）を多い順に並べる */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString("ja-JP");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SCHOOL = {
    jp: { label: "日本語学校の数", types: ["jp"], map: "jp" },
    higher: { label: "大学・短大・高専の数", types: ["univ", "jc", "kosen"], map: "higher" },
    univ: { label: "大学の数", types: ["univ"], map: "higher" },
    jc: { label: "短大の数", types: ["jc"], map: "higher" },
    kosen: { label: "高専の数", types: ["kosen"], map: "higher" },
    senmon: { label: "専門学校の数", types: ["senmon"], map: "senmon" },
  };
  const CITY_TOP = 50;
  const state = { m: "jp", unit: "pref", pref: "" };
  let D, S, R;

  Promise.all(["data/schools.json", "data/stats.json", "data/regions.json"].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); })))
    .then(([d, s, r]) => { D = d; S = s; R = r; init(); })
    .catch(() => { $("rk-info").textContent = "データを読み込めませんでした。ページを開き直してください。"; });

  function isSchool() { return !!SCHOOL[state.m]; }

  function people() {
    const [id, vid] = state.m.split(":");
    const ind = S.indicators.find((i) => i.id === id);
    if (!ind) return null;
    return { ind, v: ind.variants.find((x) => x.id === vid) || ind.variants[0] };
  }

  function init() {
    const p = new URLSearchParams(location.search);
    const m = p.get("m") || "";
    if (SCHOOL[m] || (m.includes(":") && S.indicators.some((i) => i.id === m.split(":")[0]))) state.m = m;
    if (p.get("unit") === "city" && SCHOOL[state.m]) state.unit = "city";
    if (R.prefs[p.get("pref")]) state.pref = p.get("pref");
    const sel = $("rk-metric");
    let html = '<optgroup label="学校の数">' + Object.keys(SCHOOL).map((k) => `<option value="${k}">${SCHOOL[k].label}</option>`).join("") + "</optgroup><optgroup label=\"都道府県の人数\">";
    S.indicators.forEach((i) => i.variants.forEach((v) => { html += `<option value="${i.id}:${v.id}">${esc(i.label)}${v.id === "all" ? "" : `（${esc(v.label)}）`}</option>`; }));
    sel.innerHTML = html + "</optgroup>";
    sel.value = state.m;
    sel.addEventListener("change", () => { state.m = sel.value; if (!isSchool()) state.unit = "pref"; draw(); });
    $("rk-unit").addEventListener("change", (e) => { state.unit = e.target.value; draw(); });
    const pf = $("rk-pref");
    Object.keys(R.prefs).sort().forEach((c) => pf.insertAdjacentHTML("beforeend", `<option value="${c}">${esc(R.prefs[c].name)}</option>`));
    pf.value = state.pref;
    pf.addEventListener("change", () => { state.pref = pf.value; draw(); });
    draw();
  }

  // 同じ数は同じ順位にする
  function ranked(rows) {
    rows.sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
    rows.forEach((r, i) => { r.rank = i && rows[i - 1].n === r.n ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  function schoolRows() {
    const def = SCHOOL[state.m];
    const c = {};
    if (state.unit === "pref") {
      Object.keys(R.prefs).forEach((code) => { c[code] = { code, name: R.prefs[code].name, n: 0, href: `index.html?pref=${code}&types=${def.map}` }; });
      D.schools.forEach((s) => { if (def.types.includes(s.t)) c[s.p].n++; });
    } else {
      D.schools.forEach((s) => {
        if (!def.types.includes(s.t) || !s.cc || (state.pref && s.p !== state.pref)) return;
        if (!c[s.cc]) c[s.cc] = { code: s.cc, name: R.prefs[s.p].name + " " + s.c, n: 0, href: `index.html?pref=${s.p}&city=${s.cc}&types=${def.map}` };
        c[s.cc].n++;
      });
    }
    return ranked(Object.values(c));
  }

  function peopleRows() {
    const { ind, v } = people();
    return ranked(Object.keys(R.prefs).map((code) => ({ code, name: R.prefs[code].name, n: v.values[code], href: `index.html?pref=${code}&view=stats&layer=${ind.id}${v.id === "all" ? "" : "&variant=" + v.id}` })));
  }

  function draw() {
    const school = isSchool();
    $("rk-unit").value = state.unit;
    $("rk-unit").disabled = !school;
    $("rk-pref").hidden = !(school && state.unit === "city");
    const rows = school ? schoolRows() : peopleRows();
    const unit = school ? "校" : "人";
    const city = school && state.unit === "city";
    const shown = city && !state.pref ? rows.filter((r) => r.rank <= CITY_TOP) : rows;
    const max = Math.max(1, ...shown.map((r) => r.n));
    const area = city ? (state.pref ? R.prefs[state.pref].name + "の市区町村" : "全国の市区町村") : "都道府県";
    const title = school ? SCHOOL[state.m].label : people().ind.label + (people().v.id === "all" ? "" : `（${people().v.label}）`);
    $("rk-title").textContent = `${area}別 ${title}`;
    $("rk-body").innerHTML = shown.map((r) => `<tr><td class="rk-no">${r.rank}</td><td><a href="${r.href}">${esc(r.name)}</a><span class="rk-bar" aria-hidden="true"><i style="width:${(r.n / max * 100).toFixed(1)}%"></i></span></td><td class="num">${fmt(r.n)}${unit}</td></tr>`).join("");
    let foot = "";
    let info = "";
    let period = "";
    if (school) {
      const total = D.schools.filter((s) => SCHOOL[state.m].types.includes(s.t)).length;
      foot = city ? "" : `<tr><th scope="row" colspan="2">全国</th><td class="num">${fmt(total)}校</td></tr>`;
      period = `確認日 ${D.generated}`;
      info = `国の一覧に載っている学校を数えました（${period}）。大学・短大・高専・専門学校は本部の所在地で数えています。${city ? `所在地を確認中の学校は入っていません。${state.pref ? "" : `全国は上位${CITY_TOP}位まで表示しています。`}` : ""}<a href="sources.html">出典</a>`;
    } else {
      const { ind, v } = people();
      foot = `<tr><th scope="row" colspan="2">全国</th><td class="num">${fmt(v.national)}人${v.unallocated ? `<small>（都道府県不詳${fmt(v.unallocated)}人を含む）</small>` : ""}</td></tr>`;
      period = ind.period;
      info = `基準日：${esc(ind.period)}。${esc(ind.note)}<a href="${esc(v.url)}" target="_blank" rel="noopener">出典：${esc(ind.source_name)}</a>`;
    }
    $("rk-foot").innerHTML = foot;
    $("rk-info").innerHTML = info;
    const top = rows.slice(0, 3).map((r) => `${r.rank}位 ${r.name} ${fmt(r.n)}${unit}`).join("\n");
    const q = new URLSearchParams({ m: state.m });
    if (city) { q.set("unit", "city"); if (state.pref) q.set("pref", state.pref); }
    const url = document.body.dataset.site + "ranking.html?" + q.toString().replace("%3A", ":");
    history.replaceState(null, "", location.pathname + "?" + q.toString().replace("%3A", ":"));
    const text = `${area}別 ${title}（${period}）\n${top}\n日本語学校・留学生 全国マップ`;
    const a = $("rk-share");
    a.href = "https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url);
    a.dataset.text = text;
    window.__rankCheck = { rows: rows.length, shown: shown.length, top: rows.slice(0, 3), total: rows.reduce((s, r) => s + r.n, 0), text };
  }
})();
