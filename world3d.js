// 3D-мир парка «Сказка»: земля — официальная карта парка 1:1, аттракционы — 3D-модели на реальных местах.
// Люди, животные, динозавры, деревья, фонари и домики — готовые модели Quaternius (CC0), материалы — фото-текстуры
// Poly Haven (CC0). Координаты игры — пиксели карты (map.webp), здесь они переводятся в метры: X = px * K, Z = py * K.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

export const K = 0.4; // метров в одном пикселе карты

const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

// ---------- Готовые модели и текстуры ----------
const A = { people: [], animals: {}, dinos: {}, trees: [], bushes: [], lamp: null, trash: null, bench: null, sky: null, custom: {}, tex: {} };
const FILES = {
  animals: { alpaca: ['animals/Alpaca', 1.9], husky: ['animals/Husky', 1.05], fox: ['animals/Fox', 0.8], horse: ['animals/Horse', 1.9] },
  dinos: { trex: ['dinos/Trex', 5.5], triceratops: ['dinos/Triceratops', 2.8], stegosaurus: ['dinos/Stegosaurus', 4], apatosaurus: ['dinos/Apatosaurus', 9] },
  trees: [['nature/CommonTree_1', 9], ['nature/CommonTree_2', 10], ['nature/CommonTree_3', 8], ['nature/BirchTree_1', 11], ['nature/BirchTree_2', 10], ['nature/PineTree_1', 12], ['nature/PineTree_2', 11]],
  bushes: [['nature/Bush_1', 1.2], ['nature/BushBerries_1', 1.1], ['nature/Flowers', 0.5]],
  lamp: ['props/Streetlight', 5], trash: ['props/Trashcan', 1],
  textures: ['wood', 'roof', 'concrete', 'plaster', 'grass', 'paving', 'gravel'],
};

// масштабирует модель до нужной высоты (или ширины), ставит на землю по центру и оборачивает в группу
function normalize(obj, size, byWidth = false) {
  obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  // у моделей со скелетом размер считается по позе костей, поэтому сначала обновляем кости
  const measure = () => {
    obj.updateMatrixWorld(true);
    box.makeEmpty();
    obj.traverse((m) => {
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) { m.skeleton.update(); m.computeBoundingBox(); }
      else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = (m.isSkinnedMesh ? m.boundingBox : m.geometry.boundingBox).clone();
      box.union(b.applyMatrix4(m.matrixWorld));
    });
  };
  measure();
  box.getSize(v);
  obj.scale.multiplyScalar(size / (byWidth ? Math.max(v.x, v.z) : v.y));
  measure();
  box.getCenter(v);
  obj.position.x -= v.x; obj.position.z -= v.z; obj.position.y -= box.min.y;
  const wrap = new THREE.Group();
  wrap.add(obj);
  return wrap;
}
const findClip = (g, name) => g.animations.find((a) => a.name === name || a.name.endsWith('|' + name) || a.name.endsWith('_' + name));

export async function loadAssets(onProgress, { mobile = false } = {}) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, done, total) => onProgress?.(done / total);
  const gl = new GLTFLoader(manager);
  const tl = new THREE.TextureLoader(manager);
  const load = (f) => gl.loadAsync(`assets/models/${f}.glb`);
  // люди (Ready Player Me и Michelle, анимации Mixamo): скелеты одинаковые, анимации переносятся по именам костей
  const retarget = (clip, rpm) => {
    const c = clip.clone();
    // корень (Hips) у файлов анимации и моделей ориентирован по-разному — его движение не переносим
    c.tracks = c.tracks.filter((t) => !t.name.endsWith('.position') && !/Hips\.quaternion$/.test(t.name));
    if (rpm) for (const t of c.tracks) t.name = t.name.replace(/^mixamorig/, '');
    return c;
  };
  const people = Promise.all(['people/person', 'people/michelle', 'people/anim_walk', 'people/anim_soldier'].map(load)).then(([rpm, mich, walk, soldier]) => {
    const clips = (isRpm) => ({
      walk: retarget(walk.animations[0], isRpm),
      idle: retarget(soldier.animations.find((a) => a.name === 'Idle'), isRpm),
      run: retarget(soldier.animations.find((a) => a.name === 'Run'), isRpm),
    });
    A.people = [
      { scene: normalize(rpm.scene, 1.78), clips: clips(true), rpm: true },
      { scene: normalize(mich.scene, 1.66), clips: clips(false), rpm: false },
    ];
  });
  const creature = async ([f, h]) => {
    const g = await load(f);
    return { scene: normalize(g.scene, h), clips: { idle: findClip(g, 'Idle'), walk: findClip(g, 'Walk'), eat: findClip(g, 'Eating') } };
  };
  const prop = async ([f, h], byWidth) => normalize((await load(f)).scene, h, byWidth);
  // гладкие нормали вместо граней: деревья и кусты выглядят объёмнее и живее
  const smooth = (obj) => {
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry.clone();
      g.deleteAttribute('normal');
      m.geometry = mergeVertices(g, 1e-3);
      m.geometry.computeVertexNormals();
      for (const mt of [].concat(m.material)) mt.flatShading = false;
    });
    return obj;
  };
  // свои реалистичные модели аттракционов: assets/models/rides/manifest.json — { "28": "koleso.glb", ... }
  const custom = fetch('assets/models/rides/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((list) => Promise.all(Object.entries(list).map(([id, file]) => gl.loadAsync(`assets/models/rides/${file}`)
      .then((g) => { A.custom[id] = { scene: g.scene, clips: g.animations }; }).catch(() => {}))));
  const tex = (name) => Promise.all(['diff', 'nor'].map((k) => tl.loadAsync(`assets/textures/${name}_${k}.jpg`))).then(([map, nor]) => {
    for (const t of [map, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    map.colorSpace = THREE.SRGBColorSpace;
    A.tex[name] = { map, nor };
  });
  await Promise.all([
    ...Object.entries(FILES.animals).map(([k, f]) => creature(f).then((r) => { A.animals[k] = r; })),
    ...Object.entries(FILES.dinos).map(([k, f]) => creature(f).then((r) => { A.dinos[k] = r; })),
    Promise.all(FILES.trees.map((f) => prop(f))).then((r) => { A.trees = r.map(smooth); }),
    Promise.all(FILES.bushes.map((f) => prop(f))).then((r) => { A.bushes = r.map(smooth); }),
    gl.loadAsync('assets/models/bench/bench.gltf').then((g) => { A.bench = normalize(g.scene, 1.75, true); }),
    new RGBELoader(manager).loadAsync(`assets/sky/sky_${mobile ? '1k' : '2k'}.hdr`).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; A.sky = t; }),
    custom,
    people,
    prop(FILES.lamp).then((r) => { A.lamp = r; }),
    prop(FILES.trash).then((r) => { A.trash = r; }),
    ...FILES.textures.map(tex),
  ]);
}

// ---------- Материалы и примитивы ----------
const matCache = new Map();
function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05, ...o }));
  return matCache.get(key);
}
// фото-материал: дерево, металл, черепица, бетон, штукатурка; color подкрашивает текстуру
function pbr(kind, color = '#ffffff', repeat = 1) {
  if (kind === 'metal') return mat(color, { metalness: 0.6, roughness: 0.32 });
  const key = `${kind}|${color}|${repeat}`;
  if (matCache.has(key)) return matCache.get(key);
  const t = A.tex[kind];
  if (!t) return mat(color);
  const map = t.map.clone(), nor = t.nor.clone();
  map.repeat.set(repeat, repeat); nor.repeat.set(repeat, repeat);
  map.needsUpdate = nor.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ color, map, normalMap: nor, roughness: 0.85 });
  matCache.set(key, m);
  return m;
}
// анимированная копия модели со скелетом
function animated(asset) {
  const obj = SkeletonUtils.clone(asset.scene);
  const mixer = new THREE.AnimationMixer(obj);
  const acts = {};
  for (const [k, c] of Object.entries(asset.clips)) if (c) acts[k] = mixer.clipAction(c);
  let cur = acts.idle ? 'idle' : 'walk';
  acts[cur]?.play();
  return {
    obj, mixer, acts,
    play(name, fade = 0.3) {
      if (name === cur || !acts[name]) return;
      acts[name].reset().play();
      acts[cur]?.crossFadeTo(acts[name], fade, false);
      cur = name;
    },
  };
}
function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
const box = (w, h, d, c, o) => mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'string' ? mat(c, o) : c);
const cyl = (rt, rb, h, c, seg = 16, o) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof c === 'string' ? mat(c, o) : c);
const sphere = (r, c, o, seg = 12) => mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.6)), typeof c === 'string' ? mat(c, o) : c);
function at(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; }
// добавляет дочерний объект и возвращает именно его (Object3D.add возвращает родителя)
function put(parent, obj) { parent.add(obj); return obj; }
function beam(a, b, r, c) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = cyl(r, r, d.length(), c, 6);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}
// двускатная крыша: конёк вдоль X, низ крыши на высоте y, свес 0.3 м
function gable(w, d, h, material, y) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - 0.3, 0); shape.lineTo(d / 2 + 0.3, 0); shape.lineTo(0, h); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false });
  geo.translate(0, 0, -(w + 0.6) / 2);
  geo.rotateY(Math.PI / 2);
  const m = mesh(geo, material);
  m.position.y = y;
  return m;
}
function stripeTexture(c1, c2, n = 12) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 8;
  const g = cv.getContext('2d');
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? c2 : c1; g.fillRect((i * 256) / n, 0, 256 / n + 1, 8); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3bf', emissive: '#ffd43b', emissiveIntensity: 0.4 });
function bulbRing(r, y, n, parent) {
  const geo = new THREE.SphereGeometry(0.12, 6, 4);
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(geo, bulbMat);
    b.position.set(Math.cos((i / n) * TAU) * r, y, Math.sin((i / n) * TAU) * r);
    parent.add(b);
  }
}
const lighten = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();
const darken = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#000000'), k).getHexString();

