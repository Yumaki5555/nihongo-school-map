"""公開する前の点検。1つでも不合格なら止まる。

python -I -X utf8 scripts/verify.py
"""
import json
import re
import sys
from collections import Counter
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
results = []


def ok(name, cond, detail=""):
    results.append((bool(cond), name, detail))


load = lambda p: json.loads(Path(p).read_text("utf8"))
master = load(ROOT / "data/schools.json")
pub = load(DOCS / "data/schools.json")
stats = load(DOCS / "data/stats.json")
regions = load(DOCS / "data/regions.json")
geo = load(DOCS / "data/prefectures.json")
schools = pub["schools"]

# ---- 公開してはいけない情報 ----
ALLOWED_MASTER = {"id", "name", "type", "sub", "pref_code", "pref", "city_code", "city", "address", "address_basis", "lat", "lng", "location_level", "location_source", "website", "website_source", "list_basis", "checked", "status", "public"}
ok("台帳の項目は決めたものだけ", all(set(s) == ALLOWED_MASTER for s in master), "")
ALLOWED_PUB = {"i", "n", "t", "p", "b", "ck", "s", "cc", "c", "a", "ab", "an", "au", "la", "ln", "lv", "u", "st"}
ok("公開データの項目は決めたものだけ", all(set(s) <= ALLOWED_PUB for s in schools), "")

# 公開しない資料の語の一覧は、一覧そのものを公開しないよう、このリポジトリの外に置く
_private = ROOT.parent / "非公開ツール" / "banned_words.json"
PRIVATE = load(_private) if _private.exists() else {"words": [], "folders": []}
BANNED = PRIVATE["words"]
hits = Counter()
scan = [p for d in ("docs", "data", "config", "scripts") for p in (ROOT / d).rglob("*") if p.is_file() and p.suffix in (".json", ".js", ".html", ".css", ".py", ".md", ".csv", ".txt", ".yml")]
scan += [ROOT / "README.md", ROOT / ".gitignore"]
for p in scan:
    if p.name == "verify.py" or "vendor" in p.parts:
        continue
    tx = p.read_text("utf8", errors="ignore")
    for w in BANNED:
        if w in tx:
            hits[f"{p.relative_to(ROOT).as_posix()}:{w}"] += tx.count(w)
ok("公開しない資料・項目の語が残っていない", not hits and (BANNED or not _private.parent.exists()), str(dict(list(hits.items())[:8])))

PERSONAL = re.compile(r"\b0\d{1,4}-\d{1,4}-\d{3,4}\b|[\w.+-]+@[\w-]+\.[\w.-]+")
tx = (DOCS / "data/schools.json").read_text("utf8")
ok("電話番号やメールアドレスが入っていない", not PERSONAL.search(tx), str(PERSONAL.findall(tx)[:3]))
ok("元の統計ファイルや非公開フォルダがない", not any((ROOT / f).exists() for f in PRIVATE["folders"]) and not list(DOCS.rglob("*.xlsx")), "")

# ---- 件数 ----
EXPECT = {"jp": 918, "univ": 825, "jc": 292, "kosen": 58, "senmon": 2665}
cnt = Counter(s["t"] for s in schools)
ok("種類ごとの校数", dict(cnt) == EXPECT, str(dict(cnt)))
ok("台帳と公開データの校数が同じ", len(master) == len(schools) == sum(EXPECT.values()), str(len(schools)))
ok("学校のIDが重ならない", len({s["i"] for s in schools}) == len(schools), "")
dup = Counter((s["t"], s["n"], s.get("a")) for s in schools if s.get("a"))
ok("同じ種類で校名と住所が同じ学校がない", not [k for k, v in dup.items() if v > 1], str([k for k, v in dup.items() if v > 1][:4]))
ok("短大・高専を大学に混ぜていない", cnt["univ"] == 825 and not any("短期大学" in s["n"] for s in schools if s["t"] == "univ"), "")

