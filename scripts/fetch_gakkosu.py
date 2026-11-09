"""文部科学省「学校基本調査」の市町村別集計（学校数）を e-Stat から取り込み、
就学状況のページ（shugaku.html）で「この地域の学校の数」を出すための data/gakkosu.json を書く。

python -I -X utf8 scripts/fetch_gakkosu.py

- 元の表は raw/gakkosu/（git に入らない）。無いものだけ取りに行く。
- 使う表は各年度の「全国 小学校／中学校／義務教育学校 市町村別学校数」（2021〜2025年度。就学状況の市区町村別データと同じ年）。
- 数は「計」（国立・公立・私立の計。本校と分校の計）。学校がある市区町村で数える（組合立・国立・私立も所在地で数える）。
- 市区町村は data/shugaku.json の 1,741（政令指定都市は市全体。区の行を足す。東京23区はそのまま）。
- 表の「大阪市外」（大阪市の区の並びにある、市の外の市立の学校）と「東京都外」は、どの市区町村にあるか表にないので、
  市区町村には入れず都道府県・全国の数にだけ入れる（outside に数を残し、画面に注記する）。
- 照合：各行で 計＝本校＋分校、計＝国立＋公立＋私立。都道府県の行＝市区町村の和、全国の行＝都道府県の和（全国シートとも一致）。
  就学状況の市区町村がすべて表にあり、表の市区町村名が就学状況の名前と一致すること。食いちがいは止まる。
"""
import io
import json
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "gakkosu"
OUT = ROOT / "data" / "gakkosu.json"
MUNIS = ROOT / "data" / "shugaku.json"
UA = {"User-Agent": "nihongo-school-map-data-build"}
CHECKED = "2026-11-10"
TERMS = "e-Stat 利用規約を確認済み。出典を示し、加工した内容を記載して利用"
ESTAT = "https://www.e-stat.go.jp/stat-search/files?toukei=00400001&tstat=000001011528"
KINDS = ["小学校", "中学校", "義務教育学校"]
# 年度ごとの表（e-Stat の統計表ID・公開日）。2023年度からは「学校調査票（○○）」の分類、それより前は「市町村別集計」の分類にある
YEARS = [
    {"year": 2021, "fy": "令和3年度", "updated": "2022-03-31", "ids": ["000032189226", "000032189241", "000032189255"]},
    {"year": 2022, "fy": "令和4年度", "updated": "2023-03-30", "ids": ["000040042238", "000040042267", "000040042296"]},
    {"year": 2023, "fy": "令和5年度", "updated": "2023-12-20", "ids": ["000040127888", "000040127985", "000040128081"]},
    {"year": 2024, "fy": "令和6年度", "updated": "2024-12-18", "ids": ["000040231127", "000040231156", "000040231185"]},
    {"year": 2025, "fy": "令和7年度", "updated": "2025-12-26", "ids": ["000040393444", "000040393473", "000040393502"]},
]


def fail(msg):
    print("止めました：" + msg)
    sys.exit(1)


def norm(s):
    return unicodedata.normalize("NFKC", str(s)).replace("ヶ", "ケ").replace("ヵ", "カ").replace("惠", "恵").replace(" ", "").replace("　", "")


def get(sid):
    p = RAW / f"{sid}.xlsx"
    if not p.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        b = urllib.request.urlopen(urllib.request.Request(f"https://www.e-stat.go.jp/stat-search/file-download?statInfId={sid}&fileKind=0", headers=UA), timeout=60).read()
        p.write_bytes(b)
        time.sleep(1)
    b = p.read_bytes()
    if b[:2] != b"PK":
        fail(f"{sid} が xlsx ではありません")
    import openpyxl
    return openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True)


def num(v, where):
    if isinstance(v, (int, float)) and v == int(v) and v >= 0:
        return int(v)
    fail(f"{where} の数が読めません：{v!r}")


def read_sheet(ws, kind, where):
    """見出し3行から列を決め、行ごとに 計 を返す。[(コード3桁 or '計', 名前, 計)]"""
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    if not rows or not str(rows[0][0] or "").replace("　", "").startswith(kind + "市町村別学校数"):
        fail(f"{where} の題名が「{kind} 市町村別学校数」ではありません：{rows[0][:1] if rows else ''}")
    h = o = None
    for i, r in enumerate(rows[:12]):
        for j in (1, 2):
            if len(r) > j + 2 and r[j:j + 3] == ["計", "本校", "分校"] and i >= 2:
                h, o = i - 2, j
                break
        if h is not None:
            break
    if h is None:
        fail(f"{where} の見出し（計・本校・分校）が見つかりません")
    top, mid, low = rows[h], rows[h + 1], rows[h + 2]
    ncol = len(low)
    col = lambda k: [j for j in range(o, ncol) if j < len(top) and top[j] == k]
    kok, shi = col("国立"), col("私立")
    kou = [j for j in col("公立") if mid[j] == "計" and low[j] == "計"]
    if not kok or not shi or len(kou) != 1:
        fail(f"{where} の国立・公立・私立の列が見つかりません")
    out = []
    for i, r in enumerate(rows[h + 3:], start=h + 4):
        if not r or all(v is None for v in r):
            continue
        code, name = r[0], (r[1] if o == 2 else "")
        w = f"{where} {i}行目（{name or code}）"
        tot = num(r[o], w)
        if tot != num(r[o + 1], w) + num(r[o + 2], w):
            fail(f"{w} で 計≠本校＋分校")
        if tot != sum(num(r[j], w) for j in kok) + num(r[kou[0]], w) + sum(num(r[j], w) for j in shi):
            fail(f"{w} で 計≠国立＋公立＋私立")
        out.append((str(code).strip(), str(name).strip(), tot))
    return out


