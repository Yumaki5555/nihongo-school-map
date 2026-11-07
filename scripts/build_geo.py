"""画像保存用の地図データ（都道府県ごと：市区町村の境界・線路・駅）を作る。
画像に地域の境界・地名・駅を描くために使う（地図タイルは使わない）。

使い方：python -I -X utf8 scripts/build_geo.py 境界のフォルダ 鉄道のフォルダ
  境界のフォルダ：国土数値情報（行政区域）をスマートニュース メディア研究所が軽量化した
    TopoJSON（N03-21_XX_210101.json。https://github.com/smartnews-smri/japan-topography の s0010）
  鉄道のフォルダ：国土数値情報（鉄道）N02-24 の UTF-8 フォルダ（N02-24_RailroadSection.geojson・N02-24_Station.geojson）
    https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2024.html （オープンデータ CC BY 4.0）
出力：data/geo/p01.json … p47.json と data/geo/index.json（build_site.py が docs/data/geo/ へ写す）
"""
import json
import math
import pathlib
import sys
from collections import Counter, defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "geo"
# 浜松市は2024年に区を再編した（境界データは2021年時点）。旧区を新しい区にまとめる
_CHUO = ("22138", "浜松市中央区")
_HAMANA = ("22139", "浜松市浜名区")
REMAP = {"22131": _CHUO, "22132": _CHUO, "22133": _CHUO, "22134": _CHUO, "22135": _HAMANA, "22136": _HAMANA, "22137": ("22140", "浜松市天竜区")}
MARGIN = 0.06  # 県の外側にどれだけ線路と駅を含めるか（度）


def decode_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append([round(x * sx + tx, 5), round(y * sy + ty, 5)])
        arcs.append(pts)
    return arcs


def simplify(pts, tol):
    """線の形を保ったまま点を間引く（ダグラス・ポイカー法）。"""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, idx = 0, None
        for i in range(a + 1, b):
            px, py = pts[i]
            t = 0 if den == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / den))
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol * tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def ring_pts(ring, arcs):
    out = []
    for a in ring:
        seq = arcs[a] if a >= 0 else list(reversed(arcs[~a]))
        out.extend(seq if not out else seq[1:])
    return out


def area_centroid(ring):
    a = cx = cy = 0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if a == 0:
        return 0, ring[0][0], ring[0][1]
    return abs(a / 2), cx / (3 * a), cy / (3 * a)


def inside(pt, ring):
    x, y = pt
    c = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c


def label_point(ring):
    """名前を置く位置：いちばん大きい陸地の重心（形の外に出たら、内側で境界からいちばん遠い格子点）。"""
    _, cx, cy = area_centroid(ring)
    if inside((cx, cy), ring):
        return [round(cy, 4), round(cx, 4)]
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    best, bp = -1, (ring[0][0], ring[0][1])
    for i in range(1, 20):
        for j in range(1, 20):
            p = (min(xs) + (max(xs) - min(xs)) * i / 20, min(ys) + (max(ys) - min(ys)) * j / 20)
            if inside(p, ring):
                d = min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in ring)
                if d > best:
                    best, bp = d, p
    return [round(bp[1], 4), round(bp[0], 4)]