# ---- 根拠 ----
bases = pub["bases"]
ok("全校に学校一覧の根拠と確認日がある", all(s["b"] and s["ck"] for s in schools), "")
ok("住所のある学校に所在地の根拠がある", all(("ab" in s or ("an" in s and "au" in s)) for s in schools if s.get("a")), "")
ok("根拠のリンクがhttpで始まる", all(b["url"].startswith("http") for b in bases) and all(s.get("au", "http").startswith("http") for s in schools), "")
ok("公式サイトのリンクがhttpで始まる", all(s.get("u", "http").startswith("http") for s in schools), "")
ok("Googleマップの座標や住所を使っていない", not any("google" in (s.get("au") or "") for s in schools), "")

# ---- 位置が都道府県の中にあるか ----
def inside(lat, lng, rings):
    c = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                c = not c
            j = i
    return c


rings, boxes = {}, {}
for f in geo["features"]:
    polys = [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]
    rings[f["properties"]["code"]] = [p[0] for p in polys]
    xs = [c[0] for p in polys for c in p[0]]
    ys = [c[1] for p in polys for c in p[0]]
    boxes[f["properties"]["code"]] = (min(xs), max(xs), min(ys), max(ys))
out = []
for s in schools:
    if "la" not in s:
        continue
    if not inside(s["la"], s["ln"], rings[s["p"]]):
        x0, x1, y0, y1 = boxes[s["p"]]
        d = max(x0 - s["ln"], s["ln"] - x1, y0 - s["la"], s["la"] - y1, 0)
        out.append((s["i"], s["n"], round(d, 3)))
far = [o for o in out if o[2] > .02]
ok("位置が都道府県の範囲から大きく外れない", not far, str(far[:5]))
if out:
    print(f"参考：簡略化した県境の少し外に出る点 {len(out)} 校（海岸線の簡略化によるもの）")
mapped = sum(1 for s in schools if "la" in s)
ok("位置のある学校が98％以上", mapped / len(schools) > .98, f"{mapped}/{len(schools)}")

# ---- 統計 ----
codes = {f["properties"]["code"] for f in geo["features"]}
ok("都道府県の境界が47", len(codes) == 47, str(len(codes)))
for ind in stats["indicators"]:
    need = ("id", "label", "note", "as_of", "period", "scope", "source_name", "source_url", "processing", "terms", "public")
    ok(f"{ind['id']}：必要な項目と出典がある", all(ind.get(k) not in (None, "") for k in need) and ind["source_url"].startswith("https://"), "")
    for v in ind["variants"]:
        ok(f"{ind['id']}/{v['id']}：47都道府県の数字", set(v["values"]) == codes and all(isinstance(x, int) and x >= 0 for x in v["values"].values()), "")
        total = sum(v["values"].values()) + v.get("unallocated", 0)
        ok(f"{ind['id']}/{v['id']}：県の合計＝全国の値", total == v["national"], f"{total} / {v['national']}")
        ok(f"{ind['id']}/{v['id']}：階級が小さい順に4つ", len(v["breaks"]) == 4 and v["breaks"] == sorted(set(v["breaks"])), str(v["breaks"]))