// ---------- Модели аттракционов ----------
function ferrisWheel(o) {
  const g = new THREE.Group();
  const R = 13, H = R + 3.5;
  g.add(at(box(12, 0.6, 6, pbr('concrete', '#ffffff', 2)), 0, 0.3, 0));
  const wheel = new THREE.Group();
  wheel.position.y = H;
  g.add(wheel);
  for (const z of [-1.2, 1.2]) {
    const rim = mesh(new THREE.TorusGeometry(R, 0.22, 8, 96), pbr('metal', '#f8f9fa', 4));
    rim.position.z = z;
    wheel.add(rim);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      wheel.add(beam(new THREE.Vector3(0, 0, z), new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, z), 0.07, '#ced4da'));
    }
  }
  put(wheel, at(cyl(0.9, 0.9, 3.2, '#868e96', 12), 0, 0, 0)).rotation.x = Math.PI / 2;
  const cabins = [];
  const colors = ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#f783ac', '#ff922b'];
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    c.add(at(box(1.4, 1.5, 1.6, colors[i % colors.length]), 0, -1.1, 0));
    c.add(at(box(1.6, 0.2, 1.8, '#f1f3f5'), 0, -0.3, 0));
    g.add(c);
    cabins.push(c);
  }
  for (const sx of [-1, 1]) for (const z of [-2.2, 2.2]) {
    g.add(beam(new THREE.Vector3(sx * 7, 0, z), new THREE.Vector3(0, H, z * 0.6), 0.35, pbr('metal', '#e9ecef')));
  }
  let a = 0;
  return {
    group: g, r: 10, h: H + R,
    update(dt, busy) {
      a += dt * (busy ? 0.12 : 0.05);
      wheel.rotation.z = a;
      cabins.forEach((c, i) => {
        const t = a + (i / 16) * TAU;
        c.position.set(Math.cos(t) * R, H + Math.sin(t) * R, 0);
      });
    },
  };
}

function carousel(o) {
  const g = new THREE.Group();
  g.add(at(cyl(6, 6.3, 0.6, pbr('concrete', '#ffffff', 3), 48), 0, 0.3, 0));
  const spin = new THREE.Group();
  g.add(spin);
  spin.add(at(cyl(5.4, 5.4, 0.3, pbr('wood', '#ffffff', 3), 48), 0, 0.75, 0));
  spin.add(at(cyl(0.6, 0.6, 4.4, '#f8f9fa', 12), 0, 3, 0));
  const roof = mesh(new THREE.ConeGeometry(6.2, 2.6, 24, 1, true), new THREE.MeshStandardMaterial({ map: stripeTexture(o.color, '#ffffff', 24), side: THREE.DoubleSide, flatShading: true }));
  roof.position.y = 6.5;
  spin.add(roof);
  spin.add(at(cyl(6.2, 6.2, 0.6, pbr('metal', o.color, 3), 48), 0, 5, 0));
  spin.add(at(sphere(0.5, '#ffd43b', { metalness: 0.6 }), 0, 8, 0));
  bulbRing(6.25, 5, 32, spin);
  const horses = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU, r = i % 2 ? 4 : 2.8;
    const h = new THREE.Group();
    h.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    h.rotation.y = -a;
    h.add(at(cyl(0.05, 0.05, 4.2, '#ffd43b', 6, { metalness: 0.8 }), 0, 3, 0));
    const body = new THREE.Group();
    const col = ['#ffffff', '#ffe8cc', '#d0bfff', '#ffc9c9'][i % 4];
    body.add(at(box(0.4, 0.55, 1.2, col), 0, 0, 0));
    put(body, at(box(0.3, 0.7, 0.3, col), 0, 0.4, 0.5)).rotation.x = -0.4;
    body.add(at(box(0.28, 0.3, 0.5, col), 0, 0.75, 0.75));
    for (const [x, z] of [[-0.15, -0.45], [0.15, -0.45], [-0.15, 0.45], [0.15, 0.45]]) body.add(at(box(0.1, 0.6, 0.1, col), x, -0.5, z));
    body.position.y = 2;
    h.add(body);
    spin.add(h);
    horses.push(body);
  }
  let a = 0, t = 0;
  return {
    group: g, r: 6.5, h: 8.5,
    update(dt, busy) {
      t += dt;
      a += dt * (busy ? 0.9 : 0.25);
      spin.rotation.y = a;
      horses.forEach((b, i) => { b.position.y = 2 + Math.sin(t * 3 + i) * (busy ? 0.35 : 0.1); });
    },
  };
}

function teacups(o) {
  const g = new THREE.Group();
  g.add(at(cyl(5.8, 6, 0.4, pbr('concrete', '#ffffff', 3), 48), 0, 0.2, 0));
  const spin = new THREE.Group();
  g.add(spin);
  spin.add(at(cyl(5.2, 5.2, 0.2, pbr('wood', lighten(o.color, 0.6), 3), 48), 0, 0.5, 0));
  spin.add(at(cyl(1, 1.4, 1.6, o.color, 16), 0, 1.3, 0));
  const cups = [];
  const cols = ['#ff8787', '#74c0fc', '#ffd43b', '#b197fc', '#8ce99a'];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const c = new THREE.Group();
    c.position.set(Math.cos(a) * 3.4, 0.6, Math.sin(a) * 3.4);
    const cup = mesh(new THREE.CylinderGeometry(1.1, 0.75, 1, 20, 1, true), mat(cols[i], { side: THREE.DoubleSide }));
    cup.position.y = 0.5;
    c.add(cup);
    c.add(at(cyl(0.75, 0.75, 0.1, cols[i], 20), 0, 0.05, 0));
    c.add(at(mesh(new THREE.TorusGeometry(0.35, 0.08, 6, 12), mat(cols[i])), 1.15, 0.55, 0));
    spin.add(c);
    cups.push(c);
  }
  let a = 0;
  return {
    group: g, r: 6, h: 3,
    update(dt, busy) {
      a += dt * (busy ? 0.7 : 0.2);
      spin.rotation.y = a;
      cups.forEach((c, i) => { c.rotation.y += dt * (busy ? 2.5 : 0.6) * (i % 2 ? 1 : -1); });
    },
  };
}

function coaster(o) {
  const g = new THREE.Group();
  const pts = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    pts.push(new THREE.Vector3(Math.cos(t) * 13, 2 + Math.max(0, Math.sin(t * 2 + 0.6)) * 11 + (i === 2 ? 4 : 0), Math.sin(t) * 7 + Math.sin(t * 3) * 1.5));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const col = o.color;
  g.add(mesh(new THREE.TubeGeometry(curve, 240, 0.28, 8, true), pbr('metal', col, 30)));
  const rail = curve.getSpacedPoints(240).map((p) => p.clone().add(new THREE.Vector3(0, -0.5, 0)));
  g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail, true), 240, 0.14, 5, true), mat(darken(col, 0.3))));
  curve.getSpacedPoints(28).forEach((p) => { if (p.y > 1.2) g.add(beam(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, p.y - 0.3, p.z), 0.2, pbr('metal', '#dee2e6'))); });
  g.add(at(box(6, 3, 3, pbr('plaster', '#ffffff')), 0, 1.5, -8));
  g.add(at(box(6.6, 0.4, 3.6, pbr('metal', col)), 0, 3.2, -8));
  const cars = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Group();
    c.add(at(box(1.2, 0.7, 1.6, i ? '#ffd43b' : '#f03e3e'), 0, 0.45, 0));
    c.add(at(box(1.0, 0.4, 0.3, '#212529'), 0, 0.95, -0.4));
    g.add(c);
    cars.push(c);
  }
  let u = 0;
  const p = new THREE.Vector3(), tan = new THREE.Vector3();
  return {
    group: g, r: 13, h: 17,
    update(dt, busy) {
      // по спуску быстрее, на подъёме медленнее
      const slope = curve.getTangentAt(u % 1).y;
      u = (u + dt * (busy ? 0.07 : 0.03) * (1 - slope * 0.8)) % 1;
      cars.forEach((c, i) => {
        const t = (u - i * 0.012 + 1) % 1;
        curve.getPointAt(t, p);
        curve.getTangentAt(t, tan);
        c.position.copy(p);
        c.lookAt(p.clone().add(tan));
      });
    },
  };
}

function dropTower(o) {
  const g = new THREE.Group();
  g.add(at(cyl(3, 3.5, 1, pbr('concrete', '#ffffff', 2), 32), 0, 0.5, 0));
  g.add(at(cyl(0.9, 1.1, 34, pbr('metal', '#f8f9fa', 3), 24), 0, 17, 0));
  g.add(at(cyl(1.8, 1.2, 2, o.color, 12), 0, 34.5, 0));
  g.add(at(sphere(0.6, '#ff6b6b', { emissive: '#ff0000', emissiveIntensity: 0.6 }), 0, 36, 0));
  const ring = new THREE.Group();
  ring.add(mesh(new THREE.TorusGeometry(2, 0.5, 8, 24), mat(o.color)));
  ring.children[0].rotation.x = Math.PI / 2;
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; ring.add(at(box(0.6, 1, 0.6, '#212529'), Math.cos(a) * 2.6, -0.4, Math.sin(a) * 2.6)); }
  g.add(ring);
  let t = 0;
  return {
    group: g, r: 4, h: 36,
    update(dt, busy) {
      t += dt * (busy ? 1 : 0.4);
      const ph = t % 8;
      ring.position.y = ph < 5 ? 2 + (ph / 5) * 28 : ph < 5.6 ? 30 : Math.max(2, 30 - ((ph - 5.6) ** 2) * 12);
      ring.rotation.y += dt * 0.3;
    },
  };
}

function pendulum(o) {
  const g = new THREE.Group();
  const H = 15;
  g.add(at(box(14, 0.6, 8, pbr('concrete', '#ffffff', 3)), 0, 0.3, 0));
  for (const z of [-2.5, 2.5]) {
    g.add(beam(new THREE.Vector3(-6, 0, z), new THREE.Vector3(0, H, z), 0.45, pbr('metal', o.color, 2)));
    g.add(beam(new THREE.Vector3(6, 0, z), new THREE.Vector3(0, H, z), 0.45, pbr('metal', o.color, 2)));
  }
  const arm = new THREE.Group();
  arm.position.y = H;
  g.add(arm);
  arm.add(at(cyl(0.45, 0.45, 12, '#adb5bd', 10), 0, -6, 0));
  const seats = new THREE.Group();
  seats.position.y = -12;
  arm.add(seats);
  seats.add(mesh(new THREE.TorusGeometry(2.6, 0.35, 8, 24), mat(lighten(o.color, 0.2))));
  seats.children[0].rotation.x = Math.PI / 2;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; seats.add(at(box(0.7, 0.9, 0.7, '#343a40'), Math.cos(a) * 2.6, 0.2, Math.sin(a) * 2.6)); }
  let t = 0;
  return {
    group: g, r: 8, h: H + 3,
    update(dt, busy) {
      t += dt;
      arm.rotation.z = Math.sin(t * 0.9) * (busy ? 2.4 : 0.5);
      seats.rotation.y += dt * (busy ? 1.5 : 0.3);
    },
  };
}

