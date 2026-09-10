/* =========================================================================
   Road Ready — a top-down, endless road-safety driving game.
   Vanilla JS, single-file game engine, no build step (GitHub Pages friendly).

   Structure:
     AssetManager   - loads assets/manifest.json, images & audio, tracks
                      per-asset load success so rendering can fall back to
                      clean vector shapes when real art isn't present yet.
     InputManager   - keyboard, on-screen steering wheel (drag), pedals.
     AudioManager   - thin wrapper around <audio>/WebAudio playback that
                      never throws if a file is missing.
     Entities       - Car (player + NPC), Pedestrian, Intersection (with
                      traffic light + crosswalk), Sign, Building, Prop.
     Game           - state machine (start/howto/playing/paused/gameover),
                      update loop, rendering, HUD, persistence.

   WORLD MODEL
   -----------
   Every object in the world (buildings, signs, intersections, props) is
   stored with a fixed `worldPos` — its distance along the road, which never
   changes. The player's total distance travelled is `this.scroll`. An
   object's on-screen Y is derived fresh every frame from the difference
   between its `worldPos` and `this.scroll` — there is no separate "move
   this object down by X pixels" step and no second accumulator drifting
   out of sync with it. That single source of truth is what fixes the old
   double-motion / jittery-road feel: everything scrolls at exactly the
   rate implied by the car's actual speed, every frame, with nothing to
   fall out of sync.

   The road is not a straight vertical strip any more — `roadCurve(distance)`
   returns a horizontal offset that winds gently left and right forever, so
   the whole road (and everything beside it) curves. The player has to
   steer to stay on it, which is what makes it feel like actual turns
   instead of a static lane you drift sideways in.

   See /assets/README.md for the art spec if you want to swap the
   fallback shapes for real sprites.
   ========================================================================= */

