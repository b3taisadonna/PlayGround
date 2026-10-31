import {
  WORLD, PLAY, BALL_R, POCKETS, THEMES,
} from './constants.js';
import { raycast } from './physics.js';

const TAU = Math.PI * 2;
const CENTER = { x: WORLD.w / 2, y: WORLD.h / 2 };

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - (1 - t) ** 3; }

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
function shade(hex, amount) {
  const c = hexToRgb(hex);
  const f = (v) => clamp(Math.round(v + 255 * amount), 0, 255);
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}
function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const f = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${f(ca.r, cb.r)},${f(ca.g, cb.g)},${f(ca.b, cb.b)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.dpr = 1;
    this.cssW = 1;
    this.cssH = 1;
    this.scale = 1;
    this.angle = 0;
    this.portrait = false;
    this.camX = 0;
    this.camY = 0;
    this.offsetX = 0;
    this.theme = THEMES.classic;
    this.tableCache = null;
    this.ballSprites = new Map();
    this.time = 0;
    this.particles = [];
    this.dust = this.makeDust();
    this.confetti = [];
    this.flash = 0;
    this.resizeObserver = null;
    this.resize();
  }

  makeDust() {
    const rnd = seeded(99);
    return Array.from({ length: 26 }, () => ({
      x: 120 + rnd() * 880,
      y: 100 + rnd() * 440,
      s: 0.5 + rnd() * 1.5,
      a: 0.08 + rnd() * 0.16,
      vx: (rnd() - 0.5) * 5,
      vy: -3 - rnd() * 6,
      phase: rnd() * TAU,
    }));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  setTheme(id) {
    this.theme = THEMES[id] || THEMES.classic;
    this.tableCache = null;
  }

  updateCamera(menuOpen, inGame) {
    this.portrait = this.cssH > this.cssW * 1.03;
    const rotatedW = this.portrait ? WORLD.h : WORLD.w;
    const rotatedH = this.portrait ? WORLD.w : WORLD.h;

    // Short landscape phones use a full-screen stage with floating controls,
    // so reserve room for the top bar and the HUD strip.
    this.shortLandscape = !this.portrait && this.cssH < 560;
    if (this.shortLandscape) {
      const padX = 10;
      const padTop = 48;
      const padBottom = 62;
      this.scale = Math.min(
        (this.cssW - padX * 2) / WORLD.w,
        (this.cssH - padTop - padBottom) / WORLD.h,
      );
      this.angle = 0;
      this.offsetX = 0;
      this.camX = this.cssW / 2 + (menuOpen ? this.cssW * 0.16 : 0);
      this.camY = padTop + (this.cssH - padTop - padBottom) / 2;
      return;
    }

    const pad = this.cssW < 700 ? 10 : 22;
    this.scale = Math.min((this.cssW - pad * 2) / rotatedW, (this.cssH - pad * 2) / rotatedH);
    this.angle = this.portrait ? -Math.PI / 2 : 0;
    this.camX = this.cssW / 2;
    this.camY = this.cssH / 2;
    this.offsetX = menuOpen && !this.portrait && this.cssW > 980 ? this.cssW * 0.145 : 0;
    this.camX += this.offsetX * 0.35;
  }

  screenToWorld(px, py) {
    const dx = (px - this.camX) / this.scale;
    const dy = (py - this.camY) / this.scale;
    const c = Math.cos(-this.angle);
    const s = Math.sin(-this.angle);
    return {
      x: dx * c - dy * s + CENTER.x,
      y: dx * s + dy * c + CENTER.y,
    };
  }

  worldToScreen(wx, wy) {
    const dx = wx - CENTER.x;
    const dy = wy - CENTER.y;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return {
      x: (dx * c - dy * s) * this.scale + this.camX,
      y: (dx * s + dy * c) * this.scale + this.camY,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Static table                                                        */
  /* ------------------------------------------------------------------ */

  createClothPattern() {
    const size = 96;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const rnd = seeded(7);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rnd();
      const light = v > 0.5;
      const a = Math.floor(rnd() * 15);
      img.data[i] = light ? 255 : 0;
      img.data[i + 1] = light ? 255 : 0;
      img.data[i + 2] = light ? 255 : 0;
      img.data[i + 3] = a;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  buildTableCache() {
    const c = document.createElement('canvas');
    const S = 2;
    c.width = WORLD.w * S;
    c.height = WORLD.h * S;
    const g = c.getContext('2d');
    g.scale(S, S);
    const t = this.theme;

    // Drop shadow beneath the table.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.62)';
    g.shadowBlur = 34;
    g.shadowOffsetY = 16;
    roundRect(g, 30, 30, WORLD.w - 60, WORLD.h - 60, 52);
    g.fillStyle = '#0b0705';
    g.fill();
    g.restore();

    // Wooden frame.
    const wood = g.createLinearGradient(30, 30, WORLD.w - 30, WORLD.h - 30);
    wood.addColorStop(0, t.wood1);
    wood.addColorStop(0.38, shade(t.wood1, 0.04));
    wood.addColorStop(0.62, t.wood2);
    wood.addColorStop(1, t.wood3);
    roundRect(g, 30, 30, WORLD.w - 60, WORLD.h - 60, 52);
    g.fillStyle = wood;
    g.fill();

    // Wood grain + edge lighting.
    g.save();
    roundRect(g, 30, 30, WORLD.w - 60, WORLD.h - 60, 52);
    g.clip();
    const rnd = seeded(12);
    for (let i = 0; i < 46; i++) {
      const y = 30 + rnd() * (WORLD.h - 60);
      g.beginPath();
      g.moveTo(24, y);
      g.bezierCurveTo(300, y + (rnd() - 0.5) * 20, 760, y + (rnd() - 0.5) * 24, WORLD.w - 20, y + (rnd() - 0.5) * 14);
      g.strokeStyle = `rgba(${rnd() > 0.5 ? '255,226,176' : '0,0,0'},${0.018 + rnd() * 0.035})`;
      g.lineWidth = 0.7 + rnd() * 1.8;
      g.stroke();
    }
    g.restore();

    // Gold hairline trim and inner bevel.
    roundRect(g, 33, 33, WORLD.w - 66, WORLD.h - 66, 49);
    g.strokeStyle = 'rgba(255,220,150,0.22)';
    g.lineWidth = 1.2;
    g.stroke();
    roundRect(g, 50, 50, WORLD.w - 100, WORLD.h - 100, 40);
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2.2;
    g.stroke();
    roundRect(g, 52, 52, WORLD.w - 104, WORLD.h - 104, 38);
    g.strokeStyle = 'rgba(255,235,190,0.10)';
    g.lineWidth = 1;
    g.stroke();

    // Felt.
    g.save();
    roundRect(g, PLAY.left, PLAY.top, PLAY.width, PLAY.height, 9);
    g.clip();
    const felt = g.createRadialGradient(PLAY.cx - 110, PLAY.cy - 90, 60, PLAY.cx, PLAY.cy, 640);
    felt.addColorStop(0, t.center);
    felt.addColorStop(0.48, t.mid);
    felt.addColorStop(1, t.edge);
    g.fillStyle = felt;
    g.fillRect(PLAY.left, PLAY.top, PLAY.width, PLAY.height);

    const pattern = g.createPattern(this.createClothPattern(), 'repeat');
    g.globalAlpha = 0.55;
    g.fillStyle = pattern;
    g.fillRect(PLAY.left, PLAY.top, PLAY.width, PLAY.height);
    g.globalAlpha = 1;

    // Broad soft light from the top-left.
    const light = g.createRadialGradient(PLAY.left + 270, PLAY.top + 80, 20, PLAY.left + 270, PLAY.top + 80, 700);
    light.addColorStop(0, 'rgba(255,255,255,0.11)');
    light.addColorStop(0.45, 'rgba(255,255,255,0.035)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = light;
    g.fillRect(PLAY.left, PLAY.top, PLAY.width, PLAY.height);

    // Darker corners and inner vignette.
    const vig = g.createRadialGradient(PLAY.cx, PLAY.cy, 260, PLAY.cx, PLAY.cy, 700);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(0.78, 'rgba(0,0,0,0.06)');
    vig.addColorStop(1, 'rgba(0,0,0,0.30)');
    g.fillStyle = vig;
    g.fillRect(PLAY.left, PLAY.top, PLAY.width, PLAY.height);

    // Head string + foot spot.
    g.strokeStyle = 'rgba(255,255,255,0.055)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PLAY.left + PLAY.width * 0.235, PLAY.top + 5);
    g.lineTo(PLAY.left + PLAY.width * 0.235, PLAY.bottom - 5);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.beginPath();
    g.arc(716, PLAY.cy, 2.4, 0, TAU);
    g.fill();

    // Faint felt emblem.
    g.save();
    g.translate(PLAY.cx, PLAY.cy + 96);
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, 31, 0, TAU);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 25, 0, TAU);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.font = '900 30px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('8', 0, 1);
    g.font = '700 10px Arial, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.038)';
    g.fillText('B A L L   P O O L', 0, 52);
    g.restore();

    g.restore();

    // Inner cushion shadow cast onto the cloth.
    const shadowColor = 'rgba(0,0,0,0.30)';
    const sh = 11;
    let grad = g.createLinearGradient(0, PLAY.top, 0, PLAY.top + sh);
    grad.addColorStop(0, shadowColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(PLAY.left + 4, PLAY.top, PLAY.width - 8, sh);

    grad = g.createLinearGradient(0, PLAY.bottom, 0, PLAY.bottom - sh);
    grad.addColorStop(0, shadowColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(PLAY.left + 4, PLAY.bottom - sh, PLAY.width - 8, sh);

    grad = g.createLinearGradient(PLAY.left, 0, PLAY.left + sh, 0);
    grad.addColorStop(0, shadowColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(PLAY.left, PLAY.top + 4, sh, PLAY.height - 8);

    grad = g.createLinearGradient(PLAY.right, 0, PLAY.right - sh, 0);
    grad.addColorStop(0, shadowColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(PLAY.right - sh, PLAY.top + 4, sh, PLAY.height - 8);

    // Cushions with pocket gaps.
    const segments = this.cushionSegments();
    for (const s of segments) this.drawCushion(g, s, t);

    // Rail sights.
    const sightPositionsX = [1, 2, 3, 5, 6, 7];
    for (const i of sightPositionsX) {
      const x = PLAY.left + (PLAY.width / 8) * i;
      this.drawSight(g, x, 41, t, 0);
      this.drawSight(g, x, WORLD.h - 41, t, 0);
    }
    for (const i of sightPositionsX) {
      const y = PLAY.top + (PLAY.height / 8) * i;
      this.drawSight(g, 41, y, t, Math.PI / 2);
      this.drawSight(g, WORLD.w - 41, y, t, Math.PI / 2);
    }

    // Pockets punch through felt, cushions and frame.
    for (const p of POCKETS) this.drawPocket(g, p);

    this.tableCache = c;
  }

  cushionSegments() {
    const gap = 52;
    const sideGap = 31;
    const t0 = PLAY.top;
    const t1 = PLAY.bottom;
    const l = PLAY.left;
    const r = PLAY.right;
    const topY = 52;
    const thick = 28;
    return [
      { x: l + gap, y: topY, w: (PLAY.cx - sideGap) - (l + gap), h: thick, side: 'top' },
      { x: PLAY.cx + sideGap, y: topY, w: (r - gap) - (PLAY.cx + sideGap), h: thick, side: 'top' },
      { x: l + gap, y: PLAY.bottom, w: (PLAY.cx - sideGap) - (l + gap), h: thick, side: 'bottom' },
      { x: PLAY.cx + sideGap, y: PLAY.bottom, w: (r - gap) - (PLAY.cx + sideGap), h: thick, side: 'bottom' },
      { x: 52, y: t0 + gap, w: 28, h: (t1 - gap) - (t0 + gap), side: 'left' },
      { x: PLAY.right, y: t0 + gap, w: 28, h: (t1 - gap) - (t0 + gap), side: 'right' },
    ];
  }

  drawCushion(g, s, t) {
    g.save();
    if (s.side === 'top') {
      const grd = g.createLinearGradient(0, s.y, 0, s.y + s.h);
      grd.addColorStop(0, shade(t.edge, -0.10));
      grd.addColorStop(0.62, t.rim);
      grd.addColorStop(1, shade(t.center, -0.22));
      g.fillStyle = grd;
      roundRect(g, s.x, s.y, s.w, s.h, 7);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(s.x + 4, s.y + s.h - 1.5);
      g.lineTo(s.x + s.w - 4, s.y + s.h - 1.5);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.30)';
      g.beginPath();
      g.moveTo(s.x + 2, s.y + s.h + 2.5);
      g.lineTo(s.x + s.w - 2, s.y + s.h + 2.5);
      g.stroke();
    } else if (s.side === 'bottom') {
      const grd = g.createLinearGradient(0, s.y + s.h, 0, s.y);
      grd.addColorStop(0, shade(t.edge, -0.10));
      grd.addColorStop(0.62, t.rim);
      grd.addColorStop(1, shade(t.center, -0.22));
      g.fillStyle = grd;
      roundRect(g, s.x, s.y, s.w, s.h, 7);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(s.x + 4, s.y + 1.5);
      g.lineTo(s.x + s.w - 4, s.y + 1.5);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.30)';
      g.beginPath();
      g.moveTo(s.x + 2, s.y - 2.5);
      g.lineTo(s.x + s.w - 2, s.y - 2.5);
      g.stroke();
    } else if (s.side === 'left') {
      const grd = g.createLinearGradient(s.x, 0, s.x + s.w, 0);
      grd.addColorStop(0, shade(t.edge, -0.10));
      grd.addColorStop(0.62, t.rim);
      grd.addColorStop(1, shade(t.center, -0.22));
      g.fillStyle = grd;
      roundRect(g, s.x, s.y, s.w, s.h, 7);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(s.x + s.w - 1.5, s.y + 4);
      g.lineTo(s.x + s.w - 1.5, s.y + s.h - 4);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.30)';
      g.beginPath();
      g.moveTo(s.x + s.w + 2.5, s.y + 2);
      g.lineTo(s.x + s.w + 2.5, s.y + s.h - 2);
      g.stroke();
    } else {
      const grd = g.createLinearGradient(s.x + s.w, 0, s.x, 0);
      grd.addColorStop(0, shade(t.edge, -0.10));
      grd.addColorStop(0.62, t.rim);
      grd.addColorStop(1, shade(t.center, -0.22));
      g.fillStyle = grd;
      roundRect(g, s.x, s.y, s.w, s.h, 7);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(s.x + 1.5, s.y + 4);
      g.lineTo(s.x + 1.5, s.y + s.h - 4);
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.30)';
      g.beginPath();
      g.moveTo(s.x - 2.5, s.y + 2);
      g.lineTo(s.x - 2.5, s.y + s.h - 2);
      g.stroke();
    }
    g.restore();
  }

  drawSight(g, x, y, t, rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot || 0);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.moveTo(0, -4.4);
    g.lineTo(4.4, 0);
    g.lineTo(0, 4.4);
    g.lineTo(-4.4, 0);
    g.closePath();
    g.fill();
    g.fillStyle = t.sight;
    g.globalAlpha = 0.86;
    g.beginPath();
    g.moveTo(0, -3.1);
    g.lineTo(3.1, 0);
    g.lineTo(0, 3.1);
    g.lineTo(-3.1, 0);
    g.closePath();
    g.fill();
    g.restore();
  }

  drawPocket(g, p) {
    g.save();
    // Leather surround.
    const ring = g.createRadialGradient(p.x, p.y - 5, 10, p.x, p.y, 36);
    ring.addColorStop(0, '#23150c');
    ring.addColorStop(0.7, '#120a06');
    ring.addColorStop(1, '#3a2414');
    g.fillStyle = ring;
    g.beginPath();
    g.arc(p.x, p.y, 32, 0, TAU);
    g.fill();

    // Metallic rim.
    g.strokeStyle = 'rgba(196,150,76,0.62)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(p.x, p.y, 30.5, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(255,226,165,0.16)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(p.x, p.y, 33.4, 0, TAU);
    g.stroke();

    // The hole itself.
    const hole = g.createRadialGradient(p.x - 2, p.y - 3, 2, p.x, p.y, 26);
    hole.addColorStop(0, '#000000');
    hole.addColorStop(0.72, '#020202');
    hole.addColorStop(1, '#0d0a07');
    g.fillStyle = hole;
    g.beginPath();
    g.arc(p.x, p.y, 25.5, 0, TAU);
    g.fill();

    // Inner lip highlight.
    g.strokeStyle = 'rgba(255,255,255,0.055)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(p.x, p.y, 24, Math.PI * 0.92, Math.PI * 1.62);
    g.stroke();
    g.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Ball sprites                                                        */
  /* ------------------------------------------------------------------ */

  makeBallSprite(ball) {
    const S = 96;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const cx = S / 2;
    const cy = S / 2;
    const r = 44;
    const base = ball.color;

    const isStripe = ball.type === 'stripe';
    const isCue = ball.type === 'cue';

    if (isCue) {
      const grd = g.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.1, cx, cy, r * 1.06);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.5, '#f7f4e9');
      grd.addColorStop(0.84, '#e3ded0');
      grd.addColorStop(1, '#b8b2a2');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    } else if (isStripe) {
      const grd = g.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.08, cx, cy, r * 1.07);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.52, '#f6f3e8');
      grd.addColorStop(0.85, '#e2ddcf');
      grd.addColorStop(1, '#aaa596');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();

      g.save();
      g.beginPath();
      g.arc(cx, cy, r - 0.5, 0, TAU);
      g.clip();
      const bandTop = cy - r * 0.52;
      const bandH = r * 1.04;
      const band = g.createLinearGradient(0, bandTop, 0, bandTop + bandH);
      band.addColorStop(0, shade(base, -0.18));
      band.addColorStop(0.24, shade(base, 0.10));
      band.addColorStop(0.5, base);
      band.addColorStop(0.76, shade(base, -0.10));
      band.addColorStop(1, shade(base, -0.24));
      g.fillStyle = band;
      g.fillRect(cx - r, bandTop, r * 2, bandH);
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.fillRect(cx - r, bandTop + bandH * 0.12, r * 2, bandH * 0.13);
      g.restore();
    } else {
      const grd = g.createRadialGradient(cx - r * 0.36, cy - r * 0.42, r * 0.06, cx, cy, r * 1.07);
      grd.addColorStop(0, mixHex(base, '#ffffff', 0.44));
      grd.addColorStop(0.3, mixHex(base, '#ffffff', 0.13));
      grd.addColorStop(0.68, base);
      grd.addColorStop(0.92, shade(base, -0.22));
      grd.addColorStop(1, shade(base, -0.34));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fill();
    }

    // Subtle cloth reflections / rim.
    g.save();
    g.beginPath();
    g.arc(cx, cy, r - 0.6, 0, TAU);
    g.clip();
    const rim = g.createRadialGradient(cx + r * 0.3, cy + r * 0.35, r * 0.2, cx, cy, r);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(0.72, 'rgba(0,0,0,0.05)');
    rim.addColorStop(1, 'rgba(0,0,0,0.33)');
    g.fillStyle = rim;
    g.fillRect(0, 0, S, S);

    const sheen = g.createLinearGradient(cx - r, cy - r, cx + r * 0.3, cy + r * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.20)');
    sheen.addColorStop(0.34, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(0, 0, S, S);
    g.restore();

    // Number badge.
    if (!isCue) {
      const badgeR = r * 0.42;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.22)';
      g.shadowBlur = 2.2;
      g.shadowOffsetY = 0.8;
      const bg = g.createRadialGradient(cx - badgeR * 0.35, cy - badgeR * 0.4, 1, cx, cy, badgeR);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.75, '#f7f4e8');
      bg.addColorStop(1, '#ddd7c8');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(cx, cy, badgeR, 0, TAU);
      g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.lineWidth = 0.8;
      g.stroke();

      g.fillStyle = ball.number === 8 ? '#151515' : '#202020';
      g.font = `900 ${Math.round(r * 0.52)}px "Arial Black", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(ball.number), cx, cy + r * 0.015);
      g.restore();
    }

    // Specular highlight.
    const spec = g.createRadialGradient(cx - r * 0.38, cy - r * 0.44, 0, cx - r * 0.38, cy - r * 0.44, r * 0.55);
    spec.addColorStop(0, 'rgba(255,255,255,0.70)');
    spec.addColorStop(0.35, 'rgba(255,255,255,0.18)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spec;
    g.beginPath();
    g.arc(cx - r * 0.38, cy - r * 0.44, r * 0.55, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.88)';
    g.beginPath();
    g.ellipse(cx - r * 0.4, cy - r * 0.47, r * 0.13, r * 0.085, -0.6, 0, TAU);
    g.fill();

    // Outer edge.
    g.strokeStyle = 'rgba(0,0,0,0.34)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(cx, cy, r - 0.7, 0, TAU);
    g.stroke();

    return c;
  }

  getSprite(ball) {
    const key = ball.type === 'cue' ? 'cue' : ball.number;
    if (!this.ballSprites.has(key)) {
      this.ballSprites.set(key, this.makeBallSprite(ball));
    }
    return this.ballSprites.get(key);
  }

  /* ------------------------------------------------------------------ */
  /* Main render                                                         */
  /* ------------------------------------------------------------------ */

  render(game, dt = 0.016) {
    this.time += dt;
    this.resize();
    this.updateCamera(game.menuOpen, game.inGame);
    this.updateParticles(dt, game);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.translate(this.camX, this.camY);
    ctx.rotate(this.angle);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-CENTER.x, -CENTER.y);

    if (!this.tableCache) this.buildTableCache();
    ctx.drawImage(this.tableCache, 0, 0, WORLD.w, WORLD.h);

    this.drawFeltAmbience(ctx, game);
    this.drawDust(ctx, dt, game);
    this.drawBalls(ctx, game);

    if (game.inGame) {
      if (game.ballInHand && !(game.players[game.current] || {}).isAI) this.drawHandCue(ctx, game);
      else if (game.state === 'aiming' || game.state === 'aiAiming') {
        this.drawAim(ctx, game);
        this.drawCue(ctx, game);
      }
    } else if (game.attractAim !== false) {
      this.drawAttractCue(ctx, game);
    }

    this.drawParticles(ctx);
    ctx.restore();

    this.drawScreenEffects(ctx, game);
  }

  drawFeltAmbience(ctx, game) {
    const t = this.theme;
    if (game.menuOpen) {
      const sweep = (this.time * 0.055) % 1;
      const x = PLAY.left - 300 + sweep * (PLAY.width + 600);
      const grd = ctx.createLinearGradient(x - 180, PLAY.top, x + 180, PLAY.bottom);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.035)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(PLAY.left, PLAY.top, PLAY.width, PLAY.height);
    }
    // Soft glow around the cue ball while aiming.
    if (game.inGame && (game.state === 'aiming') && !game.ballInHand && game.cue && !game.cue.potted) {
      const pulse = 0.08 + Math.sin(this.time * 2.2) * 0.02;
      const grd = ctx.createRadialGradient(game.cue.x, game.cue.y, 2, game.cue.x, game.cue.y, 56);
      grd.addColorStop(0, `rgba(255,255,255,${pulse})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(game.cue.x, game.cue.y, 56, 0, TAU);
      ctx.fill();
    }
  }

  drawDust(ctx, dt, game) {
    if (!game.menuOpen) return;
    for (const d of this.dust) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.phase += dt * 0.6;
      if (d.y < PLAY.top + 10) { d.y = PLAY.bottom - 10; d.x = PLAY.left + Math.random() * PLAY.width; }
      if (d.x < PLAY.left) d.x = PLAY.right;
      if (d.x > PLAY.right) d.x = PLAY.left;
      const a = d.a * (0.6 + 0.4 * Math.sin(d.phase));
      ctx.fillStyle = `rgba(255,255,245,${a})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.s, 0, TAU);
      ctx.fill();
    }
  }

  drawBalls(ctx, game) {
    const balls = game.balls || [];
    // Contact shadows.
    for (const b of balls) {
      if (game.ballInHand && b === game.cue) continue;
      if (b.potted && b.dropT > 0.35) continue;
      const p = b.potted ? b.pocket : null;
      let x = b.x;
      let y = b.y;
      let alpha = 0.32;
      if (p) {
        x = lerp(b.x, p.x, easeOut(b.dropT));
        y = lerp(b.y, p.y, easeOut(b.dropT));
        alpha *= 1 - b.dropT * 0.7;
      }
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x + 2.5, y + 4.5, b.r * 0.92, b.r * 0.56, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(x + 4.5, y + 7, b.r * 1.15, b.r * 0.5, 0, 0, TAU);
      ctx.fill();
    }

    // Potted balls first so they sink behind the table edge.
    const potted = balls.filter(b => b.potted);
    const live = balls.filter(b => !b.potted && !(game.ballInHand && b === game.cue));
    for (const b of potted) this.drawOneBall(ctx, b, game);
    for (const b of live) this.drawOneBall(ctx, b, game);
  }

  drawOneBall(ctx, b, game) {
    let x = b.x;
    let y = b.y;
    let scale = 1;
    let alpha = 1;
    if (b.potted) {
      const p = b.pocket;
      if (!p) return;
      const t = easeOut(b.dropT);
      x = lerp(b.x, p.x, t);
      y = lerp(b.y, p.y, t);
      scale = 1 - 0.62 * t;
      alpha = 1 - t * t;
      if (b.dropT >= 1) return;
    }
    const sprite = this.getSprite(b);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.drawImage(sprite, -b.r, -b.r, b.r * 2, b.r * 2);
    if (b.type === 'cue' && !b.potted) {
      const spin = game.spin || { x: 0, y: 0 };
      if (Math.abs(spin.x) > 0.02 || Math.abs(spin.y) > 0.02) {
        const sx = spin.x * b.r * 0.42;
        const sy = -spin.y * b.r * 0.42;
        ctx.fillStyle = 'rgba(200,32,38,0.9)';
        ctx.beginPath();
        ctx.arc(sx, sy, b.r * 0.11, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawAttractCue(ctx, game) {
    if (!game.cue || game.cue.potted) return;
    const angle = game.menuAim || -0.2;
    this.drawCueStick(ctx, game.cue, angle, 20 + Math.sin(this.time * 1.2) * 3, 0.55);
  }

  /* ------------------------------------------------------------------ */
  /* Aim, cue and ball-in-hand                                           */
  /* ------------------------------------------------------------------ */

  drawAim(ctx, game) {
    const cue = game.cue;
    if (!cue || cue.potted) return;
    const angle = game.aim || 0;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const preview = raycast(game.balls, cue, dx, dy);
    if (!Number.isFinite(preview.t) || preview.t <= 0) return;

    const ai = game.state === 'aiAiming';
    const baseAlpha = ai ? 0.28 : 0.68;
    const accent = this.theme.accent;
    // Keep guides readable when the table is scaled down on a phone.
    const k = 1 / Math.max(0.6, Math.min(1.1, this.scale));
    const dash = (arr) => arr.map(v => v * k);

    // Main guide.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash(dash([9, 8]));
    ctx.lineDashOffset = -this.time * 22;
    ctx.strokeStyle = `rgba(0,0,0,${baseAlpha * 0.4})`;
    ctx.lineWidth = 3.2 * k;
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * (cue.r + 3), cue.y + dy * (cue.r + 3));
    ctx.lineTo(cue.x + dx * preview.t, cue.y + dy * preview.t);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${baseAlpha})`;
    ctx.lineWidth = 1.35 * k;
    ctx.beginPath();
    ctx.moveTo(cue.x + dx * (cue.r + 3), cue.y + dy * (cue.r + 3));
    ctx.lineTo(cue.x + dx * preview.t, cue.y + dy * preview.t);
    ctx.stroke();
    ctx.setLineDash([]);

    if (preview.hit) {
      // Ghost ball.
      ctx.fillStyle = `rgba(255,255,255,${ai ? 0.04 : 0.08})`;
      ctx.strokeStyle = `rgba(255,255,255,${ai ? 0.22 : 0.6})`;
      ctx.lineWidth = 1.1 * k;
      ctx.setLineDash(dash([4, 5]));
      ctx.beginPath();
      ctx.arc(preview.ghost.x, preview.ghost.y, cue.r, 0, TAU);
      ctx.fill();
      ctx.stroke();

      // Object ball path.
      const ol = ai ? 90 : 160;
      ctx.setLineDash(dash([7, 7]));
      ctx.strokeStyle = rgba(accent, ai ? 0.20 : 0.7);
      ctx.lineWidth = 1.8 * k;
      ctx.beginPath();
      ctx.moveTo(preview.hit.x, preview.hit.y);
      ctx.lineTo(preview.hit.x + preview.objDir.x * ol, preview.hit.y + preview.objDir.y * ol);
      ctx.stroke();

      // Cue ball deflection.
      if (preview.cueDir && (preview.cueDir.x || preview.cueDir.y)) {
        ctx.setLineDash(dash([3, 8]));
        ctx.strokeStyle = `rgba(255,255,255,${ai ? 0.10 : 0.3})`;
        ctx.lineWidth = 1.2 * k;
        ctx.beginPath();
        ctx.moveTo(preview.ghost.x, preview.ghost.y);
        ctx.lineTo(preview.ghost.x + preview.cueDir.x * 95, preview.ghost.y + preview.cueDir.y * 95);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    } else if (preview.wall) {
      // One-bounce preview for bank shots.
      const wx = preview.ghost.x;
      const wy = preview.ghost.y;
      let rx = dx;
      let ry = dy;
      if (preview.wall.nx) rx = -rx;
      if (preview.wall.ny) ry = -ry;
      ctx.setLineDash(dash([6, 9]));
      ctx.strokeStyle = `rgba(255,255,255,${baseAlpha * 0.42})`;
      ctx.lineWidth = 1.1 * k;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + rx * 180, wy + ry * 180);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,255,255,${baseAlpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(wx, wy, 2.6 * k, 0, TAU);
      ctx.fill();
    }

    // Pull-back cue and power hint near the cue ball.
    if (game.dragging) {
      const power = game.dragPower;
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + power * 0.25})`;
      ctx.lineWidth = 1 * k;
      ctx.setLineDash(dash([3, 5]));
      ctx.beginPath();
      ctx.arc(cue.x, cue.y, cue.r + 9 + power * 8, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawCue(ctx, game) {
    const cue = game.cue;
    if (!cue || cue.potted) return;
    const pull = 22 + game.dragPower * 74 + Math.sin(this.time * 1.6) * 0.8;
    this.drawCueStick(ctx, cue, game.aim || 0, pull, 1);
  }

  drawCueStick(ctx, cue, angle, pull, alpha = 1) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const base = cue.r + 6.5 + pull;
    const x = cue.x - cos * base;
    const y = cue.y - sin * base;

    const drawShape = (offsetX, offsetY, fillStyle) => {
      ctx.save();
      ctx.translate(x + offsetX, y + offsetY);
      ctx.rotate(angle + Math.PI);
      // Shaft.
      ctx.beginPath();
      ctx.moveTo(0, -2.4);
      ctx.lineTo(202, -4.6);
      ctx.lineTo(202, 4.6);
      ctx.lineTo(0, 2.4);
      ctx.closePath();
      const shaft = ctx.createLinearGradient(0, -5, 0, 5);
      shaft.addColorStop(0, '#b78a4f');
      shaft.addColorStop(0.28, '#f2d9a2');
      shaft.addColorStop(0.52, '#fff3d0');
      shaft.addColorStop(0.78, '#d4ac6b');
      shaft.addColorStop(1, '#8a5f2f');
      ctx.fillStyle = fillStyle || shaft;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      // Butt.
      ctx.beginPath();
      ctx.moveTo(198, -4.8);
      ctx.lineTo(292, -6.4);
      ctx.lineTo(300, -5.8);
      ctx.lineTo(300, 5.8);
      ctx.lineTo(292, 6.4);
      ctx.lineTo(198, 4.8);
      ctx.closePath();
      if (!fillStyle) {
        const butt = ctx.createLinearGradient(0, -7, 0, 7);
        butt.addColorStop(0, '#2e241d');
        butt.addColorStop(0.3, '#6b5745');
        butt.addColorStop(0.5, '#1a1410');
        butt.addColorStop(0.8, '#3c2e24');
        butt.addColorStop(1, '#0b0907');
        ctx.fillStyle = butt;
      } else {
        ctx.fillStyle = fillStyle;
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.stroke();

      if (!fillStyle) {
        // Gold rings.
        for (const rx of [203, 218, 286, 293]) {
          ctx.strokeStyle = 'rgba(224,184,104,0.8)';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(rx, -5.9);
          ctx.lineTo(rx, 5.9);
          ctx.stroke();
        }
        // Wrap texture.
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.lineWidth = 0.7;
        for (let rx = 222; rx < 284; rx += 7) {
          ctx.beginPath();
          ctx.moveTo(rx, -5.5);
          ctx.lineTo(rx - 3, 5.5);
          ctx.stroke();
        }
        // Tip.
        ctx.fillStyle = '#2d6ca6';
        ctx.beginPath();
        ctx.moveTo(0, -2.5);
        ctx.lineTo(3.2, -2.7);
        ctx.lineTo(3.2, 2.7);
        ctx.lineTo(0, 2.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    ctx.save();
    ctx.globalAlpha = alpha;
    drawShape(3.4, 5.2, 'rgba(0,0,0,0.28)');
    drawShape(0, 0, null);
    ctx.restore();
  }

  drawHandCue(ctx, game) {
    const pos = game.handPos;
    if (!pos || !game.cue) return;
    const valid = game.handValid;
    const pulse = 0.55 + Math.sin(this.time * 4) * 0.18;
    ctx.save();
    ctx.globalAlpha = 0.55;
    const sprite = this.getSprite(game.cue);
    ctx.drawImage(sprite, pos.x - BALL_R, pos.y - BALL_R, BALL_R * 2, BALL_R * 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = valid ? `rgba(86,255,176,${pulse})` : `rgba(255,92,92,${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, BALL_R + 9 + Math.sin(this.time * 4) * 2, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (valid) {
      ctx.fillStyle = 'rgba(86,255,176,0.10)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, BALL_R + 8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Effects                                                             */
  /* ------------------------------------------------------------------ */

  burst(x, y, color, count = 8, spread = 70, size = 2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = spread * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.35 + Math.random() * 0.45,
        size: size * (0.5 + Math.random()),
        color,
      });
    }
  }

  cuePuff(x, y) {
    this.burst(x, y, 'rgba(110,176,255,0.55)', 7, 34, 1.4);
  }

  updateParticles(dt, game) {
    for (const p of this.particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3.5;
      p.vy *= 1 - dt * 3.5;
    }
    this.particles = this.particles.filter(p => p.life < p.max);
    this.flash = Math.max(0, this.flash - dt * 2.4);
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      ctx.fillStyle = p.color.replace(/[\d.]+\)$/, `${a})`);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a + 0.2, 0, TAU);
      ctx.fill();
    }
  }

  drawScreenEffects(ctx, game) {
    // Vignette / room light.
    const grd = ctx.createRadialGradient(
      this.cssW / 2, this.cssH * 0.44, Math.min(this.cssW, this.cssH) * 0.22,
      this.cssW / 2, this.cssH * 0.52, Math.max(this.cssW, this.cssH) * 0.78,
    );
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // Top light bloom.
    const bloom = ctx.createLinearGradient(0, 0, 0, this.cssH * 0.5);
    bloom.addColorStop(0, 'rgba(255,244,210,0.045)');
    bloom.addColorStop(1, 'rgba(255,244,210,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, this.cssW, this.cssH * 0.5);
  }
}