function swinger(o) {
  const g = new THREE.Group();
  g.add(at(cyl(7, 7.3, 0.5, pbr('concrete', '#ffffff', 3), 48), 0, 0.25, 0));
  g.add(at(cyl(0.8, 1.1, 12, pbr('metal', '#f8f9fa', 2), 24), 0, 6, 0));
  const top = new THREE.Group();
  top.position.y = 12;
  g.add(top);
  const roof = mesh(new THREE.ConeGeometry(5, 2, 20, 1, true), new THREE.MeshStandardMaterial({ map: stripeTexture(o.color, '#ffffff', 20), side: THREE.DoubleSide }));
  roof.position.y = 1;
  top.add(roof);
  bulbRing(5, 0, 24, top);
  const chains = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const c = new THREE.Group();
    c.position.set(Math.cos(a) * 4.8, 0, Math.sin(a) * 4.8);
    c.rotation.y = -a;
    c.add(at(cyl(0.03, 0.03, 6, '#adb5bd', 4), 0, -3, 0));
    c.add(at(box(0.6, 0.5, 0.6, ['#ffd43b', '#4dabf7', '#ff6b6b', '#69db7c'][i % 4]), 0, -6.1, 0));
    top.add(c);
    chains.push(c);
  }
  let a = 0, s = 0;
  return {
    group: g, r: 9, h: 14,
    update(dt, busy) {
      s += ((busy ? 1 : 0.2) - s) * dt;
      a += dt * (0.3 + s * 1.6);
      top.rotation.y = a;
      chains.forEach((c) => { c.rotation.z = -s * 0.75; });
    },
  };
}

function bumperCars(o) {
  const g = new THREE.Group();
  g.add(at(box(14, 0.3, 10, pbr('metal', '#868e96', 4)), 0, 0.15, 0));
  for (const [x, z, w, d] of [[0, 5, 14, 0.4], [0, -5, 14, 0.4], [7, 0, 0.4, 10], [-7, 0, 0.4, 10]]) g.add(at(box(w, 0.8, d, o.color), x, 0.55, z));
  for (const [x, z] of [[-6.6, -4.6], [6.6, -4.6], [-6.6, 4.6], [6.6, 4.6]]) g.add(at(cyl(0.2, 0.2, 5, pbr('metal', '#dee2e6'), 12), x, 2.8, z));
  g.add(at(box(14.4, 0.4, 10.4, pbr('metal', lighten(o.color, 0.3), 3)), 0, 5.4, 0));
  const cars = [];
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Group();
    c.add(at(box(1.2, 0.5, 1.7, ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#f783ac', '#ff922b', '#b197fc'][i]), 0, 0.55, 0));
    c.add(at(cyl(0.03, 0.03, 4.2, '#adb5bd', 4), 0, 2.9, -0.6));
    g.add(c);
    cars.push({ c, x: rnd(-5, 5), z: rnd(-3.5, 3.5), a: rnd(0, TAU), v: rnd(1.5, 3) });
  }
  return {
    group: g, r: 8, h: 6,
    update(dt, busy) {
      for (const k of cars) {
        k.a += rnd(-1, 1) * dt * 2;
        k.x += Math.sin(k.a) * k.v * dt * (busy ? 1.5 : 0.4);
        k.z += Math.cos(k.a) * k.v * dt * (busy ? 1.5 : 0.4);
        if (Math.abs(k.x) > 5.8) { k.x = Math.sign(k.x) * 5.8; k.a = -k.a; }
        if (Math.abs(k.z) > 3.8) { k.z = Math.sign(k.z) * 3.8; k.a = Math.PI - k.a; }
        k.c.position.set(k.x, 0, k.z);
        k.c.rotation.y = k.a;
      }
    },
  };
}

function train(o) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => { const t = (i / 12) * TAU; return new THREE.Vector3(Math.cos(t) * 8, 0.3, Math.sin(t) * 5); }), true);
  g.add(mesh(new THREE.TubeGeometry(curve, 120, 0.12, 4, true), mat('#495057')));
  g.add(at(box(3, 2.5, 2, pbr('plaster', '#ffe066')), 0, 1.25, 0));
  put(g, at(mesh(new THREE.ConeGeometry(2.2, 1.2, 4), pbr('roof', '#ffffff', 2)), 0, 3.1, 0)).rotation.y = Math.PI / 4;
  const cars = [];
  const cols = ['#e03131', '#4dabf7', '#ffd43b', '#69db7c'];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Group();
    if (i === 0) {
      c.add(at(box(1.1, 1, 1.8, '#e03131'), 0, 0.8, 0));
      put(c, at(cyl(0.45, 0.45, 1.2, '#212529', 10), 0, 1.2, 0.5)).rotation.x = Math.PI / 2;
      c.add(at(cyl(0.15, 0.2, 0.6, '#212529', 8), 0, 1.8, 0.8));
    } else c.add(at(box(1.1, 0.8, 1.6, cols[i]), 0, 0.7, 0));
    g.add(c);
    cars.push(c);
  }
  let u = 0;
  const p = new THREE.Vector3(), tan = new THREE.Vector3();
  return {
    group: g, r: 9, h: 4,
    update(dt, busy) {
      u = (u + dt * (busy ? 0.06 : 0.025)) % 1;
      cars.forEach((c, i) => {
        const t = (u - i * 0.045 + 1) % 1;
        curve.getPointAt(t, p); curve.getTangentAt(t, tan);
        c.position.copy(p); c.lookAt(p.clone().add(tan));
      });
    },
  };
}

function ropePark(o) {
  const g = new THREE.Group();
  const posts = [[-5, -4], [5, -4], [5, 4], [-5, 4], [0, 0]];
  for (const [x, z] of posts) {
    g.add(at(cyl(0.3, 0.35, 9, pbr('wood', '#c8a27a', 1), 12), x, 4.5, z));
    for (const y of [3, 6.5]) g.add(at(box(1.8, 0.2, 1.8, pbr('wood')), x, y, z));
  }
  for (let i = 0; i < posts.length; i++) for (const y of [3.6, 7.1]) {
    const [x1, z1] = posts[i], [x2, z2] = posts[(i + 1) % posts.length];
    g.add(beam(new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y - 0.4, z2), 0.06, o.color));
    g.add(beam(new THREE.Vector3(x1, y + 1, z1), new THREE.Vector3(x2, y + 0.6, z2), 0.04, '#f8f9fa'));
  }
  return { group: g, r: 7, h: 10, update() {} };
}

function boats(o) {
  const g = new THREE.Group();
  g.add(at(box(14, 0.8, 10, pbr('concrete', '#ffffff', 4)), 0, 0.4, 0));
  const water = mesh(new THREE.BoxGeometry(13, 0.2, 9), new THREE.MeshStandardMaterial({ color: '#4dabf7', roughness: 0.15, metalness: 0.2 }));
  water.position.y = 0.75;
  g.add(water);
  const list = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group();
    const col = ['#ff6b6b', '#ffd43b', '#69db7c', '#b197fc', '#ff922b', '#f783ac'][i];
    put(b, at(mesh(new THREE.TorusGeometry(0.8, 0.35, 6, 14), mat(col)), 0, 0.2, 0)).rotation.x = Math.PI / 2;
    b.add(at(cyl(0.6, 0.6, 0.3, '#f8f9fa', 12), 0, 0.15, 0));
    g.add(b);
    list.push({ b, x: rnd(-5, 5), z: rnd(-3, 3), a: rnd(0, TAU) });
  }
  return {
    group: g, r: 8, h: 2,
    update(dt, busy) {
      for (const k of list) {
        k.a += rnd(-1, 1) * dt;
        k.x = Math.max(-5.5, Math.min(5.5, k.x + Math.sin(k.a) * dt * (busy ? 1.6 : 0.5)));
        k.z = Math.max(-3.5, Math.min(3.5, k.z + Math.cos(k.a) * dt * (busy ? 1.6 : 0.5)));
        k.b.position.set(k.x, 0.85, k.z);
        k.b.rotation.y += dt;
      }
    },
  };
}

