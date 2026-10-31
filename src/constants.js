// Shared table geometry and game constants.
export const WORLD = { w: 1120, h: 640 };

export const PLAY = {
  left: 80,
  top: 80,
  right: 1040,
  bottom: 560,
  get width() { return this.right - this.left; },
  get height() { return this.bottom - this.top; },
  get cx() { return (this.left + this.right) / 2; },
  get cy() { return (this.top + this.bottom) / 2; },
};

export const BALL_R = 12;
export const MAX_SPEED = 2250;
export const MIN_SHOT_SPEED = 240;
export const CLOTH_FRICTION = 210;      // px / s^2, constant rolling loss
export const DRAG = 0.14;               // extra proportional loss per second
export const BALL_RESTITUTION = 0.955;
export const CUSHION_RESTITUTION = 0.78;
export const CUSHION_TANGENT = 0.965;
export const STOP_SPEED = 4.2;

export const POCKETS = [
  { id: 'tl', x: PLAY.left,   y: PLAY.top,    r: 31, corner: true },
  { id: 'tm', x: PLAY.cx,     y: PLAY.top,    r: 27, corner: false },
  { id: 'tr', x: PLAY.right,  y: PLAY.top,    r: 31, corner: true },
  { id: 'bl', x: PLAY.left,   y: PLAY.bottom, r: 31, corner: true },
  { id: 'bm', x: PLAY.cx,     y: PLAY.bottom, r: 27, corner: false },
  { id: 'br', x: PLAY.right,  y: PLAY.bottom, r: 31, corner: true },
];

export const GAP_CORNER = 52;   // cushion mouth measured from each corner
export const GAP_SIDE = 31;     // half-mouth of a side pocket

export const RACK = { x: 716, y: PLAY.cy, gap: Math.sqrt(3) * BALL_R + 0.02 };
export const HEAD_SPOT = { x: PLAY.left + PLAY.width * 0.235, y: PLAY.cy };

export const BALL_INFO = {
  1:  { color: '#f2c119', type: 'solid' },
  2:  { color: '#1d63d8', type: 'solid' },
  3:  { color: '#e23b32', type: 'solid' },
  4:  { color: '#7e3fbe', type: 'solid' },
  5:  { color: '#ef7c18', type: 'solid' },
  6:  { color: '#118b4e', type: 'solid' },
  7:  { color: '#8c2233', type: 'solid' },
  8:  { color: '#141414', type: 'eight' },
  9:  { color: '#f2c119', type: 'stripe' },
  10: { color: '#1d63d8', type: 'stripe' },
  11: { color: '#e23b32', type: 'stripe' },
  12: { color: '#7e3fbe', type: 'stripe' },
  13: { color: '#ef7c18', type: 'stripe' },
  14: { color: '#118b4e', type: 'stripe' },
  15: { color: '#8c2233', type: 'stripe' },
};

export const THEMES = {
  classic: {
    id: 'classic',
    name: 'Classic Green',
    center: '#209c69',
    mid: '#157a50',
    edge: '#074f34',
    deep: '#033424',
    rim: '#0d3f2e',
    accent: '#4fe0a0',
    wood1: '#5a3a20',
    wood2: '#2b180c',
    wood3: '#160b05',
    sight: '#f2e4bd',
  },
  royal: {
    id: 'royal',
    name: 'Royal Blue',
    center: '#2472c9',
    mid: '#1758a5',
    edge: '#0a3469',
    deep: '#05224a',
    rim: '#0b2a52',
    accent: '#6cb8ff',
    wood1: '#4b3a2c',
    wood2: '#241812',
    wood3: '#120b08',
    sight: '#efe6d2',
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson',
    center: '#bd4257',
    mid: '#992b40',
    edge: '#651428',
    deep: '#420b19',
    rim: '#4a1020',
    accent: '#ff8da0',
    wood1: '#55301f',
    wood2: '#28140c',
    wood3: '#150a06',
    sight: '#f4e1c2',
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    center: '#3a716c',
    mid: '#285954',
    edge: '#123b38',
    deep: '#092624',
    rim: '#0d3230',
    accent: '#75ddd1',
    wood1: '#3e3128',
    wood2: '#1d1510',
    wood3: '#0d0907',
    sight: '#eee4cf',
  },
};

export const DIFFICULTIES = {
  casual: {
    id: 'casual',
    name: 'Casual',
    bet: 100,
    aimError: 0.055,
    powerError: 0.1,
    safetyError: 0.08,
    label: 'Relaxed opponent',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    bet: 500,
    aimError: 0.021,
    powerError: 0.055,
    safetyError: 0.035,
    label: 'Sharp shooter',
  },
  legend: {
    id: 'legend',
    name: 'Legend',
    bet: 2000,
    aimError: 0.006,
    powerError: 0.022,
    safetyError: 0.012,
    label: 'No mercy',
  },
};

export function groupOf(ball) {
  if (!ball) return null;
  if (ball.type === 'solid' || ball.type === 'stripe') return ball.type;
  return null;
}
