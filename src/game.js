import {
  PLAY, HEAD_SPOT, BALL_R, MIN_SHOT_SPEED, MAX_SPEED, THEMES, DIFFICULTIES,
} from './constants.js';
import {
  createRack, stepWorld, allStopped, advanceDrops, validCuePlacement,
} from './physics.js';
import { chooseShot, choosePlacement, remainingBalls } from './ai.js';
import { Renderer } from './renderer.js';
import { SoundEngine } from './audio.js';

const GROUP_NAME = { solid: 'SOLIDS', stripe: 'STRIPES' };
const AI_PROFILES = {
  casual: { name: 'Riley', initials: 'RL' },
  pro: { name: 'Rex', initials: 'RX' },
  legend: { name: 'Nova', initials: 'NV' },
};
const PROFILE_KEY = 'eightball.profile.v1';
const SHOT_CLOCK = 35;
const MAX_DRAG = 300;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function defaultProfile() {
  return {
    coins: 5000,
    wins: 0,
    losses: 0,
    muted: false,
    theme: 'classic',
  };
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    const p = { ...defaultProfile(), ...parsed };
    p.coins = Math.max(0, Number(p.coins) || 0);
    p.wins = Math.max(0, Number(p.wins) || 0);
    p.losses = Math.max(0, Number(p.losses) || 0);
    if (!THEMES[p.theme]) p.theme = 'classic';
    p.muted = !!p.muted;
    return p;
  } catch {
    return defaultProfile();
  }
}

function fmt(n) {
  return Math.max(0, Math.round(n)).toLocaleString('en-US');
}