// --- Животные ---
function animalModel(kind) {
  const a = new THREE.Group();
  if (kind === 'alpaca') {
    const c = ['#fff8f0', '#f1e3d3', '#d9b99b', '#ffffff'][Math.floor(Math.random() * 4)];
    a.add(at(box(0.6, 0.6, 1.1, c), 0, 1, 0));
    a.add(at(box(0.3, 0.9, 0.3, c), 0, 1.6, 0.45));
    a.add(at(box(0.3, 0.3, 0.45, c), 0, 2.05, 0.6));
    a.add(at(box(0.08, 0.2, 0.08, c), -0.1, 2.3, 0.5));
    a.add(at(box(0.08, 0.2, 0.08, c), 0.1, 2.3, 0.5));
    for (const [x, z] of [[-0.2, -0.4], [0.2, -0.4], [-0.2, 0.4], [0.2, 0.4]]) a.add(at(box(0.14, 0.75, 0.14, c), x, 0.37, z));
  } else if (kind === 'raccoon') {
    a.add(at(box(0.35, 0.3, 0.6, '#868e96'), 0, 0.35, 0));
    a.add(at(box(0.3, 0.25, 0.3, '#adb5bd'), 0, 0.45, 0.4));
    a.add(at(box(0.32, 0.08, 0.1, '#212529'), 0, 0.48, 0.55));
    put(a, at(box(0.12, 0.12, 0.5, '#495057'), 0, 0.4, -0.5)).rotation.x = 0.5;
    for (const [x, z] of [[-0.12, -0.2], [0.12, -0.2], [-0.12, 0.2], [0.12, 0.2]]) a.add(at(box(0.08, 0.22, 0.08, '#343a40'), x, 0.11, z));
  } else if (kind === 'husky') {
    a.add(at(box(0.4, 0.45, 0.95, '#adb5bd'), 0, 0.7, 0));
    a.add(at(box(0.36, 0.2, 0.9, '#f8f9fa'), 0, 0.5, 0));
    a.add(at(box(0.35, 0.35, 0.4, '#ced4da'), 0, 1.0, 0.55));
    a.add(at(box(0.08, 0.15, 0.06, '#495057'), -0.1, 1.25, 0.5));
    a.add(at(box(0.08, 0.15, 0.06, '#495057'), 0.1, 1.25, 0.5));
    put(a, at(box(0.1, 0.1, 0.4, '#dee2e6'), 0, 0.95, -0.55)).rotation.x = -0.7;
    for (const [x, z] of [[-0.13, -0.35], [0.13, -0.35], [-0.13, 0.35], [0.13, 0.35]]) a.add(at(box(0.1, 0.45, 0.1, '#f1f3f5'), x, 0.23, z));
  } else if (kind === 'ostrich') {
    a.add(at(sphere(0.55, '#212529'), 0, 1.4, 0));
    put(a, at(cyl(0.06, 0.08, 1.1, '#ffc9c9', 6), 0, 2.1, 0.35)).rotation.x = 0.3;
    a.add(at(sphere(0.14, '#ffc9c9'), 0, 2.65, 0.5));
    a.add(at(cyl(0.05, 0.05, 1.1, '#ffc9c9', 6), -0.15, 0.55, 0));
    a.add(at(cyl(0.05, 0.05, 1.1, '#ffc9c9', 6), 0.15, 0.55, 0));
  } else if (kind === 'bird') {
    const c = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#e599f7'][Math.floor(Math.random() * 5)];
    a.add(at(sphere(0.18, c), 0, 0, 0));
    a.add(at(box(0.5, 0.03, 0.15, c), 0, 0.05, 0));
  } else { // динозавр-малыш и прочие
    a.add(at(box(0.5, 0.5, 1, '#82c91e'), 0, 0.6, 0));
  }
  return a;
}
// животное бродит по кругу радиуса r: идёт к случайной точке, стоит, иногда ест
function wanderer(a, r, speed) {
  const s = { a, x: rnd(-r, r) * 0.6, z: rnd(-r, r) * 0.6, tx: 0, tz: 0, wait: rnd(0, 3) };
  s.tx = s.x; s.tz = s.z;
  return s;
}
function wanderStep(s, dt, r, speed, hungry) {
  const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
  const node = s.a.obj || s.a;
  if (d < 0.3) {
    s.wait -= dt;
    s.a.play?.(hungry || Math.random() < 0.002 ? 'eat' : 'idle');
    if (s.wait < 0) { const ang = rnd(0, TAU), rr = rnd(0, r); s.tx = Math.cos(ang) * rr; s.tz = Math.sin(ang) * rr; s.wait = rnd(2, 6); }
  } else {
    const v = (hungry ? 0.35 : 1) * speed * dt;
    s.x += (dx / d) * Math.min(v, d); s.z += (dz / d) * Math.min(v, d);
    node.rotation.y = Math.atan2(dx, dz);
    s.a.play?.('walk');
  }
  node.position.set(s.x, 0, s.z);
  s.a.mixer?.update(dt);
}
function enclosure(o, kind, n) {
  const g = new THREE.Group();
  const R = 8.5;
  g.add(at(cyl(R, R, 0.1, '#c0d5a5', 32, { roughness: 1 }), 0, 0.05, 0));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    g.add(at(box(0.15, 1.2, 0.15, pbr('wood', '#c8a27a')), Math.cos(a) * R, 0.6, Math.sin(a) * R));
  }
  for (const y of [0.5, 1.0]) {
    const rail = mesh(new THREE.TorusGeometry(R, 0.05, 6, 64), pbr('wood', '#c8a27a', 8));
    rail.rotation.x = Math.PI / 2; rail.position.y = y;
    g.add(rail);
  }
  const barn = new THREE.Group();
  barn.add(at(box(4, 2.6, 3, pbr('wood', o.name.includes('Хаски') ? '#d9b38c' : '#e8907a')), 0, 1.3, 0));
  barn.add(gable(4, 3, 1.5, pbr('roof', '#ffffff', 0.5), 2.6));
  barn.add(at(box(1.2, 1.8, 0.1, '#f8f9fa'), 0, 0.9, 1.52));
  at(barn, -4, 0, -4, 0.6);
  g.add(barn);
  g.add(at(box(2, 0.5, 0.6, pbr('wood')), 3, 0.25, 3));
  const animals = [];
  for (let i = 0; i < n; i++) {
    const a = A.animals[kind] ? animated(A.animals[kind]) : animalModel(kind);
    const node = a.obj || a;
    node.scale.multiplyScalar(rnd(0.85, 1.1));
    g.add(node);
    animals.push(wanderer(a, 6.5));
  }
  return {
    group: g, r: 9, h: 5,
    update(dt, busy, food = 100) {
      for (const s of animals) wanderStep(s, dt, 6.5, kind === 'fox' ? 1.6 : 1.1, food < 30);
    },
  };
}
function aviary(o) {
  const g = new THREE.Group();
  g.add(at(cyl(8, 8, 0.2, '#c0d5a5', 32), 0, 0.1, 0));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 10, 0, TAU, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#adb5bd', wireframe: true, transparent: true, opacity: 0.55 }));
  g.add(dome);
  g.add(at(cyl(0.3, 0.4, 5, '#8d6e63', 8), 0, 2.5, 0));
  for (let i = 0; i < 3; i++) g.add(at(sphere(1.6, '#2f9e44'), rnd(-4, 4), 1.4, rnd(-4, 4)));
  const birds = [];
  for (let i = 0; i < 14; i++) {
    const b = animalModel('bird');
    g.add(b);
    birds.push({ b, r: rnd(2, 6), h: rnd(1.5, 6), s: rnd(0.4, 1.1) * (i % 2 ? 1 : -1), p: rnd(0, TAU) });
  }
  let t = 0;
  return {
    group: g, r: 8.5, h: 8,
    update(dt) {
      t += dt;
      for (const k of birds) {
        const a = k.p + t * k.s;
        k.b.position.set(Math.cos(a) * k.r, k.h + Math.sin(t * 2 + k.p) * 0.5, Math.sin(a) * k.r);
        k.b.rotation.y = -a;
        k.b.children[1].rotation.z = Math.sin(t * 20 + k.p) * 0.6;
      }
    },
  };
}

