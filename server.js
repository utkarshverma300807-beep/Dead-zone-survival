const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Allow Cross-Origin Resource Sharing (CORS) for local testing
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

const players = {};
const zombies = {};
const bullets = Array(150).fill(null).map(() => ({ active: false, id: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0, owner: null }));
const drops = {};

let nextZombieId = 0;
let nextBulletId = 0;
let nextDropId = 0;
let gameTime = 0;
let spawnAccum = 0;
let lastWave = 1;

const CONFIG = {
  MAP_W: 3000,
  MAP_H: 3000,
  ZOMBIE_RADIUS: 14,
  ZOMBIE_BASE_SPEED: 60,
  ZOMBIE_BASE_HP: 1,
  ZOMBIE_SEPARATION: 28,
  SPAWN_BASE_RATE: 1.2,
  MAX_ZOMBIES: 100,
  DROP_CHANCE: 1.0,
  DROP_AMMO_AMT: 20
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy) || 1; }

function spawnZombie() {
  if (Object.keys(zombies).length >= CONFIG.MAX_ZOMBIES) return;
  const s = {
    zSpeed: clamp(CONFIG.ZOMBIE_BASE_SPEED + gameTime * 0.5, CONFIG.ZOMBIE_BASE_SPEED, 180),
    zHp: clamp(CONFIG.ZOMBIE_BASE_HP + gameTime * 0.04, CONFIG.ZOMBIE_BASE_HP, 20)
  };
  const margin = 80;
  const side = Math.floor(Math.random() * 4);
  let x, y;
  switch(side) {
    case 0: x = Math.random() * CONFIG.MAP_W; y = -margin; break;
    case 1: x = Math.random() * CONFIG.MAP_W; y = CONFIG.MAP_H + margin; break;
    case 2: x = -margin; y = Math.random() * CONFIG.MAP_H; break;
    case 3: x = CONFIG.MAP_W + margin; y = Math.random() * CONFIG.MAP_H; break;
  }
  
  let tooClose = false;
  for (let pid in players) {
    if (dist({x,y}, players[pid]) < 300) { tooClose = true; break; }
  }
  if (tooClose) return;

  let type = 0, hp = s.zHp, speed = s.zSpeed;
  const roll = Math.random();
  if (gameTime > 60 && roll < 0.15) { type = 1; hp = s.zHp * 0.5; speed = s.zSpeed * 1.7; }
  else if (gameTime > 90 && roll < 0.25) { type = 2; hp = s.zHp * 3; speed = s.zSpeed * 0.55; }
  
  const id = nextZombieId++;
  zombies[id] = { id, x, y, hp, maxHp: hp, speed, type };
}

