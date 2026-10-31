import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

const canvas = $('table');
if (!canvas) throw new Error('Pool table canvas is missing.');

const els = {
  canvas,
  coinCount: $('coinCount'),
  coinPurse: $('coinPurse'),
  menuCoins: $('menuCoins'),
  menuRecord: $('menuRecord'),
  p1Card: $('p1Card'),
  p1Name: $('p1Name'),
  p1Group: $('p1Group'),
  p1Avatar: $('p1Avatar'),
  p2Card: $('p2Card'),
  p2Name: $('p2Name'),
  p2Group: $('p2Group'),
  p2Avatar: $('p2Avatar'),
  modeChip: $('modeChip'),
  statusPill: $('statusPill'),
  statusText: $('statusText'),
  statusSub: $('statusSub'),
  turnBanner: $('turnBanner'),
  toast: $('toast'),
  toastTitle: $('toastTitle'),
  toastText: $('toastText'),
  shotClock: $('shotClock'),
  clockVal: $('clockVal'),
  clockFill: $('clockFill'),
  hintText: $('hintText'),
  powerFill: $('powerFill'),
  powerVal: $('powerVal'),
  powerTrack: $('powerTrack'),
  spinPad: $('spinPad'),
  spinDot: $('spinDot'),
  spinBlock: $('spinBlock'),
  btnSpinReset: $('btnSpinReset'),
  feltName: $('feltName'),
  matchMode: $('matchMode'),
  menuLayer: $('menuLayer'),
  difficultyRow: $('difficultyRow'),
  startBtn: $('startBtn'),
  menuWarning: $('menuWarning'),
  menuRules: $('menuRules'),
  menuTheme: $('menuTheme'),
  btnSound: $('btnSound'),
  btnFullscreen: $('btnFullscreen'),
  btnMenu: $('btnMenu'),
  modalLayer: $('modalLayer'),
  modalCard: $('modalCard'),
};

const game = new Game(canvas, els);
window.game = game;
game.updateFullscreenUI();

// Keep the canvas crisp when the layout changes without waiting for a frame.
window.addEventListener('resize', () => game.renderer.resize());
window.addEventListener('orientationchange', () => {
  setTimeout(() => game.renderer.resize(), 120);
});

// iOS Safari can zoom on double taps; the table needs none of that.
document.addEventListener('dblclick', (ev) => {
  if (ev.target.closest('canvas')) ev.preventDefault();
});
