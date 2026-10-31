import {
  WORLD, PLAY, BALL_R, MAX_SPEED, CLOTH_FRICTION, DRAG,
  BALL_RESTITUTION, CUSHION_RESTITUTION, CUSHION_TANGENT, STOP_SPEED,
  POCKETS, GAP_CORNER, GAP_SIDE, RACK, HEAD_SPOT, BALL_INFO,
} from './constants.js';

let nextBallId = 1;

function makeBall(number, x, y) {
  const info = number === 0
    ? { color: '#f7f5ec', type: 'cue' }
    : BALL_INFO[number];
  return {
    id: nextBallId++,
    number,
    x, y,
    vx: 0, vy: 0,
    r: BALL_R,
    color: info.color,
    type: info.type,
    potted: false,
    pocket: null,
    dropT: 0,
    rotSeed: Math.random() * Math.PI * 2,
  };
}

export function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Build a valid 8-ball rack. Returns { balls, cue }. */
export function createRack() {
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const place = new Array(15).fill(null);
  const slots = [];
  let index = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      slots.push({
        index,
        row,
        i,
        x: RACK.x + row * RACK.gap,
        y: RACK.y + (i - row / 2) * (BALL_R * 2 + 0.02),
      });
      index++;
    }
  }

  // The 8 always sits in the middle of the third row.
  const eightSlot = slots.find(s => s.row === 2 && s.i === 1);
  place[eightSlot.index] = 8;

  // Back-row corners must be one solid and one stripe.
  const backRow = slots.filter(s => s.row === 4);
  const cornerA = backRow[0].index;
  const cornerB = backRow[4].index;
  const shuffledSolids = shuffled(solids);
  const shuffledStripes = shuffled(stripes);
  place[cornerA] = shuffledSolids.pop();
  place[cornerB] = shuffledStripes.pop();

  const rest = shuffled([...shuffledSolids, ...shuffledStripes]);
  for (const slot of slots) {
    if (place[slot.index] == null) place[slot.index] = rest.pop();
  }

  const balls = slots.map((slot, i) => makeBall(place[i], slot.x, slot.y));
  const cue = makeBall(0, HEAD_SPOT.x, HEAD_SPOT.y);
  balls.push(cue);
  return { balls, cue };
}

export function resetBallPositions(balls) {
  const { balls: fresh } = createRack();
  // Reuse objects so external references (cue) stay valid.
  for (const b of balls) {
    const freshBall = fresh.find(f => f.number === b.number);
    if (!freshBall) continue;
    b.x = freshBall.x;
    b.y = freshBall.y;
    b.vx = 0;
    b.vy = 0;
    b.potted = false;
    b.pocket = null;
    b.dropT = 0;
  }
}

export function activeBalls(balls) {
  return balls.filter(b => !b.potted);
}

export function allStopped(balls) {
  for (const b of balls) {
    if (b.potted) continue;
    if (b.vx * b.vx + b.vy * b.vy > STOP_SPEED * STOP_SPEED) return false;
  }
  return true;
}

export function speedOf(b) {
  return Math.hypot(b.vx, b.vy);
}

function leftGap(y) {
  return y < PLAY.top + GAP_CORNER || y > PLAY.bottom - GAP_CORNER;
}
function topGap(x) {
  return x < PLAY.left + GAP_CORNER || x > PLAY.right - GAP_CORNER
    || Math.abs(x - PLAY.cx) < GAP_SIDE;
}

function nearestPocket(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const p of POCKETS) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return { pocket: best, dist: bestD };
}

function potBall(ball, pocket, shot, events) {
  ball.potted = true;
  ball.pocket = pocket;
  ball.dropT = 0;
  ball.vx = 0;
  ball.vy = 0;
  if (shot) {
    if (ball.type === 'cue') shot.cueScratched = true;
    else shot.potted.push(ball);
  }
  events.push({ type: 'pocket', ball, pocket });
}

function applyCueSpin(a, b, nx, ny, shot, speedBefore, cueDirX, cueDirY) {
  if (!shot || shot.spinApplied) return;
  shot.spinApplied = true;
  const spin = shot.spin || { x: 0, y: 0 };
  const cue = a.type === 'cue' ? a : b;
  const obj = a.type === 'cue' ? b : a;
  if (!cue || !obj || cue.type !== 'cue' || obj.type === 'cue') return;
  if (Math.abs(spin.x) < 0.01 && Math.abs(spin.y) < 0.01) return;

  const impact = Math.max(120, speedBefore);
  const dirX = cueDirX;
  const dirY = cueDirY;

  // Follow / draw: add velocity along the cue's original line of travel.
  const follow = spin.y * impact * 0.26;
  cue.vx += dirX * follow;
  cue.vy += dirY * follow;

  // Side spin: squirt the cue ball sideways and throw the object ball a little.
  const rx = -dirY;
  const ry = dirX;
  cue.vx += rx * spin.x * impact * 0.2;
  cue.vy += ry * spin.x * impact * 0.2;
  obj.vx += rx * spin.x * impact * 0.022;
  obj.vy += ry * spin.x * impact * 0.022;

  // Never let spin create an unrealistic speed boost.
  const cs = speedOf(cue);
  const cap = speedBefore * 1.26 + 60;
  if (cs > cap) {
    cue.vx *= cap / cs;
    cue.vy *= cap / cs;
  }
}

