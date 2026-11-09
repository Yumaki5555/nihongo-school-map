"""文部科学省「日本語指導が必要な児童生徒の受入状況等に関する調査」の表を e-Stat から取り込み、
推移と内訳のページ（nihongo.html）用に data/nihongo_shido.json を書く。公立学校の値だけを使う。

python -I -X utf8 scripts/fetch_nihongo_shido.py

- 元の表は raw/nihongo_shido/（git に入らない）。無いものだけ取りに行く。
- 2010年以前の表は .xls なので xlrd、それ以降は openpyxl で読む（このスクリプトだけが使う。月1回の自動更新では動かさない）。
- 数字は推測しない。表に無い区分（例：2016年より前の義務教育学校、2025年より前のネパール語）は 0 ではなく null。
- 表どうしの食いちがい（県の合計と全国、学校種の和と合計、各表の「前回」の列と前回の調査、国の発表値）があれば止まる。
"""
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw" / "nihongo_shido"
OUT = ROOT / "data" / "nihongo_shido.json"
UA = {"User-Agent": "nihongo-school-map-data-build"}
CHECKED = "2026-11-09"
TERMS = "e-Stat 利用規約を確認済み。出典を示し、加工した内容を記載して利用"
ESTAT = "https://www.e-stat.go.jp/stat-search/files?toukei=00400305&tstat=000001016761"
MEXT_R7 = "https://www.mext.go.jp/b_menu/houdou/31/09/1421569_00007.htm"

PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split()
CODE = {p: f"{i + 1:02d}" for i, p in enumerate(PREFS)}
TYPES = [("elem", "小学校"), ("mid", "中学校"), ("high", "高等学校"), ("compul", "義務教育学校"), ("second", "中等教育学校"), ("special", "特別支援学校")]
TYPE_OF = {"小学校": "elem", "中学校": "mid", "高等学校": "high", "義務教育学校": "compul", "中等教育学校": "second", "特別支援学校": "special", "盲・聾・養護学校": "special"}
COMPUL_FROM = 2016  # 義務教育学校は2016年度にできた（それより前は区分がない）

