"""公開する前の点検。1つでも不合格なら止まる。

python -I -X utf8 scripts/verify.py
"""
import json
import re
import sys
from collections import Counter
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