function collideBalls(a, b, shot, events) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = a.r + b.r;
  if (dist >= minDist || dist === 0) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const along = rvx * nx + rvy * ny;
  if (along >= 0) return;

  const speedBefore = Math.hypot(rvx, rvy);
  const cueDir = a.type === 'cue'
    ? { x: a.vx, y: a.vy }
    : (b.type === 'cue' ? { x: b.vx, y: b.vy } : null);

  const j = -(1 + BALL_RESTITUTION) * along / 2;
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;

  // A touch of tangential friction makes throws look natural.
  const tx = -ny;
  const ty = nx;
  const tangential = rvx * tx + rvy * ty;
  const friction = tangential * 0.018;
  a.vx += friction * tx;
  a.vy += friction * ty;
  b.vx -= friction * tx;
  b.vy -= friction * ty;

  if (shot) {
    if (!shot.firstHit) {
      if (a.type === 'cue' && b.type !== 'cue') shot.firstHit = b;
      else if (b.type === 'cue' && a.type !== 'cue') shot.firstHit = a;
      if (shot.firstHit) {
        shot.firstHitSpeed = speedBefore;
        shot.firstContact = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    }
    if (cueDir && (a.type === 'cue' || b.type === 'cue')) {
      const cl = Math.hypot(cueDir.x, cueDir.y) || 1;
      applyCueSpin(a, b, nx, ny, shot, speedBefore, cueDir.x / cl, cueDir.y / cl);
    }
  }

  if (speedBefore > 35) {
    events.push({
      type: 'hit',
      speed: speedBefore,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      cue: a.type === 'cue' || b.type === 'cue',
    });
  }
}

function collideCushions(b, shot, events) {
  const r = b.r;
  let bounced = 0;
  let nx = 0;
  let ny = 0;

  if (b.x - r < PLAY.left && !leftGap(b.y)) {
    if (b.vx < 0) {
      b.x = PLAY.left + r;
      b.vx = -b.vx * CUSHION_RESTITUTION;
      b.vy *= CUSHION_TANGENT;
      bounced = Math.hypot(b.vx, b.vy);
      nx = 1;
    }
  } else if (b.x + r > PLAY.right && !leftGap(b.y)) {
    if (b.vx > 0) {
      b.x = PLAY.right - r;
      b.vx = -b.vx * CUSHION_RESTITUTION;
      b.vy *= CUSHION_TANGENT;
      bounced = Math.hypot(b.vx, b.vy);
      nx = -1;
    }
  }

  if (b.y - r < PLAY.top && !topGap(b.x)) {
    if (b.vy < 0) {
      b.y = PLAY.top + r;
      b.vy = -b.vy * CUSHION_RESTITUTION;
      b.vx *= CUSHION_TANGENT;
      bounced = Math.max(bounced, Math.hypot(b.vx, b.vy));
      ny = 1;
    }
  } else if (b.y + r > PLAY.bottom && !topGap(b.x)) {
    if (b.vy > 0) {
      b.y = PLAY.bottom - r;
      b.vy = -b.vy * CUSHION_RESTITUTION;
      b.vx *= CUSHION_TANGENT;
      bounced = Math.max(bounced, Math.hypot(b.vx, b.vy));
      ny = -1;
    }
  }

  if (shot && bounced > 0) {
    shot.railHits += 1;
    if (shot.firstHit) shot.railAfterContact = true;
  }
  if (bounced > 30) {
    events.push({ type: 'rail', speed: bounced, x: b.x, y: b.y, nx, ny });
  }
}

function applyPocketForces(b, dt) {
  for (const p of POCKETS) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > 67 || d === 0) continue;
    const pull = (1 - d / 67) ** 2 * 230 * dt;
    b.vx += (dx / d) * pull;
    b.vy += (dy / d) * pull;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
      b.vx *= MAX_SPEED / sp;
      b.vy *= MAX_SPEED / sp;
    }
  }
}