// --- Локации ---
function dino(o) {
  const g = new THREE.Group();
  g.add(at(cyl(9, 9, 0.2, '#b8c48a', 32, { roughness: 1 }), 0, 0.1, 0));
  for (let i = 0; i < 5; i++) g.add(palm(rnd(-7, 7), rnd(-7, 7)));
  for (let i = 0; i < 6; i++) g.add(at(mesh(new THREE.DodecahedronGeometry(rnd(0.6, 1.3), 0), pbr('concrete', '#b5aa98')), rnd(-7, 7), 0.3, rnd(-7, 7)));
  const kinds = /Сафари/.test(o.name) ? ['apatosaurus', 'triceratops'] : ['trex', 'triceratops', 'stegosaurus'];
  const herd = kinds.filter((k) => A.dinos[k]).map((k) => {
    const a = animated(A.dinos[k]);
    g.add(a.obj);
    return wanderer(a, 5);
  });
  return { group: g, r: 9, h: 9, update(dt) { for (const s of herd) wanderStep(s, dt, 5, 1.2, false); } };
}
function palm(x, z) {
  const p = new THREE.Group();
  p.add(at(cyl(0.18, 0.25, 4, '#8d6e63', 6), 0, 2, 0));
  for (let i = 0; i < 6; i++) {
    const l = at(box(0.5, 0.05, 2.4, '#2b8a3e'), 0, 4, 0, (i / 6) * TAU);
    l.rotation.x = 0.4;
    l.position.set(Math.sin((i / 6) * TAU) * 1, 3.8, Math.cos((i / 6) * TAU) * 1);
    p.add(l);
  }
  return at(p, x, 0, z);
}
function babaYaga(o) {
  const g = new THREE.Group();
  const hut = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const log = cyl(0.22, 0.22, 4.4, pbr('wood', i % 2 ? '#a07a5a' : '#8a6648'), 10);
    log.rotation.z = Math.PI / 2; log.position.set(0, i * 0.42, 1.8); hut.add(log);
    const log2 = log.clone(); log2.position.z = -1.8; hut.add(log2);
    const log3 = cyl(0.22, 0.22, 4, pbr('wood', i % 2 ? '#a07a5a' : '#8a6648'), 10); log3.rotation.x = Math.PI / 2; log3.position.set(2, i * 0.42, 0); hut.add(log3);
    const log4 = log3.clone(); log4.position.x = -2; hut.add(log4);
  }
  hut.add(at(box(3.8, 2.8, 3.4, pbr('wood', '#8a6648')), 0, 1.3, 0));
  hut.add(gable(4.4, 4, 2, pbr('roof', '#8a8a8a', 0.5), 2.7));
  hut.add(at(box(0.8, 0.8, 0.1, '#ffd43b', { emissive: '#ffa94d', emissiveIntensity: 0.3 }), 0, 1.6, 2.05));
  hut.position.y = 3.2;
  g.add(hut);
  for (const x of [-1, 1]) {
    g.add(at(cyl(0.3, 0.2, 3.4, '#fab005', 6), x, 1.6, 0));
    for (const a of [-0.6, 0, 0.6]) { const toe = at(cyl(0.08, 0.08, 1, '#fab005', 4), x + Math.sin(a) * 0.5, 0.1, Math.cos(a) * 0.5); toe.rotation.x = Math.PI / 2; toe.rotation.z = a; g.add(toe); }
  }
  let t = 0;
  return { group: g, r: 5, h: 9, update(dt, busy) { t += dt; hut.rotation.y = Math.sin(t * 0.5) * (busy ? 0.4 : 0.1); hut.position.y = 3.2 + Math.abs(Math.sin(t * 2)) * (busy ? 0.3 : 0); } };
}
function hedgeMaze(o, mirror) {
  const g = new THREE.Group();
  const S = 12, n = 6, c = S / n;
  const m = mirror ? new THREE.MeshStandardMaterial({ color: '#a5d8ff', metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.7 }) : mat('#2b8a3e');
  g.add(at(box(S + 1, 0.15, S + 1, mirror ? '#dee2e6' : '#d8c8a8'), 0, 0.07, 0));
  let seed = o.id * 9301;
  const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i <= n; i++) for (let j = 0; j < n; j++) {
    if (i === 0 || i === n || r() < 0.45) g.add(at(box(0.5, 2.2, c, m), -S / 2 + i * c, 1.1, -S / 2 + c / 2 + j * c));
    if ((i < n) && (j === 0 || r() < 0.45)) g.add(at(box(c, 2.2, 0.5, m), -S / 2 + c / 2 + i * c, 1.1, -S / 2 + j * c));
  }
  return { group: g, r: 8, h: 3, update() {} };
}
function house(o, { upside = false, scary = false } = {}) {
  const g = new THREE.Group();
  const wall = scary ? '#343a40' : lighten(o.color, 0.5);
  const body = new THREE.Group();
  body.add(at(box(6, 5, 5, pbr('plaster', wall)), 0, 2.5, 0));
  body.add(gable(6, 5, 2.4, pbr('roof', scary ? '#555555' : '#ffffff', 0.5), 5));
  const win = scary ? { emissive: '#9c36b5', emissiveIntensity: 0.8 } : {};
  for (const x of [-1.6, 1.6]) body.add(at(box(1.1, 1.1, 0.1, scary ? '#e599f7' : '#a5d8ff', win), x, 3, 2.55));
  body.add(at(box(1.3, 2.2, 0.1, '#5c3d2e'), 0, 1.1, 2.55));
  if (upside) { body.rotation.z = Math.PI; body.position.y = 7.6; }
  g.add(body);
  return { group: g, r: 6, h: 8, update() {} };
}
function castle(o) {
  const g = new THREE.Group();
  g.add(at(box(8, 4, 6, pbr('plaster', '#ffffff', 2)), 0, 2, 0));
  for (const [x, z] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
    g.add(at(cyl(1.1, 1.1, 6.5, pbr('plaster', '#ffffff'), 20), x, 3.25, z));
    g.add(at(mesh(new THREE.ConeGeometry(1.4, 2.6, 20), pbr('roof', lighten(o.color, 0.4))), x, 7.8, z));
  }
  g.add(at(box(1.8, 2.6, 0.2, '#5c3d2e'), 0, 1.3, 3.05));
  return { group: g, r: 6, h: 9, update() {} };
}
function topiary(o) {
  const g = new THREE.Group();
  g.add(at(cyl(8, 8, 0.15, '#b2c99c', 24), 0, 0.07, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU, r = i % 3 ? 5 : 2.5;
    g.add(at(cyl(0.12, 0.12, 1.4, '#795548', 5), Math.cos(a) * r, 0.7, Math.sin(a) * r));
    g.add(at(sphere(rnd(0.7, 1.1), '#2f9e44'), Math.cos(a) * r, 1.9, Math.sin(a) * r));
  }
  g.add(at(cyl(1.5, 1.8, 0.8, pbr('concrete'), 24), 0, 0.4, 0));
  g.add(at(sphere(0.9, '#74c0fc', { roughness: 0.1 }), 0, 1.1, 0));
  return { group: g, r: 8, h: 3, update() {} };
}
function gazebo(o) {
  const g = new THREE.Group();
  g.add(at(cyl(5, 5.2, 0.5, pbr('concrete', '#ffffff', 3), 8), 0, 0.25, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.add(at(cyl(0.15, 0.15, 3.6, pbr('wood', '#f1e3d3'), 8), Math.cos(a) * 4.4, 2.3, Math.sin(a) * 4.4)); }
  g.add(at(mesh(new THREE.ConeGeometry(5.6, 2.4, 8), pbr('roof', lighten(o.color, 0.5), 3)), 0, 5.3, 0));
  bulbRing(5, 4.1, 24, g);
  return { group: g, r: 6, h: 7, update() {} };
}

// --- Кафе, магазины, аркады, фото ---
// табличка с текстом
function signTexture(text, bg, fg = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 84);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 54;
  do { g.font = `800 ${size}px Manrope, sans-serif`; size -= 2; } while (g.measureText(text).width > 470 && size > 20);
  g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const glass = new THREE.MeshStandardMaterial({ color: '#9cc8e6', metalness: 0.9, roughness: 0.06 });
// павильон: оштукатуренные стены, черепичная крыша, витрина, дверь, навес и вывеска; фасад смотрит на +Z
function pavilion(o, { round = false, neon = false, tables = false } = {}) {
  const g = new THREE.Group();
  const wall = pbr('plaster', lighten(o.color, 0.75));
  g.add(at(box(8, 0.3, 6.5, pbr('concrete', '#ffffff', 2)), 0, 0.15, 0));
  if (round) {
    g.add(at(cyl(3, 3, 3.4, wall, 32), 0, 2, 0));
    g.add(at(mesh(new THREE.ConeGeometry(3.6, 2.4, 32), pbr('roof', lighten(o.color, 0.45), 2)), 0, 4.9, 0));
    g.add(at(box(2, 1.6, 0.1, glass), 0, 2.1, 3.0));
  } else {
    g.add(at(box(6.4, 3.4, 4.6, wall), 0, 2, 0));
    g.add(at(box(6.6, 0.5, 4.8, pbr('wood', '#b07a4a')), 0, 0.55, 0));
    g.add(gable(6.4, 4.6, 1.8, pbr('roof', lighten(o.color, 0.45), 0.5), 3.7));
    g.add(at(box(3.4, 1.7, 0.1, glass), -1.1, 2.2, 2.31));
    g.add(at(box(3.6, 0.15, 0.25, pbr('wood', '#7a4f2f')), -1.1, 1.3, 2.38));
    g.add(at(box(1.2, 2.3, 0.1, pbr('wood', '#7a4f2f')), 2, 1.5, 2.31));
    const awn = mesh(new THREE.BoxGeometry(6.6, 0.08, 1.6), new THREE.MeshStandardMaterial({ map: stripeTexture(o.color, '#ffffff', 12), roughness: 0.8 }));
    awn.position.set(0, 3.35, 3.0); awn.rotation.x = 0.38;
    g.add(awn);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(round ? 4.2 : 5.6, round ? 0.8 : 1.05), new THREE.MeshStandardMaterial({ map: signTexture(o.name, darken(o.color, 0.15)), roughness: 0.6 }));
  sign.position.set(0, round ? 3.9 : 4.25, round ? 3.05 : 2.62);
  g.add(sign);
  if (neon) g.add(at(box(6.6, 0.16, 0.12, o.color, { emissive: o.color, emissiveIntensity: 1.6 }), 0, 3.75, 2.45));
  if (tables) {
    const uc = ['#ff6b6b', '#ffd43b', '#4dabf7'];
    for (let i = 0; i < 3; i++) {
      const x = -3 + i * 3, z = 6;
      g.add(at(cyl(0.6, 0.6, 0.06, pbr('wood'), 20), x, 0.8, z));
      g.add(at(cyl(0.05, 0.05, 2.6, pbr('metal', '#ced4da'), 8), x, 1.3, z));
      g.add(at(mesh(new THREE.ConeGeometry(1.6, 0.55, 16), mat(uc[i], { side: THREE.DoubleSide })), x, 2.7, z));
      for (const dx of [-0.95, 0.95]) g.add(at(box(0.42, 0.45, 0.42, pbr('wood')), x + dx, 0.22, z));
    }
  }
  g.rotation.y = o.face || 0;
  return { group: g, r: tables ? 7 : 5.5, h: 6.5, update() {} };
}

// своя модель (glb из assets/models/rides): вписывается в круг радиуса ~7 м, анимации проигрываются по кругу
function customRide(o, src) {
  const g = new THREE.Group();
  const obj = SkeletonUtils.clone(src.scene);
  // размер — как у процедурной модели этого объекта (колесо обозрения больше киоска)
  g.add(normalize(obj, proceduralRide(o).r * 2, true));
  const mixer = src.clips.length ? new THREE.AnimationMixer(obj) : null;
  for (const c of src.clips) mixer.clipAction(c).play();
  g.rotation.y = o.face || 0;
  const h = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).y;
  return { group: g, r: 8, h, update(dt, busy) { mixer?.update(dt * (busy ? 1 : 0.4)); } };
}

function buildRide(o) {
  return A.custom[o.id] ? customRide(o, A.custom[o.id]) : proceduralRide(o);
}

function proceduralRide(o) {
  const n = o.name;
  if (/Колесо обозрения/.test(n)) return ferrisWheel(o);
  if (o.cat === 'extreme') {
    if (/Путь дракона|Петля|Колобок|Бумеранг|Галактика|Сердце Москвы/.test(n)) return coaster(o);
    if (/360|Высший пилотаж|Кракен|Микс/.test(n)) return pendulum(o);
    if (/Ракета|Звездопад|Молния|Формула/.test(n)) return dropTower(o);
    return swinger(o);
  }
  if (/Автодром/.test(n)) return bumperCars(o);
  if (/Паровоз/.test(n)) return train(o);
  if (/Верёвочный/.test(n)) return ropePark(o);
  if (/лодки|Нептун/.test(n)) return boats(o);
  if (o.cat === 'family' || o.cat === 'kids') return (/Чаепитие|Юла|Пружинка|Солнышко|Вертол|Ветерок|Бабл/.test(n) || o.id % 3 === 0) ? teacups(o) : carousel(o);
  if (o.cat === 'animals') {
    if (/Авиариум/.test(n)) return aviary(o);
    if (/Альпака/.test(n)) return enclosure(o, 'alpaca', 6);
    if (/Енот/.test(n)) return enclosure(o, 'fox', 6);
    if (/Хаски/.test(n)) return enclosure(o, 'husky', 6);
    if (/Страус/.test(n)) return enclosure(o, 'ostrich', 4);
    return enclosure(o, 'horse', 3);
  }
  if (o.cat === 'locations') {
    if (/Дино/.test(n)) return dino(o);
    if (/Бабы Яги/.test(n)) return babaYaga(o);
    if (/вверх дном/.test(n)) return house(o, { upside: true });
    if (/Дом страха/.test(n)) return house(o, { scary: true });
    if (/Зеркальный/.test(n)) return hedgeMaze(o, true);
    if (/лабиринт/i.test(n)) return hedgeMaze(o, false);
    return castle(o);
  }
  if (o.cat === 'events') return /Айва|Мадагаскар/.test(n) ? topiary(o) : /Дино/.test(n) ? dino(o) : gazebo(o);
  if (o.cat === 'food') return pavilion(o, { tables: true });
  if (o.cat === 'arcade') return pavilion(o, { neon: true });
  if (o.cat === 'photo') return pavilion(o, { round: true });
  return pavilion(o);
}

// ---------- Подписи и значки (спрайты) ----------
function labelSprite(text, color = '#1d1d1f') {
  const cv = document.createElement('canvas');
  const g = cv.getContext('2d');
  const font = '700 44px Manrope, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 48;
  cv.width = w; cv.height = 76;
  g.font = font;
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.beginPath(); g.roundRect(0, 0, w, 76, 38); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(w / 76 * 1.6, 1.6, 1);
  s.renderOrder = 10;
  return s;
}
function badgeSprite(iconImg, bg) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    g.clearRect(0, 0, 96, 96);
    g.fillStyle = bg; g.beginPath(); g.arc(48, 48, 44, 0, TAU); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#fff'; g.stroke();
    if (iconImg.complete) g.drawImage(iconImg, 22, 22, 52, 52);
    tex.needsUpdate = true;
  };
  if (iconImg.complete) draw(); else iconImg.addEventListener('load', draw);
  draw();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(2.2, 2.2, 1);
  s.renderOrder = 11;
  return s;
}

