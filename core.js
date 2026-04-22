// ── CONSTANTS & CONFIG ──
const CONFIG = {
  MAP_W: 3000,
  MAP_H: 3000,
  PLAYER_SPEED: 320,
  PLAYER_RADIUS: 16,
  PLAYER_HP: 100,
  PLAYER_IFRAMES: 0.8,
  BULLET_SPEED: 600,
  BULLET_RADIUS: 4,
  BULLET_LIFETIME: 1.2,
  FIRE_RATE: 0.15,
  MAX_AMMO: 200,
  START_AMMO: 50,
  ZOMBIE_RADIUS: 14,
  ZOMBIE_BASE_SPEED: 60,
  ZOMBIE_BASE_HP: 1,
  ZOMBIE_DAMAGE: 15,
  ZOMBIE_SEPARATION: 28,
  SPAWN_BASE_RATE: 1.2,
  SPAWN_MARGIN: 80,
  MAX_ZOMBIES: 180,
  MAX_BULLETS: 100,
  MAX_DROPS: 40,
  DROP_CHANCE: 1.0,
  DROP_AMMO_AMT: 20,
  DROP_RADIUS: 8,
  DROP_LIFETIME: 12,
  SCALE_INTERVAL: 30,
  GRID_CELL: 80,
  STONE_COUNT: 40,
  STONE_MIN_SIZE: 30,
  STONE_MAX_SIZE: 70,
};

// ── UTILITY ──
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rng(lo, hi) { return lo + Math.random() * (hi - lo); }

// ── OBJECT POOL ──
class Pool {
  constructor(factory, reset, max) {
    this.items = [];
    this.active = 0;
    this.factory = factory;
    this.resetFn = reset;
    this.max = max;
    for (let i = 0; i < max; i++) this.items.push(factory());
  }
  spawn(...args) {
    if (this.active >= this.max) return null;
    const obj = this.items[this.active];
    this.resetFn(obj, ...args);
    obj.alive = true;
    this.active++;
    return obj;
  }
  kill(index) {
    this.active--;
    const temp = this.items[index];
    this.items[index] = this.items[this.active];
    this.items[this.active] = temp;
  }
  forEach(fn) {
    for (let i = this.active - 1; i >= 0; i--) {
      if (fn(this.items[i], i) === false) this.kill(i);
    }
  }
  clear() { this.active = 0; }
}

// ── SPATIAL GRID ──
class SpatialGrid {
  constructor(cellSize, w, h) {
    this.cell = cellSize;
    this.cols = Math.ceil(w / cellSize);
    this.rows = Math.ceil(h / cellSize);
    this.grid = new Array(this.cols * this.rows);
    this.clear();
  }
  clear() { for (let i = 0; i < this.grid.length; i++) this.grid[i] = []; }
  _key(x, y) {
    const c = clamp(Math.floor(x / this.cell), 0, this.cols - 1);
    const r = clamp(Math.floor(y / this.cell), 0, this.rows - 1);
    return r * this.cols + c;
  }
  insert(obj) { this.grid[this._key(obj.x, obj.y)].push(obj); }
  query(x, y, radius) {
    const results = [];
    const c0 = clamp(Math.floor((x - radius) / this.cell), 0, this.cols - 1);
    const c1 = clamp(Math.floor((x + radius) / this.cell), 0, this.cols - 1);
    const r0 = clamp(Math.floor((y - radius) / this.cell), 0, this.rows - 1);
    const r1 = clamp(Math.floor((y + radius) / this.cell), 0, this.rows - 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const bucket = this.grid[r * this.cols + c];
        for (let i = 0; i < bucket.length; i++) results.push(bucket[i]);
      }
    return results;
  }
}

// ── INPUT MANAGER ──
class Input {
  constructor(canvas) {
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false };
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    canvas.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.mouse.down = true; });
    canvas.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  moveVec() {
    let mx = 0, my = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) my = -1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) my = 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx = 1;
    const len = Math.sqrt(mx * mx + my * my);
    if (len > 0) { mx /= len; my /= len; }
    return { x: mx, y: my };
  }
  shooting() { return this.mouse.down || this.keys['Space']; }
}

// ── PARTICLES (lightweight) ──
const particles = [];
const MAX_PARTICLES = 200;

function spawnParticles(x, y, color, count, speed, life) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    const angle = Math.random() * Math.PI * 2;
    const spd = rng(speed * 0.3, speed);
    particles.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, life, maxLife: life, color, r: rng(2, 5) });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles(ctx, camX, camY) {
  for (const p of particles) {
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - camX, p.y - camY, p.r * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
