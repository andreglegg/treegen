import './styles.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import {
  Download,
  FileJson,
  Image,
  Leaf,
  RotateCcw,
  Shuffle,
  Sprout,
  Wind,
} from 'lucide';

const leafPalettes = [
  ['#7faa52', '#4f7f43', '#d7b447'],
  ['#5f9d65', '#2f6e4f', '#9dc967'],
  ['#d77d42', '#b24d34', '#e1b64d'],
  ['#84a8d7', '#537eb3', '#d9eef4'],
  ['#be6f8b', '#7f4f88', '#ead1db'],
  ['#96a64f', '#596f35', '#e2d77d'],
  ['#4b8d88', '#28605c', '#9fcbc2'],
  ['#ba5360', '#742f43', '#eea07e'],
];

const barkPalettes = [
  ['#8a5735', '#5c3924'],
  ['#a16a3e', '#73462a'],
  ['#6b5a47', '#44382d'],
  ['#b58254', '#7d5134'],
  ['#584434', '#31261d'],
  ['#73735e', '#48483d'],
];

const presets = {
  meadow: {
    species: 'round',
    seed: 4192,
    height: 6.2,
    trunkRadius: 0.45,
    branchCount: 11,
    branchSpread: 1.25,
    canopySize: 2.35,
    leafDensity: 34,
    leafShape: 0.66,
    leafStyle: 'clustered',
    leafSize: 1,
    leafVariation: 0.55,
    detail: 1,
    lean: 0.18,
    leafPalette: 0,
    barkPalette: 1,
    toon: true,
    wind: true,
  },
  orchard: {
    species: 'round',
    seed: 1327,
    height: 4.9,
    trunkRadius: 0.38,
    branchCount: 8,
    branchSpread: 1.65,
    canopySize: 2.65,
    leafDensity: 42,
    leafShape: 0.35,
    leafStyle: 'rounded',
    leafSize: 1.1,
    leafVariation: 0.4,
    detail: 0,
    lean: 0.08,
    leafPalette: 2,
    barkPalette: 0,
    toon: true,
    wind: false,
  },
  pine: {
    species: 'pine',
    seed: 7714,
    height: 7.8,
    trunkRadius: 0.34,
    branchCount: 12,
    branchSpread: 0.88,
    canopySize: 2.15,
    leafDensity: 28,
    leafShape: 0.8,
    leafStyle: 'needles',
    leafSize: 1,
    leafVariation: 0.6,
    detail: 1,
    lean: 0.12,
    leafPalette: 1,
    barkPalette: 4,
    toon: true,
    wind: true,
  },
  oak: {
    species: 'oak',
    seed: 3048,
    height: 6.7,
    trunkRadius: 0.6,
    branchCount: 15,
    branchSpread: 1.75,
    canopySize: 2.8,
    leafDensity: 46,
    leafShape: 0.4,
    leafStyle: 'angular',
    leafSize: 0.92,
    leafVariation: 0.72,
    detail: 1,
    lean: 0.1,
    leafPalette: 5,
    barkPalette: 4,
    toon: true,
    wind: true,
  },
  acacia: {
    species: 'acacia',
    seed: 6291,
    height: 6.8,
    trunkRadius: 0.42,
    branchCount: 10,
    branchSpread: 2.05,
    canopySize: 3.05,
    leafDensity: 38,
    leafShape: 0.24,
    leafStyle: 'flat',
    leafSize: 1.2,
    leafVariation: 0.5,
    detail: 1,
    lean: 0.24,
    leafPalette: 6,
    barkPalette: 2,
    toon: true,
    wind: true,
  },
  willow: {
    species: 'willow',
    seed: 8174,
    height: 6.1,
    trunkRadius: 0.4,
    branchCount: 12,
    branchSpread: 1.8,
    canopySize: 2.55,
    leafDensity: 52,
    leafShape: 0.8,
    leafStyle: 'flat',
    leafSize: 0.85,
    leafVariation: 0.65,
    detail: 1,
    lean: 0.16,
    leafPalette: 1,
    barkPalette: 5,
    toon: true,
    wind: true,
  },
};

const state = { ...presets.meadow };
const leaves = [];
let treeRoot;
let renderer;
let scene;
let camera;
let controls;