function stepOnce(balls, dt, shot, events) {
  const live = balls.filter(b => !b.potted);
  for (const b of live) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const loss = (CLOTH_FRICTION + sp * DRAG) * dt;
      const next = Math.max(0, sp - loss);
      if (next <= STOP_SPEED) {
        b.vx = 0;
        b.vy = 0;
      } else {
        b.vx *= next / sp;
        b.vy *= next / sp;
      }
    }
  }

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      collideBalls(live[i], live[j], shot, events);
    }
  }

  for (const b of live) {
    if (b.potted) continue;
    collideCushions(b, shot, events);
    applyPocketForces(b, dt);
    for (const p of POCKETS) {
      if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
        potBall(b, p, shot, events);
        break;
      }
    }
    if (!b.potted) {
      const outX = b.x < PLAY.left - 26 || b.x > PLAY.right + 26;
      const outY = b.y < PLAY.top - 26 || b.y > PLAY.bottom + 26;
      if (outX || outY) {
        const nearest = nearestPocket(b.x, b.y);
        potBall(b, nearest.pocket, shot, events);
      }
    }
  }
}

export function stepWorld(balls, dt, shot, events = []) {
  let maxSpeed = 0;
  for (const b of balls) {
    if (b.potted) continue;
    const s = Math.hypot(b.vx, b.vy);
    if (s > maxSpeed) maxSpeed = s;
  }
  if (maxSpeed === 0) return events;

  const steps = Math.min(26, Math.max(1, Math.ceil((maxSpeed * dt) / (BALL_R * 0.32))));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) stepOnce(balls, h, shot, events);
  return events;
}

export function advanceDrops(balls, dt) {
  for (const b of balls) {
    if (!b.potted) continue;
    if (b.dropT < 1) b.dropT = Math.min(1, b.dropT + dt * 3.4);
  }
}

export function updateShotSpin(shot) {
  // Spin is a single-use impulse when the cue first contacts a ball.
  if (!shot) return;
}

/** Cast a ray from the cue ball and return the first object-ball impact. */
export function raycast(balls, cue, dirX, dirY) {
  let best = null;
  let bestT = Infinity;
  for (const b of balls) {
    if (b === cue || b.potted) continue;
    const ox = b.x - cue.x;
    const oy = b.y - cue.y;
    const proj = ox * dirX + oy * dirY;
    if (proj <= 0) continue;
    const perp2 = ox * ox + oy * oy - proj * proj;
    const R = b.r + cue.r;
    if (perp2 > R * R) continue;
    const t = proj - Math.sqrt(R * R - perp2);
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = b;
    }
  }

  // Distance to the playing surface boundary.
  let wallT = Infinity;
  let wallNx = 0;
  let wallNy = 0;
  if (dirX > 1e-6) { const t = (PLAY.right - cue.x) / dirX; if (t >= 0 && t < wallT) { wallT = t; wallNx = -1; wallNy = 0; } }
  if (dirX < -1e-6) { const t = (PLAY.left - cue.x) / dirX; if (t >= 0 && t < wallT) { wallT = t; wallNx = 1; wallNy = 0; } }
  if (dirY > 1e-6) { const t = (PLAY.bottom - cue.y) / dirY; if (t >= 0 && t < wallT) { wallT = t; wallNx = 0; wallNy = -1; } }
  if (dirY < -1e-6) { const t = (PLAY.top - cue.y) / dirY; if (t >= 0 && t < wallT) { wallT = t; wallNx = 0; wallNy = 1; } }

  if (best && bestT < wallT) {
    const ghost = { x: cue.x + dirX * bestT, y: cue.y + dirY * bestT };
    let odx = best.x - ghost.x;
    let ody = best.y - ghost.y;
    const ol = Math.hypot(odx, ody) || 1;
    odx /= ol;
    ody /= ol;
    const dot = dirX * odx + dirY * ody;
    let tx = dirX - odx * dot;
    let ty = dirY - ody * dot;
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-5) { tx /= tl; ty /= tl; } else { tx = 0; ty = 0; }
    return {
      hit: best, t: bestT, ghost, objDir: { x: odx, y: ody },
      cueDir: { x: tx, y: ty }, dot,
      wall: null,
    };
  }

  return {
    hit: null,
    t: wallT,
    ghost: { x: cue.x + dirX * wallT, y: cue.y + dirY * wallT },
    objDir: null,
    cueDir: null,
    dot: 0,
    wall: { nx: wallNx, ny: wallNy },
  };
}

export function validCuePlacement(balls, cue, x, y) {
  if (x < PLAY.left + BALL_R + 2 || x > PLAY.right - BALL_R - 2) return false;
  if (y < PLAY.top + BALL_R + 2 || y > PLAY.bottom - BALL_R - 2) return false;
  for (const p of POCKETS) {
    if (Math.hypot(x - p.x, y - p.y) < p.r + BALL_R * 1.15) return false;
  }
  for (const b of balls) {
    if (b === cue || b.potted) continue;
    if (Math.hypot(x - b.x, y - b.y) < BALL_R * 2 + 2) return false;
  }
  return true;
}

export { makeBall };
