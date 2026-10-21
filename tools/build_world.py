"""Готовит 3D-мир из официальной карты парка (запускать после build_data.py).

    pip install pymupdf pillow
    python tools/build_world.py "Карта вертикальная.pdf"

На выходе:
  assets/world/tile_<i>_<j>.jpg — карта парка в высоком разрешении (текстура земли)
  world-data.js                — деревья, фонари, скамейки и кусты (белые фигуры карты — здания — остаются свободными)
"""
import json
import random
import sys
from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAP_SCALE = 3                     # масштаб map/assets/map.webp относительно PDF (см. build_data.py)
CLIP_TOP = 1000                   # верх фрагмента карты в координатах PDF (см. build_data.py)
REGION = (1000, 150, 3060, 2250)  # подробная часть карты (парк) в пикселях map.webp
DETAIL = 3                        # во сколько раз подробнее map.webp рисуем парк
TILES = 3                         # сетка тайлов TILES x TILES
CELL = 3                          # клетка для поиска зданий, px
random.seed(7)


def load_items():
    text = (ROOT / "map/data.js").read_text()
    return json.loads(text.split("=", 1)[1].strip().rstrip(";"))["items"]


def render_tiles(pdf):
    page = fitz.open(pdf)[0]
    x0, y0, x1, y1 = REGION
    rect = fitz.Rect(x0 / MAP_SCALE, CLIP_TOP + y0 / MAP_SCALE, x1 / MAP_SCALE, CLIP_TOP + y1 / MAP_SCALE)
    pix = page.get_pixmap(matrix=fitz.Matrix(MAP_SCALE * DETAIL, MAP_SCALE * DETAIL), clip=rect)
    img = Image.open(BytesIO(pix.tobytes("png"))).convert("RGB")
    out = ROOT / "assets/world"
    out.mkdir(parents=True, exist_ok=True)
    tw, th = img.width // TILES, img.height // TILES
    for j in range(TILES):
        for i in range(TILES):
            img.crop((i * tw, j * th, (i + 1) * tw, (j + 1) * th)).save(out / f"tile_{i}_{j}.jpg", quality=82, optimize=True)
    # размер тайла в пикселях map.webp
    return {"x": x0, "y": y0, "w": (x1 - x0) / TILES, "h": (y1 - y0) / TILES, "n": TILES}


def is_white(p):
    return min(p) >= 247


def is_green(p):
    r, g, b = p
    return g > r + 4 and g > b + 15 and g < 215


def find_buildings(im, items):
    px = im.load()
    W, H = im.width // CELL, im.height // CELL
    white = [[0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            hits = sum(is_white(px[x * CELL + dx, y * CELL + dy]) for dy in (0, 1, 2) for dx in (0, 1, 2))
            white[y][x] = hits >= 6
    # убираем тонкие белые линии (разметка, контуры): эрозия + дилатация крестом
    def morph(g, op):
        o = [[0] * W for _ in range(H)]
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                v = (g[y][x], g[y - 1][x], g[y + 1][x], g[y][x - 1], g[y][x + 1])
                o[y][x] = min(v) if op == "e" else max(v)
        return o
    white = morph(morph(white, "e"), "d")
    # на местах аттракционов будут 3D-модели — белые площадки под ними не поднимаем
    for it in items:
        gx, gy, r = it["x"] // CELL, it["y"] // CELL, 26 // CELL
        for y in range(gy - r, gy + r + 1):
            for x in range(gx - r, gx + r + 1):
                if 0 <= x < W and 0 <= y < H and (x - gx) ** 2 + (y - gy) ** 2 <= r * r:
                    white[y][x] = 0
    # связные компоненты → высота здания по площади
    comp = [[0] * W for _ in range(H)]
    sizes = {}
    cid = 0
    for y in range(H):
        for x in range(W):
            if white[y][x] and not comp[y][x]:
                cid += 1
                stack, n = [(x, y)], 0
                comp[y][x] = cid
                while stack:
                    cx, cy = stack.pop()
                    n += 1
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < W and 0 <= ny < H and white[ny][nx] and not comp[ny][nx]:
                            comp[ny][nx] = cid
                            stack.append((nx, ny))
                sizes[cid] = n
    height = {}
    for c, n in sizes.items():
        height[c] = 0 if n < 8 else 3.5 if n < 70 else 5 if n < 260 else 8 if n < 1000 else 16
    # контур каждой компоненты: обходим граничные рёбра клеток и упрощаем ломаную (Дуглас — Пекер)
    edges = {}
    for y in range(H):
        for x in range(W):
            c = comp[y][x]
            if not c or not height[c]:
                continue
            out = lambda nx, ny: not (0 <= nx < W and 0 <= ny < H) or comp[ny][nx] != c
            e = edges.setdefault(c, {})
            if out(x, y - 1): e.setdefault((x, y), []).append((x + 1, y))
            if out(x + 1, y): e.setdefault((x + 1, y), []).append((x + 1, y + 1))
            if out(x, y + 1): e.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if out(x - 1, y): e.setdefault((x, y + 1), []).append((x, y))
    rects = []
    for c, e in edges.items():
        loops = []
        while e:
            start = next(iter(e))
            loop, cur = [start], start
            while True:
                nxt = e[cur].pop()
                if not e[cur]:
                    del e[cur]
                if nxt == start:
                    break
                loop.append(nxt)
                cur = nxt
                if cur not in e:
                    break
            loops.append(loop)
        outer = max(loops, key=len)
        pts = simplify(outer + [outer[0]], 0.9)[:-1]
        if len(pts) >= 3:
            rects.append({"p": [v * CELL for pt in pts for v in pt], "h": height[c], "c": c % 7})
    return rects, white


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = (dx * dx + dy * dy) ** 0.5 or 1e-9
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L if (dx or dy) else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
        if d > best:
            best, bi = d, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: bi + 1], tol)[:-1] + simplify(pts[bi:], tol)