document.querySelector('#app').innerHTML = `
  <main class="app-shell">
    <aside class="panel left-panel">
      <div class="panel-inner">
        <div class="brand-row">
          <div class="brand">
            <h1>Treegen</h1>
            <span>Stylized tree asset generator</span>
          </div>
          <button class="icon-button" id="resetView" title="Reset view" aria-label="Reset view"></button>
        </div>

        <section class="control-section">
          <div class="section-title"><h2>Generator</h2><span class="section-note">Seeded</span></div>
          <div class="segmented" role="group" aria-label="Tree type">
            <button data-species="round" class="active">Round</button>
            <button data-species="oak">Oak</button>
            <button data-species="acacia">Acacia</button>
            <button data-species="willow">Willow</button>
            <button data-species="pine">Pine</button>
          </div>
          <label class="field">
            <span class="field-label">Seed <span class="field-output" data-out="seed"></span></span>
            <input id="seed" type="number" min="1" max="999999" />
          </label>
          <button class="tool-button primary" id="randomize"></button>
        </section>

        <section class="control-section">
          <div class="section-title"><h2>Shape</h2><span class="section-note">Game mesh</span></div>
          ${rangeField('height', 'Height', 3, 10, 0.1)}
          ${rangeField('trunkRadius', 'Trunk radius', 0.18, 0.9, 0.01)}
          ${rangeField('branchCount', 'Branch count', 4, 18, 1)}
          ${rangeField('branchSpread', 'Branch spread', 0.45, 2.2, 0.01)}
          ${rangeField('canopySize', 'Canopy size', 0.9, 3.6, 0.01)}
          ${rangeField('leafDensity', 'Leaf clusters', 8, 64, 1)}
          ${rangeField('leafShape', 'Leaf roundness', 0.15, 1, 0.01)}
          ${rangeField('leafSize', 'Leaf scale', 0.45, 1.7, 0.01)}
          ${rangeField('leafVariation', 'Leaf variation', 0, 1, 0.01)}
          ${rangeField('lean', 'Trunk lean', 0, 0.55, 0.01)}
          <label class="field">
            <span class="field-label">Mesh detail <span class="field-output" data-out="detail"></span></span>
            <select id="detail">
              <option value="0">Low poly</option>
              <option value="1">Game ready</option>
              <option value="2">Hero asset</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Foliage style</span>
            <select id="leafStyle">
              <option value="clustered">Clustered</option>
              <option value="angular">Angular</option>
              <option value="rounded">Rounded</option>
              <option value="flat">Flat leaf cards</option>
              <option value="needles">Needle boughs</option>
            </select>
          </label>
        </section>

        <section class="control-section">
          <div class="section-title"><h2>Paint</h2><span class="section-note">Toon materials</span></div>
          <div class="field">
            <span class="field-label">Leaves</span>
            <div class="swatches" id="leafSwatches"></div>
          </div>
          <div class="field">
            <span class="field-label">Trunk</span>
            <div class="swatches" id="barkSwatches"></div>
          </div>
          <label class="toggle-row">
            <span class="field-label">Toon bands</span>
            <input id="toon" type="checkbox" />
          </label>
          <label class="toggle-row">
            <span class="field-label">Wind preview</span>
            <input id="wind" type="checkbox" />
          </label>
        </section>
      </div>
    </aside>

    <section class="canvas-wrap">
      <div class="viewport-toolbar">
        <div class="viewport-pill">Drag to orbit. Scroll to zoom.</div>
        <div class="metrics">
          <div class="stat"><strong id="meshCount">0</strong><span>Meshes</span></div>
          <div class="stat"><strong id="triCount">0</strong><span>Tris</span></div>
          <div class="stat"><strong id="assetScale">1 Godot unit = 1m</strong><span>Scale</span></div>
        </div>
      </div>
      <canvas id="scene" aria-label="Tree preview"></canvas>
    </section>

    <aside class="panel right-panel">
      <div class="panel-inner">
        <section class="control-section">
          <div class="section-title"><h2>Export</h2><span class="section-note">Godot friendly</span></div>
          <div class="export-grid">
            <button class="tool-button primary" id="exportGlb"></button>
            <button class="tool-button" id="exportObj"></button>
            <button class="tool-button" id="exportJson"></button>
            <button class="tool-button" id="exportPng"></button>
          </div>
          <p class="hint">GLB preserves materials and imports cleanly into Godot. OBJ is included for older pipelines.</p>
        </section>

        <section class="control-section">
          <div class="section-title"><h2>Presets</h2><span class="section-note">Starting points</span></div>
          <div class="preset-list">
            <button class="preset-button" data-preset="meadow"><span>Meadow Shade</span><small>Rounded canopy</small></button>
            <button class="preset-button" data-preset="orchard"><span>Autumn Orchard</span><small>Warm clustered leaves</small></button>
            <button class="preset-button" data-preset="pine"><span>Alpine Pine</span><small>Layered cones</small></button>
            <button class="preset-button" data-preset="oak"><span>Old Oak</span><small>Wide limbs, dense crown</small></button>
            <button class="preset-button" data-preset="acacia"><span>Sunset Acacia</span><small>Flat umbrella canopy</small></button>
            <button class="preset-button" data-preset="willow"><span>Riverside Willow</span><small>Soft hanging foliage</small></button>
          </div>
        </section>

        <section class="control-section">
          <div class="section-title"><h2>Pipeline</h2><span class="section-note">Ready for engines</span></div>
          <p class="footer-note">
            Generated assets use simple named meshes, flat/toon materials, UV-ready primitive surfaces,
            y-up orientation, and meter-style scale. Use the seed to regenerate matching tree families.
          </p>
        </section>
      </div>
    </aside>
  </main>
`;

