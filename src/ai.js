import { POCKETS, PLAY, BALL_R, DIFFICULTIES } from './constants.js';
import { validCuePlacement } from './physics.js';

function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function active(balls) {
  return balls.filter(b => !b.potted);
}

export function remainingBalls(balls, group) {
  if (!group) return [];
  return balls.filter(b => !b.potted && b.type === group);
}

function pathClear(balls, ax, ay, bx, by, ignore, clearance = BALL_R * 2 + 2) {
  for (const b of balls) {
    if (b.potted || ignore.includes(b)) continue;
    if (distPointSeg(b.x, b.y, ax, ay, bx, by) < clearance) return false;
  }
  return true;
}

function pocketRisk(ax, ay, bx, by) {
  for (const p of POCKETS) {
    if (distPointSeg(p.x, p.y, ax, ay, bx, by) < p.r + BALL_R * 1.2) return true;
  }
  return false;
}

function targetsFor(game, player) {
  const balls = game.balls;
  if (game.tableOpen) return balls.filter(b => !b.potted && b.type !== 'eight');
  const group = player.group;
  if (!group) return balls.filter(b => !b.potted);
  const own = remainingBalls(balls, group);
  if (own.length === 0) return balls.filter(b => !b.potted && b.type === 'eight');
  return own;
}