io.on('connection', (socket) => {
  players[socket.id] = { id: socket.id, x: 1500, y: 1500, hp: 100, ammo: 50, iframeCooldown: 0, healTimer: 0, inGame: false, spawnInvincibility: 0 };

  socket.on('joinGame', () => {
    if (players[socket.id]) {
      players[socket.id].inGame = true;
      players[socket.id].hp = 100;
      players[socket.id].ammo = 50;
      players[socket.id].x = 1500;
      players[socket.id].y = 1500;
      players[socket.id].spawnInvincibility = 10;
    }
  });

  socket.on('move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
    }
  });

  socket.on('shoot', (data) => {
    const p = players[socket.id];
    if (p && p.ammo > 0) {
      p.ammo--;
      // Find inactive bullet in pool
      const b = bullets.find(b => !b.active);
      if (b) {
        b.active = true;
        b.id = nextBulletId++;
        b.x = data.x;
        b.y = data.y;
        b.vx = data.vx;
        b.vy = data.vy;
        b.life = 1.2;
        b.owner = socket.id;
      }
      socket.broadcast.emit('playerShoot', data);
    }
  });

  socket.on('updateUsername', (name) => {
    if (players[socket.id]) {
      players[socket.id].name = String(name).substring(0, 16);
    }
  });

  socket.on('orbHit', (data) => {
    const z = zombies[data.id];
    if (z) {
      if (z.type === 2) {
        z.hp -= z.maxHp * 0.10;
        if (z.hp <= 0) {
          delete zombies[data.id];
          io.emit('zombieDied', { id: data.id, killer: socket.id, type: z.type, x: z.x, y: z.y, isOrb: true });
          if (Math.random() < CONFIG.DROP_CHANCE) {
            const dId = nextDropId++;
            drops[dId] = { id: dId, x: z.x, y: z.y, amount: CONFIG.DROP_AMMO_AMT, life: 12 };
          }
        } else {
          io.emit('zombieHit', { id: data.id, x: z.x, y: z.y });
        }
      } else {
        delete zombies[data.id];
        io.emit('zombieDied', { id: data.id, killer: socket.id, type: z.type, x: z.x, y: z.y, isOrb: true });
        if (Math.random() < CONFIG.DROP_CHANCE) {
          const dId = nextDropId++;
          drops[dId] = { id: dId, x: z.x, y: z.y, amount: CONFIG.DROP_AMMO_AMT, life: 12 };
        }
      }
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

let lastTime = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  const playersList = Object.values(players);
  const activePlayers = playersList.filter(p => p.inGame);

  if (activePlayers.length > 0) {
    const allDead = activePlayers.every(p => p.hp <= 0);
    if (allDead) {
      io.emit('teamGameOver');
      gameTime = 0;
      lastWave = 1;
      spawnAccum = 0;
      for (const key in zombies) delete zombies[key];
      for (const key in drops) delete drops[key];
      for (const b of bullets) b.active = false;
      for (const p of activePlayers) {
        p.inGame = false;
        p.hp = 100;
        p.ammo = 50;
      }
    } else {
      gameTime += dt;
      const currentWave = Math.floor(gameTime / 30) + 1;
      if (currentWave > lastWave) {
        lastWave = currentWave;
        for (const p of activePlayers) {
          if (p.hp <= 0) {
            p.hp = 100;
            p.ammo = Math.max(p.ammo, 50);
            p.spawnInvincibility = 5;
            io.to(p.id).emit('playerRespawn', { hp: p.hp, ammo: p.ammo });
          }
        }
      }

      const spawnRate = clamp(CONFIG.SPAWN_BASE_RATE + gameTime * 0.025, CONFIG.SPAWN_BASE_RATE, 8);
      spawnAccum += spawnRate * dt;
      while (spawnAccum >= 1) { spawnZombie(); spawnAccum--; }
    }
  } else {
    gameTime = 0;
    spawnAccum = 0;
    for (const key in zombies) delete zombies[key];
    for (const key in drops) delete drops[key];
    for (const b of bullets) b.active = false;
  }

  const zList = Object.values(zombies);
  for (const z of zList) {
    let closestP = null;
    let minDist = Infinity;
    for (const p of activePlayers) {
      if (p.hp <= 0) continue;
      const d = dist(z, p);
      if (d < minDist) { minDist = d; closestP = p; }
    }

    if (closestP) {
      const dx = closestP.x - z.x;
      const dy = closestP.y - z.y;
      const d = Math.max(dist(z, closestP), 1);
      let mx = (dx / d) * z.speed;
      let my = (dy / d) * z.speed;

      for (const other of zList) {
        if (other === z) continue;
        const sd = dist(z, other);
        if (sd < CONFIG.ZOMBIE_SEPARATION && sd > 0) {
          const push = (CONFIG.ZOMBIE_SEPARATION - sd) / CONFIG.ZOMBIE_SEPARATION;
          mx += ((z.x - other.x) / sd) * z.speed * push * 0.6;
          my += ((z.y - other.y) / sd) * z.speed * push * 0.6;
        }
      }

      z.x += mx * dt;
      z.y += my * dt;
    }
  }

  // UPDATE BULLETS
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (!b.active) continue;

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < -50 || b.x > CONFIG.MAP_W + 50 || b.y < -50 || b.y > CONFIG.MAP_H + 50) {
      b.active = false;
      continue;
    }
    
    let hit = false;
    for (const zid in zombies) {
      const z = zombies[zid];
      if (dist(b, z) < 4 + CONFIG.ZOMBIE_RADIUS) {
        z.hp -= 1;
        if (z.hp <= 0) {
          delete zombies[zid];
          io.emit('zombieDied', { id: zid, killer: b.owner, type: z.type, x: z.x, y: z.y, isOrb: false });
          if (Math.random() < CONFIG.DROP_CHANCE) {
            const dId = nextDropId++;
            drops[dId] = { id: dId, x: z.x, y: z.y, amount: CONFIG.DROP_AMMO_AMT, life: 12 };
          }
        } else {
          io.emit('zombieHit', { id: zid, x: b.x, y: b.y });
        }
        b.active = false;
        hit = true;
        break;
      }
    }
  }

  // UPDATE DROPS
  for (const did in drops) {
    const d = drops[did];
    d.life -= dt;
    if (d.life <= 0) {
      delete drops[did];
      continue;
    }
    
    for (const p of activePlayers) {
      if (dist(p, d) < 16 + 8 + 4) { // Player rad + drop rad + 4
        p.ammo = Math.min(p.ammo + d.amount, 200);
        delete drops[did];
        io.to(p.id).emit('ammoPicked', { amount: d.amount, x: d.x, y: d.y, currentAmmo: p.ammo });
        break;
      }
    }
  }

  // ZOMBIE VS PLAYER
  for (const p of activePlayers) {
    if (p.spawnInvincibility > 0) p.spawnInvincibility -= dt;

    if (p.hp > 0) {
      if (p.iframeCooldown > 0) p.iframeCooldown -= dt;
      else if (p.spawnInvincibility <= 0) {
        for (const z of zList) {
          if (dist(p, z) < 16 + CONFIG.ZOMBIE_RADIUS) {
            p.hp -= 15; // ZOMBIE_DAMAGE
            if (p.hp < 0) p.hp = 0;
            p.iframeCooldown = 0.8; // IFRAMES
            io.to(p.id).emit('playerHit', { id: p.id, hp: p.hp, zx: z.x, zy: z.y });
            break;
          }
        }
      }
    }
    
    // HEALING
    if (p.hp > 0) {
      p.healTimer += dt;
      if (p.healTimer >= 1 && p.hp < 100) {
        p.hp = Math.min(p.hp + 10, 100);
        p.healTimer = 0;
        io.to(p.id).emit('playerHealed', { hp: p.hp });
      }
    }
  }

  // DATA COMPRESSION: Send rounded numbers to drastically save network bandwidth
  const packPlayers = {};
  for (const id in players) {
    const p = players[id];
    packPlayers[id] = { id: p.id, x: Math.round(p.x), y: Math.round(p.y), name: p.name, inGame: p.inGame, invincible: p.spawnInvincibility > 0, isDead: p.hp <= 0 };
  }

  const packZombies = {};
  for (const id in zombies) {
    const z = zombies[id];
    packZombies[id] = { x: Math.round(z.x), y: Math.round(z.y), hp: Math.round(z.hp), maxHp: Math.round(z.maxHp), type: z.type };
  }

  const packDrops = {};
  for (const id in drops) {
    const d = drops[id];
    packDrops[id] = { x: Math.round(d.x), y: Math.round(d.y) };
  }

  io.emit('stateUpdate', { players: packPlayers, zombies: packZombies, drops: packDrops, gameTime: Math.round(gameTime) });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Multiplayer Server running on http://localhost:${PORT}`);
});