# 調査ごとの情報。as_of は各調査の基準日（2010年までは9月1日、2012年から5月1日。次の調査の表の「前回」欄の見出しで確かめる）。
# published は文部科学省の発表日（確かめられたものだけ）。estat は e-Stat に載った日（年度の一覧の公開日で最も多い日付）。
SURVEYS = {
    2005: {"fy": "平成17年度", "as_of": "2005-09-01", "estat": "2006-04-26", "tclass1": "000001023222"},
    2006: {"fy": "平成18年度", "as_of": "2006-09-01", "estat": "2007-08-01", "tclass1": "000001016762"},
    2007: {"fy": "平成19年度", "as_of": "2007-09-01", "estat": "2008-08-01", "tclass1": "000001023030"},
    2008: {"fy": "平成20年度", "as_of": "2008-09-01", "estat": "2009-07-03", "tclass1": "000001031817"},
    2010: {"fy": "平成22年度", "as_of": "2010-09-01", "estat": "2011-08-16", "tclass1": "000001045804"},
    2012: {"fy": "平成24年度", "as_of": "2012-05-01", "estat": "2013-04-03", "tclass1": "000001059439"},
    2014: {"fy": "平成26年度", "as_of": "2014-05-01", "estat": "2015-04-24", "tclass1": "000001074084"},
    2016: {"fy": "平成28年度", "as_of": "2016-05-01", "estat": "2017-06-13", "tclass1": "000001102915"},
    2018: {"fy": "平成30年度", "as_of": "2018-05-01", "estat": "2020-01-10", "tclass1": "000001140106", "published": "2019-09-27",
           "note": "2019年9月の発表時の数（外国籍40,485人・日本国籍10,274人）は、のちに訂正されています。ここでは e-Stat の表と文部科学省の令和7年度の資料が使う訂正後の数を載せています。"},
    2021: {"fy": "令和3年度", "as_of": "2021-05-01", "estat": "2022-11-25", "tclass1": "000001171786", "published": "2022-10-18",
           "note": "2020年度は調査がなく、2021年度に行われました。"},
    2023: {"fy": "令和5年度", "as_of": "2023-05-01", "estat": "2024-08-30", "tclass1": "000001220961", "published": "2024-08-08"},
    2025: {"fy": "令和7年度", "as_of": "2025-05-01", "estat": "2026-07-24", "tclass1": "000001245297", "published": "2026-05-25",
           "note": "この年度から国立・私立の学校も調べていますが、過去と比べられるように公立学校の数だけを載せています（国立・公立・私立の合計は88,045人）。"},
}
# 使う表（statInfId と e-Stat の表題）。pref_*＝都道府県別（学校種別）、lang_*＝言語（母語）別、type＝学校種別（全国）
TABLES = {
    2025: {
        "pref_f": ("000040478842", "1-1-3 都道府県別 日本語指導が必要な外国籍の児童生徒の在籍人数"),
        "pref_j": ("000040478846", "1-1-7 都道府県別 日本語指導が必要な日本国籍の児童生徒の在籍人数"),
        "lang_pref_f": ("000040478850", "1-2-3 都道府県別 日本語指導が必要な外国籍の児童生徒の言語別人数"),
        "lang_pref_j": ("000040478852", "1-3-2 都道府県別 日本語指導が必要な日本国籍の児童生徒の言語別人数"),
    },
    2023: {
        "pref_f": ("000040204769", "1-1-3 都道府県別 日本語指導が必要な外国籍の児童生徒の在籍人数"),
        "pref_j": ("000040204773", "1-1-7 都道府県別 日本語指導が必要な日本国籍の児童生徒の在籍人数"),
        "lang_pref_f": ("000040204777", "1-2-3 都道府県別 日本語指導が必要な外国籍の児童生徒の言語別人数"),
        "lang_pref_j": ("000040204779", "1-3-2 都道府県別 日本語指導が必要な日本国籍の児童生徒の言語別人数"),
    },
    2021: {
        "type_f": ("000032256559", "表1 日本語の指導状況別 日本語指導が必要な外国籍の児童生徒の学校種別在籍状況"),
        "type_j": ("000032256560", "表2 日本語の指導状況別 日本語指導が必要な日本国籍の児童生徒の学校種別在籍状況"),
        "pref_f": ("000032256600", "参考1-1 都道府県別 日本語指導が必要な外国籍の児童生徒の学校種別在籍状況 在籍人数"),
        "pref_j": ("000032256603", "参考2-1 都道府県別 日本語指導が必要な日本国籍の児童生徒の学校種別在籍状況 在籍人数"),
        "lang_pref_f": ("000032256606", "参考3-1 都道府県別 日本語指導が必要な外国籍の児童生徒の言語別人数"),
        "lang_pref_j": ("000032256608", "参考4-1 都道府県別 日本語指導が必要な日本国籍の児童生徒の言語別人数"),
    },
    2018: {
        "type": ("000031946532", "表1 日本語指導が必要な児童生徒の学校種別在籍状況"),
        "lang_f": ("000031946537", "表3 日本語指導が必要な外国籍の児童生徒の母語別在籍状況"),
        "lang_j": ("000031946538", "表4 日本語指導が必要な日本国籍の児童生徒の言語別在籍状況"),
        "pref_f": ("000031946546", "表番号1-1 日本語指導が必要な外国籍の児童生徒の学校種別在籍状況（都道府県別）"),
        "pref_j": ("000031946548", "表番号2-1 日本語指導が必要な日本国籍の児童生徒の学校種別在籍状況（都道府県別）"),
        "lang_pref_f": ("000031946550", "表番号3-1 日本語指導が必要な外国籍の児童生徒の母語別在籍状況（都道府県別）"),
        "lang_pref_j": ("000031946552", "表番号4-1 日本語指導が必要な日本国籍の児童生徒の言語別在籍状況（都道府県別）"),
    },
    2016: {
        "type": ("000031595713", "表1 日本語指導が必要な児童生徒の学校種別在籍状況"),
        "lang_f": ("000031595716", "表3 日本語指導が必要な外国籍の児童生徒の母語別在籍状況"),
        "lang_j": ("000031595717", "表4 日本語指導が必要な日本国籍の児童生徒の言語別在籍状況"),
        "pref_f": ("000031595724", "表番号1-1 日本語指導が必要な外国籍の児童生徒の学校種別在籍状況（都道府県別）"),
        "pref_j": ("000031595726", "表番号2-1 日本語指導が必要な日本国籍の児童生徒の学校種別在籍状況（都道府県別）"),
        "lang_pref_f": ("000031595728", "表番号3-1 日本語指導が必要な外国籍の児童生徒の母語別在籍状況（都道府県別）"),
        "lang_pref_j": ("000031595730", "表番号4-1 日本語指導が必要な日本国籍の児童生徒の言語別在籍状況（都道府県別）"),
    },
    2014: {
        "type": ("000030634179", "表1 日本語指導が必要な児童生徒の学校種別在籍状況"),
        "lang_f": ("000030634182", "表3 日本語指導が必要な外国人児童生徒の母語別在籍状況"),
        "lang_j": ("000030634183", "表4 日本語指導が必要な日本国籍児童生徒の言語別在籍状況"),
        "pref_f": ("000030634189", "表番号1-1 日本語指導が必要な外国人児童生徒の学校種別在籍状況（都道府県別）"),
        "pref_j": ("000030634191", "表番号2-1 日本語指導が必要な日本国籍の児童生徒の学校種別在籍状況（都道府県別）"),
        "lang_pref_f": ("000030634213", "表番号3-1 日本語指導が必要な外国人児童生徒の母語別在籍状況（都道府県別）"),
        "lang_pref_j": ("000030634215", "表番号4-1 日本語指導が必要な日本国籍の児童生徒の言語別在籍状況（都道府県別）"),
    },
    2012: {
        "type": ("000020517374", "表1 日本語指導が必要な児童生徒の学校種別在籍状況"),
        "lang_f": ("000020517378", "表4 日本語指導が必要な外国人児童生徒の母語別在籍状況"),
        "pref_f": ("000020517383", "表番号1-1 日本語指導が必要な外国人児童生徒の学校種別在籍状況（都道府県別）"),
        "pref_j": ("000020517385", "表番号2-1 日本語指導が必要な日本国籍の児童生徒の学校種別在籍状況（都道府県別）"),
        "lang_pref_f": ("000020517387", "表番号3-1 日本語指導が必要な外国人児童生徒の母語別在籍状況（都道府県別）"),
    },
    2010: {
        "type": ("000012400131", "表1 日本語指導が必要な児童生徒の学校種別在籍状況"),
        "lang_f": ("000012400135", "表4 日本語指導が必要な外国人児童生徒の母語別在籍状況"),
        "pref_f": ("000012400140", "表番号1-1 日本語指導が必要な外国人児童生徒の学校種別在籍状況（都道府県別）"),
        "lang_pref_f": ("000012400142", "表番号2-1 日本語指導が必要な外国人児童生徒の母語別在籍状況（都道府県別）"),
    },
    2008: {
        "type": ("000002978372", "表1 学校種別在籍状況"),
        "lang_f": ("000002978376", "表4 母語別児童生徒数"),
        "pref_f": ("000002978381", "表番号1 日本語指導が必要な外国人児童生徒（都道府県別）"),
    },
    2007: {
        "type": ("000002223888", "表1 学校種別在籍状況"),
        "lang_f": ("000002223890", "表4 母語別児童生徒数"),
        "pref_f": ("000002223895", "表番号1 日本語指導が必要な外国人児童生徒（都道府県別）"),
    },
    2006: {
        "pref_f": ("000001200548", "参考1 都道府県別在籍状況"),
    },
    2005: {
        "type": ("000002229112", "表1 学校種別在籍状況"),
        "lang_f": ("000002229117", "表4 母語別児童生徒数"),
        "pref_f": ("000002229122", "表番号1 都道府県別在籍状況"),
    },
}
# 2006年は全国の学校種別・母語別の表が PDF しかないため、2007年の表の「前回」の数（平成18年9月1日現在）を使う
PREV_FROM = {2006: 2007}

