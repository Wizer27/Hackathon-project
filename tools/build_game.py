"""Готовит данные для игры из карты парка (запускать после build_data.py).

    pip install pillow
    python tools/build_game.py

На выходе: game-data.js (сетка проходимости по дорожкам карты) и assets/thumbs/*.jpg.
"""
import json
from collections import deque
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
CELL = 10  # размер клетки сетки в пикселях карты


def walkable(p):
    r, g, b = p
    hi, lo = max(p), min(p)
    if hi - lo < 14 and 205 <= hi <= 243:  # серые площади и аллеи
        return True
    return r >= g - 4 and g >= b - 4 and 190 <= r <= 245 and 6 <= r - b <= 60 and g >= 175  # бежевые дорожки


def morph(g, w, h, op):
    out = [[0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            vals = [g[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if 0 <= y + dy < h and 0 <= x + dx < w]
            out[y][x] = max(vals) if op == "dilate" else min(vals)
    return out


def main():
    im = Image.open(ROOT / "map/assets/map.webp").convert("RGB")
    px = im.load()
    w, h = im.width // CELL, im.height // CELL
    grid = [[0] * w for _ in range(h)]
    for gy in range(h):
        for gx in range(w):
            hits = sum(walkable(px[gx * CELL + dx, gy * CELL + dy]) for dy in range(0, CELL, 2) for dx in range(0, CELL, 2))
            grid[gy][gx] = 1 if hits >= 3 else 0
    grid = morph(morph(grid, w, h, "dilate"), w, h, "erode")  # закрываем мелкие разрывы

    # оставляем только самую большую связную область — сам парк
    comp = [[0] * w for _ in range(h)]
    best, cid = (0, 0), 0
    for y in range(h):
        for x in range(w):
            if grid[y][x] and not comp[y][x]:
                cid += 1
                q, n = deque([(x, y)]), 0
                comp[y][x] = cid
                while q:
                    cx, cy = q.popleft()
                    n += 1
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and grid[ny][nx] and not comp[ny][nx]:
                            comp[ny][nx] = cid
                            q.append((nx, ny))
                best = max(best, (n, cid))
    rows = ["".join("1" if comp[y][x] == best[1] else "0" for x in range(w)) for y in range(h)]
    (ROOT / "game-data.js").write_text(
        "// Сгенерировано tools/build_game.py — сетка дорожек парка (1 — можно ходить)\n"
        f"window.WALK = {json.dumps({'cell': CELL, 'w': w, 'h': h, 'rows': rows})};\n"
    )

    thumbs = ROOT / "assets/thumbs"
    thumbs.mkdir(parents=True, exist_ok=True)
    for f in sorted((ROOT / "map/assets/photos").glob("*.jpg")):
        ImageOps.fit(Image.open(f).convert("RGB"), (160, 160)).save(thumbs / f.name, quality=80, optimize=True)
    print(f"сетка {w}x{h}, проходимых клеток {best[0]}, миниатюр {len(list(thumbs.glob('*.jpg')))}")


if __name__ == "__main__":
    main()