def bbox_of(pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [round(min(ys), 4), round(min(xs), 4), round(max(ys), 4), round(max(xs), 4)]  # 南・西・北・東


def cities(path):
    """市区町村：線（arc）を共有したまま持つ。同じ市区町村どうしの線は描かない（浜松市の旧区の境など）。"""
    topo = json.loads(path.read_text("utf8"))
    arcs = decode_arcs(topo)
    by_code = defaultdict(lambda: {"polys": []})
    for g in list(topo["objects"].values())[0]["geometries"]:
        p = g["properties"]
        code = p.get("N03_007")
        if not code or g["type"] not in ("Polygon", "MultiPolygon"):
            continue  # 所属未定地など
        name = (p.get("N03_003") or "") + (p.get("N03_004") or "") if (p.get("N03_003") or "").endswith("市") else p.get("N03_004") or ""
        code, name = REMAP.get(code, (code, name))
        polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
        by_code[code]["name"] = name
        by_code[code]["polys"] += polys
    # 線ごとに、どの市区町村が使うか
    users, occ = defaultdict(set), Counter()
    for code, c in by_code.items():
        for poly in c["polys"]:
            for ring in poly:
                for a in ring:
                    users[a if a >= 0 else ~a].add(code)
                    occ[a if a >= 0 else ~a] += 1
    used = sorted(users)
    new_index = {a: i for i, a in enumerate(used)}
    out_arcs = [arcs[a] for a in used]
    remap = lambda a: new_index[a] if a >= 0 else ~new_index[~a]
    feats = []
    for code in sorted(by_code):
        c = by_code[code]
        polys = [[[remap(a) for a in ring] for ring in poly] for poly in c["polys"]]
        outer = [ring_pts(poly[0], out_arcs) for poly in polys]
        main = max(outer, key=lambda r: area_centroid(r)[0])
        allpts = [p for r in outer for p in r]
        feats.append({"c": code, "n": c["name"], "r": polys, "lp": label_point(main), "bb": bbox_of(allpts), "mb": bbox_of(main)})
    # 描く線：同じ市区町村の中の線は除く。k=1 は県の外周（海岸か県境）
    lines = []
    for a in used:
        if len(users[a]) == 1 and occ[a] > 1:
            continue  # 同じ市区町村が両側にある線
        lines.append([new_index[a], 1 if occ[a] == 1 else 0])
    return out_arcs, feats, lines


def rails_and_stations(folder):
    rails = json.loads((folder / "N02-24_RailroadSection.geojson").read_text("utf8"))["features"]
    stations = json.loads((folder / "N02-24_Station.geojson").read_text("utf8"))["features"]
    lines = []
    for f in rails:
        g = f["geometry"]
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for pts in parts:
            s = simplify([[round(x, 5), round(y, 5)] for x, y in pts], 0.00025)
            if len(s) >= 2:
                lines.append({"k": 1 if f["properties"]["N02_002"] == "1" else 0, "p": [[round(x, 4), round(y, 4)] for x, y in s]})
    groups = defaultdict(list)
    for f in stations:
        p = f["properties"]
        pts = f["geometry"]["coordinates"]
        mid = pts[len(pts) // 2]
        groups[p["N02_005g"]].append((p["N02_005"], p["N02_004"], p["N02_003"], mid))
    st = []
    for g, items in groups.items():
        name = Counter(i[0] for i in items).most_common(1)[0][0]
        x = sum(i[3][0] for i in items) / len(items)
        y = sum(i[3][1] for i in items) / len(items)
        st.append({"n": name, "la": y, "ln": x, "lines": {(i[1], i[2]) for i in items}})
    # 同じ名前で800m以内の駅（会社ごとに別の駅として載っているもの）は1つにまとめる。k＝乗り入れる路線の数
    merged = []
    for s in sorted(st, key=lambda s: -len(s["lines"])):
        m = next((x for x in merged if x["n"] == s["n"] and math.hypot(x["la"] - s["la"], x["ln"] - s["ln"]) < 0.008), None)
        if m:
            m["lines"] |= s["lines"]
        else:
            merged.append(s)
    st = [{"n": s["n"], "la": round(s["la"], 4), "ln": round(s["ln"], 4), "k": len(s["lines"])} for s in merged]
    return lines, st


def within(bb, la, ln, m):
    return bb[0] - m <= la <= bb[2] + m and bb[1] - m <= ln <= bb[3] + m


def main():
    bdir, rdir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    rails, stations = rails_and_stations(rdir)
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"source": {"boundary": "国土数値情報（行政区域）2021年1月1日時点（スマートニュース メディア研究所の軽量版）", "rail": "国土数値情報（鉄道）2024年"}, "prefs": {}}
    total = 0
    for i in range(1, 48):
        code = f"{i:02d}"
        arcs, feats, lines = cities(bdir / f"N03-21_{code}_210101.json")
        bb = bbox_of([p for a in arcs for p in a])
        # 離島の多い県（東京都など）で範囲が広がりすぎないよう、市区町村ごとの範囲で選ぶ
        boxes = [c["bb"] for c in feats]
        near = lambda la, ln: any(within(b, la, ln, MARGIN) for b in boxes)
        r = [x for x in rails if any(near(y, xx) for xx, y in x["p"])]
        s = [dict(x) for x in stations if near(x["la"], x["ln"])]
        # 駅がこの県のどの市区町村にあるか（c。画像で地域の中の駅を先に出すため）
        rings = [(c["c"], c["bb"], [[ring_pts(r, arcs) for r in poly] for poly in c["r"]]) for c in feats]
        for x in s:
            for code_c, b, polys in rings:
                if within(b, x["la"], x["ln"], 0) and any(inside((x["ln"], x["la"]), poly[0]) and not any(inside((x["ln"], x["la"]), h) for h in poly[1:]) for poly in polys):
                    x["c"] = code_c
                    break
        data = {"code": code, "arcs": arcs, "lines": lines, "cities": feats, "rails": r, "stations": s}
        p = OUT / f"p{code}.json"
        p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf8")
        total += p.stat().st_size
        # 画像の範囲にかかる県だけを読むための、市区町村ごとの範囲（南・西・北・東。小数2桁に丸めて少し広げる）
        bbs = sorted({(math.floor(c["bb"][0] * 100) / 100, math.floor(c["bb"][1] * 100) / 100, math.ceil(c["bb"][2] * 100) / 100, math.ceil(c["bb"][3] * 100) / 100) for c in feats})
        index["prefs"][code] = {"bb": bb, "kb": p.stat().st_size // 1024, "bbs": [list(x) for x in bbs]}
        print(code, "市区町村", len(feats), "線路", len(r), "駅", len(s), p.stat().st_size // 1024, "KB")
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), "utf8")
    print("合計", total // 1024, "KB")


if __name__ == "__main__":
    main()