# 国の発表値（照合用）。文部科学省「令和7年度 日本語指導が必要な児童生徒の受入状況等に関する調査結果について」p.5 の推移表と、結果の概要
OFFICIAL_F_TYPES = {  # 小・中・高・義務・中等・特支・合計（公立のみ）
    2008: (19504, 7576, 1365, None, 32, 98, 28575), 2010: (18365, 8012, 1980, None, 22, 132, 28511),
    2012: (17154, 7558, 2137, None, 24, 140, 27013), 2014: (18884, 7809, 2272, None, 56, 177, 29198),
    2016: (22156, 8792, 2915, 159, 52, 261, 34335), 2018: (26316, 10260, 3677, 184, 41, 277, 40755),
    2021: (31189, 11280, 4292, 339, 66, 453, 47619), 2023: (38141, 13369, 4991, 527, 75, 615, 57718),
    2025: (46746, 18307, 6682, 722, 75, 781, 73313),
}
OFFICIAL_J = {2012: 6171, 2014: 7897, 2016: 9612, 2018: 10371, 2021: 10688, 2023: 11405, 2025: 11446}
OFFICIAL_TOTAL = {2012: 33184, 2014: 37095, 2016: 43947, 2018: 51126, 2021: 58307, 2023: 69123, 2025: 84759}

