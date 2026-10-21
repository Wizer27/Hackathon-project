"""Собирает данные для приложения из материалов парка.

Использование:
    pip install pymupdf pillow
    python tools/build_data.py <таблица.xlsx> <Карта вертикальная.pdf>

На выходе: data.js, assets/map.webp, assets/photos/*.jpg, assets/icon-*.png
"""
import json
import re
import statistics
import sys
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
EMU_PER_PT = 12700

# Фрагмент вертикальной карты (в единицах PDF), который показывает приложение
CLIP = (0, 1000, 1080, 2150)
MAP_SCALE = 3

# Строки таблицы без своей категории в колонке A
CATEGORY_OVERRIDES = {range(22, 39): "Семейные аттракционы", range(55, 63): "Локации и лабиринты"}
CATEGORY_IDS = {
    "Экстремальные аттракционы": "extreme",
    "Семейные аттракционы": "family",
    "Детские аттракционы": "kids",
    "Тематические парки с животными": "animals",
    "Локации и лабиринты": "locations",
    "Площадки для мероприятий": "events",
    "Заказ праздников": "events",
    "Кафе и рестораны": "food",
    "Сервисные объекты": "service",
    "Сувенирные магазины": "shop",
    "Аркады": "arcade",
    "Фотостудии": "photo",
    "Аквагрим": "photo",
    "Остановки": "transport",
    "Парковки": "transport",
}


def read_cells(z):
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            strings.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = {}
    for row in sheet.iter(f"{{{NS['m']}}}row"):
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            if v is None:
                continue
            val = strings[int(v.text)] if c.get("t") == "s" else v.text
            col, r = re.match(r"([A-Z]+)(\d+)", c.get("r")).groups()
            rows.setdefault(int(r), {})[col] = " ".join(val.split())
    return rows


def read_photos(z):
    """Возвращает {номер строки: имя файла в xl/media}. Картинки привязаны к ячейкам со смещением."""
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    default_ht = float(re.search(r'defaultRowHeight="([\d.]+)"', sheet).group(1))
    heights = {int(r) - 1: float(h) for r, h in re.findall(r'<row r="(\d+)"[^>]*?ht="([\d.]+)"', sheet)}
    tops = [0.0]
    for i in range(300):
        tops.append(tops[-1] + heights.get(i, default_ht) * EMU_PER_PT)

    rels_xml = z.read("xl/drawings/_rels/drawing1.xml.rels").decode()
    rels = {}
    for rel in re.findall(r"<Relationship [^>]*/>", rels_xml):
        rid = re.search(r'Id="([^"]+)"', rel).group(1)
        target = re.search(r'Target="\.\./media/([^"]+)"', rel)
        if target:
            rels[rid] = target.group(1)

    photos = {}
    drawing = z.read("xl/drawings/drawing1.xml").decode()
    pattern = (
        r"<xdr:from><xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row><xdr:rowOff>(\d+)</xdr:rowOff>"
        r'</xdr:from><xdr:ext cx="\d+" cy="(\d+)"/>.*?r:embed="(rId\d+)"'
    )
    for col, row, off, cy, rid in re.findall(pattern, drawing):
        center = tops[int(row)] + int(off) + int(cy) / 2
        r = max(i for i, t in enumerate(tops) if t <= center) + 1
        # если у объекта несколько фото, берём то, что в колонке «Изображение»
        if r not in photos or int(col) == 1:
            photos[r] = rels[rid]
    return photos


def px(s):
    return float(s.replace("px", "").replace(",", ".").strip())


def fit(xs, ys):
    mx, my = statistics.mean(xs), statistics.mean(ys)
    a = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return a, my - a * mx


def main(xlsx, pdf):
    z = zipfile.ZipFile(xlsx)
    rows = read_cells(z)
    photos = read_photos(z)

    items, cat = [], None
    for r in sorted(rows):
        c = rows[r]
        if r == 1 or "B" not in c:
            continue
        if c.get("A", "").strip():
            cat = c["A"].strip()
        row_cat = next((v for k, v in CATEGORY_OVERRIDES.items() if r in k), cat)
        name = c["B"].strip()
        if name == "360.0":
            name = "360"
        items.append(dict(row=r, cat=row_cat, name=name, note=c.get("H", ""),
                          hx=px(c["D"]), hy=px(c["E"]), vx=px(c["F"]), vy=px(c["G"])))

    # Координаты вертикальной карты содержат несколько опечаток, а горизонтальной — нет.
    # Карты отличаются только масштабом и сдвигом, поэтому пересчитываем всё из горизонтальной.
    ax, bx = fit([i["hx"] for i in items], [i["vx"] for i in items])
    ay, by = fit([i["hy"] for i in items], [i["vy"] for i in items])
    inl = [i for i in items if abs(ax * i["hx"] + bx - i["vx"]) < 10 and abs(ay * i["hy"] + by - i["vy"]) < 10]
    ax, bx = fit([i["hx"] for i in inl], [i["vx"] for i in inl])
    ay, by = fit([i["hy"] for i in inl], [i["vy"] for i in inl])

    photo_dir = ROOT / "assets" / "photos"
    photo_dir.mkdir(parents=True, exist_ok=True)
    out, by_key = [], {}
    for i in items:
        x = round((ax * i["hx"] + bx - CLIP[0]) * MAP_SCALE)
        y = round((ay * i["hy"] + by - CLIP[1]) * MAP_SCALE)
        cid = CATEGORY_IDS[i["cat"]]
        key = (i["name"].split(" (")[0].lower(), x // 10, y // 10)
        if key in by_key:  # один и тот же объект в двух разделах таблицы
            if cid not in by_key[key]["cats"]:
                by_key[key]["cats"].append(cid)
            continue
        photo = None
        if i["row"] in photos:
            photo = f"assets/photos/{len(out) + 1:03d}.jpg"
            img = Image.open(BytesIO(z.read("xl/media/" + photos[i["row"]]))).convert("RGB")
            img.thumbnail((720, 720))
            img.save(ROOT / photo, quality=78, optimize=True)
        obj = dict(id=len(out) + 1, name=i["name"], cats=[cid], x=x, y=y, note=i["note"], photo=photo)
        by_key[key] = obj
        out.append(obj)

    page = fitz.open(pdf)[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(MAP_SCALE, MAP_SCALE), clip=fitz.Rect(*CLIP))
    img = Image.open(BytesIO(pix.tobytes("png"))).convert("RGB")
    img.save(ROOT / "assets" / "map.webp", quality=82, method=6)

    for size in (192, 512):
        icon = Image.new("RGB", (size, size), "#e8461e")
        d = ImageDraw.Draw(icon)
        s = size / 192
        d.ellipse([46 * s, 30 * s, 146 * s, 130 * s], fill="white")
        d.polygon([(58 * s, 105 * s), (134 * s, 105 * s), (96 * s, 168 * s)], fill="white")
        d.ellipse([74 * s, 52 * s, 118 * s, 96 * s], fill="#e8461e")
        icon.save(ROOT / "assets" / f"icon-{size}.png")

    data = dict(width=img.width, height=img.height, items=out)
    (ROOT / "data.js").write_text(
        "// Сгенерировано tools/build_data.py — не редактировать вручную\n"
        "window.PARK = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
    )
    print(f"{len(out)} объектов, {sum(1 for o in out if o['photo'])} с фото, карта {img.width}x{img.height}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
