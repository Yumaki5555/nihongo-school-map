"""文部科学省「外国人の子供の就学状況等調査」の市区町村別の表を e-Stat から取り込み、
就学状況のページ（shugaku.html）用に data/shugaku.json を書く。

python -I -X utf8 scripts/fetch_shugaku.py

- 元の表は raw/shugaku/（git に入らない）。無いものだけ取りに行く（月1回の自動更新では動かさない）。
- 使う表は各年度の「01.市区町村別データ（就学状況の把握）」（2021〜2025年度。e-Stat にあるのは令和3年度から）。
  2019年度（令和元年度）は全国の数だけ、国の結果資料の年度別の表から載せる（市区町村別の表がないため）。
- 列：①義務教育諸学校 ②外国人学校 ③不就学 ④転居・出国（予定含む） ⑤就学状況把握できず ⑥その他（2023年度から）
  ①〜⑥計、住民基本台帳上の人数。⑦（住民基本台帳上の人数との差）は ページ側で 住民基本台帳 − 計 として出す。
- 都道府県と全国は、市区町村の行を足して作る（表の都道府県の行は照合にだけ使う）。
- 数字は推測しない。空欄は null（0 にしない。2021年度の仙台市の②〜⑤など）。⑥のない年は null。
- 照合：市区町村が毎年1,741件、各行で ①〜⑥の和＝計、表の都道府県の行＝市区町村の和、全国＝国の結果資料の表、
  2025年度の「1人以上いる地方公共団体数 1,298」「10人以上 753」（国の報道発表資料）。
  食いちがいは止まる（KNOWN に書いた元の表の食いちがいだけは、理由を残して通す）。
"""
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "shugaku"
OUT = ROOT / "data" / "shugaku.json"
UA = {"User-Agent": "nihongo-school-map-data-build"}
CHECKED = "2026-11-10"
TERMS = "e-Stat 利用規約を確認済み。出典を示し、加工した内容を記載して利用"
ESTAT = "https://www.e-stat.go.jp/stat-search/files?toukei=00400205&tstat=000001168856"
MEXT_R7 = {
    "title": "「外国人の子供の就学状況等調査（令和7年度）」の結果について",
    "url": "https://www.mext.go.jp/b_menu/houdou/31/09/1421568_00006.htm",
    "pdf": "https://www.mext.go.jp/content/20260525-mxt_kyokoku-000049808_02.pdf",
    "pdf_title": "令和7年度 外国人の子供の就学状況等調査結果",
    "date": "2026-05-25",
}

PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split()
CODE = {p: f"{i + 1:02d}" for i, p in enumerate(PREFS)}

# コード6桁＝都道府県2桁＋種類1桁（2市・区 3町 4村）＋全国地方公共団体コードの下3桁。5桁コードは種類の桁を除いて作る。
# 年度ごとの市区町村別の表（e-Stat の統計表ID・更新日）。as_of は国の資料で確かめた基準日だけ書く。
YEARS = [
    {"year": 2021, "fy": "令和3年度", "as_of": None, "id": "000032226756", "updated": "2022-08-19", "c6": False},
    {"year": 2022, "fy": "令和4年度", "as_of": None, "id": "000040059873", "updated": "2024-06-28", "c6": False},
    {"year": 2023, "fy": "令和5年度", "as_of": "2023-05-01", "id": "000040204800", "updated": "2024-08-30", "c6": True},
    {"year": 2024, "fy": "令和6年度", "as_of": "2024-05-01", "id": "000040367653", "updated": "2026-07-24", "c6": True},
    {"year": 2025, "fy": "令和7年度", "as_of": "2025-05-01", "id": "000040478725", "updated": "2026-07-24", "c6": True},
]
# 国の結果資料（令和7年度 外国人の子供の就学状況等調査結果 p.1）の年度別の表：
# 住民基本台帳上の人数, ①, ②, ③, ④, ⑤, ⑥, 計（⑥がない年は None）
NAT = {
    2019: [123830, 96370, 5023, 630, 3017, 8658, None, 113698],
    2021: [133310, 112148, 7922, 649, 3194, 8597, None, 132510],
    2022: [136923, 116288, 9180, 778, 3272, 6675, None, 136193],
    2023: [150695, 127239, 10993, 970, 3833, 7199, 29, 150263],
    2024: [163358, 138418, 11615, 1097, 4751, 7213, 144, 163238],
    2025: [177726, 150786, 11949, 911, 5660, 8013, 178, 177497],
}
# 組合で教育委員会を置く町村は、表のコードが組合のもの（216995 岐南町・笠松町、267990〜267992 相楽東部広域連合）。
# 回答は市町村ごとの行なので、全国地方公共団体コードの形（種類の桁つき6桁）に置き換える。
UNION = {
    ("岐阜県", "岐南町"): "213302", ("岐阜県", "笠松町"): "213303",
    ("京都府", "笠置町"): "263364", ("京都府", "和束町"): "263365", ("京都府", "南山城村"): "264367",
}
# 元の表の食いちがい（都道府県の行が市区町村の和と合わない）。市区町村の和は国の全国の表と一致するので、和を使う。
KNOWN = {
    (2024, "06"): "令和6年度の山形県の行は①137・計142だが、市町村の和は①139・計144（住民基本台帳144と一致）。市町村の和を使用",
    (2024, "08"): "令和6年度の茨城県の行は⑤316・計4,470だが、市町村の和は⑤207・計4,361（つくば市の計760と住民基本台帳869の差109が⑤に入った形）。全国の表（⑤7,213）は市町村の和と一致するので、和を使用",
}