function rangeField(id, label, min, max, step) {
  return `
    <label class="field">
      <span class="field-label">${label} <span class="field-output" data-out="${id}"></span></span>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" />
    </label>
  `;
}

function icon(node, Icon, label) {
  node.innerHTML = '';
  node.append(createIconNode(Icon));
  if (label) node.append(document.createTextNode(label));
}

function createIconNode(iconNode) {
  const [tag, attrs, children = []] = iconNode;
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries({ ...attrs, width: 18, height: 18, 'aria-hidden': 'true' }).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });
  children.forEach((child) => node.append(createIconNode(child)));
  return node;
}

function setIcons() {
  icon(document.querySelector('#resetView'), RotateCcw);
  icon(document.querySelector('#randomize'), Shuffle, 'Random variation');
  icon(document.querySelector('#exportGlb'), Download, 'Export GLB');
  icon(document.querySelector('#exportObj'), Sprout, 'Export OBJ');
  icon(document.querySelector('#exportJson'), FileJson, 'Export preset');
  icon(document.querySelector('#exportPng'), Image, 'Save PNG preview');
}

function rng(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function initThree() {
  const canvas = document.querySelector('#scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#c7d9dc');
  scene.fog = new THREE.Fog('#c7d9dc', 12, 32);

  camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
  camera.position.set(7.4, 5.4, 11.2);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 3.6, 0);

  const hemi = new THREE.HemisphereLight('#f8f0d0', '#80907a', 2.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4dc', 3.4);
  sun.position.set(4, 8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshStandardMaterial({ color: '#d6d2aa', roughness: 0.92 })
  );
  ground.name = 'preview_ground_not_exported';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  window.addEventListener('resize', resize);
  resize();
}

function resize() {
  const canvas = renderer.domElement;
  const rect = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function material(name, color, type = 'toon') {
  const MaterialType = state.toon && type === 'toon' ? THREE.MeshToonMaterial : THREE.MeshStandardMaterial;
  const mat =
    MaterialType === THREE.MeshToonMaterial
      ? new MaterialType({ color })
      : new MaterialType({ color, roughness: 0.84, metalness: 0 });
  mat.name = name;
  return mat;
}

function addTrunkSegment(parent, start, end, r0, r1, mat, sides) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const length = start.distanceTo(end);
  const geom = new THREE.CylinderGeometry(r1, r0, length, sides, 1, false);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'trunk_segment';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(end, start).normalize());
  parent.add(mesh);
  return mesh;
}