ids = [i["id"] for i in stats["indicators"]]
ok("人数は3種類", ids == ["ryugaku", "foreign", "nihongo"], str(ids))
ref = {i["id"]: i for i in stats["indicators"]}
ok("発表値と一致（留学464,784／日本語指導84,759）", ref["ryugaku"]["variants"][0]["national"] == 464784 and ref["nihongo"]["variants"][0]["national"] == 84759, "")
ok("留学の都道府県不詳は414人", ref["ryugaku"]["variants"][0].get("unallocated") == 414, "")
ok("日本語指導の表示名に「公立学校」が入る", ref["nihongo"]["label"] == "公立学校で日本語指導が必要な児童生徒", ref["nihongo"]["label"])
ok("人数ごとに短い説明がある", all(i.get("note") for i in stats["indicators"]), "")
ok("居住地基準と日本国籍を含むことを明記", "学校の所在地ではありません" in ref["ryugaku"]["note"] and "日本国籍" in ref["nihongo"]["note"], "")
srcs = Counter(s["location_source"] for s in master if s["lat"] is not None)
ok("位置の取得元は国土交通省の位置参照情報だけ", all("位置参照情報 国土交通省" in k for k in srcs), str(srcs))
ok("白抜きの基準（町名の代表点）が公開データにある", all(s.get("lv") in (0, 1) for s in schools if "la" in s), "")
img = (DOCS / "map-image.js").read_text("utf8")
ok("保存画像は通信しない（タイル・送信なし）", not re.search(r"fetch\(|XMLHttpRequest|cyberjapandata|sendBeacon|new Image", img), "")
ok("保存画像に出典とクレジットがある", "国土数値情報" in img and "位置参照情報" in img and "siteUrl" in img, "")

# ---- 地図の表示（2026-11-07 改善指示書の第1・2段階） ----
sj = (DOCS / "site.js").read_text("utf8")
ih = (DOCS / "index.html").read_text("utf8")
ok("地図に出すものは3種類（学校の場所・人数の分布・両方）", all(f'data-view="{k}"' in ih for k in ("place", "stats", "both")) and "aria-pressed" in ih, "")
ok("位置のない学校も公開データに残す（消さない）", sum("la" not in s for s in schools) == sum(s["lat"] is None for s in master), "")
ok("登録校数と地図に位置を表示できる校数を分けて出す", "地図に位置を表示できる" in sj, "")
ok("大学・専門学校は本部・本校の所在地と明記", "本部・本校の所在地" in sj, "")
ok("学校の所在地と国の統計を分けて見出しを付ける", "学校の所在地" in sj and "都道府県別の人数（国の統計）" in sj, "")
ok("統計は合算・単純比較できないと明記", "合算・単純比較できません" in sj, "")
ok("色分けは学校ごとの人数でないと明記", "学校ごとの人数ではありません" in sj, "")

# ---- 画像保存とX投稿（改善指示書の第3段階） ----
ok("保存画像は3種類（全国の学校分布・全国の人数分布・選択した地域）", all(f'name="img-kind" value="{k}"' in ih for k in ("schools", "stats", "region")), "")
ok("保存画像は1600×900", "W = 1600, H = 900" in img, "")
ok("保存画像に基準日を入れる", img.count("基準日") >= 3, "")
ok("全国の投稿文は指示書の文のまま", "あなたの地域に、日本語学校・大学・専門学校はどこに、何校ある？\\n\\n全国の学校の所在地と、国の統計による留学生等の人数を地図で確認できます。\\n\\n【テスト運用中】\\n${document.body.dataset.site}" in sj, "")
ok("投稿文のURLが公開サイト", 'data-site="https://yumaki5555.github.io/nihongo-school-map/"' in ih, "")
ok("画像が自動で添付されないと案内する", "画像は自動では添付されません。保存してからXで添付してください。" in ih, "")
ok("地域の投稿文はXの文字数に収める", "X_LIMIT = 280" in sj and "fitsX" in sj, "")

