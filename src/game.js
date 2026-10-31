const canvas = document.getElementById('table');
const ctx = canvas.getContext('2d');
const powerText = document.getElementById('powerText');
const statusText = document.getElementById('statusText');
const modeChip = document.getElementById('modeChip');
const matchMode = document.getElementById('matchMode');
const p1Card = document.getElementById('p1Card');
const p2Card = document.getElementById('p2Card');
const p1Group = document.getElementById('p1Group');
const p2Group = document.getElementById('p2Group');

const TABLE = {
  left: 70,
  top: 70,
  right: 1050,
  bottom: 570,
};

const BALL_RADIUS = 12;
const POCKET_RADIUS = 24;
const POCKETS = [
  { x: TABLE.left, y: TABLE.top },
  { x: 560, y: TABLE.top },
  { x: TABLE.right, y: TABLE.top },
  { x: TABLE.left, y: TABLE.bottom },
  { x: 560, y: TABLE.bottom },
  { x: TABLE.right, y: TABLE.bottom },
];

const BALL_COLORS = {
  1: '#f2d21b', 2: '#1d63d8', 3: '#e3433a', 4: '#7a41c7', 5: '#ee7f1b',
  6: '#188a56', 7: '#8a1d2b', 8: '#0e0e0e', 9: '#f1d11a', 10: '#1d61cf',
  11: '#d73b30', 12: '#7d39c1', 13: '#f07a1c', 14: '#1a8b57', 15: '#8b1f2d',
};

const state = {
  balls: [],
  turn: 1,
  mode: 'local',
  dragging: false,
  dragStart: null,
  cueBall: null,
  ready: true,
  power: 0,
  waitingForAi: false,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createBall(x, y, number) {
  return {
    number,
    x,
    y,
    vx: 0,
    vy: 0,
    r: BALL_RADIUS,
    color: number === 0 ? '#f5f5ef' : BALL_COLORS[number],
    pocketed: false,
  };
}

function setupRack() {
  const balls = [];
  const rackX = 760;
  const rackY = 320;
  const triangleGap = BALL_RADIUS * 2 * 0.96;
  const numbers = [1, 11, 8, 2, 12, 7, 9, 3, 15, 5, 10, 4, 14, 6, 13];
  const rows = 5;
  let rowIndex = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col <= row; col++) {
      const x = rackX + row * triangleGap * 0.86;
      const y = rackY + (col - row / 2) * triangleGap;
      balls.push(createBall(x, y, numbers[rowIndex++]));
    }
  }

  const cueBall = createBall(220, 320, 0);
  balls.push(cueBall);
  state.balls = balls;
  state.cueBall = cueBall;
  state.ready = true;
  state.dragging = false;
  state.power = 0;
  updateStatus();
}

function resetGame() {
  setupRack();
  state.turn = 1;
  state.waitingForAi = false;
  powerText.textContent = '0%';
}

function updateStatus() {
  const text = state.ready ? 'READY' : 'SHOOT';
  statusText.textContent = text;

  p1Card.classList.toggle('active', state.turn === 1 && state.ready);
  p2Card.classList.toggle('active', state.turn === 2 && state.ready);

  if (state.turn === 1) {
    p1Group.textContent = 'TURN';
    p2Group.textContent = 'READY';
  } else {
    p1Group.textContent = 'READY';
    p2Group.textContent = 'TURN';
  }

  modeChip.textContent = state.mode === 'local' ? 'LOCAL' : 'CPU';
  matchMode.textContent = state.mode === 'local' ? '2 Players' : 'VS CPU';
}

function pocketBall(ball) {
  if (ball.pocketed) return;
  ball.pocketed = true;
  ball.vx = 0;
  ball.vy = 0;
  ball.x = -1000;
  ball.y = -1000;
  state.ready = true;
}

function detectPockets() {
  for (const ball of state.balls) {
    if (ball.pocketed) continue;
    for (const pocket of POCKETS) {
      if (Math.hypot(ball.x - pocket.x, ball.y - pocket.y) < POCKET_RADIUS) {
        pocketBall(ball);
        break;
      }
    }
  }
}

function applyCushionCollision(ball) {
  if (ball.x - ball.r < TABLE.left) {
    ball.x = TABLE.left + ball.r;
    ball.vx = Math.abs(ball.vx) * 0.88;
  }
  if (ball.x + ball.r > TABLE.right) {
    ball.x = TABLE.right - ball.r;
    ball.vx = -Math.abs(ball.vx) * 0.88;
  }
  if (ball.y - ball.r < TABLE.top) {
    ball.y = TABLE.top + ball.r;
    ball.vy = Math.abs(ball.vy) * 0.88;
  }
  if (ball.y + ball.r > TABLE.bottom) {
    ball.y = TABLE.bottom - ball.r;
    ball.vy = -Math.abs(ball.vy) * 0.88;
  }
}

function resolveBallCollision(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distSq = dx * dx + dy * dy;
  const minDist = a.r + b.r;
  if (distSq <= 0 || distSq >= minDist * minDist) return;

  const distance = Math.sqrt(distSq) || 0.001;
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = (minDist - distance) / 2;

  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  if (velAlongNormal >= 0) return;

  const impulse = (-(1 + 0.96) * velAlongNormal) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;
}