(() => {
  'use strict';

  const DEFAULT_MANIFEST = {
    images: {
      car_player:   { file: 'assets/car_player.png',   w: 128, h: 256, anchor: [64, 200] },
      car_red:      { file: 'assets/car_red.png',       w: 128, h: 256, anchor: [64, 200] },
      car_blue:     { file: 'assets/car_blue.png',      w: 128, h: 256, anchor: [64, 200] },
      car_white:    { file: 'assets/car_white.png',     w: 128, h: 256, anchor: [64, 200] },
      ped_walk:     { file: 'assets/ped_walk.png', w: 384, h: 64, frames: 6, frameSize: [64, 64], anchor: [32, 56] },
      traffic_light:{ file: 'assets/traffic_light_sprites.png', frames: 4, frameSize: [64, 160], anchor: [32, 80] },
      sign_school40:{ file: 'assets/sign_school40.svg', w: 128, h: 128, anchor: [64, 64] },
      sign_speed50: { file: 'assets/sign_speed50.svg',  w: 128, h: 128, anchor: [64, 64] },
      sign_giveway: { file: 'assets/sign_giveway.svg',  w: 128, h: 128, anchor: [64, 64] },
      sign_roundabout:{ file: 'assets/sign_roundabout.svg', w: 128, h: 128, anchor: [64, 64] },
      steering_wheel:{ file: 'assets/steering_wheel.png', w: 512, h: 512, anchor: [256, 256] },
      house_01:     { file: 'assets/house_01.png', w: 200, h: 200 },
      house_02:     { file: 'assets/house_02.png', w: 200, h: 200 },
      shop_01:      { file: 'assets/shop_01.png',  w: 220, h: 200 },
      building_01:  { file: 'assets/building_01.png', w: 256, h: 320 },
      building_02:  { file: 'assets/building_02.png', w: 256, h: 320 }
    },
    audio: {
      horn:      'assets/sfx/horn.ogg',
      brake:     'assets/sfx/brake.ogg',
      collision: 'assets/sfx/collision.ogg',
      ped_alert: 'assets/sfx/ped_alert.ogg',
      light_tick:'assets/sfx/light_tick.ogg',
      bg_loop:   'assets/music/bg_loop.ogg'
    }
  };

  /* ----------------------------- AssetManager ---------------------------- */

  class AssetManager {
    constructor() {
      this.images = new Map();   // key -> { el, ok, meta }
      this.audio = new Map();    // key -> { el, ok }
    }

    async loadManifest(url = 'assets/manifest.json') {
      let manifest = DEFAULT_MANIFEST;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
      } catch (e) {
        // No manifest yet (or offline) — fine, we run on fallback shapes.
      }
      const jobs = [];

      for (const [key, meta] of Object.entries(manifest.images || {})) {
        jobs.push(this._loadImage(key, meta));
      }
      for (const [key, src] of Object.entries(manifest.audio || {})) {
        jobs.push(this._loadAudio(key, src));
      }
      await Promise.allSettled(jobs);
      return manifest;
    }

    _loadImage(key, meta) {
      return new Promise((resolve) => {
        const el = new Image();
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          this.images.set(key, { el, ok, meta });
          resolve();
        };
        el.onload = () => finish(true);
        el.onerror = () => finish(false);
        el.src = meta.file;
        // Don't hang forever on a slow/missing asset.
        setTimeout(() => finish(false), 4000);
      });
    }

    _loadAudio(key, src) {
      return new Promise((resolve) => {
        const el = new Audio();
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          this.audio.set(key, { el, ok });
          resolve();
        };
        el.oncanplaythrough = () => finish(true);
        el.onerror = () => finish(false);
        el.src = src;
        el.load();
        setTimeout(() => finish(false), 4000);
      });
    }

    getImage(key) {
      const rec = this.images.get(key);
      return rec && rec.ok ? rec.el : null;
    }

    meta(key) {
      const rec = this.images.get(key);
      return rec ? rec.meta : null;
    }

    hasAudio(key) {
      const rec = this.audio.get(key);
      return !!(rec && rec.ok);
    }

    getAudioEl(key) {
      const rec = this.audio.get(key);
      return rec ? rec.el : null;
    }
  }

  /* ------------------------------ AudioManager --------------------------- */

  class AudioManager {
    constructor(assets) {
      this.assets = assets;
      this.muted = false;
    }

    play(key, { loop = false, volume = 0.8 } = {}) {
      if (this.muted || !this.assets.hasAudio(key)) return;
      try {
        const base = this.assets.getAudioEl(key);
        const node = base.cloneNode();
        node.loop = loop;
        node.volume = volume;
        node.play().catch(() => {});
      } catch (e) { /* never let audio break gameplay */ }
    }
  }

  /* ------------------------------ InputManager ---------------------------- */

  class InputManager {
    constructor(root) {
      this.keys = new Set();
      this.wheelAngle = 0;      // -45..45 degrees, from drag or keys
      this.accelHeld = false;
      this.brakeHeld = false;

      window.addEventListener('keydown', (e) => {
        this.keys.add(e.key.toLowerCase());
        if (e.key === ' ') e.preventDefault();
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

      this._bindWheel(root.querySelector('#steering-wheel'));
      this._bindPedal(root.querySelector('#btn-accel'), 'accelHeld');
      this._bindPedal(root.querySelector('#btn-brake'), 'brakeHeld');
    }

    _bindWheel(wheelEl) {
      if (!wheelEl) return;
      let dragging = false;
      const setFromEvent = (clientX) => {
        const rect = wheelEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const dx = clientX - cx;
        const norm = Math.max(-1, Math.min(1, dx / (rect.width / 2)));
        this.wheelAngle = norm * 45;
        wheelEl.style.transform = `rotate(${this.wheelAngle}deg)`;
        wheelEl.setAttribute('aria-valuenow', Math.round(this.wheelAngle));
      };
      const start = (e) => { dragging = true; setFromEvent((e.touches ? e.touches[0].clientX : e.clientX)); };
      const move = (e) => { if (dragging) setFromEvent((e.touches ? e.touches[0].clientX : e.clientX)); };
      const end = () => {
        dragging = false;
        this.wheelAngle = 0;
        wheelEl.style.transform = 'rotate(0deg)';
        wheelEl.setAttribute('aria-valuenow', '0');
      };
      wheelEl.addEventListener('mousedown', start);
      wheelEl.addEventListener('touchstart', start, { passive: true });
      window.addEventListener('mousemove', move);
      window.addEventListener('touchmove', move, { passive: true });
      window.addEventListener('mouseup', end);
      window.addEventListener('touchend', end);

      // Keyboard access for the slider role.
      wheelEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') this.wheelAngle = -45;
        if (e.key === 'ArrowRight') this.wheelAngle = 45;
      });
    }

    _bindPedal(el, prop) {
      if (!el) return;
      const down = (e) => { e.preventDefault(); this[prop] = true; };
      const up = () => { this[prop] = false; };
      el.addEventListener('mousedown', down);
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', up);
      el.addEventListener('touchend', up);
    }

    get steer() {
      if (this.keys.has('arrowleft') || this.keys.has('a')) return -1;
      if (this.keys.has('arrowright') || this.keys.has('d')) return 1;
      if (Math.abs(this.wheelAngle) > 4) return this.wheelAngle / 45;
      return 0;
    }

    get accelerating() {
      return this.accelHeld || this.keys.has('arrowup') || this.keys.has('w');
    }

    get braking() {
      return this.brakeHeld || this.keys.has('arrowdown') || this.keys.has('s');
    }
  }

  /* --------------------------------- Shapes -------------------------------- */
  // Fallback vector drawing, used whenever a real sprite hasn't loaded yet.

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCarShape(ctx, x, y, w, h, bodyColor, angle) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.38, w * 0.55, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = bodyColor;
    roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.28);
    ctx.fill();

    ctx.fillStyle = 'rgba(180,220,255,0.85)';
    roundRect(ctx, -w * 0.32, -h * 0.34, w * 0.64, h * 0.28, 6);
    ctx.fill();

    ctx.fillStyle = '#fff7cc';
    ctx.fillRect(-w * 0.4, -h * 0.48, w * 0.16, h * 0.08);
    ctx.fillRect(w * 0.24, -h * 0.48, w * 0.16, h * 0.08);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(-w * 0.4, h * 0.40, w * 0.16, h * 0.08);
    ctx.fillRect(w * 0.24, h * 0.40, w * 0.16, h * 0.08);
    ctx.restore();
  }

  function drawPedestrianShape(ctx, x, y, phase) {
    ctx.save();
    ctx.translate(x, y);
    const bob = Math.sin(phase * 6) * 2;
    ctx.fillStyle = '#3a2f28';
    ctx.beginPath();
    ctx.arc(0, -18 + bob, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -12 + bob);
    ctx.lineTo(0, 6 + bob);
    ctx.stroke();
    ctx.strokeStyle = '#1d3557';
    const legSwing = Math.sin(phase * 6) * 6;
    ctx.beginPath();
    ctx.moveTo(0, 6 + bob); ctx.lineTo(-legSwing, 20);
    ctx.moveTo(0, 6 + bob); ctx.lineTo(legSwing, 20);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrafficLightShape(ctx, x, y, state) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2b2e33';
    ctx.fillRect(-4, 0, 8, 40);
    roundRect(ctx, -14, -60, 28, 62, 8);
    ctx.fill();
    const colors = { red: '#3a1414', amber: '#3a2e14', green: '#143a20' };
    const on = { red: '#ff4d4d', amber: '#ffb703', green: '#43e07a' };
    ['red', 'amber', 'green'].forEach((c, i) => {
      ctx.fillStyle = state === c ? on[c] : colors[c];
      ctx.beginPath();
      ctx.arc(0, -48 + i * 18, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawSignShape(ctx, x, y, label, kind) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-3, 0, 6, 34);
    if (kind === 'giveway') {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#d64545';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -34); ctx.lineTo(24, 0); ctx.lineTo(-24, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d64545';
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GIVE', 0, -12);
      ctx.fillText('WAY', 0, -3);
    } else if (kind === 'roundabout') {
      ctx.fillStyle = '#fff';
      roundRect(ctx, -20, -40, 40, 40, 4); ctx.fill();
      ctx.strokeStyle = '#2b2e33'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -20, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -29); ctx.lineTo(-9, -20); ctx.lineTo(0, -11); ctx.lineTo(9, -20); ctx.stroke();
    } else {
      // speed / school zone: circular or square number sign
      ctx.fillStyle = '#fff';
      if (kind === 'school') { roundRect(ctx, -20, -40, 40, 40, 6); ctx.fill(); ctx.strokeStyle = '#3EA66D'; }
      else { ctx.beginPath(); ctx.arc(0, -20, 20, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#d64545'; }
      ctx.lineWidth = 4;
      if (kind === 'school') { ctx.strokeRect(-20, -40, 40, 40); } else { ctx.beginPath(); ctx.arc(0, -20, 20, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#111';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, -16);
    }
    ctx.restore();
  }

  // ---- "houses and stuff": a small family of distinct building shapes ----

  function drawHouseShape(ctx, x, y, w, h, palette) {
    ctx.save();
    ctx.translate(x, y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(4, h * 0.52, w * 0.55, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = palette.wall;
    ctx.fillRect(-w / 2, -h * 0.1, w, h * 0.6);
    // roof
    ctx.fillStyle = palette.roof;
    ctx.beginPath();
    ctx.moveTo(-w * 0.62, -h * 0.1);
    ctx.lineTo(0, -h * 0.62);
    ctx.lineTo(w * 0.62, -h * 0.1);
    ctx.closePath();
    ctx.fill();
    // chimney
    ctx.fillStyle = palette.roof;
    ctx.fillRect(w * 0.22, -h * 0.5, w * 0.1, h * 0.22);
    // door
    ctx.fillStyle = palette.door;
    roundRect(ctx, -w * 0.1, h * 0.18, w * 0.2, h * 0.32, 3);
    ctx.fill();
    // windows
    ctx.fillStyle = palette.window;
    roundRect(ctx, -w * 0.4, h * 0.02, w * 0.18, w * 0.18, 3); ctx.fill();
    roundRect(ctx, w * 0.22, h * 0.02, w * 0.18, w * 0.18, 3); ctx.fill();
    ctx.restore();
  }

  function drawShopShape(ctx, x, y, w, h, palette) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(4, h * 0.5, w * 0.55, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = palette.wall;
    ctx.fillRect(-w / 2, -h * 0.42, w, h * 0.92);
    // storefront window
    ctx.fillStyle = palette.window;
    ctx.fillRect(-w * 0.42, -h * 0.02, w * 0.84, h * 0.34);
    // awning
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -h * 0.06);
    ctx.lineTo(w * 0.5, -h * 0.06);
    ctx.lineTo(w * 0.46, -h * 0.2);
    ctx.lineTo(-w * 0.46, -h * 0.2);
    ctx.closePath();
    ctx.fill();
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = i % 2 === 0 ? palette.accent : '#fff';
      const seg = w / 5;
      ctx.fillRect(i * seg - seg / 2, -h * 0.2, seg, h * 0.05);
    }
    // sign box
    ctx.fillStyle = palette.wall === '#f2ede0' ? '#2b2e33' : '#fff7cc';
    roundRect(ctx, -w * 0.3, -h * 0.56, w * 0.6, h * 0.14, 4);
    ctx.fill();
    ctx.restore();
  }

  function drawApartmentShape(ctx, x, y, w, h, palette) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(4, h * 0.5, w * 0.55, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.wall;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // door
    ctx.fillStyle = palette.door;
    ctx.fillRect(-w / 8, h / 3, w / 4, h / 6);
    // window grid
    ctx.fillStyle = palette.window;
    const rows = Math.max(3, Math.round(h / 46));
    const winSize = w / 6;
    const winSpacing = w / 5;
    for (let row = 0; row < rows; row++) {
      for (let col = -1; col <= 1; col++) {
        ctx.fillRect(col * winSpacing - winSize / 2, -h / 2 + h * 0.14 + row * (h / (rows + 1)), winSize, winSize);
      }
    }
    ctx.restore();
  }

  function drawParkShape(ctx, x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#5b8c4a';
    roundRect(ctx, -w / 2, -h / 2, w, h, 14);
    ctx.fill();
    ctx.fillStyle = '#7bab63';
    roundRect(ctx, -w / 2 + 8, -h / 2 + 8, w - 16, h - 16, 10);
    ctx.fill();
    const spots = [[-w * 0.22, -h * 0.1], [w * 0.18, h * 0.12], [0, -h * 0.3]];
    spots.forEach(([tx, ty]) => drawTreeShape(ctx, tx, ty, 15 + (w % 7)));
    // bench
    ctx.strokeStyle = '#5b3a29';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-w * 0.15, h * 0.32); ctx.lineTo(w * 0.15, h * 0.32);
    ctx.stroke();
    ctx.restore();
  }

  function drawTreeShape(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(2, size * 0.7, size * 0.5, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(-size * 0.08, 0, size * 0.16, size * 0.5);
    ctx.fillStyle = '#3f7a3a';
    ctx.beginPath(); ctx.arc(0, -size * 0.15, size * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4f9147';
    ctx.beginPath(); ctx.arc(-size * 0.18, -size * 0.35, size * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(size * 0.2, -size * 0.32, size * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawLampShape(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#3a3d42';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -32); ctx.stroke();
    ctx.fillStyle = 'rgba(255,224,130,0.35)';
    ctx.beginPath(); ctx.arc(0, -36, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe082';
    ctx.beginPath(); ctx.arc(0, -36, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCrosswalkStripes(ctx, xLeft, xRight, y, thickness) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const stripeW = 10;
    const gap = 8;
    let x = xLeft + 4;
    while (x < xRight - 4) {
      ctx.fillRect(x, y - thickness / 2, stripeW, thickness);
      x += stripeW + gap;
    }
    ctx.restore();
  }

  const HOUSE_PALETTES = [
    { wall: '#e8c07d', roof: '#7a4a30', door: '#5b3a29', window: '#cfe8f5' },
    { wall: '#d9a066', roof: '#5b3a29', door: '#3a2a20', window: '#cfe8f5' },
    { wall: '#e0b7a5', roof: '#8b4513', door: '#4a2f22', window: '#dff0ea' },
    { wall: '#cfe0c3', roof: '#6b4226', door: '#4a2f22', window: '#cfe8f5' },
    { wall: '#f0d9b5', roof: '#8a5a2b', door: '#3a2a20', window: '#dff0ea' }
  ];
  const SHOP_PALETTES = [
    { wall: '#f2ede0', window: '#bcd8e8', accent: '#d64545' },
    { wall: '#e6dcc8', window: '#bcd8e8', accent: '#3EA66D' },
    { wall: '#d8cbb0', window: '#cfe8f5', accent: '#E8A33D' }
  ];
  const APT_PALETTES = [
    { wall: '#9aa5ad', door: '#3a3d42', window: '#fff7cc' },
    { wall: '#8a95a0', door: '#2b2e33', window: '#fff2b8' },
    { wall: '#a3ada0', door: '#3a3d42', window: '#fff7cc' },
    { wall: '#93877a', door: '#2b2e33', window: '#ffe9b3' }
  ];

  /* ---------------------------------- Game --------------------------------- */

  const LANE_COUNT = 3;
  const CAR_W = 46, CAR_H = 84;

  class Game {
    constructor() {
      this.canvas = document.getElementById('game-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.assets = new AssetManager();
      this.audio = new AudioManager(this.assets);
      this.input = new InputManager(document);

      this.state = 'start'; // start | howto | playing | paused | gameover
      this.dpr = Math.max(1, window.devicePixelRatio || 1);

      this._resize = this._resize.bind(this);
      window.addEventListener('resize', this._resize);
      this._resize();

      this._bindUi();
      this._loadBest();

      this.lastTime = performance.now();
      requestAnimationFrame(this._loop.bind(this));
    }

    /* ---- boot / ui wiring ---- */

    _bindUi() {
      const $ = (sel) => document.querySelector(sel);
      $('#btn-start').addEventListener('click', () => this._beginLoadingThenPlay());
      $('#btn-howto').addEventListener('click', () => this._show('screen-howto'));
      $('#btn-howto-back').addEventListener('click', () => this._show('screen-start'));
      $('#btn-pause').addEventListener('click', () => this.pause());
      $('#btn-resume').addEventListener('click', () => this.resume());
      $('#btn-quit').addEventListener('click', () => this._toMenu());
      $('#btn-retry').addEventListener('click', () => this._beginLoadingThenPlay());
      $('#btn-menu').addEventListener('click', () => this._toMenu());

      window.addEventListener('keydown', (e) => {
        if (e.key === ' ' && this.state === 'playing') this.pause();
        else if (e.key === ' ' && this.state === 'paused') this.resume();
      });
    }

    _show(id) {
      document.querySelectorAll('.screen').forEach(s => s.hidden = true);
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    }

    async _beginLoadingThenPlay() {
      this._show('screen-game');
      const overlay = document.getElementById('loading-overlay');
      overlay.classList.remove('hidden');
      await this.assets.loadManifest();
      overlay.classList.add('hidden');
      this._resize();
      this.reset();
      this.state = 'playing';
      this.audio.play('bg_loop', { loop: true, volume: 0.35 });
    }

    _toMenu() {
      this.state = 'start';
      document.getElementById('overlay-pause').hidden = true;
      document.getElementById('overlay-gameover').hidden = true;
      this._show('screen-start');
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      document.getElementById('overlay-pause').hidden = false;
    }

    resume() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      document.getElementById('overlay-pause').hidden = true;
      this.lastTime = performance.now();
    }

    _loadBest() {
      const best = Number(localStorage.getItem('roadready_best') || 0);
      if (best > 0) {
        document.getElementById('best-score-line').hidden = false;
        document.getElementById('best-score-value').textContent = Math.round(best);
      }
    }

    _saveBest(score) {
      const best = Number(localStorage.getItem('roadready_best') || 0);
      if (score > best) localStorage.setItem('roadready_best', String(score));
    }

    /* ---- canvas sizing ---- */

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = Math.max(1, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(rect.width * this.dpr);
      this.canvas.height = Math.round(rect.height * this.dpr);
      this.viewW = rect.width;
      this.viewH = rect.height;
      this.roadW = Math.min(this.viewW * 0.62, 300);
      this.roadHalfW = this.roadW / 2;
      this.laneW = this.roadW / LANE_COUNT;
      this.baseCenterX = this.viewW / 2;
      this.playerRowY = this.viewH - 120;
      // How far the road's centreline is allowed to wander from the middle
      // of the screen, while still leaving room for buildings on both sides.
      this.curveAmp = Math.max(22, Math.min(85, (this.viewW - this.roadW) / 2 - 30));
    }

    /* ---- road path: a single function of distance, so every entity that
           reads it agrees on where the road is, with nothing to drift. ---- */

    roadCurve(d) {
      const a = this.curveAmp;
      return a * (
        0.55 * Math.sin(d * 0.0017) +
        0.30 * Math.sin(d * 0.0041 + 1.7) +
        0.15 * Math.sin(d * 0.0009 + 4.1)
      );
    }

    roadHeadingAt(d) {
      // Cheap numeric derivative of the curve — used to tilt cars slightly
      // and to know which way the road is bending.
      return (this.roadCurve(d + 30) - this.roadCurve(d - 30)) / 60;
    }

    distanceForY(y) { return this.scroll + (this.playerRowY - y); }
    yForDistance(d) { return this.playerRowY - (d - this.scroll); }

    roadCenterAtY(y) { return this.baseCenterX + this.roadCurve(this.distanceForY(y)); }
    roadCenterAtDistance(d) { return this.baseCenterX + this.roadCurve(d); }

    laneCenterAtY(y, lane) {
      return this.roadCenterAtY(y) - this.roadHalfW + this.laneW * (lane + 0.5);
    }

    /* ---- world state ---- */

    reset() {
      this.distance = 0;
      this.lives = 3;
      this.invuln = 0;
      this.speed = 0;           // px/s equivalent, drives scroll + score
      this.maxSpeed = 260;
      this.baseMaxSpeed = 260;
      this.speedLimit = 100;    // km/h-ish display number, cosmetic + zone logic
      this.playerX = this.baseCenterX;
      this.playerAngle = 0;
      this.offRoad = false;

      this.scroll = 0;          // total world distance travelled

      this.npcCars = [];
      this.pedestrians = [];
      this.signs = [];
      this.intersections = [];
      this.buildings = [];
      this.props = [];

      // Each "next...At" is a world distance threshold: once the visible
      // lookahead reaches it, we spawn something there and push it further out.
      this.nextCarAt = 500;
      this.nextIntersectionAt = 700;
      this.nextSignAt = 350;
      this.nextBuildingAt = 150;
      this.nextPropAt = 90;

      this.schoolZoneUntil = -1;
      this.flashMsg = null;
      this.flashTimer = 0;
    }

    /* ---- main loop ---- */

    _loop(now) {
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      if (this.state === 'playing') {
        this.update(dt);
      }
      if (this.state === 'playing' || this.state === 'paused') {
        this.render();
      }
      requestAnimationFrame(this._loop.bind(this));
    }

    update(dt) {
      const car = this.input;

      // Speed control
      if (car.accelerating) this.speed += 220 * dt;
      if (car.braking) this.speed -= 320 * dt;
      if (!car.accelerating && !car.braking) this.speed -= 60 * dt; // engine drag
      if (this.offRoad) this.speed -= 140 * dt; // extra drag off the asphalt
      this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));

      // Steering: free lateral movement, independent of the road's own curve.
      // Because the road bends under a fixed roadX and the player doesn't
      // auto-follow it, staying on the road through a bend takes real input.
      const steerSpeed = 230;
      this.playerX += car.steer * steerSpeed * dt * (0.4 + this.speed / this.maxSpeed);

      // Scroll world by speed — this is the ONLY thing that advances the
      // world. Every entity's screen position is derived from `scroll`
      // fresh each frame, so nothing can end up scrolling at a different
      // rate than the car actually moved.
      this.scroll += this.speed * dt;
      this.distance += this.speed * dt * 0.05;

      this._applyRoadBounds();

      // Gentle visual tilt: a blend of the road's own bend ahead and the
      // player's current steering input.
      const heading = this.roadHeadingAt(this.scroll + 60);
      const targetAngle = Math.max(-0.5, Math.min(0.5, heading * 1.4 + car.steer * 0.16));
      this.playerAngle += (targetAngle - this.playerAngle) * Math.min(1, dt * 8);

      if (this.invuln > 0) this.invuln -= dt;
      if (this.flashTimer > 0) { this.flashTimer -= dt; if (this.flashTimer <= 0) this.flashMsg = null; }

      this._spawnLogic();
      this._updateIntersections(dt);
      this._updatePedestrians(dt);
      this._updateNpcCars(dt);
      this._pruneEntities();
      this._checkCollisions();
      this._checkZoneSigns();
      this._updateHud();
    }

    _applyRoadBounds() {
      const cx = this.roadCenterAtY(this.playerRowY);
      const leftEdge = cx - this.roadHalfW;
      const rightEdge = cx + this.roadHalfW;
      const margin = CAR_W * 0.55;
      const hardOverrun = 22;

      if (this.playerX < leftEdge - hardOverrun) {
        this.playerX = leftEdge - hardOverrun;
        this._roadHit();
      } else if (this.playerX > rightEdge + hardOverrun) {
        this.playerX = rightEdge + hardOverrun;
        this._roadHit();
      } else if (this.playerX < leftEdge + margin || this.playerX > rightEdge - margin) {
        this.offRoad = true;
        this._flash('Steer back onto the road!');
      } else {
        this.offRoad = false;
      }
    }

    _roadHit() {
      if (this.invuln > 0) return;
      this._hit('collision', 'You ran off the road.');
    }

    /* ---- spawning: world-distance thresholds, checked against how far
           ahead the player can currently see. ---- */

    _nearIntersection(worldPos, pad = 130) {
      return this.intersections.some(i => Math.abs(i.worldPos - worldPos) < i.crossHalf + pad);
    }

    _spawnLogic() {
      const carLookahead = this.scroll + this.playerRowY + 160;
      const signLookahead = this.scroll + this.playerRowY + 40;
      const buildingLookahead = this.scroll + this.playerRowY + 120;
      const propLookahead = this.scroll + this.playerRowY + 100;
      const intersectionLookahead = this.scroll + this.playerRowY + 60;

      if (carLookahead > this.nextCarAt) {
        const lane = Math.floor(Math.random() * LANE_COUNT);
        const colorKeys = ['car_red', 'car_blue', 'car_white'];
        const idx = Math.floor(Math.random() * 3);
        this.npcCars.push({
          worldPos: this.nextCarAt,
          lane,
          speed: 130 + Math.random() * 110,
          colorKey: colorKeys[idx],
          color: ['#d64545', '#3d6fd6', '#eeeeee'][idx]
        });
        this.nextCarAt += 260 + Math.random() * 260;
      }

      if (intersectionLookahead > this.nextIntersectionAt) {
        this.intersections.push({
          worldPos: this.nextIntersectionAt,
          crossHalf: 46,
          light: { state: 'green', timer: 3 + Math.random() * 2 },
          spawnedPed: false,
          crossed: false
        });
        this.nextIntersectionAt += 950 + Math.random() * 450;
      }

      if (signLookahead > this.nextSignAt) {
        if (!this._nearIntersection(this.nextSignAt, 60)) {
          const kinds = ['school', 'speed', 'giveway', 'roundabout'];
          const kind = kinds[Math.floor(Math.random() * kinds.length)];
          this.signs.push({ worldPos: this.nextSignAt, kind, side: Math.random() < 0.5 ? -1 : 1, triggered: false });
        }
        this.nextSignAt += 500 + Math.random() * 300;
      }

      if (buildingLookahead > this.nextBuildingAt) {
        if (this._nearIntersection(this.nextBuildingAt)) {
          this.nextBuildingAt += 140;
        } else {
          const roll = Math.random();
          const side = Math.random() < 0.5 ? -1 : 1;
          let kind, w, h, palette;
          if (roll < 0.45) {
            kind = 'house'; w = 76 + Math.random() * 30; h = 78 + Math.random() * 26;
            palette = HOUSE_PALETTES[Math.floor(Math.random() * HOUSE_PALETTES.length)];
          } else if (roll < 0.66) {
            kind = 'shop'; w = 96 + Math.random() * 26; h = 84 + Math.random() * 18;
            palette = SHOP_PALETTES[Math.floor(Math.random() * SHOP_PALETTES.length)];
          } else if (roll < 0.86) {
            kind = 'apartment'; w = 92 + Math.random() * 20; h = 150 + Math.random() * 70;
            palette = APT_PALETTES[Math.floor(Math.random() * APT_PALETTES.length)];
          } else {
            kind = 'park'; w = 110 + Math.random() * 40; h = 100 + Math.random() * 30;
            palette = null;
          }
          this.buildings.push({
            worldPos: this.nextBuildingAt, side, kind, w, h, palette,
            setback: 20 + Math.random() * 20
          });
          this.nextBuildingAt += 100 + Math.random() * 90;
        }
      }

      if (propLookahead > this.nextPropAt) {
        if (!this._nearIntersection(this.nextPropAt, 70)) {
          const kind = Math.random() < 0.6 ? 'tree' : 'lamp';
          this.props.push({ worldPos: this.nextPropAt, side: Math.random() < 0.5 ? -1 : 1, kind });
        }
        this.nextPropAt += 70 + Math.random() * 90;
      }
    }

    _updateIntersections(dt) {
      this.intersections.forEach(i => {
        i.light.timer -= dt;
        if (i.light.timer <= 0) {
          if (i.light.state === 'green') { i.light.state = 'amber'; i.light.timer = 1.2; }
          else if (i.light.state === 'amber') {
            i.light.state = 'red'; i.light.timer = 2.6;
            this._spawnPedestrianFor(i);
          } else { i.light.state = 'green'; i.light.timer = 3.5; }
          const y = this.yForDistance(i.worldPos);
          if (y > -100 && y < this.viewH + 100) this.audio.play('light_tick', { volume: 0.5 });
        }
      });
    }

    _updatePedestrians(dt) {
      this.pedestrians.forEach(p => {
        p.localX += p.dir * 40 * dt;
        p.phase += dt;
      });
    }

    _updateNpcCars(dt) {
      this.npcCars.forEach(c => { c.worldPos += c.speed * dt; });
    }

    _pruneEntities() {
      const behind = this.playerRowY + 260;
      const ahead = -600;
      const yOf = (worldPos) => this.yForDistance(worldPos);

      this.npcCars = this.npcCars.filter(c => { const y = yOf(c.worldPos); return y < behind && y > ahead; });
      this.signs = this.signs.filter(s => yOf(s.worldPos) < behind);
      this.buildings = this.buildings.filter(b => yOf(b.worldPos) < behind);
      this.props = this.props.filter(p => yOf(p.worldPos) < behind);
      this.intersections = this.intersections.filter(i => yOf(i.worldPos) < behind + 200);
      this.pedestrians = this.pedestrians.filter(p => {
        const y = yOf(p.worldPos);
        return y < this.viewH + 60 && Math.abs(p.localX) < this.roadHalfW + 40;
      });
    }

    _checkZoneSigns() {
      this.signs.forEach(s => {
        if (s.triggered) return;
        const y = this.yForDistance(s.worldPos);
        if (Math.abs(y - this.playerRowY) > 12) return;
        s.triggered = true;
        if (s.kind === 'school') {
          this.maxSpeed = this.baseMaxSpeed * 0.55;
          this.speedLimit = 40;
          this.schoolZoneUntil = this.scroll + 500;
          this._flash('School zone — slow down');
        } else if (s.kind === 'speed') {
          this.speedLimit = 50;
          this.maxSpeed = this.baseMaxSpeed * 0.75;
        } else if (s.kind === 'giveway') {
          this._flash('Give way ahead');
        } else if (s.kind === 'roundabout') {
          this._flash('Roundabout ahead — slow & check right');
        }
      });
      if (this.schoolZoneUntil > 0 && this.scroll > this.schoolZoneUntil) {
        this.maxSpeed = this.baseMaxSpeed;
        this.speedLimit = 100;
        this.schoolZoneUntil = -1;
      }
    }

    _spawnPedestrianFor(intersection) {
      const fromLeft = Math.random() < 0.5;
      this.pedestrians.push({
        worldPos: intersection.worldPos - intersection.crossHalf,
        localX: fromLeft ? -(this.roadHalfW + 18) : (this.roadHalfW + 18),
        dir: fromLeft ? 1 : -1,
        phase: Math.random() * 10
      });
      this.audio.play('ped_alert', { volume: 0.6 });
    }

    _flash(msg) { this.flashMsg = msg; this.flashTimer = 1.6; }

    _checkCollisions() {
      const py = this.playerRowY;

      if (this.invuln <= 0) {
        // vs NPC cars
        for (const c of this.npcCars) {
          const y = this.yForDistance(c.worldPos);
          if (Math.abs(y - py) < CAR_H * 0.75) {
            const x = this.laneCenterAtY(y, c.lane);
            if (Math.abs(x - this.playerX) < CAR_W * 0.8) {
              this._hit('collision', 'You collided with another car.');
              return;
            }
          }
        }
        // vs pedestrians
        for (const p of this.pedestrians) {
          const y = this.yForDistance(p.worldPos);
          if (Math.abs(y - py) < 26) {
            const x = this.roadCenterAtY(y) + p.localX;
            if (Math.abs(x - this.playerX) < CAR_W * 0.6) {
              this._hit('collision', 'A pedestrian stepped out — always give way at crossings.');
              return;
            }
          }
        }
      }

      // running a red/amber light — triggers once, exactly when the stop
      // line is crossed, regardless of frame rate or speed.
      for (const i of this.intersections) {
        const stopLineAt = i.worldPos - i.crossHalf - 6;
        if (!i.crossed && this.scroll >= stopLineAt) {
          i.crossed = true;
          if (i.light.state !== 'green' && this.speed > 20) {
            this._hit('brake', 'You went through a red light.');
            return;
          }
        }
      }
    }

    _hit(sfxKey, reason) {
      this.audio.play(sfxKey, { volume: 0.9 });
      this.lives -= 1;
      this.invuln = 1.6;
      this.speed *= 0.3;
      if (this.lives <= 0) {
        this._gameOver(reason);
      } else {
        this._flash(reason);
      }
    }

    _gameOver(reason) {
      this.state = 'gameover';
      this._saveBest(this.distance);
      document.getElementById('gameover-reason').textContent = reason || 'Run ended.';
      document.getElementById('final-score').textContent = Math.round(this.distance);
      document.getElementById('overlay-gameover').hidden = false;
      this._loadBest();
    }

    _updateHud() {
      document.getElementById('hud-score').textContent = `Distance: ${Math.round(this.distance)} m`;
      document.getElementById('hud-speed').textContent = `Speed: ${Math.round(this.speed / 2)} km/h (limit ${this.speedLimit})`;
      document.getElementById('hud-lives').textContent = 'Lives: ' + '❤️'.repeat(Math.max(0, this.lives));
    }

    /* ---- rendering ---- */

    render() {
      const ctx = this.ctx;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.clearRect(0, 0, this.viewW, this.viewH);

      this._drawGround(ctx);
      this._drawIntersectionBands(ctx);
      this._drawRoad(ctx);
      this._drawCrosswalksAndStopLines(ctx);

      // world-fixed scenery, back to front by distance so nearer ones overlap
      const scenery = [...this.buildings, ...this.props]
        .sort((a, b) => a.worldPos - b.worldPos);
      scenery.forEach(item => {
        if (item.kind === 'tree' || item.kind === 'lamp') this._drawProp(ctx, item);
        else this._drawBuilding(ctx, item);
      });

      this.signs.forEach(s => this._drawSign(ctx, s));
      this.intersections.forEach(i => this._drawLightForIntersection(ctx, i));
      this.pedestrians.forEach(p => {
        const y = this.yForDistance(p.worldPos);
        const x = this.roadCenterAtY(y) + p.localX;
        drawPedestrianShape(ctx, x, y, p.phase);
      });
      this.npcCars.forEach(c => this._drawNpcCar(ctx, c));
      this._drawPlayer(ctx);

      if (this.flashMsg) this._drawFlash(ctx, this.flashMsg);
      ctx.restore();
    }

    _drawGround(ctx) {
      ctx.fillStyle = '#3f6b45';
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    _drawIntersectionBands(ctx) {
      ctx.fillStyle = '#35383e';
      this.intersections.forEach(i => {
        const y0 = this.yForDistance(i.worldPos);
        if (y0 < -i.crossHalf - 20 || y0 > this.viewH + i.crossHalf + 20) return;
        ctx.fillRect(0, y0 - i.crossHalf, this.viewW, i.crossHalf * 2);
        // faint centreline through the cross street for readability
        ctx.save();
        ctx.strokeStyle = 'rgba(244,196,48,0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 12]);
        ctx.beginPath();
        ctx.moveTo(0, y0); ctx.lineTo(this.viewW, y0);
        ctx.stroke();
        ctx.restore();
      });
    }

    _roadEdgePoints() {
      const step = 12;
      const left = [], right = [], centers = [];
      for (let y = -step; y <= this.viewH + step; y += step) {
        const cx = this.roadCenterAtY(y);
        left.push({ x: cx - this.roadHalfW, y });
        right.push({ x: cx + this.roadHalfW, y });
        centers.push({ x: cx, y });
      }
      return { left, right, centers };
    }

    _drawRoad(ctx) {
      const { left, right, centers } = this._roadEdgePoints();

      // sidewalk (a little wider than the road, same curve)
      ctx.fillStyle = '#a39c8f';
      ctx.beginPath();
      ctx.moveTo(left[0].x - 16, left[0].y);
      left.forEach(p => ctx.lineTo(p.x - 16, p.y));
      for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k].x + 16, right[k].y);
      ctx.closePath();
      ctx.fill();

      // asphalt
      ctx.fillStyle = '#35383e';
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      left.forEach(p => ctx.lineTo(p.x, p.y));
      for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(right[k].x, right[k].y);
      ctx.closePath();
      ctx.fill();

      // road edges
      ctx.strokeStyle = '#FBF7EE';
      ctx.lineWidth = 3;
      ctx.beginPath();
      left.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      ctx.beginPath();
      right.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();

      // lane markings — dash phase comes straight from scroll, so it can
      // never drift out of sync with how far the car has actually moved.
      ctx.strokeStyle = '#F4C430';
      ctx.lineWidth = 4;
      ctx.setLineDash([26, 22]);
      ctx.lineDashOffset = -this.scroll;
      for (let lane = 1; lane < LANE_COUNT; lane++) {
        ctx.beginPath();
        for (let idx = 0; idx < centers.length; idx++) {
          const p = centers[idx];
          const x = p.x - this.roadHalfW + this.laneW * lane;
          idx === 0 ? ctx.moveTo(x, p.y) : ctx.lineTo(x, p.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    _drawCrosswalksAndStopLines(ctx) {
      this.intersections.forEach(i => {
        const yNear = this.yForDistance(i.worldPos - i.crossHalf);
        const yFar = this.yForDistance(i.worldPos + i.crossHalf);
        [yNear, yFar].forEach(y => {
          if (y < -30 || y > this.viewH + 30) return;
          const cx = this.roadCenterAtY(y);
          drawCrosswalkStripes(ctx, cx - this.roadHalfW, cx + this.roadHalfW, y, 16);
        });
        // stop line just before the near-side crosswalk
        if (yNear > -30 && yNear < this.viewH + 30) {
          const cx = this.roadCenterAtY(yNear + 14);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(cx - this.roadHalfW + 4, yNear + 14);
          ctx.lineTo(cx + this.roadHalfW - 4, yNear + 14);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    _drawBuilding(ctx, b) {
      const y = this.yForDistance(b.worldPos);
      if (y < -150 || y > this.viewH + 150) return;
      const cx = this.roadCenterAtY(y);
      const x = cx + b.side * (this.roadHalfW + b.setback + b.w / 2);
      const imgKey = b.kind === 'house' ? (b.worldPos % 2 < 1 ? 'house_01' : 'house_02')
        : b.kind === 'shop' ? 'shop_01'
        : b.kind === 'apartment' ? (b.side < 0 ? 'building_01' : 'building_02')
        : null;
      const img = imgKey ? this.assets.getImage(imgKey) : null;
      if (img) {
        ctx.drawImage(img, x - b.w / 2, y - b.h, b.w, b.h);
        return;
      }
      const py = y - b.h / 2 + 10; // shapes are drawn around their own centre
      if (b.kind === 'house') drawHouseShape(ctx, x, py, b.w, b.h, b.palette);
      else if (b.kind === 'shop') drawShopShape(ctx, x, py, b.w, b.h, b.palette);
      else if (b.kind === 'apartment') drawApartmentShape(ctx, x, py, b.w, b.h, b.palette);
      else drawParkShape(ctx, x, py, b.w, b.h);
    }

    _drawProp(ctx, p) {
      const y = this.yForDistance(p.worldPos);
      if (y < -60 || y > this.viewH + 60) return;
      const cx = this.roadCenterAtY(y);
      const x = cx + p.side * (this.roadHalfW + (p.kind === 'lamp' ? 10 : 32));
      if (p.kind === 'tree') drawTreeShape(ctx, x, y, 20);
      else drawLampShape(ctx, x, y);
    }

    _drawSign(ctx, s) {
      const y = this.yForDistance(s.worldPos);
      if (y < -60 || y > this.viewH + 60) return;
      const cx = this.roadCenterAtY(y);
      const x = cx + s.side * (this.roadHalfW + 26);
      const img = this.assets.getImage(`sign_${s.kind === 'speed' ? 'speed50' : s.kind === 'school' ? 'school40' : s.kind}`);
      if (img) {
        ctx.drawImage(img, x - 24, y - 48, 48, 48);
      } else {
        const label = s.kind === 'school' ? '40' : s.kind === 'speed' ? '50' : '';
        drawSignShape(ctx, x, y, label, s.kind);
      }
    }

    _drawLightForIntersection(ctx, i) {
      const y0 = this.yForDistance(i.worldPos - i.crossHalf - 30);
      if (y0 < -100 || y0 > this.viewH + 100) return;
      const cx = this.roadCenterAtY(y0);
      const x = cx + this.roadHalfW + 26;
      const img = this.assets.getImage('traffic_light');
      if (img) ctx.drawImage(img, x - 32, y0 - 80, 64, 80);
      else drawTrafficLightShape(ctx, x, y0, i.light.state);
    }

    _drawNpcCar(ctx, c) {
      const y = this.yForDistance(c.worldPos);
      if (y < -120 || y > this.viewH + 200) return;
      const x = this.laneCenterAtY(y, c.lane);
      const angle = this.roadHeadingAt(c.worldPos) * 1.2;
      const img = this.assets.getImage(c.colorKey);
      if (img) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.drawImage(img, -CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H);
        ctx.restore();
      } else {
        drawCarShape(ctx, x, y, CAR_W, CAR_H, c.color, angle);
      }
    }

    _drawPlayer(ctx) {
      const y = this.playerRowY;
      const flashing = this.invuln > 0 && Math.floor(this.invuln * 10) % 2 === 0;
      ctx.save();
      if (flashing) ctx.globalAlpha = 0.4;
      const img = this.assets.getImage('car_player');
      if (img) {
        ctx.translate(this.playerX, y);
        ctx.rotate(this.playerAngle);
        ctx.drawImage(img, -CAR_W / 2, -CAR_H / 2, CAR_W, CAR_H);
      } else {
        drawCarShape(ctx, this.playerX, y, CAR_W, CAR_H, '#3EA66D', this.playerAngle);
      }
      ctx.restore();
    }

    _drawFlash(ctx, msg) {
      ctx.save();
      ctx.font = 'bold 15px Baloo 2, sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(msg).width + 28;
      ctx.fillStyle = 'rgba(28,30,34,0.85)';
      roundRect(ctx, this.viewW / 2 - w / 2, 64, w, 34, 10);
      ctx.fill();
      ctx.fillStyle = '#F4C430';
      ctx.fillText(msg, this.viewW / 2, 87);
      ctx.restore();
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    new Game();
  });
})();