def fail(msg):
    print("止めました：" + msg)
    sys.exit(1)


def fetch(y):
    RAW.mkdir(parents=True, exist_ok=True)
    f = RAW / f"{y['year']}_{y['id']}.xlsx"
    if not f.exists():
        url = f"https://www.e-stat.go.jp/stat-search/file-download?statInfId={y['id']}&fileKind=0"
        b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        if b[:2] != b"PK":
            fail(f"{y['year']}年度の表がExcelではありません")
        f.write_bytes(b)
        time.sleep(1)
    return f.read_bytes()


def num(c):
    if c is None or (isinstance(c, str) and c.strip() == ""):
        return None
    if isinstance(c, bool) or not isinstance(c, (int, float)) or c != int(c) or c < 0:
        fail(f"数ではない値 {c!r}")
    return int(c)


def rows_of(b, y):
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(b), read_only=True, data_only=True).worksheets[0]
    n = 6 if y["c6"] else 5  # ①〜⑥ または ①〜⑤
    out = []
    for r in ws.iter_rows(values_only=True):
        r = list(r) + [None] * 12
        if r[1] not in CODE or not isinstance(r[2], str):
            continue
        cells = r[3:3 + n + 3]  # ①..⑤(⑥), 計, 住基, 差
        if not any(isinstance(c, (int, float)) for c in cells):
            continue
        v = [num(c) for c in cells[:n]]
        tot, juki, diff = num(cells[n]), num(cells[n + 1]), cells[n + 2]
        if tot is None or juki is None:
            fail(f"{y['year']} {r[1]}{r[2]}：計か住民基本台帳の人数が空欄")
        if sum(x or 0 for x in v) != tot:
            fail(f"{y['year']} {r[1]}{r[2]}：①〜の和と計が合わない")
        if isinstance(diff, (int, float)) and diff != juki - tot:
            fail(f"{y['year']} {r[1]}{r[2]}：差の欄が 住民基本台帳−計 と合わない")
        if not y["c6"]:
            v.append(None)
        code = r[0]
        if isinstance(code, (int, float)):
            code = f"{int(code):06d}"
        out.append({"code": code, "pref": r[1], "name": r[2].strip(), "v": v + [tot, juki]})
    return out