# ---- 人口あたり・2県比較（改善指示書の第4段階） ----
rates = stats.get("rates", [])
ok("人口あたりは1種類（住民1万人あたりの留学）", [r["id"] for r in rates] == ["ryugaku_pop"], str([r["id"] for r in rates]))
for r in rates:
    d, num_ind = r["denominator"], ref[r["numerator"]["indicator"]]
    nv = next(v for v in num_ind["variants"] if v["id"] == r["numerator"]["variant"])
    ok(f"{r['id']}：分母は47都道府県の人口で、合計＝全国", set(d["values"]) == codes and all(isinstance(x, int) and x > 0 for x in d["values"].values()) and sum(d["values"].values()) == d["national"], "")
    ok(f"{r['id']}：分母は2026年1月1日の住民基本台帳人口（全国123,767,642人）", d["national"] == 123767642 and d["as_of"] == "2026-01-01", f"{d['national']} {d['as_of']}")
    gap = abs((date.fromisoformat(d["as_of"]) - date.fromisoformat(num_ind["as_of"])).days)
    ok(f"{r['id']}：分子と分母の基準日の差が31日以内", gap <= 31, f"{gap}日")
    calc = lambda n, base: float((Decimal(n) * r["per"] / Decimal(base)).quantize(Decimal("0.1"), ROUND_HALF_UP))
    ok(f"{r['id']}：47都道府県と全国の値を計算し直して一致", set(r["values"]) == codes and all(r["values"][c] == calc(nv["values"][c], d["values"][c]) for c in codes) and r["national"] == calc(nv["national"], d["national"]), "")
    ok(f"{r['id']}：計算式・端数処理・そろえた点・計算値の注記・出典がある", all(r.get(k) for k in ("formula", "rounding", "why", "terms", "period")) and "国の公表値ではなく" in r["note"] and d["source_url"].startswith("https://"), "")
rj = (DOCS / "ranking.js").read_text("utf8")
rh = (DOCS / "ranking.html").read_text("utf8")
sh = (DOCS / "sources.html").read_text("utf8")
ok("ランキングの人口あたりは計算値と明記し、計算式と分子・分母の出典を出す", "計算値です（国の公表値ではありません）" in rj and "rt.formula" in rj and "分子 <a" in rj and "分母 <a" in rj, "")
ok("出典ページに人口あたりの計算式と分母の出典がある", rates and all(r["formula"] in sh and r["denominator"]["source_name"] in sh for r in rates), "")
ok("2県比較はランキングのページにあり、トップには置かない", 'id="compare"' in rh and 'id="cmp-a"' in rh and 'id="cmp-b"' in rh and "cmp-a" not in ih, "")
ok("2県比較は資料ごとに見出しと基準日を付け、ちがう資料は比べないと明記", "ind.period" in rj and "cmp-group" in rj and "ちがう資料の行どうしは比べたり足したりできません" in rh, "")

# ---- 入口サイトが読む形 ----
ok("regions.json の形（prefs[県].n・cities・generated）", regions.get("generated") and len(regions["prefs"]) == 47 and all("n" in p and "cities" in p for p in regions["prefs"].values()), "")
ok("regions の校数の合計＝日本語学校の校数", sum(p["n"] for p in regions["prefs"].values()) == cnt["jp"], "")
ok("regions に人数が入っていない", not re.search(r"enr_|cap_|size_|nat_pairs", json.dumps(regions)), "")

# ---- ページ ----
for page in ("index", "ranking", "guide", "sources", "map", "region", "school", "changes"):
    ok(f"{page}.html がある", (DOCS / f"{page}.html").exists(), "")
for page in ("index", "ranking", "guide", "sources"):
    h = (DOCS / f"{page}.html").read_text("utf8")
    ok(f"{page}.html に置き換え忘れがない", "{{" not in h and "[[" not in h, "")
    miss = [r for r in re.findall(r'(?:src|href)="([^"#:?]+)(?:\?[^"]*)?"', h) if not (DOCS / r).exists()]
    ok(f"{page}.html の参照先がある", not miss, str(miss[:4]))
size = sum(p.stat().st_size for p in DOCS.rglob("*") if p.is_file())
ok("公開ファイル全体が10MB未満", size < 10_000_000, f"{size // 1024}KB")

bad = [r for r in results if not r[0]]
print(f"点検 {len(results)} 項目：合格 {len(results) - len(bad)}、不合格 {len(bad)}")
for _, name, detail in bad:
    print("不合格:", name, detail)
if bad:
    sys.exit(1)