function addLeafBlob(parent, position, scale, mat, rand, index) {
  const detail = Math.max(0, Math.min(2, state.detail));
  const geometryByStyle = {
    clustered: () => new THREE.IcosahedronGeometry(1, detail),
    angular: () => new THREE.DodecahedronGeometry(1, detail),
    rounded: () => new THREE.SphereGeometry(1, 8 + detail * 4, 5 + detail * 2),
    flat: () => new THREE.IcosahedronGeometry(1, Math.max(0, detail - 1)),
    needles: () => new THREE.ConeGeometry(1, 1.7, 5 + detail * 2, 1),
  };
  const geom = geometryByStyle[state.leafStyle]();
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `leaf_cluster_${index}`;
  mesh.position.copy(position);
  mesh.scale.set(scale.x, state.leafStyle === 'flat' ? scale.y * 0.32 : scale.y, scale.z);
  mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.windPhase = rand() * Math.PI * 2;
  mesh.userData.basePosition = position.clone();
  mesh.userData.baseRotation = mesh.rotation.clone();
  parent.add(mesh);
  leaves.push(mesh);
}

function addPineLayer(parent, y, radius, height, mat, sides, rand, index) {
  const geom = new THREE.ConeGeometry(radius, height, sides, 1, false);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = `pine_bough_layer_${index}`;
  mesh.position.set((rand() - 0.5) * 0.16, y, (rand() - 0.5) * 0.16);
  mesh.rotation.y = rand() * Math.PI;
  mesh.scale.x = 1 + (rand() - 0.5) * 0.18;
  mesh.scale.z = 1 + (rand() - 0.5) * 0.18;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.windPhase = rand() * Math.PI * 2;
  mesh.userData.basePosition = mesh.position.clone();
  mesh.userData.baseRotation = mesh.rotation.clone();
  parent.add(mesh);
  leaves.push(mesh);
}

function buildTree() {
  leaves.length = 0;
  if (treeRoot) scene.remove(treeRoot);
  treeRoot = new THREE.Group();
  treeRoot.name = 'Treegen_asset';
  scene.add(treeRoot);

  const rand = rng(Number(state.seed));
  const sides = [6, 8, 12][Number(state.detail)];
  const [barkBase, barkDark] = barkPalettes[state.barkPalette];
  const [leafBase, leafDark, leafLight] = leafPalettes[state.leafPalette];
  const barkMat = material('bark_toon', barkBase);
  const barkAltMat = material('bark_shadow', barkDark);
  const leafMats = [
    material('leaves_base', leafBase),
    material('leaves_shadow', leafDark),
    material('leaves_highlight', leafLight),
  ];

  const top = new THREE.Vector3(state.lean, state.height, state.lean * 0.45);
  addTrunkSegment(treeRoot, new THREE.Vector3(0, 0, 0), top, state.trunkRadius, state.trunkRadius * 0.34, barkMat, sides);
  addTrunkSegment(
    treeRoot,
    new THREE.Vector3(0.05, state.height * 0.08, -0.04),
    new THREE.Vector3(-0.03, state.height * 0.86, 0.03),
    state.trunkRadius * 0.58,
    state.trunkRadius * 0.18,
    barkAltMat,
    sides
  );

  if (state.species === 'pine') buildPine(rand, sides, leafMats, barkMat);
  else buildBroadleaf(rand, sides, leafMats, barkMat);

  updateMetrics();
}

function buildBroadleaf(rand, sides, leafMats, barkMat) {
  const profiles = {
    round: { canopyY: 0.86, width: 1, vertical: 0.9, branchBase: 0.43, branchRange: 0.42, rise: 0.55 },
    oak: { canopyY: 0.76, width: 1.25, vertical: 0.72, branchBase: 0.34, branchRange: 0.43, rise: 0.28 },
    acacia: { canopyY: 0.83, width: 1.42, vertical: 0.33, branchBase: 0.55, branchRange: 0.24, rise: 0.12 },
    willow: { canopyY: 0.76, width: 1.12, vertical: 1.15, branchBase: 0.4, branchRange: 0.32, rise: -0.12 },
  };
  const profile = profiles[state.species] ?? profiles.round;
  const canopyCenter = new THREE.Vector3(state.lean * 1.25, state.height * profile.canopyY, 0);
  const branches = Number(state.branchCount);
  for (let i = 0; i < branches; i += 1) {
    const t = branches === 1 ? 0 : i / (branches - 1);
    const angle = t * Math.PI * 2 + rand() * 0.4;
    const y = state.height * (profile.branchBase + rand() * profile.branchRange);
    const len = state.branchSpread * profile.width * (1.05 + rand() * 0.8);
    const start = new THREE.Vector3(state.lean * (y / state.height), y, 0);
    const rise = profile.rise + rand() * (state.species === 'willow' ? 0.3 : 0.8);
    const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, rise, Math.sin(angle) * len));
    addTrunkSegment(treeRoot, start, end, state.trunkRadius * 0.2, state.trunkRadius * 0.06, barkMat, sides);
  }

  const count = Number(state.leafDensity);
  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * state.canopySize * profile.width;
    const vertical = (rand() - 0.42) * state.canopySize * profile.vertical;
    const position = canopyCenter.clone().add(new THREE.Vector3(Math.cos(angle) * radius, vertical, Math.sin(angle) * radius * 0.92));
    if (state.species === 'willow') position.y -= Math.max(0, radius - state.canopySize * 0.45) * 0.45;
    const variation = Number(state.leafVariation);
    const lump = (0.48 + rand() * 0.36 * variation) * Number(state.leafSize);
    const roundness = Number(state.leafShape);
    const scale = new THREE.Vector3(
      lump * (1.25 - roundness * 0.28),
      lump * (0.55 + roundness * 0.8) * (0.9 + rand() * variation * 0.25),
      lump * (1.15 - roundness * 0.18)
    );
    addLeafBlob(treeRoot, position, scale, leafMats[i % leafMats.length], rand, i + 1);
  }
}