// ---------- Земля: фото-покрытия по разметке карты ----------
// Цвет пикселя схемы решает, что лежит в этом месте: зелёное — газон, серое — плитка, тёмно-серое — асфальт,
// бежевое — гравийная дорожка, голубое — вода (гладкая, отражает небо). Текстуры кладутся в мировых метрах.
function realGround(material) {
  const T = A.tex;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGrass: { value: T.grass.map }, tPave: { value: T.paving.map }, tGravel: { value: T.gravel.map }, tConcrete: { value: T.concrete.map },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorld;
uniform sampler2D tGrass, tPave, tGravel, tConcrete;
float wWater = 0.0;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 s = pow(max(sampledDiffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
  float lum = dot(s, vec3(0.333));
  vec2 w = vWorld.xz;
  float macro = 0.82 + 0.36 * vnoise(w * 0.035) ;
  float gW = smoothstep(0.035, 0.08, s.g - s.b);
  wWater = smoothstep(0.07, 0.13, s.b - s.r);
  float sW = smoothstep(0.05, 0.1, s.r - s.b) * (1.0 - gW);
  float rest = clamp(1.0 - gW - wWater - sW, 0.0, 1.0);
  float asphalt = (1.0 - smoothstep(0.74, 0.84, lum)) * rest;
  float pave = rest - asphalt;
  vec3 grass = texture2D(tGrass, w / 2.5).rgb * mix(vec3(0.9, 1.0, 0.9), vec3(1.05, 1.0, 0.85), vnoise(w * 0.08)) * macro;
  vec3 paving = texture2D(tPave, w / 2.2).rgb * (0.9 + 0.2 * vnoise(w * 0.05));
  vec3 gravel = texture2D(tGravel, w / 2.8).rgb * 1.05;
  vec3 asph = texture2D(tConcrete, w / 3.0).rgb * 0.42;
  vec3 water = vec3(0.02, 0.07, 0.1);
  diffuseColor.rgb = grass * gW + paving * pave + gravel * sW + asph * asphalt + water * wWater;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.05, wWater);');
  };
  return material;
}

// ---------- Человечки ----------
// Простая фигура человека ростом 1.75 м: ноги и руки качаются от бедра и плеча при ходьбе.
// Каждая часть тела — свой InstancedMesh, поэтому сотня гостей рисуется за несколько вызовов.
const BODY = {
  leg: { r: 0.075, len: 0.72, hip: 0.9, side: 0.1 },
  torso: { r: 0.165, len: 0.36, y: 1.2 },
  arm: { r: 0.055, len: 0.5, shoulder: 1.42, side: 0.23 },
  head: { r: 0.105, y: 1.64 },
};
function limbGeo(r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, -len / 2 - r * 0.5, 0); // точка вращения — сверху (бедро, плечо)
  return g;
}
class Crowd {
  constructor(scene, max) {
    this.max = max;
    const m = () => new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const make = (geo, n) => {
      const im = new THREE.InstancedMesh(geo, m(), n);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      scene.add(im);
      return im;
    };
    const torso = new THREE.CapsuleGeometry(BODY.torso.r, BODY.torso.len, 4, 12);
    torso.scale(1.15, 1, 0.72);
    const hair = new THREE.SphereGeometry(BODY.head.r * 1.06, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    this.legs = make(limbGeo(BODY.leg.r, BODY.leg.len), max * 2);
    this.arms = make(limbGeo(BODY.arm.r, BODY.arm.len), max * 2);
    this.torso = make(torso, max);
    this.head = make(new THREE.SphereGeometry(BODY.head.r, 16, 12), max);
    this.hair = make(hair, max);
    this.o = new THREE.Object3D();
    this.o.rotation.order = 'YXZ';
    this.colors = new Map();
  }
  col(hex) { if (!this.colors.has(hex)) this.colors.set(hex, new THREE.Color(hex)); return this.colors.get(hex); }
  // p: { x, z, ry, s (рост), phase, swing, shirt, pants, skin, hair }
  draw(list) {
    const { o } = this;
    let n = 0;
    for (const p of list) {
      if (n >= this.max) break;
      const s = p.s, cy = Math.cos(p.ry), sy = Math.sin(p.ry);
      const put = (im, i, x, y, z, rx, color, sc = 1) => {
        o.position.set(p.x + (cy * x + sy * z) * s, y * s, p.z + (-sy * x + cy * z) * s);
        o.rotation.set(rx, p.ry, 0);
        o.scale.setScalar(s * sc);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
        im.setColorAt(i, this.col(color));
      };
      const sw = Math.sin(p.phase) * p.swing, bob = Math.abs(Math.cos(p.phase)) * 0.03 * p.swing;
      put(this.legs, n * 2, -BODY.leg.side, BODY.leg.hip + bob, 0, sw, p.pants);
      put(this.legs, n * 2 + 1, BODY.leg.side, BODY.leg.hip + bob, 0, -sw, p.pants);
      put(this.arms, n * 2, -BODY.arm.side, BODY.arm.shoulder + bob, 0, -sw * 0.8, p.shirt);
      put(this.arms, n * 2 + 1, BODY.arm.side, BODY.arm.shoulder + bob, 0, sw * 0.8, p.shirt);
      put(this.torso, n, 0, BODY.torso.y + bob, 0, 0, p.shirt);
      put(this.head, n, 0, BODY.head.y + bob, 0, 0, p.skin);
      put(this.hair, n, 0, BODY.head.y + 0.015 + bob, -0.01, -0.25, p.hair);
      n++;
    }
    for (const im of [this.legs, this.arms]) im.count = n * 2;
    for (const im of [this.torso, this.head, this.hair]) im.count = n;
    for (const im of [this.legs, this.arms, this.torso, this.head, this.hair]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
const PANTS = ['#2f3542', '#3d4a5c', '#5a4636', '#1e272e', '#576574', '#8395a7', '#2d3436'];
const HAIR = ['#2d1e14', '#4a3222', '#1b1b1b', '#7a5230', '#b08a5a', '#3b2a1e'];
const hashOf = (v) => Math.abs(Math.floor(Math.sin(v * 9301.7) * 10000));

// ---------- Трава ----------
// Травинки вокруг камеры. Поле бесконечно повторяется, поэтому травинки не «едут» за камерой;
// растут только там, где на карте газон (цвет пикселя карты проверяется в вершинном шейдере).
function grassField(mapTex, mapW, mapH, count, R) {
  const blade = new THREE.PlaneGeometry(0.06, 1, 1, 3);
  blade.translate(0, 0.5, 0);
  const pos = blade.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (1 - pos.getY(i) * 0.9)); // сужается к кончику
  const geo = new THREE.InstancedBufferGeometry().copy(blade);
  geo.instanceCount = count;
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    off[i * 4] = (Math.random() * 2 - 1) * R;
    off[i * 4 + 1] = (Math.random() * 2 - 1) * R;
    off[i * 4 + 2] = Math.random();
    off[i * 4 + 3] = Math.random() * Math.PI;
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  const mat = new THREE.MeshStandardMaterial({ color: '#4d7d2c', roughness: 0.9, side: THREE.DoubleSide });
  const uni = { uOrigin: { value: new THREE.Vector2() }, uTime: { value: 0 }, uMask: { value: mapTex }, uMap: { value: new THREE.Vector2(mapW, mapH) }, uR: { value: R } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aOff;
uniform vec2 uOrigin, uMap;
uniform float uTime, uR;
uniform sampler2D uMask;
varying float vH;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', `
vec2 wp = aOff.xy + 2.0 * uR * floor((uOrigin - aOff.xy) / (2.0 * uR) + 0.5);
vec3 mc = pow(max(texture2D(uMask, vec2(wp.x / uMap.x, 1.0 - wp.y / uMap.y)).rgb, 0.0), vec3(1.0 / 2.2));
float green = smoothstep(0.035, 0.08, mc.g - mc.b);
float fade = smoothstep(uR, uR * 0.6, distance(wp, uOrigin));
float h = (0.22 + aOff.z * 0.3) * green * fade;
float c = cos(aOff.w), s = sin(aOff.w);
vec3 transformed = vec3(position.x * c, position.y * h, position.x * s);
float bend = position.y * position.y * h;
transformed.x += (sin(uTime * 1.7 + wp.x * 0.35 + wp.y * 0.21) * 0.6 + 0.4) * 0.12 * bend;
transformed.z += cos(uTime * 1.3 + wp.y * 0.3) * 0.05 * bend;
transformed.xz += wp;
vH = position.y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.45, 1.25, vH);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return { mesh, uni };
}

// ---------- Мир ----------
export function createWorld({ canvas, rides, services, kassas, Icons, quality }) {
  // модели и текстуры уже загружены через loadAssets()
  const W = window.WORLD;
  const mobile = quality === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // разрешение рендера: на телефоне начинаем с 1.25 и дальше подстраиваемся под частоту кадров (см. adaptQuality)
  const maxDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2);
  let dpr = mobile ? Math.min(1.25, maxDpr) : maxDpr;
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color('#c9d9e6'), mobile ? 160 : 220, mobile ? 600 : 900);
  scene.background = A.sky;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, mobile ? 700 : 1300);
  // окружение для отражений: без него металл и фото-материалы выглядят чёрными
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(A.sky).texture;

