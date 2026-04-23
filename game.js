// ══════════════════════════════════════════
//  DEAD ZONE — Modular Game Engine
// ══════════════════════════════════════════

// ── DEPLOYMENT CONFIG ──
// If hosting frontend (Vercel) and backend (Render) separately, put the backend URL here.
// Example: const SERVER_URL = 'https://dead-zone-server.onrender.com';
// If hosting everything together on one server, leave as empty string ''.
const SERVER_URL = '';

// ── DOM & GLOBALS ──
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const screenMenu = document.getElementById('screen-menu');
const screenGameover = document.getElementById('screen-gameover');
const hud = document.getElementById('hud');
const pauseOverlay = document.getElementById('pause-overlay');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

const input = new Input(canvas);

// ── IMAGE LOADING ──
const imgPlayer = new Image(); imgPlayer.src = 'Dan_the_man.webp';
const imgZombie = new Image();
const zombieCanvas = document.createElement('canvas');
imgZombie.onload = () => {
  zombieCanvas.width = imgZombie.naturalWidth;
  zombieCanvas.height = imgZombie.naturalHeight;
  const zCtx = zombieCanvas.getContext('2d', { willReadFrequently: true });
  zCtx.drawImage(imgZombie, 0, 0);
  const imgData = zCtx.getImageData(0, 0, zombieCanvas.width, zombieCanvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 230 && data[i+1] > 230 && data[i+2] > 230) {
      data[i+3] = 0;
    }
  }
  zCtx.putImageData(imgData, 0, 0);
};
imgZombie.src = 'OIP.webp';

// ── HEALING & ORB CONFIG ──
const HEAL_INTERVAL = 1;
const HEAL_AMOUNT = 10;
const ORB_KILL_THRESHOLD = 50;
const ORB_DURATION = 10;
const ORB_RADIUS = 10;
const ORB_ORBIT_DIST = 70;
const ORB_SPEED = 18;

// ── UTILS ──
function pushOutOfStones(obj, radius, stones) {
  for (const s of stones) {
    const dx = obj.x - s.x, dy = obj.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const minDist = radius + s.size * 0.45;
    if (d < minDist) {
      const push = minDist - d;
      obj.x += (dx / d) * push;
      obj.y += (dy / d) * push;
    }
  }
}

// ══════════════════════════════════════════
//  CLASSES
// ══════════════════════════════════════════

class Player {
  constructor() {
    this.x = CONFIG.MAP_W / 2;
    this.y = CONFIG.MAP_H / 2;
    this.hp = CONFIG.PLAYER_HP;
    this.maxHp = CONFIG.PLAYER_HP;
    this.ammo = CONFIG.START_AMMO;
    this.maxAmmo = CONFIG.MAX_AMMO;
    this.angle = 0;
    this.fireCooldown = 0;
    this.iframeCooldown = 0;
    this.hitFlash = 0;
  }

