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
// Geometry comes from the shared generator — the same code the MCP server and
// library consumers use. This app only re-materialises it for preview.
import { buildTree as generateTree, meshStats, presets, leafPalettes, barkPalettes } from '../mcp/generator.js';

const FOLIAGE = /leaf_cluster|pine_bough/;

const state = { ...presets.meadow, age: 0.5, toon: true, wind: true };
const leaves = [];
let treeRoot;
let renderer;
let scene;
let camera;
let controls;
let ground;
let sun;

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
          ${rangeField('age', 'Age', 0, 1, 0.01)}
          ${rangeField('height', 'Height', 2, 50, 0.1)}
          ${rangeField('trunkRadius', 'Trunk radius', 0.15, 2.5, 0.01)}
          ${rangeField('branchCount', 'Branch count', 4, 18, 1)}
          ${rangeField('branchSpread', 'Branch spread', 0.45, 2.2, 0.01)}
          ${rangeField('canopySize', 'Canopy size', 0.9, 8, 0.01)}
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
            <button class="preset-button" data-preset="sapling"><span>Young Sapling</span><small>Slender and upswept</small></button>
            <button class="preset-button" data-preset="ancient"><span>Ancient Oak</span><small>Squat, gnarled veteran</small></button>
            <button class="preset-button" data-preset="giant"><span>Forest Giant</span><small>42m emergent, buttressed</small></button>
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
  sun = new THREE.DirectionalLight('#fff4dc', 3.4);
  sun.position.set(4, 8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  ground = new THREE.Mesh(
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

/**
 * Swap the generator's MeshStandardMaterials for toon equivalents, keeping one
 * instance per material name so the swap doesn't multiply draw calls.
 */
function toonify(root) {
  const cache = new Map();
  root.traverse((child) => {
    if (!child.isMesh) return;
    const { name } = child.material;
    if (!cache.has(name)) {
      const toon = new THREE.MeshToonMaterial({ color: child.material.color.clone() });
      toon.name = name;
      cache.set(name, toon);
    }
    child.material = cache.get(name);
  });
}

function dispose(root) {
  const seen = new Set();
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (!seen.has(child.geometry)) {
      seen.add(child.geometry);
      child.geometry.dispose();
    }
    if (!seen.has(child.material)) {
      seen.add(child.material);
      child.material.dispose();
    }
  });
}

function buildTree() {
  leaves.length = 0;
  if (treeRoot) {
    scene.remove(treeRoot);
    dispose(treeRoot);
  }

  treeRoot = generateTree(state);
  if (state.toon) toonify(treeRoot);

  treeRoot.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (!FOLIAGE.test(child.name)) return;
    // Derive the sway offset from position so it is stable across rebuilds
    // rather than drifting every time the tree is regenerated.
    child.userData.windPhase = (child.position.x * 3.1 + child.position.z * 5.7) % (Math.PI * 2);
    child.userData.basePosition = child.position.clone();
    child.userData.baseRotation = child.rotation.clone();
    leaves.push(child);
  });

  scene.add(treeRoot);
  fitScene();
  updateMetrics();
}

/**
 * Fit the view to the current tree. Species differ enormously in proportion —
 * a wide acacia and a narrow pine cannot share one fixed camera without one of
 * them being cropped. Only called on load and on Reset view, so it never yanks
 * the camera while sliders are being dragged.
 */
function frameTree() {
  const sphere = new THREE.Box3().setFromObject(treeRoot).getBoundingSphere(new THREE.Sphere());
  const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15;
  controls.target.copy(sphere.center);
  camera.position.set(
    sphere.center.x + distance * 0.52,
    sphere.center.y + distance * 0.3,
    sphere.center.z + distance * 0.8
  );
  camera.far = Math.max(100, distance + sphere.radius * 10);
  camera.updateProjectionMatrix();
  controls.update();
}

/**
 * Trees now span 2m saplings to 40m+ giants; the fog, ground disc, sun
 * distance, and shadow frustum are sized per tree or the big ones would be
 * fogged out with shadows clipped to a small square.
 */
function fitScene() {
  const sphere = new THREE.Box3().setFromObject(treeRoot).getBoundingSphere(new THREE.Sphere());
  const r = Math.max(5, sphere.radius);
  ground.scale.setScalar(Math.max(1, r / 4));
  scene.fog.near = r * 3.4;
  scene.fog.far = r * 9;
  sun.position.set(4, 8, 3).normalize().multiplyScalar(r * 2.4);
  const box = r * 1.5;
  sun.shadow.camera.left = -box;
  sun.shadow.camera.right = box;
  sun.shadow.camera.top = box;
  sun.shadow.camera.bottom = -box;
  sun.shadow.camera.far = r * 6;
  sun.shadow.camera.updateProjectionMatrix();
}

function updateMetrics() {
  const { meshes, triangles } = meshStats(treeRoot);
  document.querySelector('#meshCount').textContent = meshes;
  document.querySelector('#triCount').textContent = triangles.toLocaleString();
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
    'seed', 'age', 'height', 'trunkRadius', 'branchCount', 'branchSpread', 'canopySize', 'leafDensity',
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
      age: +(0.15 + Math.random() * 0.75).toFixed(2),
    });
    regenerate();
  });
  document.querySelector('#resetView').addEventListener('click', frameTree);
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      // Reset age first: presets without an age key mean "mature", and age
      // must not leak from a previously selected ancient/sapling preset.
      Object.assign(state, { age: 0.5 }, presets[button.dataset.preset]);
      regenerate();
      frameTree();
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

// Export the asset with plain standard materials, whatever the preview is
// currently showing, and without the preview-only userData.
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
frameTree();
animate();