def main():
    S = json.loads(MUNIS.read_text("utf8"))
    prefs, munis = S["prefs"], S["munis"]
    v = {}
    ymeta = {}
    outside = {}
    wards = set()
    log = []
    for Ym in YEARS:
        y = str(Ym["year"])
        src = {}
        for kind, sid in zip(KINDS, Ym["ids"]):
            ki = KINDS.index(kind)
            wb = get(sid)
            names = [ws.title for ws in wb.worksheets]
            if names[0] != "全国" or names[1:] != [prefs[p] for p in sorted(prefs)]:
                fail(f"{y}年 {kind}（{sid}）のシートが 全国＋47都道府県 になっていません")
            nat = read_sheet(wb["全国"], kind, f"{y}年 {kind} 全国")
            nat_tot = [t for c, n, t in nat if c == "計"]
            if len(nat_tot) < 1:
                fail(f"{y}年 {kind} 全国シートに計の行がありません")
            seen_munis = set()
            pref_sum = 0
            for p in sorted(prefs):
                rows = read_sheet(wb[prefs[p]], kind, f"{y}年 {kind} {prefs[p]}")
                head = [t for c, n, t in rows if c == "計"]
                if len(head) != 1:
                    fail(f"{y}年 {kind} {prefs[p]} の計の行が1つではありません")
                msum = 0
                for c3, name, t in rows:
                    if c3 == "計":
                        continue
                    if not (len(c3) == 3 and c3.isdigit()):
                        fail(f"{y}年 {kind} {prefs[p]} のコードが3桁ではありません：{c3} {name}")
                    msum += t
                    c5 = p + c3
                    if name.endswith("外"):  # 「東京都外」「大阪市外」：どの市区町村にあるか表にない学校。都道府県の数にだけ入れる
                        if c3 not in ("999", "129") or (c3 == "129" and p != "27"):
                            fail(f"{y}年 {kind} {prefs[p]}「{name}」（{c3}）は初めて見る行です。扱いを決めてください")
                        o = outside.setdefault(p, {"name": name})
                        if o["name"] != name:
                            fail(f"{prefs[p]} の「○○外」の行が2つあります")
                        o.setdefault(y, [0, 0, 0])[ki] = t
                        continue
                    if c5 in munis:
                        if norm(munis[c5][1]) != norm(name):
                            fail(f"{y}年 {kind} {c5} の名前がちがいます：表「{name}」／就学状況「{munis[c5][1]}」")
                        key = c5
                    elif p != "13" and c3[0] == "1" and name.endswith("区"):
                        cities = [m for m in munis if m.startswith(p + "1") and m <= c5]
                        if not cities or not munis[max(cities)][1].endswith("市"):
                            fail(f"{y}年 {kind} {c5}「{name}」の市が見つかりません")
                        key = max(cities)
                        wards.add(key)
                    else:
                        fail(f"{y}年 {kind} {c5}「{name}」が就学状況の市区町村にありません")
                    row = v.setdefault(key, {}).setdefault(y, [None, None, None])
                    row[ki] = (row[ki] or 0) + t
                    seen_munis.add(key)
                if msum != head[0]:
                    fail(f"{y}年 {kind} {prefs[p]} の計 {head[0]} と市区町村の和 {msum} が合いません")
                v.setdefault(p, {}).setdefault(y, [None, None, None])[ki] = head[0]
                pref_sum += head[0]
            if pref_sum != nat_tot[0]:
                fail(f"{y}年 {kind} 全国 {nat_tot[0]} と都道府県の和 {pref_sum} が合いません")
            v.setdefault("00", {}).setdefault(y, [None, None, None])[ki] = nat_tot[0]
            missing = [m for m in munis if m not in seen_munis]
            if missing:
                fail(f"{y}年 {kind} の表にない市区町村が {len(missing)} 件：{[munis[m][1] for m in missing[:5]]}")
            src[kind] = {"id": sid, "title": f"{Ym['fy']} 学校基本調査 {kind} 市町村別学校数", "url": f"https://www.e-stat.go.jp/stat-search/files?stat_infid={sid}"}
            log.append(f"{y}年 {kind}：全国 {nat_tot[0]:,}校、市区町村 {len(seen_munis)} 件")
        ymeta[y] = {"fy": Ym["fy"], "as_of": f"{y}-05-01", "updated": Ym["updated"], "src": src}
    for c, ys in v.items():
        for y, row in ys.items():
            if None in row:
                fail(f"{c} {y}年 に読めていない種類があります")
    order = ["00"] + sorted(prefs) + sorted(munis)
    out = {
        "id": "gakkosu",
        "survey": "文部科学省「学校基本調査」",
        "scope": "国立・公立・私立の計（本校と分校の計）。学校がある市区町村で数える。政令指定都市は区の合計",
        "kinds": KINDS,
        "estat_url": ESTAT,
        "checked": CHECKED,
        "terms": TERMS,
        "years": [Ym["year"] for Ym in YEARS],
        "y": ymeta,
        "wards": sorted(wards),
        "outside": {p: o for p, o in sorted(outside.items()) if any(sum(o.get(str(Ym["year"]), [0])) for Ym in YEARS)},
        "v": {c: v[c] for c in order},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf8")
    print("\n".join(log))
    print("書きました", OUT, f"{OUT.stat().st_size // 1024}KB", "地域", len(out["v"]))


if __name__ == "__main__":
    main()
