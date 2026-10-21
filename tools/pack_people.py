"""Готовит модели людей для игры: уменьшает текстуры и/или оставляет в файле только анимации.

Источники (лицензия CC-BY 4.0, репозиторий BabylonJS/Assets и примеры three.js; персонажи и анимации — Mixamo / Ready Player Me):
  rpm.glb (Ready Player Me), Michelle.glb, Walking.glb, Soldier.glb (Idle, Run)

    pip install pillow
    python tools/pack_people.py rpm.glb assets/models/people/person.glb --max-texture 512 --no-anims --no-morphs
    python tools/pack_people.py Walking.glb assets/models/people/anim_walk.glb --anims-only
    python tools/pack_people.py Soldier.glb assets/models/people/anim_soldier.glb --anims-only --keep Idle,Run
"""
import argparse
import json
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image


def read_glb(path):
    b = Path(path).read_bytes()
    jlen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    rest = b[20 + jlen:]
    blen = struct.unpack("<I", rest[:4])[0]
    return j, rest[8:8 + blen]


def write_glb(path, j, binary):
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binary = bytes(binary) + b"\0" * (-len(binary) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binary), 0x004E4942) + binary
    Path(path).write_bytes(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--max-texture", type=int, default=0)
    ap.add_argument("--anims-only", action="store_true", help="оставить только скелет и анимации")
    ap.add_argument("--no-anims", action="store_true")
    ap.add_argument("--keep", help="имена анимаций через запятую")
    ap.add_argument("--no-morphs", action="store_true", help="убрать морф-таргеты (мимику лица)")
    a = ap.parse_args()
    g, buf = read_glb(a.src)

    if a.no_anims:
        g["animations"] = []
    elif a.keep:
        keep = set(a.keep.split(","))
        g["animations"] = [x for x in g.get("animations", []) if x.get("name") in keep]
    if a.no_morphs:
        for m in g.get("meshes", []):
            m.pop("weights", None)
            m.pop("extras", None)
            for p in m["primitives"]:
                p.pop("targets", None)
                p.pop("extras", None)
    if a.anims_only:
        for n in g["nodes"]:
            n.pop("mesh", None)
            n.pop("skin", None)
        for k in ("meshes", "skins", "materials", "textures", "images", "samplers"):
            g.pop(k, None)

    # какие bufferView нужны после удаления; картинки можно пережать
    used_acc = set()
    for m in g.get("meshes", []):
        for p in m["primitives"]:
            used_acc.update(p["attributes"].values())
            if "indices" in p:
                used_acc.add(p["indices"])
            for t in p.get("targets", []):
                used_acc.update(t.values())
    for s in g.get("skins", []):
        if "inverseBindMatrices" in s:
            used_acc.add(s["inverseBindMatrices"])
    for an in g.get("animations", []):
        for s in an["samplers"]:
            used_acc.update((s["input"], s["output"]))

    new_views, view_map, out = [], {}, bytearray()

    def add_view(data, extra):
        while len(out) % 4:
            out.append(0)
        v = dict(extra, buffer=0, byteOffset=len(out), byteLength=len(data))
        out.extend(data)
        new_views.append(v)
        return len(new_views) - 1

    acc_map, new_acc = {}, []
    for i in sorted(used_acc):
        acc = dict(g["accessors"][i])
        v = acc.get("bufferView")
        if v is not None:
            if v not in view_map:
                bv = g["bufferViews"][v]
                st = bv.get("byteOffset", 0)
                extra = {k: bv[k] for k in ("byteStride", "target") if k in bv}
                view_map[v] = add_view(buf[st:st + bv["byteLength"]], extra)
            acc["bufferView"] = view_map[v]
        acc_map[i] = len(new_acc)
        new_acc.append(acc)
    for img in g.get("images", []):
        bv = g["bufferViews"][img["bufferView"]]
        st = bv.get("byteOffset", 0)
        data = buf[st:st + bv["byteLength"]]
        if a.max_texture:
            im = Image.open(BytesIO(data))
            if max(im.size) > a.max_texture:
                im.thumbnail((a.max_texture, a.max_texture))
            o = BytesIO()
            if im.mode in ("RGBA", "LA") and "png" in img.get("mimeType", ""):
                im.save(o, "PNG", optimize=True)
            else:
                im.convert("RGB").save(o, "JPEG", quality=85)
                img["mimeType"] = "image/jpeg"
            data = o.getvalue()
        img["bufferView"] = add_view(data, {})

    for m in g.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
            if "targets" in p:
                p["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in p["targets"]]
    for s in g.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for an in g.get("animations", []):
        for s in an["samplers"]:
            s["input"], s["output"] = acc_map[s["input"]], acc_map[s["output"]]
    g["accessors"], g["bufferViews"] = new_acc, new_views
    g["buffers"] = [{"byteLength": len(out) + (-len(out) % 4)}]
    Path(a.dst).parent.mkdir(parents=True, exist_ok=True)
    write_glb(a.dst, g, out)
    print(f"{a.src} → {a.dst}: {Path(a.dst).stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
