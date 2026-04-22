// ══════════════════════════════════════════
//  DEAD ZONE — Main Game Module
// ══════════════════════════════════════════

// ── DOM ──
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
const imgZombie = new Image(); imgZombie.src = 'OIP.webp';

// ── HEALING CONFIG ──
const HEAL_INTERVAL = 6;   // seconds between heals
const HEAL_AMOUNT = 5;     // hp restored per tick
let healTimer = 0;

// ── GAME STATE ──
let state = 'menu';
let gameTime = 0, kills = 0, score = 0, wave = 1;
let streakKills = 0, streakTimer = 0, bestStreak = 0;
let spawnAccum = 0, camX = 0, camY = 0;

// ── STONES (generated once per game) ──
let stones = [];

function generateStones() {
  stones = [];
  for (let i = 0; i < CONFIG.STONE_COUNT; i++) {
    const size = rng(CONFIG.STONE_MIN_SIZE, CONFIG.STONE_MAX_SIZE);
    const x = rng(size + 50, CONFIG.MAP_W - size - 50);
    const y = rng(size + 50, CONFIG.MAP_H - size - 50);
    // avoid center spawn area
    if (Math.abs(x - CONFIG.MAP_W/2) < 200 && Math.abs(y - CONFIG.MAP_H/2) < 200) continue;
    stones.push({ x, y, size, rotation: Math.random() * Math.PI * 2 });
  }
}

// ── PLAYER ──
const player = {
  x: CONFIG.MAP_W / 2, y: CONFIG.MAP_H / 2,
  hp: CONFIG.PLAYER_HP, maxHp: CONFIG.PLAYER_HP,
  ammo: CONFIG.START_AMMO, maxAmmo: CONFIG.MAX_AMMO,
  angle: 0, fireCooldown: 0, iframeCooldown: 0, hitFlash: 0,
};

// ── OBJECT POOLS ──
const bullets = new Pool(
  () => ({ x:0,y:0,vx:0,vy:0,life:0,alive:false }),
  (b,x,y,vx,vy) => { b.x=x;b.y=y;b.vx=vx;b.vy=vy;b.life=CONFIG.BULLET_LIFETIME; },
  CONFIG.MAX_BULLETS
);
const zombies = new Pool(
  () => ({ x:0,y:0,hp:0,maxHp:0,speed:0,alive:false,flash:0,type:0 }),
  (z,x,y,hp,speed,type) => { z.x=x;z.y=y;z.hp=hp;z.maxHp=hp;z.speed=speed;z.flash=0;z.type=type||0; },
  CONFIG.MAX_ZOMBIES
);
const drops = new Pool(
  () => ({ x:0,y:0,life:0,alive:false,amount:0,pulse:0 }),
  (d,x,y,amt) => { d.x=x;d.y=y;d.amount=amt;d.life=CONFIG.DROP_LIFETIME;d.pulse=0; },
  CONFIG.MAX_DROPS
);
const grid = new SpatialGrid(CONFIG.GRID_CELL, CONFIG.MAP_W, CONFIG.MAP_H);

// ── SCALING ──
function getScaling() {
  const t = gameTime;
  return {
    spawnRate: clamp(CONFIG.SPAWN_BASE_RATE + t*0.025, CONFIG.SPAWN_BASE_RATE, 8),
    zSpeed: clamp(CONFIG.ZOMBIE_BASE_SPEED + t*0.5, CONFIG.ZOMBIE_BASE_SPEED, 180),
    zHp: clamp(CONFIG.ZOMBIE_BASE_HP + t*0.04, CONFIG.ZOMBIE_BASE_HP, 20),
    dropChance: clamp(CONFIG.DROP_CHANCE + t*0.002, CONFIG.DROP_CHANCE, 1.0),
  };
}

// ── STONE COLLISION HELPER ──
function pushOutOfStones(obj, radius) {
  for (const s of stones) {
    const dx = obj.x - s.x, dy = obj.y - s.y;
    const d = Math.sqrt(dx*dx + dy*dy) || 1;
    const minDist = radius + s.size * 0.45;
    if (d < minDist) {
      const push = minDist - d;
      obj.x += (dx/d) * push;
      obj.y += (dy/d) * push;
    }
  }
}