  const hemi = new THREE.HemisphereLight('#dbeeff', '#5c7a3a', 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 4096, mobile ? 1024 : 4096);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // --- земля: вся карта + подробные тайлы парка ---
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (url) => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  const MW = W.mapW * K, MH = W.mapH * K;
  const base = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), realGround(new THREE.MeshStandardMaterial({ map: tex('map/assets/map.webp'), roughness: 0.95 })));
  base.rotation.x = -Math.PI / 2;
  base.position.set(MW / 2, 0, MH / 2);
  base.receiveShadow = true;
  scene.add(base);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), pbr('grass', '#ffffff', 1200));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(MW / 2, -0.05, MH / 2);
  scene.add(outer);
  const grass = grassField(base.material.map, MW, MH, mobile ? 14000 : 140000, mobile ? 18 : 34);
  scene.add(grass.mesh);
  const T = W.tiles;
  for (let j = 0; j < T.n; j++) for (let i = 0; i < T.n; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(T.w * K, T.h * K), realGround(new THREE.MeshStandardMaterial({ map: tex(`assets/world/tile_${i}_${j}.jpg`), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    m.rotation.x = -Math.PI / 2;
    m.position.set((T.x + (i + 0.5) * T.w) * K, 0.02, (T.y + (j + 0.5) * T.h) * K);
    m.receiveShadow = true;
    scene.add(m);
  }

  const o3 = new THREE.Object3D();

  // --- деревья, кусты, фонари: готовые модели, размноженные через InstancedMesh ---
  const tmpM = new THREE.Matrix4();
  function instanced(tpl, matrices, shadows = true) {
    if (!tpl || !matrices.length) return [];
    tpl.updateMatrixWorld(true);
    const out = [];
    tpl.traverse((m) => {
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length);
      matrices.forEach((M, i) => im.setMatrixAt(i, tmpM.multiplyMatrices(M, m.matrixWorld)));
      im.castShadow = shadows; im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
      out.push(im);
    });
    return out;
  }
  const byType = (n) => Array.from({ length: n }, () => []);
  const treeMats = byType(A.trees.length);
  W.trees.forEach(([x, y, s, t], i) => {
    o3.position.set(x * K, 0, y * K); o3.rotation.set(0, (i * 2.4) % TAU, 0); o3.scale.setScalar(s); o3.updateMatrix();
    treeMats[(x * 7 + y * 13 + t) % A.trees.length].push(o3.matrix.clone());
  });
  A.trees.forEach((tpl, k) => instanced(tpl, treeMats[k], !mobile)); // тени 2300 деревьев телефону не по силам

  // --- фонари, скамейки, урны, кусты ---
  const lampMats = W.lamps.map(([x, y], i) => { o3.position.set(x * K, 0, y * K); o3.rotation.set(0, (i * 1.7) % TAU, 0); o3.scale.setScalar(1); o3.updateMatrix(); return o3.matrix.clone(); });
  // самый светлый материал фонаря — плафон: ночью светится
  const lampGlow = [];
  if (A.lamp) {
    let best = null, lum = -1;
    A.lamp.traverse((m) => { if (m.isMesh) { const c = m.material.color; const l = c.r + c.g + c.b; if (l > lum) { lum = l; best = m; } } });
    if (best) { best.material = best.material.clone(); best.material.emissive = new THREE.Color('#ffd8a8'); best.material.emissiveIntensity = 0; lampGlow.push(best.material); }
  }
  instanced(A.lamp, lampMats);
  instanced(A.bench, W.benches.map(([x, y, dx, dy]) => { o3.position.set(x * K, 0, y * K); o3.rotation.set(0, Math.atan2(-dx, -dy), 0); o3.scale.setScalar(1); o3.updateMatrix(); return o3.matrix.clone(); }));
  instanced(A.trash, W.benches.filter((_, i) => i % 3 === 0).map(([x, y, dx, dy]) => { o3.position.set(x * K + dy * 1.4, 0, y * K - dx * 1.4); o3.rotation.set(0, 0, 0); o3.updateMatrix(); return o3.matrix.clone(); }));
  const bushMats = byType(A.bushes.length);
  W.bushes.forEach(([x, y, s], i) => { o3.position.set(x * K, 0, y * K); o3.rotation.set(0, i, 0); o3.scale.setScalar(s); o3.updateMatrix(); bushMats[i % A.bushes.length].push(o3.matrix.clone()); });
  A.bushes.forEach((tpl, k) => instanced(tpl, bushMats[k]));

  // --- кассы с арками и сервисы ---
  const svcSprites = [];
  for (const k of kassas) {
    const g = new THREE.Group();
    for (const x of [-4, 4]) g.add(at(cyl(0.5, 0.6, 7, pbr('metal', '#e03131', 2), 16), x, 3.5, 0));
    const arch = mesh(new THREE.TorusGeometry(4, 0.45, 8, 24, Math.PI), mat('#ffd43b'));
    arch.position.y = 7;
    g.add(arch);
    const booth = pavilion({ name: 'Кассы', color: '#e03131' }).group;
    booth.scale.setScalar(0.6); booth.position.set(8.5, 0, 0);
    g.add(booth);
    const lbl = labelSprite('СКАЗКА', '#e03131');
    lbl.position.set(0, 9.2, 0);
    g.add(lbl);
    g.position.set(k.x * K, 0, k.y * K);
    scene.add(g);
  }
  for (const s of services) {
    const g = new THREE.Group();
    if (/bath|baby|info/.test(s.icon)) { g.add(at(box(2.6, 2.6, 2, pbr('plaster', '#f1f3f5')), 0, 1.3, 0)); g.add(at(box(2.9, 0.25, 2.3, pbr('metal', '#495057')), 0, 2.7, 0)); }
    const b = badgeSprite(Icons.img(s.icon, '#ffffff', 2.4), '#495057');
    b.scale.set(1.6, 1.6, 1);
    b.position.y = 4.2;
    g.add(b);
    g.position.set(s.x * K, 0, s.y * K);
    scene.add(g);
    svcSprites.push(b);
  }

  // --- аттракционы ---
  const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
  const R = new Map();
  const colliders = [];
  const iconImg = (name, color) => Icons.img(name, color, 2.4);
  for (const o of rides) {
    const root = new THREE.Group();
    root.position.set(o.x * K, 0, o.y * K);
    scene.add(root);
    const plot = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ring.scale.setScalar(5);
    plot.add(ring);
    const slab = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), new THREE.MeshStandardMaterial({ color: '#f1f3f5', transparent: true, opacity: 0.55 }));
    slab.rotation.x = -Math.PI / 2; slab.position.y = 0.06;
    plot.add(slab);
    const plus = badgeSprite(iconImg('plus', '#ffffff'), o.color);
    plus.position.y = 3; plus.scale.set(1.8, 1.8, 1);
    plot.add(plus);
    root.add(plot);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 12, 10), new THREE.MeshBasicMaterial({ visible: false }));
    col.position.y = 6;
    col.userData.rideId = o.id;
    root.add(col);
    colliders.push(col);
    R.set(o.id, { o, root, plot, plus, model: null, label: null, badge: null, badgeKind: '', scaffold: null, born: 0 });
  }
  const selRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);
  const badges = { wrench: iconImg('wrench', '#ffffff'), carrot: iconImg('carrot', '#ffffff'), hammer: iconImg('hammer', '#ffffff') };

  function scaffold(r) {
    const g = new THREE.Group();
    const h = 6;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(at(cyl(0.12, 0.12, h, '#ffa94d', 5), x * r * 0.6, h / 2, z * r * 0.6));
    for (const y of [2, 4, 6]) for (const [x, z, w, d] of [[0, -1, 1.2, 0.05], [0, 1, 1.2, 0.05], [-1, 0, 0.05, 1.2], [1, 0, 0.05, 1.2]]) g.add(at(box(Math.max(0.15, w * r), 0.15, Math.max(0.15, d * r), '#fab005'), x * r * 0.6, y, z * r * 0.6));
    const crane = new THREE.Group();
    crane.add(at(box(0.5, 14, 0.5, '#fcc419'), 0, 7, 0));
    crane.add(at(box(12, 0.5, 0.5, '#fcc419'), 3, 14, 0));
    crane.add(at(cyl(0.03, 0.03, 6, '#343a40', 4), 8, 11, 0));
    crane.position.set(-r * 0.9, 0, -r * 0.9);
    g.add(crane);
    g.userData.crane = crane;
    return g;
  }

  // --- люди: ближайшие к камере — реалистичные модели, дальние — простые фигуры ---
  const crowd = new Crowd(scene, mobile ? 70 : 140);
  const TOPS = ['#ffffff', '#c0392b', '#2e86de', '#e1b12c', '#44bd32', '#8c7ae6', '#e58e26', '#353b48', '#d35400', '#16a085'];
  const BOTTOMS = ['#ffffff', '#3d4a5c', '#5a4636', '#1e272e', '#8395a7', '#2d3436', '#c8b89a'];
  const HAIRS = ['#ffffff', '#5a3825', '#2b1d14', '#c9a06a', '#8a8a8a', '#7a3b1e'];
  // копия модели человека со своими цветами одежды и волос
  function personClone(i, look) {
    const asset = A.people[look ? 0 : i % 4 === 3 ? 1 : 0];
    const a = animated(asset);
    if (asset.rpm) {
      a.obj.traverse((m) => {
        if (!m.isMesh) return;
        const name = m.material.name;
        const pickC = (list) => list[(i * 7 + name.length) % list.length];
        const col = look?.[name] ?? (/Top/.test(name) ? pickC(TOPS) : /Bottom/.test(name) ? pickC(BOTTOMS) : /Hair/.test(name) ? pickC(HAIRS) : null);
        if (col) { m.material = m.material.clone(); m.material.color.set(col); }
      });
    }
    a.obj.scale.multiplyScalar(look ? 1.02 : 0.92 + ((i * 37) % 14) / 100);
    return a;
  }
  const pool = [];
  for (let i = 0; i < (mobile ? 10 : 40) && A.people.length; i++) {
    const a = personClone(i);
    a.play('walk', 0);
    a.acts.walk.time = Math.random() * a.acts.walk.getClip().duration;
    a.obj.visible = false;
    scene.add(a.obj);
    pool.push({ a, guest: null, base: a.obj.scale.x });
  }
  const boss = A.people.length ? personClone(0, { Wolf3D_Outfit_Top: '#3a4660', Wolf3D_Outfit_Bottom: '#2a3245', Wolf3D_Hair: '#3b2a1e' }) : null;
  if (boss) scene.add(boss.obj);
  const dRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }));
  dRing.rotation.x = -Math.PI / 2; dRing.position.y = 0.06;
  scene.add(dRing);
  let dPhase = 0;
  const colorCache = new Map();
  const C = (hex) => { if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex)); return colorCache.get(hex); };

  const litterMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.08, 0.25), new THREE.MeshStandardMaterial({ roughness: 0.9 }), 80);
  litterMesh.count = 0;
  scene.add(litterMesh);

  // --- камера от третьего лица ---
  const cam = { yaw: 0, pitch: 0.62, dist: 34, tx: 0, ty: 0, tz: 0, ready: false };
  function placeCamera(dt, px, pz) {
    const k = cam.ready ? Math.min(1, dt * 6) : 1;
    cam.ready = true;
    cam.tx += (px - cam.tx) * k; cam.tz += (pz - cam.tz) * k; cam.ty = 1.6;
    const cp = Math.cos(cam.pitch);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, cam.ty + Math.sin(cam.pitch) * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    sun.target.position.set(cam.tx, 0, cam.tz);
  }

  // --- время суток ---
  const daySky = new THREE.Color('#d6e4ee'), duskSky = new THREE.Color('#ffb38a'), nightSky = new THREE.Color('#141a3c');
  function setHour(h) {
    const day = Math.max(0, Math.min(1, (20.5 - h) / 3));           // 1 днём, 0 ночью
    const dusk = Math.max(0, 1 - Math.abs(h - 18.8) / 1.6);
    const skyCol = nightSky.clone().lerp(daySky, day).lerp(duskSky, dusk * 0.6);
    scene.backgroundIntensity = 0.04 + 0.96 * day * (1 - dusk * 0.25);
    scene.fog.color.copy(skyCol).lerp(new THREE.Color('#c9d9e6'), day * 0.6);
    for (const m of lampGlow) m.emissiveIntensity = (1 - day) * 2.5;
    const el = 0.25 + Math.sin(((h - 7) / 14) * Math.PI) * 0.9;     // высота солнца
    const az = ((h - 12) / 12) * Math.PI;
    sun.position.set(cam.tx + Math.sin(az) * 120, Math.max(15, el * 140), cam.tz - Math.cos(az) * 80 - 40);
    sun.intensity = 0.2 + 2.0 * day;
    sun.color.set(dusk > 0.2 ? '#ffc58a' : '#fff4e0');
    hemi.intensity = 0.15 + 0.35 * day;
    // ночью окружение тоже темнеет; материалы перебираем не чаще раза в секунду
    const env = 0.15 + 0.85 * day;
    if (Math.abs(env - (setHour.env ?? -1)) > 0.02 && t - (setHour.t ?? -9) > 1) {
      setHour.env = env; setHour.t = t;
      scene.traverse((m) => { if (m.material) for (const x of [].concat(m.material)) if ('envMapIntensity' in x) x.envMapIntensity = env * (x.userData.env ?? 1); });
    }
    bulbMat.emissiveIntensity = 0.4 + (1 - day) * 2.5;
    if (bloom) { bloom.strength = 0.1 + (1 - day) * 0.3; bloom.threshold = 0.92; }
    renderer.toneMappingExposure = 0.8 + day * 0.15;
  }

  // --- обновление каждый кадр ---
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let t = 0;
  function sync(dt, st) {
    t += dt;
    // аттракционы
    for (const [id, r] of R) {
      const s = st.rides(id); // { built, building, broken, hungry, food, busy }
      const close = r.root.position.distanceToSquared(camera.position) < 260 * 260;
      if (s.built && !r.model) {
        r.model = buildRide(r.o);
        r.root.add(r.model.group);
        r.born = t;
        r.label = labelSprite(r.o.name);
        r.label.position.y = Math.min(r.model.h + 2, 30);
        r.root.add(r.label);
      }
      if (!s.built && r.model) { r.root.remove(r.model.group); r.root.remove(r.label); r.model = null; }
      r.plot.visible = !s.built;
      r.plus.visible = !s.built && !s.building && (st.buildMode || st.selected === id || r.root.position.distanceTo(camera.position) < 90);
      if (s.building && !r.scaffold) { r.scaffold = scaffold(5); r.root.add(r.scaffold); }
      if (!s.building && r.scaffold) { r.root.remove(r.scaffold); r.scaffold = null; }
      if (r.scaffold) { r.scaffold.userData.crane.rotation.y = Math.sin(t * 0.8) * 0.8; r.scaffold.scale.y = 0.3 + s.progress * 0.7; }
      if (r.model) {
        const k = Math.min(1, (t - r.born) / 0.7);
        r.model.group.scale.setScalar(k < 1 ? 0.2 + 0.8 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.12 : 1);
        if (close) r.model.update(dt, s.busy && !s.broken, s.food);
        r.label.visible = st.selected === id || r.root.position.distanceTo(new THREE.Vector3(cam.tx, 0, cam.tz)) < 45;
        const kind = s.broken ? 'wrench' : s.hungry ? 'carrot' : '';
        if (kind !== r.badgeKind) {
          if (r.badge) r.root.remove(r.badge);
          r.badge = kind ? badgeSprite(badges[kind], kind === 'wrench' ? '#f03e3e' : '#f76707') : null;
          if (r.badge) r.root.add(r.badge);
          r.badgeKind = kind;
        }
        if (r.badge) r.badge.position.y = Math.min(r.model.h, 26) + 4 + Math.sin(t * 4) * 0.4;
      }
    }
    // выбранный объект
    const sel = st.selected != null && R.get(st.selected);
    selRing.visible = !!sel;
    if (sel) {
      const rr = (sel.model?.r || 5) + 1.2 + Math.sin(t * 4) * 0.3;
      selRing.position.set(sel.root.position.x, 0.1, sel.root.position.z);
      selRing.scale.setScalar(rr);
    }
    // люди: директор, затем гости — ближайшие получают реалистичные модели из пула, остальные рисуются фигурами
    const P = st.player;
    dPhase += dt * (P.moving ? (P.sprint ? 13 : 10) : 0);
    const people = [];
    if (boss) {
      boss.obj.position.set(P.px * K, 0, P.py * K);
      boss.obj.rotation.y = Math.PI / 2 - P.dir;
      boss.play(P.moving ? (P.sprint ? 'run' : 'walk') : 'idle', 0.25);
      boss.mixer.update(dt * (P.moving ? (P.sprint ? 1.5 : 2.1) : 1));
    } else {
      people.push({ x: P.px * K, z: P.py * K, ry: Math.PI / 2 - P.dir, s: 1.05, phase: dPhase, swing: P.moving ? 0.75 : 0, shirt: '#1f2d4d', pants: '#1f2d4d', skin: '#e0b896', hair: '#2d1e14' });
    }
    const near = [];
    for (const g of st.guests) {
      if (g.state === 'ride') continue;
      const d = (g.x * K - cam.tx) ** 2 + (g.y * K - cam.tz) ** 2;
      if (d < 160 * 160) near.push([d, g]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const want = new Set(near.slice(0, pool.length).filter((n) => n[0] < 70 * 70).map((n) => n[1]));
    for (const p of pool) if (p.guest && !want.has(p.guest)) { p.guest._model = null; p.guest = null; }
    for (const g of want) {
      if (g._model) continue;
      const p = pool.find((q) => !q.guest);
      if (!p) break;
      p.guest = g; g._model = p;
    }
    for (const p of pool) {
      const g = p.guest;
      p.a.obj.visible = !!g;
      if (!g) continue;
      p.a.obj.position.set(g.x * K, 0, g.y * K);
      p.a.obj.rotation.y = Math.PI / 2 - (g.dir || 0);
      p.a.obj.scale.setScalar(p.base * (g.kid ? 0.68 : 1));
      p.a.mixer.update(dt * (g.speed * K) / 1.25);
    }
    for (const [, g] of near) {
      if (g._model) continue;
      g._h ??= hashOf(g.ox + g.oy * 7 + g.speed);
      g._phase = (g._phase ?? g._h % 7) + dt * g.speed * K * 4.2;
      people.push({
        x: g.x * K, z: g.y * K, ry: Math.PI / 2 - (g.dir || 0), s: g.kid ? 0.62 : 0.95 + (g._h % 12) / 100, phase: g._phase, swing: 0.55,
        shirt: g.shirt, pants: PANTS[g._h % PANTS.length], skin: g.skin, hair: HAIR[g._h % HAIR.length],
      });
    }
    crowd.draw(people);
    dRing.position.set(P.px * K, 0.06, P.py * K);
    dRing.scale.setScalar(0.8 + Math.sin(t * 3) * 0.08);
    // мусор
    let li = 0;
    for (const l of st.litter) {
      if (li >= 80) break;
      o3.position.set(l.x * K, 0.05, l.y * K); o3.rotation.set(0, l.r, 0); o3.scale.setScalar(1); o3.updateMatrix();
      litterMesh.setMatrixAt(li, o3.matrix); litterMesh.setColorAt(li, C(l.c)); li++;
    }
    litterMesh.count = li;
    litterMesh.instanceMatrix.needsUpdate = true;
    if (litterMesh.instanceColor) litterMesh.instanceColor.needsUpdate = true;
    placeCamera(dt, P.x * K, P.y * K);
    grass.uni.uOrigin.value.set(cam.tx, cam.tz);
    grass.uni.uTime.value = t;
    setHour(st.hour);
    if (composer) composer.render(dt);
    else renderer.render(scene, camera);
    adaptQuality(dt);
  }

  // --- постобработка (только на компьютере): объёмное затенение, свечение огней, виньетка, сглаживание.
  // На телефоне сцена рисуется сразу на экран — это в 2–3 раза дешевле.
  let composer = null, bloom = null;
  if (!mobile) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const ssao = new SSAOPass(scene, camera, innerWidth, innerHeight);
    ssao.kernelRadius = 0.9;
    ssao.minDistance = 0.000005;
    ssao.maxDistance = 0.0012;
    composer.addPass(ssao);
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.15, 0.5, 0.88);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 0.95;
    vignette.uniforms.darkness.value = 1.05;
    composer.addPass(vignette);
    composer.addPass(new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()));
  }

  // Подстройка разрешения под устройство: держим ~50+ кадров в секунду
  let frames = 0, acc = 0;
  function adaptQuality(dt) {
    frames++; acc += dt;
    if (acc < 2) return;
    const fps = frames / acc;
    frames = 0; acc = 0;
    const next = fps < 40 ? Math.max(0.6, dpr - 0.15) : fps > 57 ? Math.min(maxDpr, dpr + 0.1) : dpr;
    if (Math.abs(next - dpr) > 0.01) { dpr = next; renderer.setPixelRatio(dpr); resize(); }
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  return {
    cam,
    sync,
    // что под курсором: аттракцион или точка на земле (в пикселях карты)
    pick(cx, cy) {
      ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(colliders, false)[0];
      const ground = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (hit && (!ground || hit.distance < camera.position.distanceTo(ground) + 3)) return { ride: hit.object.userData.rideId };
      return ground ? { x: ground.x / K, y: ground.z / K } : null;
    },
    // экранные координаты точки карты (для всплывающих надписей)
    screenOf(px, py, h = 0) {
      const v = new THREE.Vector3(px * K, h, py * K).project(camera);
      return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, visible: v.z < 1 };
    },
    rideHeight(id) { const r = R.get(id); return r?.model ? Math.min(r.model.h, 24) : 3; },
  };
}