def find_props(im, items, white, walk):
    """Фонари и скамейки вдоль аллей, кусты на газонах у дорожек."""
    px = im.load()
    cell, gw, gh, rows = walk["cell"], walk["w"], walk["h"], walk["rows"]
    isw = lambda x, y: 0 <= x < gw and 0 <= y < gh and rows[y][x] == "1"
    lamps, benches, bushes = [], [], []
    taken = set()
    for y in range(gh):
        for x in range(gw):
            if not isw(x, y):
                continue
            # край аллеи: рядом газон
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if isw(x + dx, y + dy):
                    continue
                gx, gy = (x + dx) * cell + cell // 2, (y + dy) * cell + cell // 2
                if not (0 <= gx < im.width and 0 <= gy < im.height) or not is_green(px[gx, gy]):
                    continue
                key = (x // 4, y // 4)
                if key in taken or any((it["x"] - x * cell) ** 2 + (it["y"] - y * cell) ** 2 < 28 ** 2 for it in items):
                    continue
                taken.add(key)
                lx, ly = x * cell + cell / 2 + dx * 4, y * cell + cell / 2 + dy * 4
                if random.random() < 0.55:
                    lamps.append([round(lx), round(ly)])
                elif random.random() < 0.5:
                    benches.append([round(lx), round(ly), dx, dy])
                if random.random() < 0.7:
                    bushes.append([round(gx + dx * 6 + random.uniform(-4, 4)), round(gy + dy * 6 + random.uniform(-4, 4)), round(random.uniform(0.7, 1.3), 2)])
                break
    return lamps, benches, bushes


def find_trees(im, items, white, walk):
    px = im.load()
    x0, y0, x1, y1 = REGION
    trees = []
    step = 13
    for y in range(max(0, y0 - 150), min(im.height, y1 + 150), step):
        for x in range(max(0, x0 - 250), min(im.width, x1 + 150), step):
            jx, jy = x + random.uniform(-5, 5), y + random.uniform(-5, 5)
            if not (0 <= jx < im.width and 0 <= jy < im.height):
                continue
            p = px[int(jx), int(jy)]
            if not is_green(p):
                continue
            cx, cy = int(jx) // walk["cell"], int(jy) // walk["cell"]
            near_path = any(
                0 <= cy + dy < walk["h"] and 0 <= cx + dx < walk["w"] and walk["rows"][cy + dy][cx + dx] == "1"
                for dy in (-1, 0, 1) for dx in (-1, 0, 1)
            )
            if near_path:
                continue
            bx, by = int(jx) // CELL, int(jy) // CELL
            if any(white[by + dy][bx + dx] for dy in (-2, 0, 2) for dx in (-2, 0, 2)
                   if 0 <= by + dy < len(white) and 0 <= bx + dx < len(white[0])):
                continue
            if any((it["x"] - jx) ** 2 + (it["y"] - jy) ** 2 < 32 ** 2 for it in items):
                continue
            forest = p[1] - p[2] >= 40  # тёмно-зелёное на карте — лес и посадки
            inside = x0 + 150 < jx < x1 - 100 and y0 + 100 < jy < y1 - 100
            chance = 0.75 if forest else 0.12 if inside else 0.03
            if random.random() < chance:
                trees.append([round(jx), round(jy), round(random.uniform(0.75, 1.35), 2), random.randint(0, 2)])
    return trees


def main(pdf):
    items = load_items()
    tiles = render_tiles(pdf)
    im = Image.open(ROOT / "map/assets/map.webp").convert("RGB")
    walk = json.loads((ROOT / "game-data.js").read_text().split("=", 1)[1].strip().rstrip(";"))
    rects, white = find_buildings(im, items)
    trees = find_trees(im, items, white, walk)
    lamps, benches, bushes = find_props(im, items, white, walk)
    data = {"mapW": im.width, "mapH": im.height, "tiles": tiles, "trees": trees,
            "lamps": lamps, "benches": benches, "bushes": bushes}
    (ROOT / "world-data.js").write_text(
        "// Сгенерировано tools/build_world.py — 3D-мир по официальной карте парка\n"
        f"window.WORLD = {json.dumps(data, separators=(',', ':'))};\n"
    )
    print(f"тайлов {tiles['n'] ** 2}, деревьев {len(trees)}, фонарей {len(lamps)}, скамеек {len(benches)}, кустов {len(bushes)}")


if __name__ == "__main__":
    main(sys.argv[1])