// ── RESET ──
function resetGame() {
  player.x = CONFIG.MAP_W/2; player.y = CONFIG.MAP_H/2;
  player.hp = CONFIG.PLAYER_HP; player.ammo = CONFIG.START_AMMO;
  player.fireCooldown = 0; player.iframeCooldown = 0; player.hitFlash = 0;
  gameTime=0; kills=0; score=0; wave=1;
  streakKills=0; streakTimer=0; bestStreak=0; spawnAccum=0;
  bullets.clear(); zombies.clear(); drops.clear();
  particles.length = 0;
  healTimer = 0;
  generateStones();
}

// ── SPAWNING ──
function spawnZombie() {
  if (zombies.active >= CONFIG.MAX_ZOMBIES) return;
  const s = getScaling();
  const margin = CONFIG.SPAWN_MARGIN;
  const side = Math.floor(Math.random()*4);
  let x, y;
  switch(side) {
    case 0: x=rng(0,CONFIG.MAP_W); y=-margin; break;
    case 1: x=rng(0,CONFIG.MAP_W); y=CONFIG.MAP_H+margin; break;
    case 2: x=-margin; y=rng(0,CONFIG.MAP_H); break;
    case 3: x=CONFIG.MAP_W+margin; y=rng(0,CONFIG.MAP_H); break;
  }
  if (dist({x,y}, player) < 300) return;
  let type=0, hp=s.zHp, speed=s.zSpeed;
  const roll = Math.random();
  if (gameTime>60 && roll<0.15) { type=1; hp=s.zHp*0.5; speed=s.zSpeed*1.7; }
  else if (gameTime>90 && roll<0.25) { type=2; hp=s.zHp*3; speed=s.zSpeed*0.55; }
  zombies.spawn(x,y,hp,speed,type);
}