function bestPot(game, cue, targets, difficulty) {
  const balls = game.balls;
  const candidates = [];
  for (const ball of targets) {
    if (ball.type === 'eight' && game.tableOpen) continue;
    for (const pocket of POCKETS) {
      const pdx = pocket.x - ball.x;
      const pdy = pocket.y - ball.y;
      const pd = Math.hypot(pdx, pdy);
      if (pd < 1) continue;
      const ox = pdx / pd;
      const oy = pdy / pd;
      const ghost = {
        x: ball.x - ox * (BALL_R * 2 + 0.5),
        y: ball.y - oy * (BALL_R * 2 + 0.5),
      };
      if (ghost.x < PLAY.left + BALL_R + 1 || ghost.x > PLAY.right - BALL_R - 1) continue;
      if (ghost.y < PLAY.top + BALL_R + 1 || ghost.y > PLAY.bottom - BALL_R - 1) continue;

      const cdx = ghost.x - cue.x;
      const cdy = ghost.y - cue.y;
      const cd = Math.hypot(cdx, cdy);
      if (cd < BALL_R * 1.5) continue;
      const cx = cdx / cd;
      const cy = cdy / cd;
      const cut = cx * ox + cy * oy;
      if (cut < 0.24) continue;

      const ignore = [cue, ball];
      if (!pathClear(balls, cue.x, cue.y, ghost.x, ghost.y, ignore, BALL_R * 2 + 3)) continue;
      if (!pathClear(balls, ball.x, ball.y, pocket.x, pocket.y, ignore, BALL_R * 2 + 1.5)) continue;
      if (pocketRisk(cue.x, cue.y, ghost.x, ghost.y)) continue;

      const nearRail = ball.x < PLAY.left + 34 || ball.x > PLAY.right - 34
        || ball.y < PLAY.top + 34 || ball.y > PLAY.bottom - 34;
      const centerPocket = pocket.id === 'tm' || pocket.id === 'bm';
      let score = (cut ** 4) * 100;
      score /= 1 + (cd + pd) / 300;
      score *= centerPocket ? 0.72 : 1.06;
      score *= nearRail ? 0.9 : 1;
      score *= 0.9 + Math.random() * 0.2;

      const power = Math.max(
        0.3,
        Math.min(0.93, 0.3 + (cd + pd) / 1550 + (1 - cut) * 0.22 + (centerPocket ? 0.03 : 0)),
      );

      candidates.push({
        ball, pocket, ghost, angle: Math.atan2(cy, cx), cut, cd, pd, power, score,
      });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  // Casual players occasionally take the second-best look.
  let pick = candidates[0];
  if (difficulty.id === 'casual' && candidates.length > 1 && Math.random() < 0.25) {
    pick = candidates[1];
  }
  return pick;
}

function chooseSafety(game, cue, targets, difficulty) {
  const balls = game.balls;
  const candidates = [];
  for (const ball of targets) {
    if (ball.type === 'eight' && game.tableOpen) continue;
    const dx = ball.x - cue.x;
    const dy = ball.y - cue.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) continue;
    let cx = dx / d;
    let cy = dy / d;

    // Aim a fraction off-center so the cue ball does not follow straight in.
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = (0.3 + Math.random() * 0.7) * side;
    const px = -cy;
    const py = cx;
    const ghostX = ball.x - cx * BALL_R * 2 + px * off * BALL_R * 0.9;
    const ghostY = ball.y - cy * BALL_R * 2 + py * off * BALL_R * 0.9;
    cx = ghostX - cue.x;
    cy = ghostY - cue.y;
    const cl = Math.hypot(cx, cy) || 1;
    cx /= cl;
    cy /= cl;

    if (!pathClear(balls, cue.x, cue.y, ghostX, ghostY, [cue, ball], BALL_R * 2 + 1)) continue;
    if (pocketRisk(cue.x, cue.y, ghostX, ghostY)) continue;

    let score = 50 / (1 + d / 280);
    score *= 0.85 + Math.random() * 0.3;
    candidates.push({
      angle: Math.atan2(cy, cx),
      power: Math.min(0.82, 0.38 + d / 1600),
      score,
      safety: true,
    });
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // Last resort: hit the nearest legal ball straight on.
  const nearest = targets
    .filter(b => !(b.type === 'eight' && game.tableOpen))
    .sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
  if (nearest) {
    return {
      angle: Math.atan2(nearest.y - cue.y, nearest.x - cue.x),
      power: 0.55,
      score: 0,
      safety: true,
    };
  }
  return { angle: Math.random() * Math.PI * 2, power: 0.3, safety: true };
}

export function chooseShot(game, player, difficultyId = 'pro') {
  const difficulty = DIFFICULTIES[difficultyId] || DIFFICULTIES.pro;
  const cue = game.cue;
  if (!cue) return { angle: 0, power: 0.5 };

  if (game.isBreakShot) {
    const rackBalls = active(game.balls).filter(b => b.type !== 'cue');
    const apex = rackBalls.sort((a, b) => a.x - b.x)[0];
    if (!apex) return { angle: 0, power: 0.9 };
    const angle = Math.atan2(apex.y - cue.y, apex.x - cue.x) + (Math.random() - 0.5) * 0.018;
    return {
      angle,
      power: 0.92 + Math.random() * 0.06,
      spin: { x: (Math.random() - 0.5) * 0.15, y: 0 },
      break: true,
    };
  }

  const targets = targetsFor(game, player);
  if (!targets.length) {
    return { angle: Math.random() * Math.PI * 2, power: 0.4, safety: true };
  }

  let choice = bestPot(game, cue, targets, difficulty);
  if (!choice) {
    choice = chooseSafety(game, cue, targets, difficulty);
  }

  let angle = choice.angle;
  const errScale = choice.safety ? difficulty.safetyError * 1.4 : difficulty.aimError;
  angle += randn() * errScale;
  let power = choice.power;
  power *= 1 + randn() * difficulty.powerError;
  power = Math.max(0.16, Math.min(1, power));

  return {
    angle,
    power,
    safety: !!choice.safety,
    target: choice.ball || null,
    pocket: choice.pocket || null,
    spin: { x: (Math.random() - 0.5) * 0.12, y: (Math.random() - 0.5) * 0.1 },
  };
}

export function choosePlacement(game, player, difficultyId = 'pro') {
  const difficulty = DIFFICULTIES[difficultyId] || DIFFICULTIES.pro;
  let best = null;
  const candidates = [];
  for (let ix = 0; ix <= 8; ix++) {
    for (let iy = 0; iy <= 5; iy++) {
      const x = PLAY.left + PLAY.width * (0.1 + (ix / 8) * 0.8);
      const y = PLAY.top + PLAY.height * (0.12 + (iy / 5) * 0.76);
      if (!validCuePlacement(game.balls, game.cue, x, y)) continue;
      const savedX = game.cue.x;
      const savedY = game.cue.y;
      game.cue.x = x;
      game.cue.y = y;
      const targetList = targetsFor(game, player);
      const shot = bestPot(game, game.cue, targetList, difficulty);
      game.cue.x = savedX;
      game.cue.y = savedY;
      if (!shot) continue;
      let score = shot.score - (Math.hypot(x - PLAY.cx, y - PLAY.cy) / PLAY.width) * 6;
      score *= 0.94 + Math.random() * 0.12;
      candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) best = candidates[0];
  if (!best) {
    best = { x: PLAY.left + PLAY.width * 0.25, y: PLAY.cy };
  }
  return best;
}

/** Simple public helper used by tests/tools. */
export function evaluatePot(game, cue, ball, pocket) {
  const pdx = pocket.x - ball.x;
  const pdy = pocket.y - ball.y;
  const pd = Math.hypot(pdx, pdy);
  const ox = pdx / pd;
  const oy = pdy / pd;
  const ghost = { x: ball.x - ox * BALL_R * 2, y: ball.y - oy * BALL_R * 2 };
  const cdx = ghost.x - cue.x;
  const cdy = ghost.y - cue.y;
  const cd = Math.hypot(cdx, cdy);
  const cut = (cdx / cd) * ox + (cdy / cd) * oy;
  const ignore = [cue, ball];
  return Boolean(
    cut > 0.2
    && pathClear(game.balls, cue.x, cue.y, ghost.x, ghost.y, ignore)
    && pathClear(game.balls, ball.x, ball.y, pocket.x, pocket.y, ignore),
  );
}