problems = []
passed = []


def check(name, got, want):
    ok = got == want
    if ok:
        passed.append(name)
    else:
        problems.append(f"{name}: {got} ≠ {want}")
    return ok


def stat_url(sid):
    return f"https://www.e-stat.go.jp/stat-search/files?stat_infid={sid}"


def fetch(year, key, sid):
    RAW.mkdir(parents=True, exist_ok=True)
    have = list(RAW.glob(f"{year}_{key}_{sid}.*"))
    if have:
        return have[0]
    req = urllib.request.Request(f"https://www.e-stat.go.jp/stat-search/file-download?statInfId={sid}&fileKind=0", headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        b = r.read()
    ext = "xlsx" if b[:2] == b"PK" else "xls" if b[:4] == bytes.fromhex("d0cf11e0") else None
    if not ext:
        sys.exit(f"Excel ではないファイル: {sid}")
    p = RAW / f"{year}_{key}_{sid}.{ext}"
    p.write_bytes(b)
    time.sleep(0.8)
    return p


def sheet_rows(path):
    """最初のシートの行（値のリスト）"""
    if path.suffix == ".xls":
        import xlrd
        sh = xlrd.open_workbook(str(path)).sheet_by_index(0)
        return [sh.row_values(r) for r in range(sh.nrows)]
    import openpyxl
    ws = openpyxl.load_workbook(str(path), read_only=True, data_only=True).worksheets[0]
    return [list(r) for r in ws.iter_rows(values_only=True)]


def cl(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"[\s　]", "", unicodedata.normalize("NFKC", str(v)))


DASH = set()  # 「-」を 0 と読んだ表（表の中の該当者なしの印）


def num(v, where=""):
    s = cl(v).replace(",", "")
    if re.fullmatch(r"\d+(\.0+)?", s):
        return int(float(s))
    if s in ("-", "－", "‐", "―", "—"):
        DASH.add(where)
        return 0
    return None


def pref_of(row):
    for v in row[:4]:
        c = cl(v)
        if c in CODE:
            return CODE[c]
    return None


def header_cols(rows, labels, stop):
    """見出しの行から、各見出しの最初の列番号を返す（データの最初の行より上だけを見る）"""
    found = {}
    for r in rows[:stop]:
        for j, v in enumerate(r):
            c = cl(v)
            if c in labels and c not in found:
                found[c] = j
    return found


def first_data_row(rows):
    return next(i for i, r in enumerate(rows) if pref_of(r))


def total_row(rows, name_cols=4):
    for r in rows:
        if any(cl(v) in ("計", "合計", "全国") for v in r[:name_cols]) and not pref_of(r) and any(isinstance(v, (int, float)) and not isinstance(v, bool) for v in r):
            return r
    return None


# ---- 都道府県別・学校種別の表 ----
def read_pref_types(year, rows, label):
    start = first_data_row(rows)
    cols = header_cols(rows, set(TYPE_OF) | {"合計"}, start)
    tcol = {TYPE_OF[k]: j for k, j in cols.items() if k in TYPE_OF}
    if "合計" not in cols or not {"elem", "mid", "high", "second", "special"} <= set(tcol):
        sys.exit(f"{year} {label}: 見出しが読めません {cols}")
    if year >= COMPUL_FROM and "compul" not in tcol:
        sys.exit(f"{year} {label}: 義務教育学校の列がありません")
    # 前回の調査の合計の列（2018年まで「合計(平成…現在)」、2021年から「令和5年度」などの見出し）
    prev_col = None
    for r in rows[:start]:
        for j, v in enumerate(r):
            c = cl(v)
            if j > cols["合計"] and (re.fullmatch(r"合計\((平成|令和).+現在\)", c) or re.fullmatch(r"(平成|令和)\d+年度", c)):
                prev_col = j
    head = " ".join(cl(v) for r in rows[:start] for v in r if cl(v))
    out, prev = {}, {}
    for r in rows[start:]:
        code = pref_of(r)
        if not code:
            continue
        vals = {t: (num(r[j], f"{year}{label}") if (t != "compul" or year >= COMPUL_FROM) else None) for t, j in tcol.items()}
        if year < COMPUL_FROM:
            vals["compul"] = None
        tot = num(r[cols["合計"]], f"{year}{label}")
        s = sum(v for v in vals.values() if v is not None)
        check(f"{year} {label} {PREFS[int(code) - 1]}：学校種の和＝合計", s, tot)
        out[code] = [vals[t] for t, _ in TYPES]
        if prev_col is not None:
            prev[code] = num(r[prev_col])
    check(f"{year} {label}：47都道府県", len(out), 47)
    tr = total_row(rows)
    if tr is not None:
        for t, j in tcol.items():
            if vals.get(t) is not None:
                check(f"{year} {label} 合計行 {t}", sum(out[c][[x for x, _ in TYPES].index(t)] for c in out), num(tr[j]))
        check(f"{year} {label} 合計行", sum(sum(v for v in out[c] if v is not None) for c in out), num(tr[cols["合計"]]))
    return out, prev, head


# ---- 言語（母語）別：都道府県別の表 ----
def read_pref_lang(year, rows, label):
    start = first_data_row(rows)
    hdr = None
    for r in rows[:start]:
        cs = [cl(v) for v in r]
        if ("計" in cs or "合計" in cs) and sum(1 for c in cs if c.endswith("語") or c == "その他") >= 3:
            hdr = cs
    if not hdr:
        sys.exit(f"{year} {label}: 言語の見出しがありません")
    tcol = hdr.index("合計") if "合計" in hdr else hdr.index("計")
    cats = [(j, c) for j, c in enumerate(hdr) if c and j < tcol and (c.endswith("語") or c == "その他")]
    out = {}
    for r in rows[start:]:
        code = pref_of(r)
        if not code:
            continue
        vals = [num(r[j], f"{year}{label}") for j, _ in cats]
        check(f"{year} {label} {PREFS[int(code) - 1]}：言語の和＝計", sum(vals), num(r[tcol]))
        out[code] = vals
    check(f"{year} {label}：47都道府県", len(out), 47)
    tr = total_row(rows)
    if tr is not None:
        check(f"{year} {label} 合計行", [sum(out[c][i] for c in out) for i in range(len(cats))], [num(tr[j]) for j, _ in cats])
    return [c for _, c in cats], out


# ---- 言語（母語）別：全国の表（前回の数の行と今回の数の行が組になっている） ----
def read_nat_lang(year, rows, label):
    hi = next(i for i, r in enumerate(rows) if "小学校" in [cl(v) for v in r])
    tcol = [cl(v) for v in rows[hi]].index("合計")
    entries = []  # [名前, [数の行…]]
    for r in rows[hi + 1:]:
        name = next((cl(v) for v in r[:2] if cl(v)), "")
        if name.startswith("※"):
            break
        n = num(r[tcol]) if tcol < len(r) else None
        if n is None or (name and "構成比" in name):
            continue
        if name and not name.startswith("(") and not name.startswith("（"):
            entries.append([name, [n]])
        else:
            if not entries:
                sys.exit(f"{year} {label}: 行の読み方が分かりません")
            entries[-1][1].append(n)
            if name:
                entries[-1][0] += name
    total = next(e for e in entries if e[0] in ("合計", "計"))
    langs = [e for e in entries if e is not total]
    pairs = all(len(e[1]) == 2 for e in entries)
    if not pairs and not all(len(e[1]) == 1 for e in entries):
        sys.exit(f"{year} {label}: 前回と今回の行がそろいません {entries}")
    cur = [e[1][-1] for e in langs]
    check(f"{year} {label}：言語の和＝合計", sum(cur), total[1][-1])
    prev = ([e[1][0] for e in langs], total[1][0]) if pairs else None
    return [e[0] for e in langs], cur, total[1][-1], prev


# ---- 学校種別：全国の表（2018年まで。外国籍・日本国籍の今回と前回） ----
def read_nat_types(year, rows, label):
    hi = next(i for i, r in enumerate(rows) if "小学校" in [cl(v) for v in r])
    cols = header_cols(rows[hi:hi + 1], set(TYPE_OF) | {"合計"}, 1)
    tcol = {TYPE_OF[k]: j for k, j in cols.items() if k in TYPE_OF}
    lab = lambda r: "".join(cl(v) for v in r[:6])

    def vals(r, y):
        d = {t: (num(r[j]) if (t != "compul" or y >= COMPUL_FROM) else None) for t, j in tcol.items()}
        d.setdefault("compul", None)
        return [d[t] for t, _ in TYPES], num(r[cols["合計"]])

    fi = next(i for i, r in enumerate(rows) if re.search(r"児童生徒数:?1$", lab(r)))
    ji = next(i for i, r in enumerate(rows) if "日本国籍" in lab(r))
    jc, jp = (ji + 1, ji) if "有する" in lab(rows[ji]) else (ji, ji - 1)
    return {"f": vals(rows[fi], year), "f_prev": rows[fi - 1], "j": vals(rows[jc], year), "j_prev": rows[jp], "vals": vals}


def bare(name):
    """括弧書きを除いた区分名（表どうしの照合用）"""
    return re.sub(r"[(（].*[)）]$", "", name)


def lang_kind(title):
    return "母語別" if "母語" in title else "言語別"


def main():
    years = sorted(SURVEYS)
    data = {y: {"src": {}} for y in years}
    heads = {}
    nat_type_tables = {}
    for y in years:
        for key, (sid, title) in TABLES.get(y, {}).items():
            data[y]["src"][key] = {"id": sid, "title": title, "url": stat_url(sid)}
            rows = sheet_rows(fetch(y, key, sid))
            if key in ("pref_f", "pref_j"):
                vals, prev, head = read_pref_types(y, rows, key)
                data[y][key] = vals
                data[y][key + "_prev"] = prev
                heads[(y, key)] = head
            elif key in ("lang_pref_f", "lang_pref_j"):
                data[y][key] = read_pref_lang(y, rows, key)
            elif key in ("lang_f", "lang_j"):
                data[y][key] = read_nat_lang(y, rows, key)
            elif key == "type":
                nat_type_tables[y] = (rows, read_nat_types(y, rows, key))
            elif key in ("type_f", "type_j"):
                data[y][key] = rows

    # 2006年：全国の学校種別・母語別は2007年の表の前回の数から
    rows07, t07 = nat_type_tables[2007]
    f06, ft06 = t07["vals"](t07["f_prev"], 2006)
    j06, jt06 = t07["vals"](t07["j_prev"], 2006)
    data[2006]["src"]["type"] = dict(data[2007]["src"]["type"], prev=True)
    data[2006]["src"]["lang_f"] = dict(data[2007]["src"]["lang_f"], prev=True)

    out_years = []
    for i, y in enumerate(years):
        d, meta = data[y], SURVEYS[y]
        pf, pj = d.get("pref_f"), d.get("pref_j")
        # ---- 全国の学校種別 ----
        sum_types = lambda pv: [None if all(pv[c][k] is None for c in pv) else sum(pv[c][k] for c in pv) for k in range(len(TYPES))]
        nf = sum_types(pf)
        if y in nat_type_tables:
            t = nat_type_tables[y][1]
            check(f"{y} 全国の表（外国籍）＝県の和", t["f"][0], nf)
            nj, jtot = t["j"]
            if pj:
                check(f"{y} 全国の表（日本国籍）＝県の和", nj, sum_types(pj))
        elif y == 2006:
            check("2006 2007年の表の前回（外国籍）＝2006年の県の和", f06, nf)
            nj, jtot = j06, jt06
        else:
            nj = sum_types(pj)
            jtot = sum(v for v in nj if v is not None)
        if "type_f" in d:  # 2021年：指導状況別の表の「(ア)」の行
            for k, v in (("type_f", nf), ("type_j", nj)):
                r = next(r for r in d[k] if cl(r[1]) == "(ア)")
                cells = [num(x) for x in r[4:] if num(x) is not None]
                check(f"{y} {k}（ア）の人数＝県の和", cells[0::2][:7], v + [sum(x for x in v if x is not None)])
        ftot = sum(x for x in nf if x is not None)
        check(f"{y} 日本国籍の学校種の和＝合計", sum(x for x in nj if x is not None), jtot)
        if y in OFFICIAL_F_TYPES:
            check(f"{y} 外国籍の学校種別＝文科省の推移表", nf + [ftot], list(OFFICIAL_F_TYPES[y]))
        if y in OFFICIAL_J:
            check(f"{y} 日本国籍＝文科省の発表値", jtot, OFFICIAL_J[y])
            check(f"{y} 合計＝文科省の発表値", ftot + jtot, OFFICIAL_TOTAL[y])
        # ---- 前回の調査とのつながり（各表の「前回」の列＝前回の調査の値）----
        if i:
            py = years[i - 1]
            for key in ("pref_f", "pref_j"):
                prev = d.get(key + "_prev")
                if prev and data[py].get(key):
                    check(f"{y} {key} の前回の列＝{py}年の県の値", prev, {c: sum(v for v in data[py][key][c] if v is not None) for c in prev})
            if y in nat_type_tables:
                t = nat_type_tables[y][1]
                pf_, pft = t["vals"](t["f_prev"], py)
                check(f"{y} 全国の表の前回（外国籍）＝{py}年", pft, out_years[-1]["nat"]["f"])
                pj_, pjt = t["vals"](t["j_prev"], py)
                if y != 2005:
                    check(f"{y} 全国の表の前回（日本国籍）＝{py}年", pjt, out_years[-1]["nat"]["j"])
            # 基準日：次の調査の表の見出しに前回の基準日が書かれている（2021年からは年度だけ）
        nxt = years[i + 1] if i + 1 < len(years) else None
        if nxt and nxt <= 2018:
            m = re.search(r"(平成|令和)(\d+|元)年(\d+)月(\d+)日現在", heads.get((nxt, "pref_f"), ""))
            if m:
                era = 1988 if m.group(1) == "平成" else 2018
                got = f"{era + int(m.group(2)):04d}-{int(m.group(3)):02d}-{int(m.group(4)):02d}"
                check(f"{y} 基準日（{nxt}年の表の前回欄）", got, meta["as_of"])
        # ---- 言語（母語）別 ----
        lang = {}
        for nat in ("f", "j"):
            title = None
            cats = natv = prefv = None
            if f"lang_pref_{nat}" in d:
                cats, prefv = d[f"lang_pref_{nat}"]
                natv = [sum(prefv[c][k] for c in prefv) for k in range(len(cats))]
                title = d["src"][f"lang_pref_{nat}"]["title"]
            if f"lang_{nat}" in d:
                c2, v2, tot2, _ = d[f"lang_{nat}"]
                title = title or d["src"][f"lang_{nat}"]["title"]
                if cats:
                    check(f"{y} 言語{nat}：全国の表＝県の和", dict(zip(map(bare, c2), v2)), dict(zip(map(bare, cats), natv)))
                # 区分名は全国の表の書き方を使う（例：2010・2012年の全国の表は「フィリピノ語(タガログ語)」、県別の表は「フィリピノ語」）
                order = [cats.index(next(c for c in cats if bare(c) == bare(n))) for n in c2] if cats else None
                if order is not None and prefv:
                    prefv = {c: [prefv[c][k] for k in order] for c in prefv}
                cats, natv = c2, v2
            if y == 2006 and nat == "f":
                c7, _, _, prev7 = data[2007]["lang_f"]
                cats, natv = c7, prev7[0]
                check("2006 母語の和（2007年の表の前回）＝外国籍", prev7[1], ftot)
                title = data[2007]["src"]["lang_f"]["title"]
            if not cats:
                continue
            ntot = ftot if nat == "f" else jtot
            check(f"{y} 言語{nat}の和＝{'外国籍' if nat == 'f' else '日本国籍'}の合計", sum(natv), ntot)
            if prefv:
                pt = pf if nat == "f" else pj
                for c in prefv:
                    check(f"{y} 言語{nat} {PREFS[int(c) - 1]}＝学校種別の合計", sum(prefv[c]), sum(v for v in pt[c] if v is not None))
            names = [re.sub(r"\((.+)\)$", r"（\1）", c) for c in cats]
            lang[nat] = {"kind": lang_kind(title), "cats": names, "nat": natv, "pref": prefv}
        # 前回の言語の値（全国の表の前回の行）＝前回の調査
        if f"lang_f" in d and d["lang_f"][3] and i:
            py = years[i - 1]
            pl = out_years[-1]["lang"].get("f")
            c2, _, _, (pv, pt) = d["lang_f"]
            if pl:
                names = [re.sub(r"\((.+)\)$", r"（\1）", c) for c in c2]
                check(f"{y} 母語の表の前回＝{py}年", dict(zip(map(bare, names), pv)), dict(zip(map(bare, pl["cats"]), pl["nat"])))
        out_years.append({
            "year": y, "fy": meta["fy"], "as_of": meta["as_of"], "published": meta.get("published"), "estat_posted": meta["estat"],
            "estat_url": f"{ESTAT}&cycle=0&tclass1={meta['tclass1']}&layout=datalist",
            "nat": {"f": ftot, "j": jtot},
            "pref": {"f": {c: sum(v for v in pf[c] if v is not None) for c in sorted(pf)}, "j": {c: sum(v for v in pj[c] if v is not None) for c in sorted(pj)} if pj else None},
            "special_label": "盲・聾・養護学校" if y <= 2006 else "特別支援学校",
            "type": {"nat": {"f": nf, "j": nj}, "pref": {"f": pf, "j": pj}},
            "lang": lang,
            "src": d["src"],
            "note": meta.get("note"),
        })
    if problems:
        print("食いちがいがあります：")
        for p in problems:
            print(" ", p)
        sys.exit(1)
    out = {
        "id": "nihongo_shido",
        "title": "日本語指導が必要な児童生徒",
        "survey": "文部科学省「日本語指導が必要な児童生徒の受入状況等に関する調査」",
        "scope": "公立の小学校・中学校・高等学校・義務教育学校・中等教育学校・特別支援学校",
        "estat_url": ESTAT, "mext_url": MEXT_R7, "checked": CHECKED, "terms": TERMS,
        "lang_def": "家庭及び日常生活において、比較的使用頻度の高い言語別（文部科学省の令和5年度・令和7年度の報告書の定義）",
        "prefs": {CODE[p]: p for p in PREFS},
        "types": [{"id": k, "label": v} for k, v in TYPES],
        "years": out_years,
        "dash_tables": sorted(DASH),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf8")
    for o in out_years:
        lk = "・".join(f"{n}{o['lang'][n]['kind']}{len(o['lang'][n]['cats'])}区分{'(県別あり)' if o['lang'][n]['pref'] else ''}" for n in o["lang"])
        print(o["year"], o["as_of"], "外国籍", f"{o['nat']['f']:,}", "日本国籍", f"{o['nat']['j']:,}", "県別日本国籍", "あり" if o["pref"]["j"] else "なし", lk)
    print(f"照合 {len(passed)}件すべて一致（うち基準日 {sum('基準日' in n for n in passed)}件、前回の列 {sum('前回' in n for n in passed)}件、文科省の発表値 {sum('文科省' in n for n in passed)}件）")
    print("「-」を0と読んだ表：", ", ".join(sorted(DASH)) or "なし")
    print("書き出し", OUT)


if __name__ == "__main__":
    main()