function stepPhysics(dt) {
  const balls = state.balls.filter(ball => !ball.pocketed);

  for (const ball of balls) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= 0.992;
    ball.vy *= 0.992;

    if (Math.abs(ball.vx) < 0.02) ball.vx = 0;
    if (Math.abs(ball.vy) < 0.02) ball.vy = 0;

    applyCushionCollision(ball);
  }

  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      resolveBallCollision(balls[i], balls[j]);
    }
  }

  detectPockets();

  const anyMoving = state.balls.some(ball => !ball.pocketed && (Math.abs(ball.vx) > 0.03 || Math.abs(ball.vy) > 0.03));
  if (!anyMoving) {
    state.ready = true;
    if (state.mode === 'cpu' && state.turn === 2 && !state.waitingForAi) {
      state.waitingForAi = true;
      setTimeout(() => {
        performCpuShot();
      }, 700);
    }
  }
}

function drawBall(ball) {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fillStyle = ball.number === 0 ? '#f6f6f0' : ball.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.stroke();

  if (ball.number > 0) {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(ball.number), ball.x, ball.y + 1);
  }
}

function drawTable() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0d4d39';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#10754e';
  ctx.fillRect(TABLE.left, TABLE.top, TABLE.right - TABLE.left, TABLE.bottom - TABLE.top);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 3;
  ctx.strokeRect(TABLE.left, TABLE.top, TABLE.right - TABLE.left, TABLE.bottom - TABLE.top);

  for (const pocket of POCKETS) {
    ctx.beginPath();
    ctx.fillStyle = '#05080a';
    ctx.arc(pocket.x, pocket.y, POCKET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const ball of state.balls) {
    if (!ball.pocketed) drawBall(ball);
  }

  if (state.dragging && state.cueBall && state.cueBall.x) {
    const dx = state.dragStart.x - state.cueBall.x;
    const dy = state.dragStart.y - state.cueBall.y;
    const distToCue = Math.hypot(dx, dy);

    if (distToCue > 0) {
      ctx.beginPath();
      ctx.moveTo(state.cueBall.x, state.cueBall.y);
      ctx.lineTo(state.dragStart.x, state.dragStart.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(state.dragStart.x, state.dragStart.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
  }
}

function shootCueFromDrag() {
  if (!state.cueBall || !state.dragStart) return;
  const dx = state.dragStart.x - state.cueBall.x;
  const dy = state.dragStart.y - state.cueBall.y;
  const length = Math.hypot(dx, dy);
  if (length < 12) return;

  const angle = Math.atan2(dy, dx);
  const power = clamp(length / 180, 0.18, 1.1);

  state.cueBall.vx = Math.cos(angle) * 900 * power;
  state.cueBall.vy = Math.sin(angle) * 900 * power;
  state.ready = false;
  state.dragging = false;
  state.dragStart = null;
  state.waitingForAi = false;

  if (state.mode === 'cpu' && state.turn === 1) {
    state.turn = 2;
  } else if (state.mode === 'local') {
    state.turn = state.turn === 1 ? 2 : 1;
  }
  updateStatus();
}

function getPointerPosition(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener('pointerdown', (evt) => {
  if (!state.ready) return;
  const pos = getPointerPosition(evt);
  const cue = state.cueBall;
  const distance = Math.hypot(pos.x - cue.x, pos.y - cue.y);
  if (distance > 80) return;

  state.dragging = true;
  state.dragStart = pos;
});

canvas.addEventListener('pointermove', (evt) => {
  if (!state.dragging) return;
  const pos = getPointerPosition(evt);
  state.dragStart = pos;
  const dx = state.cueBall.x - pos.x;
  const dy = state.cueBall.y - pos.y;
  const power = clamp(Math.hypot(dx, dy) / 180, 0, 1);
  powerText.textContent = `${Math.round(power * 100)}%`;
});

canvas.addEventListener('pointerup', () => {
  if (!state.dragging) return;
  shootCueFromDrag();
  powerText.textContent = '0%';
});

canvas.addEventListener('pointerleave', () => {
  if (state.dragging) {
    shootCueFromDrag();
    powerText.textContent = '0%';
  }
});

function performCpuShot() {
  if (state.mode !== 'cpu' || state.turn !== 2 || !state.ready) return;

  const cue = state.cueBall;
  const target = state.balls.filter(ball => ball.number > 0 && !ball.pocketed)[0];
  if (!target) return;

  const angle = Math.atan2(target.y - cue.y, target.x - cue.x);
  const power = 0.78;
  cue.vx = Math.cos(angle) * 900 * power;
  cue.vy = Math.sin(angle) * 900 * power;
  state.ready = false;
  state.waitingForAi = false;
  state.turn = 1;
  updateStatus();
}

document.getElementById('btnMode').addEventListener('click', () => {
  state.mode = state.mode === 'local' ? 'cpu' : 'local';
  if (state.mode === 'cpu') {
    state.turn = 1;
  }
  updateStatus();
});

document.getElementById('btnReset').addEventListener('click', resetGame);

let lastTime = 0;
function animate(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000 || 0.016, 0.033);
  lastTime = timestamp;

  if (!state.ready) stepPhysics(dt);
  drawTable();
  requestAnimationFrame(animate);
}

setupRack();
updateStatus();
requestAnimationFrame(animate);

window.addEventListener('resize', () => drawTable());
