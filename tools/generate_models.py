"""Генерирует 3D-модели аттракционов по настоящим фотографиям парка (Meshy, image-to-3D).

Фото берутся из таблицы парка (map/assets/photos/<id>.jpg), готовые модели складываются в
assets/models/rides/<id>.glb и прописываются в manifest.json — игра подхватывает их сама.

    export MESHY_API_KEY=msy_...
    python3 tools/generate_models.py                 # стартовые и главные аттракционы
    python3 tools/generate_models.py --ids 28,15,49  # конкретные объекты (id из map/data.js)
    python3 tools/generate_models.py --all           # все объекты с фото (дорого: ~90 генераций)

Одна генерация занимает 2–5 минут и расходует кредиты Meshy. Уже сгенерированные модели пропускаются
(--force — сгенерировать заново).
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/models/rides"
API = "https://api.meshy.ai/openapi/v1/image-to-3d"
SKIP_CATS = {"service", "transport"}  # кассы, туалеты, остановки — не аттракционы


def request(method, url, key, body=None):
    req = urllib.request.Request(url, method=method, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def generate(item, key, force):
    dst = OUT / f"{item['id']}.glb"
    if dst.exists() and not force:
        return item["id"], "уже есть"
    photo = ROOT / "map" / item["photo"]
    image = "data:image/jpeg;base64," + base64.b64encode(photo.read_bytes()).decode()
    task = request("POST", API, key, {
        "image_url": image,
        "ai_model": "latest",
        "enable_pbr": True,
        "should_remesh": True,
        "target_polycount": 40000,
        "should_texture": True,
    })["result"]
    while True:
        time.sleep(10)
        st = request("GET", f"{API}/{task}", key)
        if st["status"] == "SUCCEEDED":
            urllib.request.urlretrieve(st["model_urls"]["glb"], dst)
            return item["id"], "готово"
        if st["status"] in ("FAILED", "CANCELED", "EXPIRED"):
            return item["id"], f"ошибка: {st.get('task_error', {}).get('message', st['status'])}"
        print(f"  {item['name']}: {st.get('progress', 0)}%", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", help="id объектов через запятую")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    key = os.environ.get("MESHY_API_KEY")
    if not key:
        sys.exit("Нужен ключ: export MESHY_API_KEY=... (https://www.meshy.ai → API)")

    items = json.loads((ROOT / "map/data.js").read_text().split("=", 1)[1].strip().rstrip(";"))["items"]
    catalog = json.loads((ROOT / "catalog.json").read_text())
    items = [i for i in items if i["photo"] and not set(i["cats"]) <= SKIP_CATS]
    if args.ids:
        want = {int(x) for x in args.ids.split(",")}
    elif args.all:
        want = {i["id"] for i in items}
    else:
        want = set(catalog["start"]["built"]) | set(catalog["featured"])
    todo = [i for i in items if i["id"] in want]

    OUT.mkdir(parents=True, exist_ok=True)
    print(f"Генерирую {len(todo)} моделей…")
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda i: generate(i, key, args.force), todo))

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for f in OUT.glob("*.glb"):
        if f.stem.isdigit():
            manifest[f.stem] = f.name
    manifest_path.write_text(json.dumps(manifest, indent=2))
    names = {i["id"]: i["name"] for i in todo}
    for id_, status in results:
        print(f"{names[id_]}: {status}")
    print(f"В manifest.json {len(manifest)} моделей. Обновите страницу игры.")


if __name__ == "__main__":
    main()