def main():
    years = {}
    names = {}  # 5桁コード -> (都道府県コード, 名前)（新しい年の名前で上書き）
    by_name = {}  # (都道府県, 名前) -> 5桁コード
    for y in sorted(YEARS, key=lambda y: -y["year"]):  # 新しい年から（2021年度はコードがないので名前で対応づける）
        rows = rows_of(fetch(y), y)
        prefrow, munis = {}, {}
        for r in rows:
            if r["name"] == r["pref"]:
                prefrow[CODE[r["pref"]]] = r["v"]
                continue
            c = r["code"]
            if (r["pref"], r["name"]) in UNION:  # 組合の教育委員会（行は市町村ごと、コードは組合のもの）
                c = UNION[(r["pref"], r["name"])]
            if c:
                if not (len(c) == 6 and c[:2] == CODE[r["pref"]] and c[2] in "234"):
                    fail(f"{y['year']} {r['pref']}{r['name']}：コード {c} の形が想定とちがう")
                k = c[:2] + c[3:]
                if k in names and names[k][1] != r["name"]:
                    print(f"  名前のちがい {k}：{y['year']}年度は {r['name']}、新しい年は {names[k][1]}")
                names.setdefault(k, (CODE[r["pref"]], r["name"]))
                by_name.setdefault((r["pref"], r["name"]), k)
            else:
                k = by_name.get((r["pref"], r["name"]))
                if not k:
                    fail(f"{y['year']} {r['pref']}{r['name']}：新しい年の表に同じ名前がない")
            if k in munis:
                fail(f"{y['year']} {k} が2回出てきた")
            munis[k] = r["v"]
        if len(munis) != 1741 or len(prefrow) != 47:
            fail(f"{y['year']}：市区町村 {len(munis)}件・都道府県 {len(prefrow)}件")
        # 都道府県＝市区町村の和（null は 0 として足し、どの欄に空欄があったかを残す）
        pv, blanks = {}, []
        for pc in CODE.values():
            ks = [k for k in munis if k[:2] == pc]
            s = [None if (i == 5 and not y["c6"]) else sum(munis[k][i] or 0 for k in ks) for i in range(8)]
            pv[pc] = s
            if s != prefrow[pc]:
                why = KNOWN.get((y["year"], pc))
                if not why:
                    fail(f"{y['year']} {PREFS[int(pc) - 1]}：表の行 {prefrow[pc]} ≠ 市区町村の和 {s}")
                print(f"  既知の食いちがい：{why}")
            for k in ks:
                for i, x in enumerate(munis[k][:6]):
                    if x is None and (i < 5 or y["c6"]):
                        blanks.append([k, i])
        nat = [None if (i == 5 and not y["c6"]) else sum(pv[p][i] for p in pv) for i in range(8)]
        n = NAT[y["year"]]
        if [nat[7]] + nat[:6] + [nat[6]] != n:
            fail(f"{y['year']}：全国の和 {nat} が国の結果資料の表 {n} と合わない")
        years[y["year"]] = {"meta": y, "munis": munis, "prefs": pv, "nat": nat, "blanks": blanks}
        print(f"{y['year']}年度：市区町村1,741・全国の住民基本台帳 {nat[7]:,}人・計 {nat[6]:,}人（国の表と一致）")

    m25 = years[2025]["munis"]
    one, ten = sum(1 for v in m25.values() if v[7] >= 1), sum(1 for v in m25.values() if v[7] >= 10)
    if (one, ten) != (1298, 753):
        fail(f"2025年度の1人以上・10人以上の地方公共団体数 {one}・{ten} が国の報道発表資料（1,298・753）と合わない")
    print(f"2025年度：1人以上いる市区町村 {one}・10人以上 {ten}（国の報道発表資料と一致）")

    v = {"00": {}}
    for yr, Y in years.items():
        v["00"][str(yr)] = Y["nat"]
        for pc, s in Y["prefs"].items():
            v.setdefault(pc, {})[str(yr)] = s
        for k, s in Y["munis"].items():
            v.setdefault(k, {})[str(yr)] = s
    n19 = NAT[2019]
    v["00"]["2019"] = n19[1:7] + [n19[7], n19[0]]
    yinfo = {"2019": {"fy": "令和元年度", "as_of": None, "nat_only": True,
                      "src": {"title": MEXT_R7["pdf_title"] + "（年度別の表）", "url": MEXT_R7["pdf"]}}}
    for yr, Y in years.items():
        m = Y["meta"]
        yinfo[str(yr)] = {"fy": m["fy"], "as_of": m["as_of"], "blanks": Y["blanks"],
                          "src": {"id": m["id"], "title": f"{m['fy']} 外国人の子供の就学状況等調査_市区町村別データ（就学状況の把握）",
                                  "updated": m["updated"], "url": f"https://www.e-stat.go.jp/stat-search/files?stat_infid={m['id']}"}}
    data = {
        "id": "shugaku", "title": "外国人の子供の就学状況", "survey": "文部科学省「外国人の子供の就学状況等調査」",
        "scope": "住民基本台帳に記載された学齢相当（小学校・中学校の年齢）の外国人の子ども。市町村教育委員会（特別区を含む）1,741が回答",
        "estat_url": ESTAT, "mext": MEXT_R7, "checked": CHECKED, "terms": TERMS,
        "known": [{"year": y, "pref": p, "note": t} for (y, p), t in KNOWN.items()],
        "prefs": {CODE[p]: p for p in PREFS},
        "munis": {k: list(names[k]) for k in sorted(names)},
        "years": sorted([2019] + list(years)),
        "y": yinfo,
        "v": v,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf8")
    print(f"書き出し：{OUT.relative_to(ROOT)}（{OUT.stat().st_size:,}バイト・地域 {len(v):,}）")


if __name__ == "__main__":
    main()