  // Pure logic update
  update(dt, gameManager) {
    if (this.hp <= 0) return;
    // Movement
    const mv = input.moveVec();
    this.x += mv.x * CONFIG.PLAYER_SPEED * dt;
    this.y += mv.y * CONFIG.PLAYER_SPEED * dt;
    this.x = clamp(this.x, CONFIG.PLAYER_RADIUS, CONFIG.MAP_W - CONFIG.PLAYER_RADIUS);
    this.y = clamp(this.y, CONFIG.PLAYER_RADIUS, CONFIG.MAP_H - CONFIG.PLAYER_RADIUS);
    pushOutOfStones(this, CONFIG.PLAYER_RADIUS, gameManager.stones);

    // Aiming
    const spx = this.x - gameManager.camX;
    const spy = this.y - gameManager.camY;
    this.angle = Math.atan2(input.mouse.y - spy, input.mouse.x - spx);

    // Timers
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.iframeCooldown = Math.max(0, this.iframeCooldown - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    // Shooting
    if (input.shooting() && this.fireCooldown <= 0 && this.ammo > 0) {
      this.fireCooldown = CONFIG.FIRE_RATE;
      this.ammo--;
      const bvx = Math.cos(this.angle) * CONFIG.BULLET_SPEED;
      const bvy = Math.sin(this.angle) * CONFIG.BULLET_SPEED;
      gameManager.bullets.spawn(this.x, this.y, bvx, bvy);
      spawnParticles(this.x + Math.cos(this.angle) * 20, this.y + Math.sin(this.angle) * 20, '#ffcc44', 3, 80, 0.2);

      // Sync the bullet with other players
      if (gameManager.socket) {
        gameManager.socket.emit('shoot', { x: this.x, y: this.y, vx: bvx, vy: bvy, angle: this.angle });
      }
    }

    // Emit local position to the server continuously
    if (gameManager.socket) {
      gameManager.socket.emit('move', { x: this.x, y: this.y });
    }
  }

  // Pure rendering
  render(ctx, camX, camY) {
    if (this.hp <= 0) return;
    const px = this.x - camX, py = this.y - camY;
    if (this.iframeCooldown > 0 && Math.floor(this.iframeCooldown * 10) % 2 === 0) {
      ctx.globalAlpha = 0.4;
    }

    ctx.save();
    ctx.translate(px, py);

    // Hit flash glow
    if (this.hitFlash > 0) {
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 20;
      ctx.fillStyle = 'rgba(255,68,68,0.3)';
      ctx.beginPath(); ctx.arc(0, 0, CONFIG.PLAYER_RADIUS + 4, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Flip based on aim direction
    const facingLeft = Math.abs(this.angle) > Math.PI / 2;
    if (facingLeft) ctx.scale(-1, 1);

    const pSize = CONFIG.PLAYER_RADIUS * 3;
    if (imgPlayer.complete && imgPlayer.naturalWidth > 0) {
      ctx.drawImage(imgPlayer, -pSize / 2, -pSize / 2, pSize, pSize);
    } else {
      ctx.fillStyle = '#44aaff';
      ctx.beginPath(); ctx.arc(0, 0, CONFIG.PLAYER_RADIUS, 0, Math.PI * 2); ctx.fill();
    }

    if (this.invincible) {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, CONFIG.PLAYER_RADIUS + 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Aim arrow
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.angle);
    const arrowDist = CONFIG.PLAYER_RADIUS + 14;
    const arrowSize = 8;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(arrowDist + arrowSize, 0);
    ctx.lineTo(arrowDist - arrowSize * 0.4, -arrowSize * 0.7);
    ctx.lineTo(arrowDist - arrowSize * 0.4, arrowSize * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.globalAlpha = 1;
  }
}

class Bullet {
  constructor() {
    this.alive = false;
  }

  init(x, y, vx, vy) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = CONFIG.BULLET_LIFETIME;
  }

  update(dt, gameManager) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    
    // Bounds check
    if (this.life <= 0 || this.x < -50 || this.x > CONFIG.MAP_W + 50 || this.y < -50 || this.y > CONFIG.MAP_H + 50) {
      return false; // Tells pool to kill this bullet
    }
    
    // Stone collision check
    for (const s of gameManager.stones) {
      if (dist(this, s) < CONFIG.BULLET_RADIUS + s.size * 0.4) {
        spawnParticles(this.x, this.y, '#999966', 3, 60, 0.2);
        return false;
      }
    }

    // Zombie collision check
    for (const id in gameManager.remoteZombies) {
      const z = gameManager.remoteZombies[id];
      const zRadius = z.type === 2 ? CONFIG.ZOMBIE_RADIUS + 6 : z.type === 1 ? CONFIG.ZOMBIE_RADIUS - 2 : CONFIG.ZOMBIE_RADIUS;
      if (dist(this, z) < CONFIG.BULLET_RADIUS + zRadius) {
        spawnParticles(this.x, this.y, '#ff4444', 3, 60, 0.2);
        return false;
      }
    }

    return true;
  }

  render(ctx, camX, camY) {
    const sx = this.x - camX, sy = this.y - camY;
    if (sx < -10 || sx > canvas.width + 10 || sy < -10 || sy > canvas.height + 10) return;
    ctx.beginPath(); ctx.arc(sx, sy, CONFIG.BULLET_RADIUS, 0, Math.PI * 2); ctx.fill();
  }
}

class OtherPlayer {
  constructor(id, x, y) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
    this.targetX = x;
    this.targetY = y;
    this.lerpProgress = 1;
    this.isDead = false;
  }

  update(dt) {
    // Time-Based Linear Interpolation
    // Server sends updates every 50ms (20 tick rate).
    // We interpolate over 100ms (0.1s) to add a small buffer against network jitter.
    if (this.lerpProgress < 1) {
      this.lerpProgress += dt / 0.1;
      this.lerpProgress = Math.min(this.lerpProgress, 1.0);
      this.x = lerp(this.startX, this.targetX, this.lerpProgress);
      this.y = lerp(this.startY, this.targetY, this.lerpProgress);
    }
  }

  render(ctx, camX, camY) {
    if (this.isDead) return;
    const px = this.x - camX, py = this.y - camY;
    if (px < -50 || px > canvas.width + 50 || py < -50 || py > canvas.height + 50) return;

    ctx.save();
    ctx.translate(px, py);
    
    // Draw remote player (slightly transparent/different color to distinguish)
    ctx.globalAlpha = 0.8;
    const pSize = CONFIG.PLAYER_RADIUS * 3;
    if (imgPlayer.complete && imgPlayer.naturalWidth > 0) {
      // For simplicity, remote players face left or right based on movement direction
      const facingLeft = this.targetX < this.x;
      if (facingLeft) ctx.scale(-1, 1);
      ctx.drawImage(imgPlayer, -pSize / 2, -pSize / 2, pSize, pSize);
    } else {
      ctx.fillStyle = '#ffaa44';
      ctx.beginPath(); ctx.arc(0, 0, CONFIG.PLAYER_RADIUS, 0, Math.PI * 2); ctx.fill();
    }
    
    ctx.restore();

    // Name tag
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.name || 'Player ' + this.id.substring(0, 4)}`, px, py - 25);
  }
}

class RemoteZombie {
  constructor(id, data) {
    this.id = id;
    this.updateData(data);
    this.x = data.x;
    this.y = data.y;
    this.startX = data.x;
    this.startY = data.y;
    this.lerpProgress = 1;
    this.flash = 0;
  }
  updateData(data) {
    this.hp = data.hp;
    this.maxHp = data.maxHp;
    this.type = data.type;
    this.speed = data.speed;
    this.targetX = data.x;
    this.targetY = data.y;
    this.startX = this.x;
    this.startY = this.y;
    this.lerpProgress = 0;
  }
  update(dt) {
    if (this.lerpProgress < 1) {
      this.lerpProgress += dt / 0.1;
      this.lerpProgress = Math.min(this.lerpProgress, 1.0);
      this.x = lerp(this.startX, this.targetX, this.lerpProgress);
      this.y = lerp(this.startY, this.targetY, this.lerpProgress);
    }
    this.flash = Math.max(0, this.flash - dt);
  }

  render(ctx, camX, camY, player) {
    const sx = this.x - camX, sy = this.y - camY;
    if (sx < -40 || sx > canvas.width + 40 || sy < -40 || sy > canvas.height + 40) return;

    const r = this.type === 2 ? CONFIG.ZOMBIE_RADIUS + 6 : this.type === 1 ? CONFIG.ZOMBIE_RADIUS - 2 : CONFIG.ZOMBIE_RADIUS;
    const drawSize = r * 2.8;

    ctx.save();
    ctx.translate(sx, sy);

    if (this.flash > 0) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    const facingLeft = player.x < this.x;
    if (facingLeft) ctx.scale(-1, 1);

    if (imgZombie.complete && imgZombie.naturalWidth > 0) {
      ctx.drawImage(zombieCanvas, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    } else {
      ctx.fillStyle = this.type === 2 ? '#338833' : this.type === 1 ? '#dd8822' : '#882222';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // HP bar for tanks
    if (this.type === 2 && this.hp < this.maxHp) {
      const bw = r * 2.5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx - bw / 2, sy - r - 10, bw, 4);
      ctx.fillStyle = '#44ff44';
      ctx.fillRect(sx - bw / 2, sy - r - 10, bw * (this.hp / this.maxHp), 4);
    }
  }
}

class GameManager {
  constructor() {
    this.state = 'menu';
    this.player = new Player();
    
    this.bullets = new Pool(() => new Bullet(), (b, x, y, vx, vy) => b.init(x, y, vx, vy), CONFIG.MAX_BULLETS);
    
    this.remoteDrops = {};
    
    this.grid = new SpatialGrid(CONFIG.GRID_CELL, CONFIG.MAP_W, CONFIG.MAP_H);
    this.stones = [];
    
    this.remotePlayers = {};
    this.remoteZombies = {};
    
    // Initialize networking
    if (typeof io !== 'undefined') {
      this.socket = SERVER_URL ? io(SERVER_URL) : io();
      this.setupNetworking();
    }
    
    this.reset();
  }

  setupNetworking() {
    this.socket.on('teamGameOver', () => {
      this.triggerTeamGameOver();
    });

    this.socket.on('stateUpdate', (serverData) => {
      const serverPlayers = serverData.players || serverData;
      const serverZombies = serverData.zombies || {};
      this.remoteDrops = serverData.drops || {};
      this.remoteDrops = serverData.drops || {};
      
      if (serverData.gameTime !== undefined) {
          this.gameTime = serverData.gameTime;
          this.wave = Math.floor(this.gameTime / CONFIG.SCALE_INTERVAL) + 1;
      }

      for (const id in serverPlayers) {
        if (id === this.socket.id) {
          this.player.invincible = serverPlayers[id].invincible;
          continue;
        }
        const p = serverPlayers[id];
        if (!p.inGame) {
          if (this.remotePlayers[id]) delete this.remotePlayers[id];
          continue;
        }
        if (!this.remotePlayers[id]) {
          this.remotePlayers[id] = new OtherPlayer(id, p.x, p.y);
          this.remotePlayers[id].name = p.name;
          this.remotePlayers[id].isDead = p.isDead;
        } else {
          const rp = this.remotePlayers[id];
          rp.startX = rp.x;
          rp.startY = rp.y;
          rp.targetX = p.x;
          rp.targetY = p.y;
          rp.lerpProgress = 0;
          rp.name = p.name;
          rp.invincible = p.invincible;
          rp.isDead = p.isDead;
        }
      }
      for (const id in this.remotePlayers) {
        if (!serverPlayers[id]) { delete this.remotePlayers[id]; }
      }

      // Update Lobby UI
      const lobbyHtml = Object.values(serverPlayers).map(p => `<div>${p.name || 'Player ' + p.id.substring(0, 4)}</div>`).join('');
      const lp = document.getElementById('lobby-players');
      if (lp) lp.innerHTML = lobbyHtml;

      for (const id in serverZombies) {
        const sz = serverZombies[id];
        if (!this.remoteZombies[id]) {
          this.remoteZombies[id] = new RemoteZombie(id, sz);
        } else {
          this.remoteZombies[id].updateData(sz);
        }
      }
      for (const id in this.remoteZombies) {
        if (!serverZombies[id]) { delete this.remoteZombies[id]; }
      }
    });

    this.socket.on('zombieDied', (data) => {
      if (data.killer === this.socket.id) {
        this.kills++;
        this.score += (data.type === 2 ? 30 : data.type === 1 ? 15 : 10);
        if (!data.isOrb) {
          this.streakKills++;
          this.streakTimer = 2;
          if (this.streakKills > this.bestStreak) this.bestStreak = this.streakKills;
          if (this.streakKills >= 3) this.score += this.streakKills * 5;
        }
        if (Math.random() < CONFIG.DROP_CHANCE) this.drops.spawn(data.x, data.y, CONFIG.DROP_AMMO_AMT);
      }
      
      if (data.isOrb) {
        spawnParticles(data.x, data.y, '#88ffff', 12, 150, 0.5);
      } else {
        spawnParticles(data.x, data.y, data.type === 2 ? '#66ff66' : data.type === 1 ? '#ffaa33' : '#cc3333', 10, 120, 0.5);
      }
      
      if (this.remoteZombies[data.id]) {
        delete this.remoteZombies[data.id];
      }
    });

    this.socket.on('playerShoot', (data) => {
      this.bullets.spawn(data.x, data.y, data.vx, data.vy);
      if (data.angle !== undefined) {
        spawnParticles(data.x + Math.cos(data.angle) * 20, data.y + Math.sin(data.angle) * 20, '#ffcc44', 3, 80, 0.2);
      }
    });

    this.socket.on('zombieHit', (data) => {
      spawnParticles(data.x, data.y, '#ff4444', 4, 100, 0.3);
      if (this.remoteZombies[data.id]) {
        this.remoteZombies[data.id].flash = 0.1;
      }
    });

    this.socket.on('playerHit', (data) => {
      this.player.hp = data.hp;
      this.player.iframeCooldown = CONFIG.PLAYER_IFRAMES;
      this.player.hitFlash = 0.3;
      spawnParticles(this.player.x, this.player.y, '#ff2222', 8, 90, 0.4);
      
      if (data.zx !== undefined && data.zy !== undefined) {
        const pdx = this.player.x - data.zx, pdy = this.player.y - data.zy;
        const pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
        this.player.x += (pdx / pd) * 20;
        this.player.y += (pdy / pd) * 20;
      }
    });

    this.socket.on('ammoPicked', (data) => {
      this.player.ammo = data.currentAmmo;
      spawnParticles(data.x, data.y, '#ffcc00', 6, 60, 0.3);
    });

    this.socket.on('playerHealed', (data) => {
      this.player.hp = data.hp;
      spawnParticles(this.player.x, this.player.y, '#44ff88', 6, 50, 0.4);
    });

    this.socket.on('zombieHit', (data) => {
      spawnParticles(data.x, data.y, '#ff4444', 4, 100, 0.3);
      if (this.remoteZombies[data.id]) {
        this.remoteZombies[data.id].flash = 0.1;
      }
    });

    this.socket.on('playerHit', (data) => {
      this.player.hp = data.hp;
      this.player.iframeCooldown = CONFIG.PLAYER_IFRAMES;
      this.player.hitFlash = 0.3;
      spawnParticles(this.player.x, this.player.y, '#ff2222', 8, 90, 0.4);
      
      if (data.zx !== undefined && data.zy !== undefined) {
        const pdx = this.player.x - data.zx, pdy = this.player.y - data.zy;
        const pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
        this.player.x += (pdx / pd) * 20;
        this.player.y += (pdy / pd) * 20;
      }
    });

    this.socket.on('ammoPicked', (data) => {
      this.player.ammo = data.currentAmmo;
      spawnParticles(data.x, data.y, '#ffcc00', 6, 60, 0.3);
    });

    this.socket.on('playerHealed', (data) => {
      this.player.hp = data.hp;
      spawnParticles(this.player.x, this.player.y, '#44ff88', 6, 50, 0.4);
    });

    this.socket.on('playerRespawn', (data) => {
      this.player.hp = data.hp;
      this.player.ammo = data.ammo;
      this.player.isDead = false;
      if (this.state === 'gameover') {
        this.state = 'playing';
      }
      spawnParticles(this.player.x, this.player.y, '#44ffff', 15, 100, 0.6);
    });
  }

  reset() {
    this.player = new Player();
    this.gameTime = 0; this.kills = 0; this.score = 0; this.wave = 1;
    this.streakKills = 0; this.streakTimer = 0; this.bestStreak = 0; this.spawnAccum = 0;
    this.camX = 0; this.camY = 0;
    this.healTimer = 0;
    this.orbActive = false; this.orbTimer = 0; this.orbAngle = 0; this.lastOrbMilestone = 0;

    this.bullets.clear(); this.remoteDrops = {};
    this.remoteZombies = {};
    particles.length = 0;
    
    this.generateStones();
  }

  generateStones() {
    this.stones = [];
    for (let i = 0; i < CONFIG.STONE_COUNT; i++) {
      const size = rng(CONFIG.STONE_MIN_SIZE, CONFIG.STONE_MAX_SIZE);
      const x = rng(size + 50, CONFIG.MAP_W - size - 50);
      const y = rng(size + 50, CONFIG.MAP_H - size - 50);
      // Keep center clear for spawn
      if (Math.abs(x - CONFIG.MAP_W / 2) < 200 && Math.abs(y - CONFIG.MAP_H / 2) < 200) continue;
      this.stones.push({ x, y, size, rotation: Math.random() * Math.PI * 2 });
    }
  }

  getScaling() {
    const t = this.gameTime;
    return {
      spawnRate: clamp(CONFIG.SPAWN_BASE_RATE + t * 0.025, CONFIG.SPAWN_BASE_RATE, 8),
      zSpeed: clamp(CONFIG.ZOMBIE_BASE_SPEED + t * 0.5, CONFIG.ZOMBIE_BASE_SPEED, 180),
      zHp: clamp(CONFIG.ZOMBIE_BASE_HP + t * 0.04, CONFIG.ZOMBIE_BASE_HP, 20),
      dropChance: clamp(CONFIG.DROP_CHANCE + t * 0.002, CONFIG.DROP_CHANCE, 1.0),
    };
  }

  spawnZombie() {
    if (this.zombies.active >= CONFIG.MAX_ZOMBIES) return;
    const s = this.getScaling();
    const margin = CONFIG.SPAWN_MARGIN;
    const side = Math.floor(Math.random() * 4);
    let x, y;
    
    switch(side) {
      case 0: x = rng(0, CONFIG.MAP_W); y = -margin; break;
      case 1: x = rng(0, CONFIG.MAP_W); y = CONFIG.MAP_H + margin; break;
      case 2: x = -margin; y = rng(0, CONFIG.MAP_H); break;
      case 3: x = CONFIG.MAP_W + margin; y = rng(0, CONFIG.MAP_H); break;
    }
    
    if (dist({x, y}, this.player) < 300) return;
    
    let type = 0, hp = s.zHp, speed = s.zSpeed;
    const roll = Math.random();
    if (this.gameTime > 60 && roll < 0.15) { type = 1; hp = s.zHp * 0.5; speed = s.zSpeed * 1.7; }
    else if (this.gameTime > 90 && roll < 0.25) { type = 2; hp = s.zHp * 3; speed = s.zSpeed * 0.55; }
    
    this.zombies.spawn(x, y, hp, speed, type);
  }

  // ── CENTRAL UPDATE LOOP ──
  update(dt) {
    // gameTime and wave are synced from server now, but we advance locally too for smoothness
    this.gameTime += dt;

    this.player.update(dt, this);
    for (const id in this.remotePlayers) {
      this.remotePlayers[id].update(dt);
    }
    for (const id in this.remoteZombies) {
      this.remoteZombies[id].update(dt);
    }

    this.bullets.forEach(b => b.update(dt, this));

    this.grid.clear();
    for (const id in this.remoteZombies) {
      this.grid.insert(this.remoteZombies[id]);
    }

    
    this.updateSystems(dt);
    
    updateParticles(dt);

    if (this.player.hp <= 0 && this.state !== 'gameover') {
      this.player.hp = 0;
      this.player.isDead = true;
    }
  }

  updateSystems(dt) {
    

    // Orbital Attack
    const currentMilestone = Math.floor(this.kills / ORB_KILL_THRESHOLD);
    if (currentMilestone > this.lastOrbMilestone) {
      this.lastOrbMilestone = currentMilestone;
      this.orbActive = true;
      this.orbTimer = ORB_DURATION;
      this.orbAngle = 0;
    }

    if (this.orbActive) {
      this.orbTimer -= dt;
      this.orbAngle += ORB_SPEED * dt;
      if (this.orbTimer <= 0) this.orbActive = false;

      const orbX = this.player.x + Math.cos(this.orbAngle) * ORB_ORBIT_DIST;
      const orbY = this.player.y + Math.sin(this.orbAngle) * ORB_ORBIT_DIST;

      if (Math.random() < 0.6) spawnParticles(orbX, orbY, '#88ffff', 1, 30, 0.3);

      const orbNear = this.grid.query(orbX, orbY, ORB_RADIUS + CONFIG.ZOMBIE_RADIUS + 5);
      for (const z of orbNear) {
        if (dist({x: orbX, y: orbY}, z) < ORB_RADIUS + CONFIG.ZOMBIE_RADIUS) {
          if (this.socket) {
             this.socket.emit('orbHit', { id: z.id });
          }
          z.flash = 0.15;
          spawnParticles(z.x, z.y, '#88ffff', 5, 80, 0.3);
        }
      }
    }

    this.streakTimer -= dt;
    if (this.streakTimer <= 0) this.streakKills = 0;
    this.score += dt * 2;
  }

  // ── SEPARATE RENDERING LOOP ──
  render() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    this.camX = clamp(this.player.x - W / 2, 0, CONFIG.MAP_W - W);
    this.camY = clamp(this.player.y - H / 2, 0, CONFIG.MAP_H - H);

    ctx.fillStyle = '#111118';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const gs = 80;
    for (let x = -(this.camX % gs); x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = -(this.camY % gs); y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    ctx.strokeStyle = '#ff4422';
    ctx.lineWidth = 3;
    ctx.strokeRect(-this.camX, -this.camY, CONFIG.MAP_W, CONFIG.MAP_H);

    // Render Stones
    for (const s of this.stones) {
      const sx = s.x - this.camX, sy = s.y - this.camY;
      if (sx < -s.size || sx > W + s.size || sy < -s.size || sy > H + s.size) continue;
      
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(s.rotation);
      
      const r = s.size * 0.45;
      ctx.fillStyle = '#554433';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#665544';
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.2, r * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#443322';
      ctx.beginPath(); ctx.arc(r * 0.25, r * 0.2, r * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.arc(-r * 0.15, -r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
      
      ctx.restore();
    }

    // Entities
    for (const id in this.remoteDrops) {
      const d = this.remoteDrops[id];
      const sx = d.x - this.camX, sy = d.y - this.camY;
      if (sx >= -20 && sx <= canvas.width + 20 && sy >= -20 && sy <= canvas.height + 20) {
        ctx.fillStyle = '#ffaa00';
        ctx.shadowColor = '#ffaa00';
        ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    for (const id in this.remoteZombies) {
      this.remoteZombies[id].render(ctx, this.camX, this.camY, this.player);
    }
    
    ctx.fillStyle = '#ffdd44';
    ctx.shadowColor = '#ffdd44';
    ctx.shadowBlur = 8;
    this.bullets.forEach(b => b.render(ctx, this.camX, this.camY));
    ctx.shadowBlur = 0;

    // Render remote players
    for (const id in this.remotePlayers) {
      this.remotePlayers[id].render(ctx, this.camX, this.camY);
    }

    this.player.render(ctx, this.camX, this.camY);

    // Render Orb
    if (this.orbActive) {
      const ox = this.player.x + Math.cos(this.orbAngle) * ORB_ORBIT_DIST - this.camX;
      const oy = this.player.y + Math.sin(this.orbAngle) * ORB_ORBIT_DIST - this.camY;
      
      const pulse = 1 + Math.sin(this.gameTime * 8) * 0.15;
      ctx.shadowColor = '#44ffff';
      ctx.shadowBlur = 25;
      ctx.fillStyle = 'rgba(100, 255, 255, 0.25)';
      ctx.beginPath(); ctx.arc(ox, oy, ORB_RADIUS * 2.2 * pulse, 0, Math.PI * 2); ctx.fill();
      
      ctx.fillStyle = '#aaffff';
      ctx.beginPath(); ctx.arc(ox, oy, ORB_RADIUS * pulse, 0, Math.PI * 2); ctx.fill();
      
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ox, oy, ORB_RADIUS * 0.4 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(100, 255, 255, 0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.player.x - this.camX, this.player.y - this.camY, ORB_ORBIT_DIST, 0, Math.PI * 2); ctx.stroke();
    }

    drawParticles(ctx, this.camX, this.camY);

    // Fog
    const fogSize = 120;
    const gTop = ctx.createLinearGradient(0, -this.camY, 0, -this.camY + fogSize);
    gTop.addColorStop(0, 'rgba(0,0,0,0.7)'); gTop.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gTop; ctx.fillRect(0, -this.camY, W, fogSize);
    
    const bEdge = CONFIG.MAP_H - this.camY;
    const gBot = ctx.createLinearGradient(0, bEdge, 0, bEdge - fogSize);
    gBot.addColorStop(0, 'rgba(0,0,0,0.7)'); gBot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gBot; ctx.fillRect(0, bEdge - fogSize, W, fogSize);
    
    const gLeft = ctx.createLinearGradient(-this.camX, 0, -this.camX + fogSize, 0);
    gLeft.addColorStop(0, 'rgba(0,0,0,0.7)'); gLeft.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gLeft; ctx.fillRect(-this.camX, 0, fogSize, H);
    
    const rEdge = CONFIG.MAP_W - this.camX;
    const gRight = ctx.createLinearGradient(rEdge, 0, rEdge - fogSize, 0);
    gRight.addColorStop(0, 'rgba(0,0,0,0.7)'); gRight.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gRight; ctx.fillRect(rEdge - fogSize, 0, fogSize, H);

    this.updateHUD();

    if (this.player.hp <= 0 && this.state !== 'gameover') {
      ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff2222';
      ctx.font = '900 3.5rem Orbitron';
      ctx.textAlign = 'center';
      ctx.fillText("YOU ARE DEAD", W / 2, H / 2 - 20);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 1.2rem Orbitron';
      ctx.fillText("Waiting for team...", W / 2, H / 2 + 30);
    }
  }

  updateHUD() {
    document.getElementById('hp-bar').style.width = `${(this.player.hp / this.player.maxHp) * 100}%`;
    document.getElementById('hp-bar').style.background = this.player.hp < 30 ? 'linear-gradient(90deg,#cc2222,#ff3333)' : 'linear-gradient(90deg,#22cc44,#44ff66)';
    document.getElementById('ammo-bar').style.width = `${(this.player.ammo / this.player.maxAmmo) * 100}%`;
    
    const ammoEl = document.getElementById('ammo-count');
    ammoEl.textContent = `${this.player.ammo} / ${this.player.maxAmmo}`;
    ammoEl.className = this.player.ammo <= 5 ? 'hud-value blink-warn' : 'hud-value';
    
    document.getElementById('wave-label').textContent = `WAVE ${this.wave}`;
    document.getElementById('score-display').textContent = Math.floor(this.score);
    document.getElementById('kill-display').textContent = this.kills;
    
    const mins = Math.floor(this.gameTime / 60);
    const secs = Math.floor(this.gameTime % 60);
    document.getElementById('time-display').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    
    const streakEl = document.getElementById('kill-streak');
    if (this.orbActive) {
      const orbSecs = Math.ceil(this.orbTimer);
      streakEl.textContent = `⚡ ORB ACTIVE — ${orbSecs}s`;
      streakEl.style.color = '#44ffff';
    } else {
      const killsToNext = ORB_KILL_THRESHOLD - (this.kills % ORB_KILL_THRESHOLD);
      const streakText = this.streakKills >= 3 ? `🔥 ${this.streakKills}x STREAK` : '';
      streakEl.textContent = streakText || (this.kills > 0 ? `⚡ Orb in ${killsToNext} kills` : '');
      streakEl.style.color = '#ffcc00';
    }
  }

  triggerTeamGameOver() {
    this.state = 'gameover';
    hud.classList.add('hidden');
    screenGameover.classList.remove('hidden');
    const mins = Math.floor(this.gameTime / 60);
    const secs = Math.floor(this.gameTime % 60);
    document.getElementById('go-time').textContent = `${mins}m ${secs}s`;
    document.getElementById('go-kills').textContent = this.kills;
    document.getElementById('go-score').textContent = Math.floor(this.score);
    document.getElementById('go-wave').textContent = this.wave;
  }
}

// ══════════════════════════════════════════
//  INITIALIZATION & GAME LOOP
// ══════════════════════════════════════════

const game = new GameManager();

function startGame() {
  if (game.socket) game.socket.emit('joinGame');
  game.reset();
  game.state = 'playing';
  screenMenu.classList.add('hidden');
  screenGameover.classList.add('hidden');
  hud.classList.remove('hidden');
  pauseOverlay.classList.add('hidden');
}

function togglePause() {
  if (game.state === 'playing') {
    game.state = 'paused';
    pauseOverlay.classList.remove('hidden');
  } else if (game.state === 'paused') {
    game.state = 'playing';
    pauseOverlay.classList.add('hidden');
  }
}

document.getElementById('username-input').addEventListener('input', (e) => {
  if (game.socket) {
    game.socket.emit('updateUsername', e.target.value);
  }
});

// ── Event Listeners ──
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', () => {
  screenGameover.classList.add('hidden');
  screenMenu.classList.remove('hidden');
  game.state = 'menu';
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (game.state === 'playing' || game.state === 'paused') togglePause();
  }
});

let lastTime = performance.now();

function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (game.state === 'playing') {
    game.update(dt);
    game.render();
  } else if (game.state === 'paused') {
    game.render(); // Keep rendering background
  }

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