function buildPine(rand, sides, leafMats, barkMat) {
  const layers = Math.max(6, Math.round(state.leafDensity / 3));
  for (let i = 0; i < Number(state.branchCount); i += 1) {
    const y = state.height * (0.22 + rand() * 0.62);
    const angle = rand() * Math.PI * 2;
    const len = state.branchSpread * (1.25 - y / state.height) * 1.9;
    const start = new THREE.Vector3(state.lean * (y / state.height), y, 0);
    const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * len, -0.14 + rand() * 0.28, Math.sin(angle) * len));
    addTrunkSegment(treeRoot, start, end, state.trunkRadius * 0.14, state.trunkRadius * 0.035, barkMat, sides);
  }
  for (let i = 0; i < layers; i += 1) {
    const t = i / Math.max(1, layers - 1);
    const y = state.height * (0.28 + t * 0.68);
    const variation = 1 + (rand() - 0.5) * Number(state.leafVariation) * 0.26;
    const radius = state.canopySize * (1.08 - t * 0.86) * state.branchSpread * Number(state.leafSize) * variation;
    const h = state.height * (0.2 - t * 0.08) * (0.75 + state.leafShape * 0.55);
    addPineLayer(treeRoot, y, radius, h, leafMats[i % leafMats.length], sides + 2, rand, i + 1);
  }
}

function updateMetrics() {
  let meshes = 0;
  let tris = 0;
  treeRoot.traverse((child) => {
    if (!child.isMesh) return;
    meshes += 1;
    const indexCount = child.geometry.index?.count ?? child.geometry.attributes.position.count;
    tris += Math.round(indexCount / 3);
  });
  document.querySelector('#meshCount').textContent = meshes;
  document.querySelector('#triCount').textContent = tris.toLocaleString();
}

function syncControls() {
  for (const [key, value] of Object.entries(state)) {
    const input = document.querySelector(`#${key}`);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value;
  }
  document.querySelectorAll('[data-species]').forEach((button) => {
    button.classList.toggle('active', button.dataset.species === state.species);
  });
  document.querySelectorAll('[data-out]').forEach((out) => {
    const value = state[out.dataset.out];
    out.textContent = Number.isFinite(Number(value)) ? Number(value).toFixed(Number(value) % 1 ? 2 : 0) : value;
  });
  drawSwatches('leafSwatches', leafPalettes, state.leafPalette, (index) => {
    state.leafPalette = index;
    regenerate();
  });
  drawSwatches('barkSwatches', barkPalettes, state.barkPalette, (index) => {
    state.barkPalette = index;
    regenerate();
  });
}

function drawSwatches(id, palettes, active, onPick) {
  const wrap = document.querySelector(`#${id}`);
  wrap.innerHTML = '';
  palettes.forEach((palette, index) => {
    const button = document.createElement('button');
    button.className = `swatch${index === active ? ' active' : ''}`;
    button.style.background = `linear-gradient(135deg, ${palette.join(', ')})`;
    button.title = `Palette ${index + 1}`;
    button.setAttribute('aria-label', `Palette ${index + 1}`);
    button.addEventListener('click', () => onPick(index));
    wrap.append(button);
  });
}

