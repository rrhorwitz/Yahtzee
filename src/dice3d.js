/* Real 3D dice for the roll animation (WebGL via three.js, bundled to vendor/dice3d.js).
   Rounded-box dice tumble in a transparent canvas laid over the tray, then hand off to the
   crisp 2D dice when they land. Build: npm run build:dice */
import {
  WebGLRenderer, Scene, OrthographicCamera, AmbientLight, DirectionalLight, Mesh, MeshStandardMaterial,
  MeshBasicMaterial, PlaneGeometry, CanvasTexture, SRGBColorSpace, Quaternion, Vector3, Matrix4,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const PIPS = { TL: [25, 25], TR: [75, 25], ML: [25, 50], C: [50, 50], MR: [75, 50], BL: [25, 75], BR: [75, 75] };
const FACE = { 1: ['C'], 2: ['TR', 'BL'], 3: ['TR', 'C', 'BL'], 4: ['TL', 'TR', 'BL', 'BR'], 5: ['TL', 'TR', 'C', 'BL', 'BR'], 6: ['TL', 'TR', 'ML', 'MR', 'BL', 'BR'] };

// Visual styles (mirrors the CSS dice themes).
const THEMES = {
  classic: { stops: ['#FFFFFF', '#F1F1F5'], pip: '#1C1C1E', rough: 0.5 },
  casino: { stops: ['#FF5C5C', '#E0202B', '#A70F19'], pip: '#FFFFFF', rough: 0.28 },
  midnight: { stops: ['#3A3D4A', '#1C1E26', '#0E0F14'], pip: '#F5C542', rough: 0.4 },
  sparkle: { stops: ['#FFB6E8', '#C3A6FF', '#8EDCFF', '#A8FFD8', '#FFE59A'], pip: '#4A2380', rough: 0.3, glitter: true },
  wood: { stops: ['#E3B57A', '#C88B4D', '#A86D35'], pip: '#3A2212', rough: 0.7, grain: true },
  ocean: { stops: ['#5CC8FF', '#1E7BE0', '#0B4EA8'], pip: '#FFFFFF', rough: 0.3 },
  gold: { stops: ['#FFE7A0', '#F5C542', '#E0A21B', '#FFE18A'], pip: '#5A3A00', rough: 0.3, metal: 0.55 },
};

// BoxGeometry material order: +x, -x, +y, -y, +z, -z. Opposite faces add to 7.
const FACE_VALUE = [3, 4, 2, 5, 1, 6];
// For each value: the face normal and its texture "up" direction in object space.
const BASIS = {
  1: { n: [0, 0, 1], up: [0, 1, 0] },
  6: { n: [0, 0, -1], up: [0, 1, 0] },
  3: { n: [1, 0, 0], up: [0, 1, 0] },
  4: { n: [-1, 0, 0], up: [0, 1, 0] },
  2: { n: [0, 1, 0], up: [0, 0, -1] },
  5: { n: [0, -1, 0], up: [0, 0, 1] },
};
// Extra quarter-turns about the view axis so each face lands upright (matches the 2D dice).
const ZFIX = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

function faceTexture(theme, value) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, S, S * 1.1);
  theme.stops.forEach((col, k) => grad.addColorStop(k / Math.max(1, theme.stops.length - 1), col));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  if (theme.grain) {
    g.strokeStyle = 'rgba(90,50,20,.18)';
    g.lineWidth = 2;
    for (let x = -40; x < S + 40; x += 14 + (x % 7)) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 12, S * 0.35, x - 10, S * 0.7, x + 8, S); g.stroke(); }
  }
  if (theme.glitter) {
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,255,255,${0.5 + Math.random() * 0.5})`; g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 1.6, 0, Math.PI * 2); g.fill(); }
  }
  // soft edge shading so faces read as slightly domed
  const vg = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.10)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  g.fillStyle = theme.pip;
  FACE[value].forEach((k) => {
    const [x, y] = PIPS[k];
    g.beginPath();
    g.arc((x / 100) * S, (y / 100) * S, 0.105 * S, 0, Math.PI * 2);
    g.fill();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shadowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0, 'rgba(0,0,0,.45)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, S, S);
  return new CanvasTexture(c);
}

function targetQuat(value) {
  const { n, up } = BASIS[value];
  const N = new Vector3(...n);
  const U = new Vector3(...up);
  const R = new Vector3().crossVectors(U, N);
  // rotation taking (R,U,N) -> (x,y,z) is the transpose of the basis matrix
  const m = new Matrix4().makeBasis(R, U, N).transpose();
  const q = new Quaternion().setFromRotationMatrix(m);
  if (ZFIX[value]) q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (ZFIX[value] * Math.PI) / 2));
  return q;
}

// Same lift-and-bounce profile as before: big (close to you) -> table, two little bounces.
const HOP = [[0, 1.45], [0.4, 1], [0.56, 1.09], [0.72, 1], [0.85, 1.025], [1, 1]];
function hop(t) {
  for (let k = 1; k < HOP.length; k++) {
    if (t <= HOP[k][0]) {
      const [t0, a] = HOP[k - 1];
      const [t1, b] = HOP[k];
      const u = (t - t0) / (t1 - t0);
      const e = k === 1 ? 1 - Math.pow(1 - u, 2) : 0.5 - Math.cos(u * Math.PI) / 2;
      return a + (b - a) * e;
    }
  }
  return 1;
}

export function createDiceRoller() {
  let renderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch (e) {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'dice3d';
  canvas.setAttribute('aria-hidden', 'true');
  const scene = new Scene();
  // Straight-on camera: at rest a die shows only its top face, exactly like the flat 2D die,
  // so the hand-off is seamless. Lift is shown by scale.
  const camera = new OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(-0.35, 0.9, 1);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.5);
  fill.position.set(0.6, -0.4, 0.7);
  scene.add(fill);

  const geo = new RoundedBoxGeometry(1, 1, 1, 6, 0.16);
  const shadowGeo = new PlaneGeometry(1, 1);
  const shadowMat = new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
  const matCache = {};
  const mats = (name) => {
    if (!matCache[name]) {
      const th = THEMES[name] || THEMES.classic;
      matCache[name] = FACE_VALUE.map((v) => new MeshStandardMaterial({ map: faceTexture(th, v), roughness: th.rough, metalness: th.metal || 0 }));
    }
    return matCache[name];
  };
  const targets = {};
  [1, 2, 3, 4, 5, 6].forEach((v) => { targets[v] = targetQuat(v); });

  let raf = 0;
  let active = null;

  function layout(host, W, H) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    // 1 world unit = 1 CSS px
    camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2;
    camera.position.set(0, 0, 1000);
    camera.updateProjectionMatrix();
    if (canvas.parentNode !== host) host.appendChild(canvas);
  }

  function clear() {
    renderer.clear();
    canvas.style.visibility = 'hidden';
  }
  function stop() {
    cancelAnimationFrame(raf);
    if (active) { active.dice.forEach((d) => { scene.remove(d.mesh); scene.remove(d.shadow); }); active.done(); }
    active = null;
    clear();
  }

  /**
   * dice: [{ x, y, size, value }] in px relative to the canvas box; opts: { theme, duration(k), slow }
   * Returns a promise that resolves when every die has landed.
   */
  function roll(host, box, dice, opts) {
    stop();
    layout(host, box.w, box.h);
    canvas.style.left = box.x + 'px';
    canvas.style.top = box.y + 'px';
    canvas.style.visibility = 'visible';
    const m = mats(opts.theme);
    return new Promise((resolve) => {
      const list = dice.map((d, k) => {
        const mesh = new Mesh(geo, m);
        mesh.scale.setScalar(d.size);
        const shadow = new Mesh(shadowGeo, shadowMat);
        const axis = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const turns = (Math.random() < 0.5 ? -1 : 1) * (Math.PI * 2 * (1 + Math.floor(Math.random() * 2)) + 0.7 + Math.random() * 2.4);
        scene.add(shadow);
        scene.add(mesh);
        return { ...d, mesh, shadow, axis, turns, dur: opts.duration(k) * (opts.slow ? 2 : 1), target: targets[d.value] };
      });
      const t0 = performance.now();
      const ts = window.__diceTimeScale || 1; // test hook: slow the clock down
      const spin = new Quaternion();
      const frame = (now) => {
        let running = false;
        list.forEach((d) => {
          const t = Math.min(1, (now - t0) / (d.dur * ts));
          if (t < 1) running = true;
          const e = 1 - Math.pow(1 - t, 3); // fast start, gentle stop
          spin.setFromAxisAngle(d.axis, d.turns * (1 - e));
          d.mesh.quaternion.copy(d.target).multiply(spin);
          const s = hop(t);
          const cx = d.x - box.w / 2;
          const cy = box.h / 2 - d.y;
          // front face sits on the z=0 plane at rest; "lift" toward the camera = bigger
          d.mesh.scale.setScalar(d.size * s);
          d.mesh.position.set(cx, cy, -d.size / 2);
          const lift = (s - 1) / 0.45;
          d.shadow.scale.set(d.size * (1.05 + lift * 0.5), d.size * (1.05 + lift * 0.5), 1);
          d.shadow.position.set(cx + lift * d.size * 0.12, cy - d.size * 0.1 - lift * d.size * 0.3, -d.size * 1.2);
          d.shadow.material.opacity = 1 - lift * 0.65;
        });
        renderer.render(scene, camera);
        if (running) raf = requestAnimationFrame(frame);
        else {
          list.forEach((d) => { scene.remove(d.mesh); scene.remove(d.shadow); });
          active = null;
          resolve();
          // hide on the next frame, after the flat dice have been revealed underneath
          requestAnimationFrame(clear);
        }
      };
      active = { dice: list, done: resolve };
      raf = requestAnimationFrame(frame);
    });
  }

  return { roll, stop, canvas, _targets: targets, _zfix: ZFIX };
}