// ══════════════════════════════════════════
//  UPDATE
// ══════════════════════════════════════════
function update(dt) {
  gameTime += dt;
  wave = Math.floor(gameTime / CONFIG.SCALE_INTERVAL) + 1;

  // Player Movement
  const mv = input.moveVec();
  player.x += mv.x * CONFIG.PLAYER_SPEED * dt;
  player.y += mv.y * CONFIG.PLAYER_SPEED * dt;
  player.x = clamp(player.x, CONFIG.PLAYER_RADIUS, CONFIG.MAP_W - CONFIG.PLAYER_RADIUS);
  player.y = clamp(player.y, CONFIG.PLAYER_RADIUS, CONFIG.MAP_H - CONFIG.PLAYER_RADIUS);
  pushOutOfStones(player, CONFIG.PLAYER_RADIUS);

  // Aim
  const spx = player.x - camX, spy = player.y - camY;
  player.angle = Math.atan2(input.mouse.y - spy, input.mouse.x - spx);

  // Timers
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  player.iframeCooldown = Math.max(0, player.iframeCooldown - dt);
  player.hitFlash = Math.max(0, player.hitFlash - dt);

  // Shooting
  if (input.shooting() && player.fireCooldown <= 0 && player.ammo > 0) {
    player.fireCooldown = CONFIG.FIRE_RATE;
    player.ammo--;
    const bvx = Math.cos(player.angle)*CONFIG.BULLET_SPEED;
    const bvy = Math.sin(player.angle)*CONFIG.BULLET_SPEED;
    bullets.spawn(player.x, player.y, bvx, bvy);
    spawnParticles(player.x+Math.cos(player.angle)*20, player.y+Math.sin(player.angle)*20, '#ffcc44', 3, 80, 0.2);
  }

  // Bullets update + stone collision
  bullets.forEach((b) => {
    b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
    if (b.life<=0 || b.x<-50 || b.x>CONFIG.MAP_W+50 || b.y<-50 || b.y>CONFIG.MAP_H+50) return false;
    for (const s of stones) {
      if (dist(b, s) < CONFIG.BULLET_RADIUS + s.size*0.4) {
        spawnParticles(b.x, b.y, '#999966', 3, 60, 0.2);
        return false;
      }
    }
  });

  // Zombie Spawning
  const s = getScaling();
  spawnAccum += s.spawnRate * dt;
  while (spawnAccum >= 1) { spawnZombie(); spawnAccum--; }

  // Spatial Grid
  grid.clear();
  zombies.forEach((z) => { grid.insert(z); });

  // Zombie AI
  zombies.forEach((z) => {
    const dx = player.x-z.x, dy = player.y-z.y;
    const d = Math.sqrt(dx*dx+dy*dy)||1;
    let mx = (dx/d)*z.speed, my = (dy/d)*z.speed;
    const nearby = grid.query(z.x, z.y, CONFIG.ZOMBIE_SEPARATION*2);
    for (const o of nearby) {
      if (o===z) continue;
      const sx=z.x-o.x, sy=z.y-o.y;
      const sd = Math.sqrt(sx*sx+sy*sy)||1;
      if (sd < CONFIG.ZOMBIE_SEPARATION) {
        const push = (CONFIG.ZOMBIE_SEPARATION-sd)/CONFIG.ZOMBIE_SEPARATION;
        mx += (sx/sd)*z.speed*push*0.6;
        my += (sy/sd)*z.speed*push*0.6;
      }
    }
    z.x += mx*dt; z.y += my*dt;
    pushOutOfStones(z, CONFIG.ZOMBIE_RADIUS);
    z.flash = Math.max(0, z.flash-dt);
    if (dist(z, player) > 1800) return false;
  });

  // Bullet vs Zombie
  bullets.forEach((b) => {
    const near = grid.query(b.x, b.y, 30);
    for (const z of near) {
      if (!z.alive) continue;
      if (dist(b,z) < CONFIG.BULLET_RADIUS+CONFIG.ZOMBIE_RADIUS) {
        z.hp -= 1; z.flash = 0.1;
        spawnParticles(b.x, b.y, '#ff4444', 4, 100, 0.3);
        if (z.hp <= 0) {
          z.alive = false; kills++;
          score += (z.type===2?30:z.type===1?15:10);
          streakKills++; streakTimer=2;
          if (streakKills>bestStreak) bestStreak=streakKills;
          if (streakKills>=3) score += streakKills*5;
          spawnParticles(z.x, z.y, z.type===2?'#66ff66':z.type===1?'#ffaa33':'#cc3333', 10, 120, 0.5);
          // Always drop ammo
          if (Math.random() < s.dropChance) drops.spawn(z.x, z.y, CONFIG.DROP_AMMO_AMT);
        }
        return false;
      }
    }
  });

  // Cleanup dead zombies
  zombies.forEach((z) => { if (!z.alive) return false; });

  // Zombie vs Player
  if (player.iframeCooldown <= 0) {
    const pNear = grid.query(player.x, player.y, CONFIG.PLAYER_RADIUS+CONFIG.ZOMBIE_RADIUS+5);
    for (const z of pNear) {
      if (!z.alive) continue;
      if (dist(player,z) < CONFIG.PLAYER_RADIUS+CONFIG.ZOMBIE_RADIUS) {
        player.hp -= CONFIG.ZOMBIE_DAMAGE;
        player.iframeCooldown = CONFIG.PLAYER_IFRAMES;
        player.hitFlash = 0.3;
        spawnParticles(player.x, player.y, '#ff2222', 8, 90, 0.4);
        const pdx=player.x-z.x, pdy=player.y-z.y;
        const pd = Math.sqrt(pdx*pdx+pdy*pdy)||1;
        player.x += (pdx/pd)*20; player.y += (pdy/pd)*20;
        break;
      }
    }
  }

  // Ammo pickups
  drops.forEach((d) => {
    d.life -= dt; d.pulse += dt*4;
    if (d.life <= 0) return false;
    if (dist(player, d) < CONFIG.PLAYER_RADIUS+CONFIG.DROP_RADIUS+4) {
      player.ammo = Math.min(player.ammo+d.amount, player.maxAmmo);
      spawnParticles(d.x, d.y, '#ffcc00', 6, 60, 0.3);
      return false;
    }
  });

  streakTimer -= dt;
  if (streakTimer <= 0) streakKills = 0;
  score += dt * 2;

  // Passive healing every 6 seconds
  healTimer += dt;
  if (healTimer >= HEAL_INTERVAL && player.hp < player.maxHp) {
    player.hp = Math.min(player.hp + HEAL_AMOUNT, player.maxHp);
    spawnParticles(player.x, player.y, '#44ff88', 6, 50, 0.4);
    healTimer = 0;
  }

  updateParticles(dt);
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

// ══════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════
function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  camX = clamp(player.x - W/2, 0, CONFIG.MAP_W - W);
  camY = clamp(player.y - H/2, 0, CONFIG.MAP_H - H);

  // Background
  ctx.fillStyle = '#111118';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gs = 80;
  for (let x = -(camX%gs); x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = -(camY%gs); y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Map border
  ctx.strokeStyle = '#ff4422'; ctx.lineWidth = 3;
  ctx.strokeRect(-camX, -camY, CONFIG.MAP_W, CONFIG.MAP_H);

  // Stones
  for (const s of stones) {
    const sx = s.x - camX, sy = s.y - camY;
    if (sx < -s.size || sx > W+s.size || sy < -s.size || sy > H+s.size) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(s.rotation);
    // Draw stone as a stylized rock shape
    const r = s.size * 0.45;
    ctx.fillStyle = '#554433';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#665544';
    ctx.beginPath(); ctx.arc(-r*0.3, -r*0.2, r*0.7, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#443322';
    ctx.beginPath(); ctx.arc(r*0.25, r*0.2, r*0.5, 0, Math.PI*2); ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(-r*0.15, -r*0.3, r*0.35, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // Ammo Drops
  drops.forEach((d) => {
    const sx = d.x-camX, sy = d.y-camY;
    if (sx<-20||sx>W+20||sy<-20||sy>H+20) return;
    const pulse = 1+Math.sin(d.pulse)*0.2;
    ctx.globalAlpha = d.life<3 ? d.life/3 : 1;
    ctx.fillStyle = '#ffaa00';
    ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(sx, sy, CONFIG.DROP_RADIUS*pulse, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  });

  // Zombies — use image sprite
  const zImgReady = imgZombie.complete && imgZombie.naturalWidth > 0;
  zombies.forEach((z) => {
    const sx = z.x-camX, sy = z.y-camY;
    if (sx<-40||sx>W+40||sy<-40||sy>H+40) return;
    const r = z.type===2 ? CONFIG.ZOMBIE_RADIUS+6 : z.type===1 ? CONFIG.ZOMBIE_RADIUS-2 : CONFIG.ZOMBIE_RADIUS;
    const drawSize = r * 2.8;

    ctx.save();
    ctx.translate(sx, sy);

    // Flash white overlay
    if (z.flash > 0) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, r+2, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Flip sprite to face player
    const facingLeft = player.x < z.x;
    if (facingLeft) ctx.scale(-1, 1);

    if (zImgReady) {
      ctx.drawImage(imgZombie, -drawSize/2, -drawSize/2, drawSize, drawSize);
    } else {
      ctx.fillStyle = z.type===2?'#338833':z.type===1?'#dd8822':'#882222';
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // HP bar for tanks
    if (z.type===2 && z.hp<z.maxHp) {
      const bw = r*2.5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sx-bw/2, sy-r-10, bw, 4);
      ctx.fillStyle = '#44ff44';
      ctx.fillRect(sx-bw/2, sy-r-10, bw*(z.hp/z.maxHp), 4);
    }
  });

  // Bullets
  ctx.fillStyle = '#ffdd44'; ctx.shadowColor = '#ffdd44'; ctx.shadowBlur = 8;
  bullets.forEach((b) => {
    const sx = b.x-camX, sy = b.y-camY;
    if (sx<-10||sx>W+10||sy<-10||sy>H+10) return;
    ctx.beginPath(); ctx.arc(sx, sy, CONFIG.BULLET_RADIUS, 0, Math.PI*2); ctx.fill();
  });
  ctx.shadowBlur = 0;

  // Player — use image sprite
  const px = player.x-camX, py = player.y-camY;
  if (player.iframeCooldown > 0 && Math.floor(player.iframeCooldown*10)%2===0) ctx.globalAlpha = 0.4;

  ctx.save();
  ctx.translate(px, py);

  // Hit flash glow
  if (player.hitFlash > 0) {
    ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(255,68,68,0.3)';
    ctx.beginPath(); ctx.arc(0, 0, CONFIG.PLAYER_RADIUS+4, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Flip based on aim direction
  const facingLeft = Math.abs(player.angle) > Math.PI/2;
  if (facingLeft) ctx.scale(-1, 1);

  const pSize = CONFIG.PLAYER_RADIUS * 3;
  if (imgPlayer.complete && imgPlayer.naturalWidth > 0) {
    ctx.drawImage(imgPlayer, -pSize/2, -pSize/2, pSize, pSize);
  } else {
    ctx.fillStyle = '#44aaff';
    ctx.beginPath(); ctx.arc(0,0,CONFIG.PLAYER_RADIUS,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // Aim arrow (white ">" marker)
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(player.angle);
  const arrowDist = CONFIG.PLAYER_RADIUS + 14;
  const arrowSize = 8;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(arrowDist + arrowSize, 0);
  ctx.lineTo(arrowDist - arrowSize * 0.4, -arrowSize * 0.7);
  ctx.lineTo(arrowDist - arrowSize * 0.4, arrowSize * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.globalAlpha = 1;

  // Particles
  drawParticles(ctx, camX, camY);

  // Fog edges
  const fogSize = 120;
  const gTop = ctx.createLinearGradient(0,-camY,0,-camY+fogSize);
  gTop.addColorStop(0,'rgba(0,0,0,0.7)'); gTop.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = gTop; ctx.fillRect(0,-camY,W,fogSize);
  const bEdge = CONFIG.MAP_H-camY;
  const gBot = ctx.createLinearGradient(0,bEdge,0,bEdge-fogSize);
  gBot.addColorStop(0,'rgba(0,0,0,0.7)'); gBot.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = gBot; ctx.fillRect(0,bEdge-fogSize,W,fogSize);
  const gLeft = ctx.createLinearGradient(-camX,0,-camX+fogSize,0);
  gLeft.addColorStop(0,'rgba(0,0,0,0.7)'); gLeft.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = gLeft; ctx.fillRect(-camX,0,fogSize,H);
  const rEdge = CONFIG.MAP_W-camX;
  const gRight = ctx.createLinearGradient(rEdge,0,rEdge-fogSize,0);
  gRight.addColorStop(0,'rgba(0,0,0,0.7)'); gRight.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = gRight; ctx.fillRect(rEdge-fogSize,0,fogSize,H);

  updateHUD();
}

// ── HUD ──
function updateHUD() {
  document.getElementById('hp-bar').style.width = `${(player.hp/player.maxHp)*100}%`;
  document.getElementById('hp-bar').style.background = player.hp<30 ? 'linear-gradient(90deg,#cc2222,#ff3333)' : 'linear-gradient(90deg,#22cc44,#44ff66)';
  document.getElementById('ammo-bar').style.width = `${(player.ammo/player.maxAmmo)*100}%`;
  const ammoEl = document.getElementById('ammo-count');
  ammoEl.textContent = `${player.ammo} / ${player.maxAmmo}`;
  ammoEl.className = player.ammo<=5 ? 'hud-value blink-warn' : 'hud-value';
  document.getElementById('wave-label').textContent = `WAVE ${wave}`;
  document.getElementById('score-display').textContent = Math.floor(score);
  document.getElementById('kill-display').textContent = kills;
  const mins = Math.floor(gameTime/60), secs = Math.floor(gameTime%60);
  document.getElementById('time-display').textContent = `${mins}:${secs.toString().padStart(2,'0')}`;
  const streakEl = document.getElementById('kill-streak');
  streakEl.textContent = streakKills>=3 ? `🔥 ${streakKills}x STREAK` : '';
}

// ── GAME STATES ──
function startGame() {
  resetGame(); state = 'playing';
  screenMenu.classList.add('hidden');
  screenGameover.classList.add('hidden');
  hud.classList.remove('hidden');
  pauseOverlay.classList.add('hidden');
}

function gameOver() {
  state = 'gameover'; hud.classList.add('hidden');
  screenGameover.classList.remove('hidden');
  const mins = Math.floor(gameTime/60), secs = Math.floor(gameTime%60);
  document.getElementById('go-time').textContent = `${mins}m ${secs}s`;
  document.getElementById('go-kills').textContent = kills;
  document.getElementById('go-score').textContent = Math.floor(score);
  document.getElementById('go-wave').textContent = wave;
}

function togglePause() {
  if (state==='playing') { state='paused'; pauseOverlay.classList.remove('hidden'); }
  else if (state==='paused') { state='playing'; pauseOverlay.classList.add('hidden'); }
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
window.addEventListener('keydown', (e) => {
  if (e.code==='KeyP'||e.code==='Escape') { if (state==='playing'||state==='paused') togglePause(); }
});

// ── MAIN LOOP ──
let lastTime = performance.now();
function gameLoop(now) {
  const dt = Math.min((now-lastTime)/1000, 0.05);
  lastTime = now;
  if (state==='playing') { update(dt); render(); }
  else if (state==='paused') { render(); }
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