export class Game {
  constructor(canvas, els) {
    this.canvas = canvas;
    this.el = els;
    this.renderer = new Renderer(canvas);
    this.sound = new SoundEngine();
    this.profile = loadProfile();
    this.sound.setMuted(this.profile.muted);
    this.renderer.setTheme(this.profile.theme);

    this.balls = [];
    this.cue = null;
    this.players = [];
    this.current = 0;
    this.mode = 'cpu';
    this.difficulty = 'pro';
    this.menuMode = 'cpu';
    this.menuOpen = true;
    this.inGame = false;
    this.paused = false;
    this.modalOpen = false;
    this.state = 'menu';
    this.tableOpen = true;
    this.ballInHand = false;
    this.isBreakShot = true;
    this.shot = null;
    this.plan = null;
    this.aim = 0;
    this.menuAim = -0.18;
    this.dragging = false;
    this.dragPower = 0;
    this.placing = false;
    this.handPos = { x: HEAD_SPOT.x, y: HEAD_SPOT.y };
    this.handValid = true;
    this.spin = { x: 0, y: 0 };
    this.activePointer = null;
    this.time = 0;
    this.lastFrame = performance.now();
    this.uiCooldown = 0;
    this.toastTimer = null;
    this.bannerTimer = null;
    this.aiAt = 0;
    this.resolveAt = 0;
    this.clockLeft = 0;
    this.clockMax = SHOT_CLOCK;
    this.entryPaid = 0;
    this.ranked = false;
    this.result = null;
    this.pendingResultAt = 0;

    this.setupAttract();
    this.bindUI();
    this.bindPointer();
    this.updateMenu();
    this.updateUI(true);
    this.renderer.resize();

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  saveProfile() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile)); } catch { /* ignore */ }
  }

  setupAttract() {
    const { balls, cue } = createRack();
    this.balls = balls;
    this.cue = cue;
    this.players = [
      { name: 'Player 1', initials: 'P1', isAI: false, group: null },
      { name: 'Player 2', initials: 'P2', isAI: false, group: null },
    ];
    this.current = 0;
    this.tableOpen = true;
    this.ballInHand = false;
    this.dragging = false;
    this.placing = false;
    this.shot = null;
    this.plan = null;
    this.spin = { x: 0, y: 0 };
    this.state = 'menu';
    this.inGame = false;
    this.menuOpen = true;
    this.paused = false;
    this.isBreakShot = true;
    this.aim = -0.18;
    this.dragPower = 0;
  }

  resetSpin() {
    this.spin = { x: 0, y: 0 };
    this.updateSpinUI();
  }

  updateSpinUI() {
    const pad = this.el.spinPad;
    const dot = this.el.spinDot;
    if (!pad || !dot) return;
    const radius = pad.clientWidth * 0.31;
    dot.style.transform = `translate(${this.spin.x * radius}px, ${-this.spin.y * radius}px)`;
    pad.classList.toggle('spinning', Math.hypot(this.spin.x, this.spin.y) > 0.04);
  }

  bindUI() {
    const e = this.el;
    window.addEventListener('pointerdown', () => this.sound.unlock(), { once: true, passive: true });

    e.btnSound?.addEventListener('click', () => {
      this.sound.unlock();
      this.profile.muted = !this.profile.muted;
      this.sound.setMuted(this.profile.muted);
      this.saveProfile();
      this.updateSoundUI();
      this.sound.ui();
    });

    e.btnFullscreen?.addEventListener('click', () => this.toggleFullscreen());
    e.btnMenu?.addEventListener('click', () => {
      if (this.inGame && !this.menuOpen) this.openPause();
    });

    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.ui();
        this.menuMode = btn.dataset.mode;
        this.updateMenu();
      });
    });
    document.querySelectorAll('[data-diff]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.ui();
        this.difficulty = btn.dataset.diff;
        this.updateMenu();
      });
    });
    document.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sound.unlock();
        this.profile.theme = btn.dataset.theme;
        this.renderer.setTheme(this.profile.theme);
        this.saveProfile();
        this.updateMenu();
        this.updateUI(true);
        this.sound.ui();
      });
    });

    e.startBtn?.addEventListener('click', () => {
      this.sound.unlock();
      this.startMatch(this.menuMode, this.difficulty);
    });
    e.menuRules?.addEventListener('click', () => {
      this.sound.unlock();
      this.openRules(false);
    });
    e.menuTheme?.addEventListener('click', () => {
      const ids = Object.keys(THEMES);
      const i = (ids.indexOf(this.profile.theme) + 1) % ids.length;
      this.profile.theme = ids[i];
      this.renderer.setTheme(this.profile.theme);
      this.saveProfile();
      this.updateMenu();
      this.sound.ui();
    });
    e.btnSpinReset?.addEventListener('click', () => {
      this.sound.ui();
      this.resetSpin();
    });

    const pad = e.spinPad;
    if (pad) {
      const setSpin = (ev) => {
        const rect = pad.getBoundingClientRect();
        let dx = (ev.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.31);
        let dy = (ev.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.31);
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        this.spin = { x: dx, y: -dy };
        this.updateSpinUI();
      };
      const canSpin = () => this.inGame && !this.paused && !this.menuOpen
        && this.state === 'aiming' && !this.ballInHand
        && this.players[this.current] && !this.players[this.current].isAI;
      pad.addEventListener('pointerdown', (ev) => {
        if (!canSpin()) return;
        this.sound.unlock();
        pad.setPointerCapture?.(ev.pointerId);
        setSpin(ev);
        ev.preventDefault();
      });
      pad.addEventListener('pointermove', (ev) => {
        if (!canSpin() || !pad.hasPointerCapture?.(ev.pointerId)) return;
        setSpin(ev);
        ev.preventDefault();
      });
      pad.addEventListener('pointerup', () => {});
      pad.addEventListener('dblclick', () => this.resetSpin());
    }

    e.modalLayer?.addEventListener('click', (ev) => {
      if (ev.target === e.modalLayer && this.modalClosable) this.closeModal();
    });
    e.modalCard?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      this.handleModalAction(btn.dataset.action, btn);
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (this.modalOpen && this.modalClosable) this.closeModal();
        else if (this.inGame && !this.menuOpen && !this.modalOpen) this.openPause();
      }
      if ((ev.key === 'm' || ev.key === 'M') && !ev.ctrlKey && !ev.metaKey) {
        this.profile.muted = !this.profile.muted;
        this.sound.setMuted(this.profile.muted);
        this.saveProfile();
        this.updateSoundUI();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      this.updateFullscreenUI();
      setTimeout(() => this.renderer.resize(), 60);
    });
  }

  bindPointer() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (ev) => ev.preventDefault());
    c.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    c.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    c.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
    c.addEventListener('pointercancel', (ev) => this.onPointerCancel(ev));
    c.addEventListener('pointerleave', () => {
      if (this.dragging) return;
      this.canvas.style.cursor = '';
    });
  }

  startMatch(mode = this.menuMode, difficultyId = this.difficulty, opts = {}) {
    const diff = DIFFICULTIES[difficultyId] || DIFFICULTIES.pro;
    const pay = opts.pay !== false;
    if (mode === 'cpu' && pay) {
      if (this.profile.coins < diff.bet) {
        this.sound.foul();
        if (this.el.startBtn) {
          this.el.startBtn.classList.remove('shake');
          void this.el.startBtn.offsetWidth;
          this.el.startBtn.classList.add('shake');
        }
        if (!this.menuOpen) {
          this.toast('NOT ENOUGH COINS', `This table needs ${fmt(diff.bet)} coins.`, 'foul', 3200);
        }
        this.updateMenu();
        return false;
      }
      this.profile.coins -= diff.bet;
      this.entryPaid = diff.bet;
      this.ranked = true;
      this.saveProfile();
      this.updateCoinUI(true);
      this.sound.coin();
    } else {
      this.entryPaid = 0;
      this.ranked = mode === 'cpu' && pay;
    }

    this.mode = mode;
    this.difficulty = difficultyId;
    this.modalClosable = false;
    this.closeModal();
    this.menuOpen = false;
    this.inGame = true;
    this.paused = false;
    this.modalOpen = false;
    this.state = 'aiming';
    this.current = 0;
    this.tableOpen = true;
    this.isBreakShot = true;
    this.ballInHand = false;
    this.dragging = false;
    this.placing = false;
    this.dragPower = 0;
    this.shot = null;
    this.plan = null;
    this.result = null;
    this.pendingResultAt = 0;
    this.resolveAt = 0;
    this.clockLeft = mode === 'cpu' ? SHOT_CLOCK : 0;
    this.clockMax = SHOT_CLOCK;
    this.resetSpin();

    if (mode === 'cpu') {
      const ai = AI_PROFILES[difficultyId] || AI_PROFILES.pro;
      this.players = [
        { name: 'You', initials: 'YOU', isAI: false, group: null },
        { name: ai.name, initials: ai.initials, isAI: true, group: null },
      ];
    } else {
      this.players = [
        { name: 'Player 1', initials: 'P1', isAI: false, group: null },
        { name: 'Player 2', initials: 'P2', isAI: false, group: null },
      ];
    }

    this.initRack();
    this.aim = this.autoAim();
    this.el.menuLayer?.classList.add('is-hidden');
    this.updateSoundUI();
    this.updateUI(true);
    this.sound.turn();
    if (mode === 'cpu') {
      this.showTurnBanner('YOUR BREAK', 'Pull back far and release for a power break');
    } else {
      this.showTurnBanner('PLAYER 1 BREAKS', 'Pull back far, then pass the device');
    }
    return true;
  }

  initRack() {
    const { balls, cue } = createRack();
    this.balls = balls;
    this.cue = cue;
    this.balls.forEach(b => { b.vx = 0; b.vy = 0; b.potted = false; b.pocket = null; b.dropT = 0; });
    this.cue.x = HEAD_SPOT.x;
    this.cue.y = HEAD_SPOT.y;
  }

  nextTurn(opts = {}) {
    this.shot = null;
    this.plan = null;
    this.dragging = false;
    this.placing = false;
    this.dragPower = 0;
    this.resolveAt = 0;
    this.resetSpin();
    const p = this.players[this.current];
    if (!p) return;
    this.aim = this.autoAim();

    if (this.ballInHand) {
      if (p.isAI) {
        this.state = 'aiThinking';
        this.aiAt = this.time + 0.7 + Math.random() * 0.5;
      } else {
        this.state = 'ballInHand';
        const spot = this.findValidCueSpot(this.cue.x, this.cue.y);
        this.cue.x = spot.x;
        this.cue.y = spot.y;
        this.handPos = { x: spot.x, y: spot.y };
        this.handValid = true;
        this.clockLeft = this.mode === 'cpu' ? SHOT_CLOCK : 0;
      }
    } else if (p.isAI) {
      this.state = 'aiThinking';
      this.aiAt = this.time + 0.85 + Math.random() * 0.65;
      this.clockLeft = 0;
    } else {
      this.state = 'aiming';
      this.clockLeft = this.mode === 'cpu' ? SHOT_CLOCK : 0;
    }

    this.updateUI(true);
    if (!opts.quiet) {
      if (this.ballInHand) {
        this.showTurnBanner(
          p.isAI ? 'BALL IN HAND' : 'BALL IN HAND',
          p.isAI ? `${p.name} will place the cue ball` : `${p.name} — tap the table to place the cue ball`,
        );
      } else if (p.isAI) {
        this.showTurnBanner('OPPONENT TURN', `${p.name} is lining up`);
      } else if (this.mode === 'local') {
        this.showTurnBanner(`${p.name.toUpperCase()}'S TURN`, 'Pass the device');
      } else {
        this.showTurnBanner('YOUR TURN', this.targetLine(p));
      }
    }
  }

  autoAim() {
    const cue = this.cue;
    if (!cue) return 0;
    if (this.isBreakShot) {
      const rack = this.balls.filter(b => !b.potted && b.type !== 'cue');
      const apex = rack.sort((a, b) => a.x - b.x)[0];
      return apex ? Math.atan2(apex.y - cue.y, apex.x - cue.x) : 0;
    }
    const p = this.players[this.current];
    let targets = [];
    if (p && p.group) {
      targets = remainingBalls(this.balls, p.group);
      if (!targets.length) targets = this.balls.filter(b => !b.potted && b.type === 'eight');
    } else {
      targets = this.balls.filter(b => !b.potted && b.type !== 'eight' && b.type !== 'cue');
      if (!targets.length) targets = this.balls.filter(b => !b.potted && b.type === 'eight');
    }
    if (!targets.length) return this.aim || 0;
    const nearest = targets.sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
    return Math.atan2(nearest.y - cue.y, nearest.x - cue.x);
  }

  shoot(angle, power, spin = this.spin) {
    if (!this.inGame || this.ballInHand) return;
    if (this.state !== 'aiming' && this.state !== 'aiAiming') return;
    if (!this.cue || this.cue.potted) return;
    const p = this.players[this.current];
    const group = p?.group || null;
    const cleared = group ? remainingBalls(this.balls, group).length === 0 : false;
    const wasBreak = this.isBreakShot;
    const pw = clamp(power, 0.03, 1);
    const speed = MIN_SHOT_SPEED + (MAX_SPEED - MIN_SHOT_SPEED) * pw;

    this.aim = angle;
    this.cue.vx = Math.cos(angle) * speed;
    this.cue.vy = Math.sin(angle) * speed;
    this.shot = {
      isBreak: wasBreak,
      firstHit: null,
      firstHitSpeed: 0,
      potted: [],
      railHits: 0,
      railAfterContact: false,
      cueScratched: false,
      spin: { x: spin.x, y: spin.y },
      spinApplied: false,
      context: {
        playerIndex: this.current,
        group,
        cleared,
        tableOpen: this.tableOpen,
      },
      startedAt: this.time,
      power: pw,
    };
    this.state = 'shooting';
    this.isBreakShot = false;
    this.dragging = false;
    this.dragPower = 0;
    this.resolveAt = 0;
    this.clockLeft = 0;
    const tipX = this.cue.x - Math.cos(angle) * (BALL_R + 8);
    const tipY = this.cue.y - Math.sin(angle) * (BALL_R + 8);
    this.renderer.cuePuff(tipX, tipY);
    this.sound.cueStrike(pw);
    this.updateUI(true);
  }

  loop(now) {
    const raw = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const dt = clamp(Number.isFinite(raw) ? raw : 0.016, 0, 0.05);
    if (!this.paused) {
      this.time += dt;
      this.updateGame(dt);
    }
    this.renderer.render(this, dt);
    requestAnimationFrame(this.loop);
  }

  updateGame(dt) {
    advanceDrops(this.balls, dt);

    if (this.menuOpen) {
      this.menuAim = -0.2 + Math.sin(this.time * 0.35) * 0.09;
      this.updateUI();
      return;
    }

    if (this.state === 'shooting') {
      const events = stepWorld(this.balls, dt, this.shot, []);
      if (events.length) this.handleEvents(events);
      if (allStopped(this.balls)) {
        if (!this.resolveAt) this.resolveAt = this.time + 0.34;
        else if (this.time >= this.resolveAt) this.resolveShot();
      } else {
        this.resolveAt = 0;
      }
      if (this.shot && this.time - this.shot.startedAt > 18) {
        for (const b of this.balls) { b.vx = 0; b.vy = 0; }
        this.resolveAt = this.time;
      }
    }

    if (this.state === 'aiThinking' && this.time >= this.aiAt) {
      const p = this.players[this.current];
      if (this.ballInHand) {
        const pos = choosePlacement(this, p, this.difficulty);
        this.cue.potted = false;
        this.cue.pocket = null;
        this.cue.dropT = 0;
        this.cue.x = pos.x;
        this.cue.y = pos.y;
        this.cue.vx = 0;
        this.cue.vy = 0;
        this.ballInHand = false;
        this.handValid = true;
        this.sound.ui();
      }
      this.plan = chooseShot(this, p, this.difficulty);
      this.aim = this.plan.angle;
      this.state = 'aiAiming';
      this.aiAt = this.time + 0.62;
      this.updateUI(true);
    } else if (this.state === 'aiAiming' && this.time >= this.aiAt) {
      const plan = this.plan;
      this.plan = null;
      if (plan) this.shoot(plan.angle, plan.power, plan.spin || { x: 0, y: 0 });
    }

    if (this.state === 'aiming' && !this.ballInHand && !this.dragging
      && this.mode === 'cpu' && this.players[this.current] && !this.players[this.current].isAI) {
      this.clockLeft = Math.max(0, this.clockLeft - dt);
      if (this.clockLeft <= 0) {
        this.clockLeft = 0;
        this.toast('SHOT CLOCK', 'Time is up — taking a shot for you.', 'foul', 2600);
        this.sound.foul();
        this.shoot(this.aim, 0.32, this.spin);
      }
    }

    if (this.state === 'gameover' && this.pendingResultAt && this.time >= this.pendingResultAt) {
      this.pendingResultAt = 0;
      this.showResultModal();
    }

    this.uiCooldown -= dt;
    this.updateUI();
  }

  handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'hit') {
        this.sound.ballHit(ev.speed, ev.cue);
        if (ev.speed > 650 && Math.random() < 0.22) {
          this.renderer.burst(ev.x, ev.y, 'rgba(255,255,255,0.32)', 2, 34, 0.9);
        }
      } else if (ev.type === 'rail') {
        this.sound.rail(ev.speed);
        if (ev.speed > 700 && Math.random() < 0.18) {
          this.renderer.burst(ev.x, ev.y, 'rgba(255,255,255,0.22)', 2, 28, 0.8);
        }
      } else if (ev.type === 'pocket') {
        this.sound.pocket();
        const count = ev.ball.type === 'eight' ? 22 : 11;
        this.renderer.burst(ev.pocket.x, ev.pocket.y, 'rgba(255,213,122,0.75)', count, 95, 1.9);
        this.renderer.burst(ev.pocket.x, ev.pocket.y, 'rgba(255,255,255,0.5)', Math.round(count / 2), 55, 1.2);
      }
    }
  }

  findValidCueSpot(x, y) {
    if (validCuePlacement(this.balls, this.cue, x, y)) return { x, y };
    const preferred = [
      { x: HEAD_SPOT.x, y: HEAD_SPOT.y },
      { x: PLAY.left + PLAY.width * 0.26, y: PLAY.cy },
      { x: PLAY.cx, y: PLAY.cy },
    ];
    for (const p of preferred) {
      if (validCuePlacement(this.balls, this.cue, p.x, p.y)) return p;
    }
    for (let r = 24; r <= 360; r += 24) {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + r * 0.01;
        const px = clamp(x + Math.cos(a) * r, PLAY.left + BALL_R + 3, PLAY.right - BALL_R - 3);
        const py = clamp(y + Math.sin(a) * r, PLAY.top + BALL_R + 3, PLAY.bottom - BALL_R - 3);
        if (validCuePlacement(this.balls, this.cue, px, py)) return { x: px, y: py };
      }
    }
    return { x: HEAD_SPOT.x, y: HEAD_SPOT.y };
  }

  resolveShot() {
    if (!this.shot) return;
    const shot = this.shot;
    this.shot = null;
    const p = this.players[this.current];
    const opp = this.players[1 - this.current];
    const potted = shot.potted;
    const eight = potted.find(b => b.type === 'eight');
    const scratch = shot.cueScratched;
    const first = shot.firstHit;

    if (eight) {
      if (shot.isBreak) {
        this.toast('8 ON THE BREAK', 'The rack will be reset. No winner yet.', 'info', 3200);
        this.reRack();
        return;
      }
      if (!shot.context.cleared || scratch || !first || first.type !== 'eight') {
        this.endGame(1 - this.current, scratch
          ? 'Pocketed the 8-ball with a scratch.'
          : (!shot.context.cleared ? 'Pocketed the 8-ball too early.' : 'Illegal 8-ball shot.'));
      } else {
        this.endGame(this.current, 'The 8-ball dropped cleanly. Frame over.');
      }
      return;
    }

    let foul = false;
    let reason = '';
    if (scratch) {
      foul = true;
      reason = 'Cue ball pocketed';
    } else if (!first) {
      foul = true;
      reason = 'No ball was struck';
    }

    if (!shot.isBreak) {
      const group = shot.context.group;
      if (first && !foul) {
        if (group) {
          if (first.type === 'eight' && !shot.context.cleared) {
            foul = true;
            reason = 'The 8-ball was struck first';
          } else if (first.type !== 'eight' && first.type !== group) {
            foul = true;
            reason = 'Wrong group struck first';
          }
        } else if (first.type === 'eight') {
          foul = true;
          reason = 'The 8-ball was struck first';
        }
      }
      if (!foul && potted.length === 0 && !shot.railAfterContact) {
        foul = true;
        reason = 'No rail after contact';
      }
    } else if (!foul && potted.length === 0 && shot.railHits < 2) {
      foul = true;
      reason = 'Illegal break — too few balls reached the cushion';
    }

    let assigned = false;
    if (this.tableOpen && !shot.isBreak && !foul) {
      const firstPot = potted.find(b => b.type === 'solid' || b.type === 'stripe');
      if (firstPot) {
        p.group = firstPot.type;
        opp.group = firstPot.type === 'solid' ? 'stripe' : 'solid';
        this.tableOpen = false;
        assigned = true;
      }
    }

    let ownPotted = false;
    if (p.group) ownPotted = potted.some(b => b.type === p.group);
    else if (this.tableOpen) ownPotted = potted.some(b => b.type !== 'eight');

    if (foul) {
      this.current = 1 - this.current;
      this.ballInHand = true;
      this.respotCue(scratch);
      this.sound.foul();
      this.toast('FOUL', `${reason}. Ball in hand for ${this.players[this.current].name}.`, 'foul', 3800);
      this.nextTurn();
      return;
    }

    if (assigned) {
      this.toast('SIDES CHOSEN', `${p.name} takes ${GROUP_NAME[p.group]}.`, 'good', 2800);
      this.sound.turn();
    }

    if (ownPotted) {
      const remaining = p.group ? remainingBalls(this.balls, p.group).length : null;
      if (p.group && remaining === 0) {
        this.toast('ON THE 8', `${p.name} must now pocket the 8-ball.`, 'good', 2600);
      }
      this.nextTurn({ quiet: true });
    } else {
      this.current = 1 - this.current;
      this.nextTurn();
    }
  }

  respotCue(scratched) {
    const cue = this.cue;
    if (!cue) return;
    if (scratched) {
      cue.potted = false;
      cue.pocket = null;
      cue.dropT = 0;
      cue.x = HEAD_SPOT.x;
      cue.y = HEAD_SPOT.y;
    }
    cue.vx = 0;
    cue.vy = 0;
    const spot = this.findValidCueSpot(cue.x, cue.y);
    cue.x = spot.x;
    cue.y = spot.y;
  }

  reRack() {
    this.initRack();
    this.tableOpen = true;
    this.isBreakShot = true;
    this.ballInHand = false;
    this.dragging = false;
    this.placing = false;
    this.dragPower = 0;
    this.shot = null;
    this.plan = null;
    this.resolveAt = 0;
    this.players.forEach(pl => { pl.group = null; });
    this.resetSpin();
    this.aim = this.autoAim();
    const p = this.players[this.current];
    if (p && p.isAI) {
      this.state = 'aiThinking';
      this.aiAt = this.time + 0.9;
    } else {
      this.state = 'aiming';
      this.clockLeft = this.mode === 'cpu' ? SHOT_CLOCK : 0;
    }
    this.updateUI(true);
    this.showTurnBanner('RE-RACK', `${p ? p.name : 'Player'} breaks again`);
  }

  endGame(winnerIndex, reason) {
    if (this.state === 'gameover') return;
    const winner = this.players[winnerIndex];
    const humanWon = winnerIndex === 0;
    let prize = 0;

    if (this.mode === 'cpu' && this.ranked) {
      if (humanWon) {
        prize = this.entryPaid * 2;
        this.profile.coins += prize;
        this.profile.wins += 1;
        this.sound.win();
      } else {
        this.profile.losses += 1;
        this.sound.lose();
      }
      this.saveProfile();
      this.updateCoinUI(humanWon);
    } else {
      this.sound.win();
    }

    this.result = {
      winnerIndex,
      winner,
      reason,
      humanWon,
      prize,
      ranked: this.ranked,
      mode: this.mode,
      entryPaid: this.entryPaid,
    };
    this.state = 'gameover';
    this.dragging = false;
    this.placing = false;
    this.dragPower = 0;
    this.ballInHand = false;
    this.plan = null;
    this.shot = null;
    this.pendingResultAt = this.time + 1.05;
    this.updateUI(true);
  }

  showResultModal() {
    const r = this.result;
    if (!r) return;
    let title;
    let kicker;
    let cls = 'result-modal';
    if (r.mode === 'cpu') {
      if (r.humanWon) { title = 'VICTORY'; kicker = 'FRAME WON'; cls += ' is-win'; }
      else { title = 'DEFEAT'; kicker = 'FRAME LOST'; cls += ' is-loss'; }
    } else {
      title = `${r.winner.name.toUpperCase()} WINS`;
      kicker = 'PASS & PLAY';
      cls += ' is-win';
    }
    let coinLine = '';
    if (r.mode === 'cpu' && r.ranked) {
      if (r.humanWon) {
        coinLine = `<div class="result-reward"><span>POT WON</span><b class="plus">+${fmt(r.prize)}</b></div>`;
      } else {
        coinLine = `<div class="result-reward"><span>ENTRY LOST</span><b class="minus">−${fmt(r.entryPaid)}</b></div>`;
      }
    } else if (r.mode === 'cpu') {
      coinLine = '<div class="result-reward practice"><span>PRACTICE MATCH</span><b>No stakes</b></div>';
    }

    const html = `
      ${r.humanWon || r.mode === 'local' ? this.confettiMarkup() : ''}
      <div class="result-head">
        <div class="result-kicker">${kicker}</div>
        <h2>${title}</h2>
        <p>${r.reason}</p>
      </div>
      <div class="result-avatar ${r.mode === 'cpu' && !r.humanWon ? 'ai' : 'human'}">${r.winner.initials || 'P'}</div>
      <div class="result-name">${r.winner.name}</div>
      ${coinLine}
      <div class="result-stats"><span>${this.profile.wins}W</span><i>·</i><span>${this.profile.losses}L</span><i>·</i><span>${fmt(this.profile.coins)} coins</span></div>
      <div class="modal-actions">
        <button class="btn-primary" data-action="rematch">PLAY AGAIN</button>
        <button class="btn-ghost" data-action="main-menu">MAIN MENU</button>
      </div>
    `;
    this.paused = true;
    this.openModal(html, cls, false, true);
  }

  confettiMarkup() {
    const colors = ['#f6c65b', '#2ee08a', '#6cb8ff', '#ff7a8a', '#ffffff', '#ffd978'];
    let out = '';
    for (let i = 0; i < 54; i++) {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.9;
      const dur = 2.1 + Math.random() * 1.7;
      const drift = -110 + Math.random() * 220;
      const rot = -540 + Math.random() * 1080;
      const w = 5 + Math.random() * 7;
      const h = 8 + Math.random() * 12;
      const color = colors[Math.floor(Math.random() * colors.length)];
      out += `<i style="left:${left}%;width:${w}px;height:${h}px;background:${color};animation-delay:${delay}s;animation-duration:${dur}s;--drift:${drift}px;--rot:${rot}deg"></i>`;
    }
    return `<div class="confetti" aria-hidden="true">${out}</div>`;
  }

  openModal(html, className = '', closable = true, keepPaused = true) {
    if (!this.el.modalLayer) return;
    this.el.modalCard.className = `modal-card ${className}`.trim();
    this.el.modalCard.innerHTML = html;
    this.el.modalLayer.hidden = false;
    this.modalOpen = true;
    this.modalClosable = closable;
    if (this.inGame && keepPaused) this.paused = true;
  }

  closeModal(keepPaused = false) {
    if (!this.el.modalLayer) return;
    this.el.modalLayer.hidden = true;
    this.el.modalCard.className = 'modal-card';
    this.el.modalCard.innerHTML = '';
    this.modalOpen = false;
    this.modalClosable = false;
    if (!keepPaused) this.paused = false;
  }

  openPause() {
    if (!this.inGame || this.menuOpen || this.state === 'gameover') return;
    this.paused = true;
    const soundLabel = this.profile.muted ? 'SOUND: OFF' : 'SOUND: ON';
    const themeButtons = Object.values(THEMES).map(t => `
      <button class="theme-swatch ${this.profile.theme === t.id ? 'active' : ''}"
        data-action="theme" data-theme-id="${t.id}" title="${t.name}">
        <i style="background:${t.center}"></i><span>${t.name.split(' ')[0]}</span>
      </button>`).join('');
    this.openModal(`
      <div class="pause-head">
        <div class="result-kicker">TIME OUT</div>
        <h2>PAUSED</h2>
        <p>${this.players[this.current]?.name || ''} is at the table.</p>
      </div>
      <div class="pause-actions">
        <button class="btn-primary" data-action="resume">RESUME</button>
        <button class="btn-ghost" data-action="restart">RESTART (PRACTICE)</button>
        <button class="btn-ghost" data-action="rules">HOW TO PLAY</button>
        <button class="btn-ghost" data-action="sound">${soundLabel}</button>
        <button class="btn-ghost danger" data-action="main-menu">MAIN MENU</button>
      </div>
      <div class="pause-themes">
        <span>TABLE FELT</span>
        <div class="theme-row">${themeButtons}</div>
      </div>
    `, 'pause-modal', true, true);
  }

  openRules(fromPause = false) {
    const closeAction = fromPause ? 'back-pause' : 'close';
    const html = `
      <div class="rules-head">
        <div class="result-kicker">8-BALL</div>
        <h2>HOW TO PLAY</h2>
      </div>
      <div class="rules-scroll">
        <section><b>THE AIM</b><p>Drag backwards from the cue ball like pulling back a real cue. The line shows the ghost-ball contact. The further you pull, the harder the shot. Release to strike.</p></section>
        <section><b>THE BREAK</b><p>Player 1 breaks. Pot a ball or send a ball to the cushions, otherwise it is a foul and the opponent gets ball in hand.</p></section>
        <section><b>OPEN TABLE</b><p>After the break the table is open. The first legally pocketed ball after the break decides your group: solids (1–7) or stripes (9–15).</p></section>
        <section><b>LEGAL SHOT</b><p>Always contact your own group first, then pocket a ball or drive any ball to a cushion. Potting one of your balls keeps you at the table.</p></section>
        <section><b>FOULS</b><p>Cue ball pocketed, no ball hit, wrong group first, no rail after contact, or an illegal break. The opponent receives ball in hand and may place the cue ball anywhere.</p></section>
        <section><b>WINNING</b><p>Clear your group, then pocket the 8-ball. Potting the 8 too early — or scratching on the 8 — loses the frame. An 8-ball on the break is re-racked.</p></section>
        <section><b>SPIN</b><p>The cue-ball pad adds follow, draw or side spin. The red dot on the cue ball shows your strike point. Center it again with the reset button.</p></section>
        <section><b>MULTIPLAYER</b><p>Play solo against a CPU opponent or choose 2 Players for pass-and-play on this device. No account or internet required.</p></section>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" data-action="${closeAction}">${fromPause ? 'BACK' : 'GOT IT'}</button>
      </div>
    `;
    this.openModal(html, 'rules-modal', true, this.inGame);
    if (this.inGame) this.paused = true;
  }

  handleModalAction(action, btn) {
    switch (action) {
      case 'close':
      case 'resume':
        this.sound.ui();
        this.closeModal();
        break;
      case 'back-pause':
        this.sound.ui();
        this.closeModal(true);
        this.openPause();
        break;
      case 'rules':
        this.sound.ui();
        this.openRules(true);
        break;
      case 'restart':
        this.sound.ui();
        this.closeModal();
        this.startMatch(this.mode, this.difficulty, { pay: false });
        break;
      case 'menu':
      case 'main-menu':
        this.sound.ui();
        this.goMenu();
        break;
      case 'rematch': {
        this.sound.ui();
        if (this.mode === 'cpu') {
          const diff = DIFFICULTIES[this.difficulty] || DIFFICULTIES.pro;
          if (this.profile.coins < diff.bet) {
            this.sound.foul();
            const actions = btn?.closest('.modal-actions');
            if (actions && !actions.parentElement.querySelector('.rematch-warning')) {
              const note = document.createElement('p');
              note.className = 'rematch-warning';
              note.textContent = `Not enough coins — you need ${fmt(diff.bet)} to play this table again.`;
              actions.before(note);
            }
            if (btn) btn.disabled = true;
            break;
          }
        }
        this.closeModal();
        this.startMatch(this.mode, this.difficulty, { pay: true });
        break;
      }
      case 'sound':
        this.sound.unlock();
        this.profile.muted = !this.profile.muted;
        this.sound.setMuted(this.profile.muted);
        this.saveProfile();
        this.updateSoundUI();
        this.openPause();
        break;
      case 'theme': {
        const id = btn?.dataset.themeId;
        if (id && THEMES[id]) {
          this.profile.theme = id;
          this.renderer.setTheme(id);
          this.saveProfile();
          this.sound.ui();
          this.updateUI(true);
          this.openPause();
        }
        break;
      }
      default:
        break;
    }
  }

  goMenu() {
    this.closeModal(true);
    this.paused = false;
    this.inGame = false;
    this.menuOpen = true;
    this.state = 'menu';
    this.entryPaid = 0;
    this.ranked = false;
    this.setupAttract();
    this.el.menuLayer?.classList.remove('is-hidden');
    this.updateMenu();
    this.updateUI(true);
    this.renderer.setTheme(this.profile.theme);
  }

  toggleFullscreen() {
    const app = document.getElementById('app') || document.documentElement;
    try {
      if (!document.fullscreenElement) {
        app.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.();
      }
    } catch { /* ignore */ }
  }

  updateFullscreenUI() {
    this.el.btnFullscreen?.classList.toggle('active', Boolean(document.fullscreenElement));
  }

  updateCoinUI(bump = false) {
    if (this.el.coinCount) this.el.coinCount.textContent = fmt(this.profile.coins);
    if (this.el.menuCoins) this.el.menuCoins.textContent = fmt(this.profile.coins);
    if (bump && this.el.coinPurse) {
      this.el.coinPurse.classList.remove('bump');
      void this.el.coinPurse.offsetWidth;
      this.el.coinPurse.classList.add('bump');
      setTimeout(() => this.el.coinPurse?.classList.remove('bump'), 550);
    }
  }

  updateSoundUI() {
    this.el.btnSound?.classList.toggle('muted', this.profile.muted);
    if (this.el.btnSound) this.el.btnSound.setAttribute('aria-label', this.profile.muted ? 'Unmute sound' : 'Mute sound');
  }

  toast(title, text, type = 'info', duration = 2800) {
    const t = this.el.toast;
    if (!t) return;
    clearTimeout(this.toastTimer);
    this.el.toastTitle.textContent = title;
    this.el.toastText.textContent = text;
    t.classList.remove('is-foul', 'is-good', 'is-info');
    t.classList.add(type === 'foul' ? 'is-foul' : type === 'good' ? 'is-good' : 'is-info');
    t.classList.add('show');
    this.toastTimer = setTimeout(() => t.classList.remove('show'), duration);
  }

  showTurnBanner(title, sub) {
    const b = this.el.turnBanner;
    if (!b) return;
    clearTimeout(this.bannerTimer);
    b.innerHTML = `<b>${title}</b><span>${sub || ''}</span>`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    this.bannerTimer = setTimeout(() => b.classList.remove('show'), 2100);
  }

  targetLine(player) {
    if (!player) return '';
    if (this.tableOpen) return 'Open table — first pot picks sides';
    if (!player.group) return 'Open table';
    const rem = remainingBalls(this.balls, player.group).length;
    if (rem === 0) return 'On the 8-ball';
    return `${GROUP_NAME[player.group]} · ${rem} left`;
  }

  updateMenu() {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.menuMode);
    });
    document.querySelectorAll('[data-diff]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.diff === this.difficulty);
    });
    if (this.el.difficultyRow) {
      this.el.difficultyRow.classList.toggle('is-hidden', this.menuMode !== 'cpu');
    }
    const diff = DIFFICULTIES[this.difficulty] || DIFFICULTIES.pro;
    if (this.el.startBtn) {
      if (this.menuMode === 'cpu') {
        this.el.startBtn.innerHTML = `<span>PLAY</span><span class="buy-in"><i class="coin-dot"></i><b>${fmt(diff.bet)}</b></span>`;
        this.el.startBtn.classList.toggle('insufficient', this.profile.coins < diff.bet);
      } else {
        this.el.startBtn.innerHTML = '<span>START PASS &amp; PLAY</span>';
        this.el.startBtn.classList.remove('insufficient');
      }
    }
    if (this.el.menuWarning) {
      const lacking = this.menuMode === 'cpu' && this.profile.coins < diff.bet;
      this.el.menuWarning.hidden = !lacking;
      if (lacking) {
        this.el.menuWarning.textContent = `You need ${fmt(diff.bet - this.profile.coins)} more coins for this table — try a cheaper one.`;
      }
    }
    document.querySelectorAll('[data-theme]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === this.profile.theme);
    });
    this.updateCoinUI();
    if (this.el.menuRecord) this.el.menuRecord.textContent = `${this.profile.wins}W · ${this.profile.losses}L`;
    if (this.el.feltName) this.el.feltName.textContent = (THEMES[this.profile.theme] || THEMES.classic).name;
    if (this.el.matchMode) {
      this.el.matchMode.textContent = this.inGame
        ? (this.mode === 'cpu' ? `VS CPU · ${diff.name.toUpperCase()}` : 'PASS & PLAY')
        : 'VS CPU';
    }
  }

  updateUI(force = false) {
    if (!force && this.uiCooldown > 0) return;
    this.uiCooldown = 0.07;
    const e = this.el;
    const p1 = this.players[0];
    const p2 = this.players[1];
    const cp = this.players[this.current] || p1;
    const diff = DIFFICULTIES[this.difficulty] || DIFFICULTIES.pro;

    if (this.el.coinCount) this.el.coinCount.textContent = fmt(this.profile.coins);
    if (this.el.menuCoins) this.el.menuCoins.textContent = fmt(this.profile.coins);

    const setCard = (card, nameEl, groupEl, avatarEl, player, index) => {
      if (!card || !player) return;
      nameEl && (nameEl.textContent = player.name);
      avatarEl && (avatarEl.textContent = player.initials || player.name.slice(0, 2).toUpperCase());
      let label = '—';
      if (!this.inGame) label = 'READY';
      else if (player.group) {
        const rem = remainingBalls(this.balls, player.group).length;
        label = rem === 0 ? 'ON THE 8' : `${GROUP_NAME[player.group]} · ${rem} LEFT`;
      } else {
        label = this.tableOpen ? 'OPEN TABLE' : '—';
      }
      if (groupEl) groupEl.textContent = label;
      card.dataset.group = player.group || '';
      card.classList.toggle('is-ai', !!player.isAI);
      card.classList.toggle('active', this.inGame && !this.menuOpen && this.current === index && this.state !== 'gameover');
      card.classList.toggle('is-winner', this.state === 'gameover' && this.result && this.result.winnerIndex === index);
    };
    setCard(e.p1Card, e.p1Name, e.p1Group, e.p1Avatar, p1, 0);
    setCard(e.p2Card, e.p2Name, e.p2Group, e.p2Avatar, p2, 1);

    if (e.modeChip) {
      e.modeChip.textContent = this.inGame
        ? (this.mode === 'cpu' ? `VS CPU · ${diff.name.toUpperCase()}` : 'PASS & PLAY')
        : 'WELCOME';
    }

    let status = 'READY';
    let sub = 'Choose a match';
    if (this.inGame) {
      if (this.state === 'gameover') {
        status = 'GAME OVER';
        sub = this.result ? `${this.result.winner.name} wins the frame` : 'Frame complete';
      } else if (this.state === 'shooting') {
        status = 'SHOT IN PLAY';
        sub = 'Balls are rolling…';
      } else if (this.ballInHand) {
        status = 'BALL IN HAND';
        sub = cp?.isAI ? 'Opponent is placing the cue ball' : 'Place the cue ball anywhere';
      } else if (this.state === 'aiThinking' || this.state === 'aiAiming') {
        status = this.mode === 'cpu' ? 'OPPONENT TURN' : `${(cp?.name || 'PLAYER').toUpperCase()}'S TURN`;
        sub = cp?.isAI ? 'Lining up the next shot' : 'Line up your shot';
      } else if (this.state === 'aiming') {
        status = this.mode === 'cpu' ? 'YOUR TURN' : `${(cp?.name || 'PLAYER').toUpperCase()}'S TURN`;
        sub = this.targetLine(cp);
      }
    }
    if (e.statusText) e.statusText.textContent = status;
    if (e.statusSub) e.statusSub.textContent = sub;
    if (e.statusPill) {
      e.statusPill.classList.toggle('is-live', this.inGame && this.state !== 'gameover');
      e.statusPill.classList.toggle('is-ai', this.inGame && cp?.isAI && this.state !== 'gameover');
    }

    const humanTurn = this.inGame && cp && !cp.isAI;
    let hint = 'Choose a match to begin';
    if (this.inGame) {
      if (this.state === 'gameover') hint = 'Match complete — play again or return to the menu';
      else if (this.state === 'shooting') hint = 'Balls are rolling…';
      else if (this.ballInHand) hint = cp?.isAI ? 'Opponent is placing the cue ball…' : 'Move the cue ball and tap to place it';
      else if (this.state === 'aiThinking' || this.state === 'aiAiming') hint = `${cp?.name || 'Opponent'} is lining up a shot…`;
      else if (this.state === 'aiming') {
        if (!humanTurn) hint = 'Opponent is lining up a shot…';
        else if (this.dragging) hint = `Release to shoot · ${Math.round(this.dragPower * 100)}% power`;
        else if (this.isBreakShot) hint = 'Drag back far for a power break';
        else hint = 'Drag back from the cue ball to aim & shoot';
      }
    }
    if (e.hintText) e.hintText.textContent = hint;

    const power = this.dragging ? this.dragPower : 0;
    if (e.powerFill) e.powerFill.style.width = `${Math.round(power * 100)}%`;
    if (e.powerVal) e.powerVal.textContent = `${Math.round(power * 100)}%`;
    if (e.powerTrack) {
      e.powerTrack.classList.toggle('is-hot', power > 0.72);
      e.powerTrack.classList.toggle('is-live', this.dragging);
    }

    const canSpin = this.inGame && this.state === 'aiming' && !this.ballInHand && humanTurn;
    if (e.spinPad) e.spinPad.classList.toggle('disabled', !canSpin); else if (e.spinBlock) e.spinBlock.classList.toggle('disabled', !canSpin);
    if (e.spinBlock) e.spinBlock.classList.toggle('disabled', !canSpin);

    if (e.shotClock) {
      const showClock = this.inGame && this.mode === 'cpu' && humanTurn
        && this.state === 'aiming' && !this.ballInHand && this.state !== 'gameover';
      e.shotClock.classList.toggle('show', showClock);
      if (showClock) {
        const sec = Math.max(0, Math.ceil(this.clockLeft));
        if (e.clockVal) e.clockVal.textContent = `0:${String(sec).padStart(2, '0')}`;
        if (e.clockFill) e.clockFill.style.width = `${(this.clockLeft / this.clockMax) * 100}%`;
        e.shotClock.classList.toggle('is-low', this.clockLeft <= 10);
      }
    }

    if (e.feltName) e.feltName.textContent = (THEMES[this.profile.theme] || THEMES.classic).name;
    if (e.matchMode) {
      e.matchMode.textContent = this.inGame
        ? (this.mode === 'cpu' ? `VS CPU · ${diff.name.toUpperCase()}` : 'PASS & PLAY')
        : 'VS CPU';
    }
    this.updateSpinUI();
    this.updateSoundUI();
  }

  pointerWorld(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  onPointerDown(ev) {
    this.sound.unlock();
    if (!this.inGame || this.paused || this.modalOpen || this.menuOpen) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const world = this.pointerWorld(ev);
    if (this.ballInHand) {
      const p = this.players[this.current];
      if (!p || p.isAI) return;
      this.placing = true;
      this.activePointer = ev.pointerId;
      this.canvas.setPointerCapture?.(ev.pointerId);
      this.updateHandPos(world);
      ev.preventDefault();
      return;
    }
    if (this.state !== 'aiming') return;
    const p = this.players[this.current];
    if (!p || p.isAI) return;
    this.dragging = true;
    this.activePointer = ev.pointerId;
    this.canvas.setPointerCapture?.(ev.pointerId);
    this.canvas.style.cursor = 'grabbing';
    this.updateDrag(world);
    ev.preventDefault();
  }

  onPointerMove(ev) {
    if (!this.inGame || this.menuOpen || this.modalOpen) return;
    const world = this.pointerWorld(ev);
    if (this.placing && this.activePointer === ev.pointerId) {
      this.updateHandPos(world);
      ev.preventDefault();
      return;
    }
    if (this.dragging && this.activePointer === ev.pointerId) {
      this.updateDrag(world);
      ev.preventDefault();
      return;
    }
    if (this.ballInHand && ev.pointerType === 'mouse') {
      const p = this.players[this.current];
      if (p && !p.isAI) this.updateHandPos(world);
    }
  }

  onPointerUp(ev) {
    if (this.activePointer !== ev.pointerId) return;
    this.canvas.releasePointerCapture?.(ev.pointerId);
    this.canvas.style.cursor = '';
    if (this.placing) {
      this.placing = false;
      this.activePointer = null;
      this.updateHandPos(this.pointerWorld(ev));
      if (this.handValid) {
        this.cue.x = this.handPos.x;
        this.cue.y = this.handPos.y;
        this.cue.vx = 0;
        this.cue.vy = 0;
        this.cue.potted = false;
        this.cue.pocket = null;
        this.cue.dropT = 0;
        this.ballInHand = false;
        this.state = 'aiming';
        this.clockLeft = this.mode === 'cpu' ? SHOT_CLOCK : 0;
        this.aim = this.autoAim();
        this.sound.ui();
        this.updateUI(true);
      } else {
        this.toast('CANNOT PLACE', 'That spot overlaps a ball or pocket.', 'foul', 2200);
        this.sound.foul();
      }
      ev.preventDefault();
      return;
    }
    if (this.dragging) {
      const power = this.dragPower;
      const angle = this.aim;
      this.dragging = false;
      this.dragPower = 0;
      this.activePointer = null;
      if (power > 0.035) this.shoot(angle, power, this.spin);
      else this.updateUI(true);
      ev.preventDefault();
    }
  }

  onPointerCancel(ev) {
    if (this.activePointer !== ev.pointerId) return;
    this.dragging = false;
    this.placing = false;
    this.dragPower = 0;
    this.activePointer = null;
    this.canvas.style.cursor = '';
    this.updateUI(true);
  }

  updateHandPos(world) {
    this.handPos = {
      x: clamp(world.x, PLAY.left + BALL_R + 2, PLAY.right - BALL_R - 2),
      y: clamp(world.y, PLAY.top + BALL_R + 2, PLAY.bottom - BALL_R - 2),
    };
    this.handValid = validCuePlacement(this.balls, this.cue, this.handPos.x, this.handPos.y);
  }

  updateDrag(world) {
    const cue = this.cue;
    if (!cue) return;
    const dx = cue.x - world.x;
    const dy = cue.y - world.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 7) this.aim = Math.atan2(dy, dx);
    const power = clamp((dist - 24) / MAX_DRAG, 0, 1);
    this.dragPower = power;
    if (this.el.powerFill) this.el.powerFill.style.width = `${Math.round(power * 100)}%`;
    if (this.el.powerVal) this.el.powerVal.textContent = `${Math.round(power * 100)}%`;
    if (this.el.powerTrack) {
      this.el.powerTrack.classList.toggle('is-hot', power > 0.72);
      this.el.powerTrack.classList.add('is-live');
    }
    if (this.el.hintText) {
      this.el.hintText.textContent = `Release to shoot · ${Math.round(power * 100)}% power`;
    }
  }
}