function bindControls() {
  const fields = [
    'seed', 'height', 'trunkRadius', 'branchCount', 'branchSpread', 'canopySize', 'leafDensity',
    'leafShape', 'leafSize', 'leafVariation', 'lean', 'detail', 'leafStyle',
  ];
  fields.forEach((id) => {
    document.querySelector(`#${id}`).addEventListener('input', (event) => {
      state[id] = event.target.type === 'number' || event.target.type === 'range' ? Number(event.target.value) : event.target.value;
      regenerate();
    });
  });

  document.querySelectorAll('[data-species]').forEach((button) => {
    button.addEventListener('click', () => {
      state.species = button.dataset.species;
      regenerate();
    });
  });

  document.querySelector('#toon').addEventListener('change', (event) => {
    state.toon = event.target.checked;
    regenerate();
  });
  document.querySelector('#wind').addEventListener('change', (event) => {
    state.wind = event.target.checked;
    syncControls();
  });
  document.querySelector('#randomize').addEventListener('click', () => {
    Object.assign(state, {
      seed: Math.floor(Math.random() * 999999) + 1,
      height: +(4.2 + Math.random() * 4.6).toFixed(1),
      branchCount: Math.floor(6 + Math.random() * 11),
      branchSpread: +(0.7 + Math.random() * 1.25).toFixed(2),
      canopySize: +(1.3 + Math.random() * 1.9).toFixed(2),
      leafDensity: Math.floor(18 + Math.random() * 42),
      leafShape: +(0.25 + Math.random() * 0.7).toFixed(2),
      leafSize: +(0.65 + Math.random() * 0.7).toFixed(2),
      leafVariation: +(Math.random() * 0.9).toFixed(2),
      lean: +(Math.random() * 0.4).toFixed(2),
    });
    regenerate();
  });
  document.querySelector('#resetView').addEventListener('click', () => {
    camera.position.set(7.4, 5.4, 11.2);
    controls.target.set(0, 3.6, 0);
    controls.update();
  });
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      Object.assign(state, presets[button.dataset.preset]);
      regenerate();
    });
  });
  document.querySelector('#exportGlb').addEventListener('click', exportGlb);
  document.querySelector('#exportObj').addEventListener('click', exportObj);
  document.querySelector('#exportJson').addEventListener('click', exportJson);
  document.querySelector('#exportPng').addEventListener('click', exportPng);
}

function regenerate() {
  syncControls();
  buildTree();
}

function cleanExportGroup() {
  const clone = treeRoot.clone(true);
  clone.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry = child.geometry.clone();
    const color = child.material.color?.clone() ?? new THREE.Color('#ffffff');
    child.material = new THREE.MeshStandardMaterial({
      name: child.material.name,
      color,
      roughness: 0.88,
      metalness: 0,
    });
    child.userData = {};
  });
  return clone;
}

function exportGlb() {
  const exporter = new GLTFExporter();
  exporter.parse(
    cleanExportGroup(),
    (result) => {
      saveBlob(new Blob([result], { type: 'model/gltf-binary' }), fileName('glb'));
    },
    (error) => console.error(error),
    { binary: true, trs: false, onlyVisible: true }
  );
}

function exportObj() {
  const exporter = new OBJExporter();
  const obj = exporter.parse(cleanExportGroup());
  saveBlob(new Blob([obj], { type: 'text/plain' }), fileName('obj'));
}

function exportJson() {
  saveBlob(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), fileName('json'));
}

function exportPng() {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => saveBlob(blob, fileName('png')));
}

function saveBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function fileName(ext) {
  return `treegen_${state.species}_${state.seed}.${ext}`;
}

function animate(time = 0) {
  requestAnimationFrame(animate);
  const t = time * 0.001;
  for (const leaf of leaves) {
    if (state.wind) {
      const sway = Math.sin(t * 1.8 + leaf.userData.windPhase) * 0.045;
      leaf.rotation.z = leaf.userData.baseRotation.z + sway;
      leaf.position.x = leaf.userData.basePosition.x + sway * (0.7 + leaf.position.y / 9);
    } else {
      leaf.rotation.copy(leaf.userData.baseRotation);
      leaf.position.copy(leaf.userData.basePosition);
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

setIcons();
initThree();
bindControls();
regenerate();
animate();
