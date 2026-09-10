import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import './style.css';
import {
  createIcons,
  Crosshair,
  Target,
  Zap,
  BarChart3,
  Trophy,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Grid2x2,
  Focus,
  Activity,
  Volume2,
  VolumeX,
  CircleHelp,
  Maximize,
  Minimize,
  Mouse,
  Keyboard,
  Play,
  Pause,
  RotateCcw,
  X,
  Check,
  Clock3,
  TrendingUp,
  Menu,
  Command,
  ShieldCheck,
  Download,
  Trash2,
  MoveUpRight,
  Sparkles,
  Circle,
  Minus,
  Settings2,
} from 'lucide';
import { Arena } from './arena';
import type {
  ArenaConfig,
  ArenaState,
  ArenaStats,
  SessionResult,
  TrainingMode,
} from './arena';

const iconSet = {
  Crosshair,
  Target,
  Zap,
  BarChart3,
  Trophy,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Grid2x2,
  Focus,
  Activity,
  Volume2,
  VolumeX,
  CircleHelp,
  Maximize,
  Minimize,
  Mouse,
  Keyboard,
  Play,
  Pause,
  RotateCcw,
  X,
  Check,
  Clock3,
  TrendingUp,
  Menu,
  Command,
  ShieldCheck,
  Download,
  Trash2,
  MoveUpRight,
  Sparkles,
  Circle,
  Minus,
  Settings2,
};
const icons = () =>
  createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.7 } });
const icon = (name: string, className = '') =>
  `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const format = (value: number) => Math.round(value).toLocaleString('en-US');
const modes = {
  gridshot: {
    name: 'Gridshot',
    icon: 'grid-2x2',
    tag: 'SPEED + REFLEXES',
    short: 'Speed. Accuracy. Repeat.',
    description: 'Find your rhythm. Hit the targets. Get faster.',
    detail:
      'Six targets. One goal: hit as many as you can. Click each target, build your combo, and keep moving.',
    number: '01',
  },
  precision: {
    name: 'Precision',
    icon: 'focus',
    tag: 'CONTROL + ACCURACY',
    short: 'Small targets. Big improvements.',
    description: 'Slow it down. Make every pixel count.',
    detail:
      'Smaller targets put your control to the test. Take a moment to line up each shot. Accuracy comes before speed.',
    number: '02',
  },
  tracking: {
    name: 'Tracking',
    icon: 'activity',
    tag: 'FOCUS + CONSISTENCY',
    short: 'Stay focused. Stay on target.',
    description: 'Follow the motion. Find your flow.',
    detail:
      'Keep your crosshair on the moving target and hold the mouse button to fire. Smooth, steady movement wins.',
    number: '03',
  },
} as const;
const defaultConfig: ArenaConfig = {
  mode: 'gridshot',
  duration: 60,
  difficulty: 'normal',
  sensitivity: 1,
  sound: true,
  crosshair: 'cross',
};
type SavedSession = SessionResult & { id: string; date: string };
function loadConfig(): ArenaConfig {
  try {
    const saved = JSON.parse(
      localStorage.getItem('deadeye-settings-v1') || '{}',
    );
    return {
      mode: Object.hasOwn(modes, saved.mode) ? saved.mode : 'gridshot',
      duration: [30, 60, 120].includes(saved.duration) ? saved.duration : 60,
      difficulty: ['easy', 'normal', 'hard'].includes(saved.difficulty)
        ? saved.difficulty
        : 'normal',
      sensitivity:
        typeof saved.sensitivity === 'number' &&
        saved.sensitivity >= 0.2 &&
        saved.sensitivity <= 2
          ? saved.sensitivity
          : 1,
      sound: typeof saved.sound === 'boolean' ? saved.sound : true,
      crosshair: ['cross', 'dot', 'circle'].includes(saved.crosshair)
        ? saved.crosshair
        : 'cross',
    };
  } catch {
    return { ...defaultConfig };
  }
}
function loadSessions(): SavedSession[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem('deadeye-sessions-v1') || '[]',
    );
    if (!Array.isArray(saved)) return [];
    return saved
      .filter(
        (s) =>
          s &&
          Object.hasOwn(modes, s.mode) &&
          typeof s.score === 'number' &&
          Number.isFinite(s.score) &&
          typeof s.id === 'string' &&
          typeof s.date === 'string' &&
          Number.isFinite(Date.parse(s.date)) &&
          [30, 60, 120].includes(s.duration) &&
          ['easy', 'normal', 'hard'].includes(s.difficulty) &&
          ['hits', 'shots', 'accuracy', 'reactionTime', 'bestCombo'].every(
            (key) => typeof s[key] === 'number' && Number.isFinite(s[key]),
          ),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
let config = loadConfig();
let sessions = loadSessions();
let state: ArenaState = 'idle';
let view = 'arena';
let arena: Arena | undefined;
let stats: ArenaStats = {
  score: 0,
  hits: 0,
  shots: 0,
  combo: 0,
  bestCombo: 0,
  accuracy: 0,
  timeLeft: config.duration,
  reactionTime: 0,
};
let leaderboardMode: TrainingMode = 'gridshot';
let leaderboardDuration = config.duration;
let leaderboardDifficulty = config.difficulty;
let toastTimer: ReturnType<typeof setTimeout>;
let lastFocus: HTMLElement | null = null;
let storageWarningShown = false;

$('#app').innerHTML = `
  <aside class="sidebar" id="sidebar">
    <a class="brand" href="#arena" aria-label="Deadeye home">
      <span class="brand-mark"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M15 5H5v10M25 5h10v10M5 25v10h10m20-10v10H25" stroke="currentColor" stroke-width="3.5"/><circle cx="20" cy="20" r="6" stroke="currentColor" stroke-width="3.5"/></svg></span>
      <span class="brand-word">deadeye<span>.</span><small>AIM TRAINING, ELEVATED</small></span>
    </a>
    <div class="sidebar-section-label">YOUR WORKSPACE</div>
    <nav class="main-nav" aria-label="Main navigation">
      <button class="nav-item active" data-view="arena">${icon('crosshair')}<span>Training arena</span>${icon('chevron-right', 'nav-arrow')}</button>
      <button class="nav-item" data-view="statistics">${icon('bar-chart-3')}<span>Statistics</span></button>
      <button class="nav-item" data-view="leaderboard">${icon('trophy')}<span>Personal bests</span><span class="nav-badge">PB</span></button>
    </nav>
    <div class="sidebar-separator"></div>
    <div class="sidebar-section-label">TRAINING MODES <span>03</span></div>
    <nav class="mode-nav" aria-label="Training modes">
      ${Object.entries(modes)
        .map(
          ([id, mode]) =>
            `<button class="nav-item mode-shortcut" data-mode="${id}">${icon(mode.icon)}<span>${mode.name}</span><span class="mode-number">${mode.number}</span></button>`,
        )
        .join('')}
    </nav>
    <div class="sidebar-bottom">
      <div class="consistency-card">
        <span class="eyebrow">THE DAILY REP</span>${icon('trending-up', 'daily-trend')}
        <h3>A little better.<br>Every day.</h3>
        <p>Great aim starts with showing up.</p>
        <div class="week-days" id="week-days"></div>
        <div class="daily-progress"><span id="daily-label">Your first rep is waiting</span>${icon('arrow-up-right')}</div>
      </div>
      <button class="shortcuts-button" data-action="help">${icon('keyboard')}<span>Keyboard shortcuts</span><kbd>?</kbd></button>
      <div class="profile"><span class="avatar">R<span></span></span><div><strong>Rookie</strong><span>THE GRIND STARTS HERE</span></div><button class="icon-button" data-action="settings" aria-label="Open settings">${icon('settings-2')}</button></div>
    </div>
    <div class="sidebar-version">DEADEYE SYSTEMS <span>V.1.0</span></div>
  </aside>
  <button class="sidebar-scrim" data-action="close-menu" aria-label="Close navigation"></button>
  <main class="main-shell">
    <header class="topbar">
      <div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="Open navigation">${icon('menu')}</button><span>Workspace</span>${icon('chevron-right')}<strong id="breadcrumb-view">Training arena</strong></div>
      <div class="topbar-actions"><span class="system-status"><span class="status-dot"></span>All systems ready</span><span class="topbar-divider"></span><button class="icon-button" data-action="help" aria-label="How to play" title="How to play (?)">${icon('circle-help')}</button><button class="icon-button" id="sound-button" data-action="sound" aria-label="Mute sound" title="Toggle sound">${icon('volume-2')}</button><span class="top-avatar">R</span></div>
    </header>
    <div class="page-content">
      <section class="page-heading"><div><div class="eyebrow heading-eyebrow"><span></span>TRAIN. REFINE. REPEAT.</div><h1 id="page-title">Your aim. <span>Elevated.</span></h1><p id="page-description">A little focus. A few more reps. A whole new level.</p></div><div class="heading-aside"><span class="heading-cross">${icon('crosshair')}</span><div><span>YOU VS. YESTERDAY</span><strong>Make every shot count.</strong></div></div></section>
      <div id="arena-view" class="page-view">
        <div class="training-layout">
          <section class="arena-panel" aria-label="Training arena">
            <div class="arena-panel-header"><div class="arena-mode-heading"><span class="mode-header-icon" id="mode-header-icon">${icon('grid-2x2')}</span><div><h2 id="arena-mode-name">Gridshot <span class="mini-badge">CLASSIC</span></h2><p id="arena-mode-description">Speed. Accuracy. Repeat.</p></div></div><div class="personal-best"><span>${icon('trophy')} PERSONAL BEST</span><strong id="arena-best">--<small>PTS</small></strong></div></div>
            <div class="arena-stage" id="arena-stage">
              <div class="arena-canvas" id="arena-canvas"></div>
              <div class="scene-vignette"></div>
              <div class="arena-hud"><div class="hud-stat"><span>SCORE</span><strong id="hud-score">00000</strong></div><div class="hud-timer"><span class="timer-icon">${icon('clock-3')}</span><strong id="hud-time">01:00</strong></div><div class="hud-stat hud-accuracy"><span>ACCURACY</span><strong><span id="hud-accuracy">--</span><small>%</small></strong></div></div>
              <div class="map-label"><span class="status-dot"></span><span>THE RANGE</span><span class="map-divider">/</span><span>SECTOR 01</span></div>
              <div class="crosshair" id="crosshair" aria-hidden="true"><span></span><span></span><span></span><span></span><b></b></div>
              <div class="preview-label" id="preview-label"><span class="preview-pill"><span class="status-dot"></span>YOUR NEXT LEVEL STARTS HERE</span><span>Dial in your settings. Step into the arena.</span></div>
              <div class="arena-corner corner-tl"></div><div class="arena-corner corner-tr"></div><div class="arena-corner corner-bl"></div><div class="arena-corner corner-br"></div>
              <div class="arena-bottom-hud"><span id="arena-state-label"><span class="status-dot"></span>ARENA READY</span><span id="combo-label">6 TARGETS <span>·</span> UNLIMITED POTENTIAL</span></div>
              <button class="stage-pause icon-button" data-action="pause" aria-label="Pause session">${icon('pause')}</button>
              <div class="countdown-overlay hidden" id="countdown-overlay"><span>GET READY</span><strong id="countdown-number">3</strong><p>Find your focus.</p></div>
              <div class="pause-overlay hidden" id="pause-overlay"><span class="pause-symbol">${icon('pause')}</span><span class="eyebrow">TAKE A BREATH</span><h2>Session paused.</h2><p>Your next shot can wait.</p><button class="primary-button" data-action="resume">${icon('play')}Back to it${icon('arrow-right')}</button><button class="text-button" data-action="end">End session</button></div>
              <button class="touch-shoot" data-action="shoot" aria-label="Shoot">${icon('crosshair')}</button>
            </div>
            <div class="arena-controls"><div class="desktop-controls"><span><span class="key-cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>Move</span><span>${icon('mouse')}Aim & shoot</span><span><kbd>ESC</kbd>Pause</span></div><div class="touch-controls">${icon('move-up-right')}Drag to aim <span>·</span> Tap to shoot</div><button class="fullscreen-button" data-action="fullscreen" title="Expand arena (F)">${icon('maximize')}<span>Fullscreen</span></button></div>
          </section>
          <aside class="setup-panel">
            <div class="setup-header"><h2>Session setup</h2>${icon('sliders-horizontal')}</div>
            <div class="setup-fields" id="setup-fields">
              <div class="field"><label>Training mode <span>01 / 03</span></label><div class="mode-selector" role="group" aria-label="Training mode">${Object.entries(
                modes,
              )
                .map(
                  ([id, mode]) =>
                    `<button data-mode="${id}" class="mode-option" aria-pressed="false">${icon(mode.icon)}<span>${mode.name}</span></button>`,
                )
                .join('')}</div></div>
              <div class="field"><label>Session duration${icon('clock-3')}</label><div class="segment-control" role="group" aria-label="Session duration">${[30, 60, 120].map((n) => `<button data-duration="${n}" aria-pressed="false">${n}<span> sec</span></button>`).join('')}</div></div>
              <div class="field"><label for="difficulty">Difficulty</label><div class="select-wrap"><span class="difficulty-bars"><i></i><i></i><i></i></span><select id="difficulty" aria-label="Difficulty"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select>${icon('chevron-down')}</div></div>
              <div class="field sensitivity-field"><label for="sensitivity">Mouse sensitivity <output id="sensitivity-value" for="sensitivity">1.00<span>×</span></output></label><input id="sensitivity" type="range" min="0.2" max="2" step="0.05" value="1"/><div class="range-labels"><span>Precise</span><span>Fast</span></div></div>
              <button class="crosshair-setting" data-action="settings">${icon('crosshair')}Customize crosshair${icon('chevron-right')}</button>
            </div>
            <div class="setup-start"><button class="primary-button" id="start-button" data-action="start">${icon('play')}<span>Start training</span>${icon('arrow-up-right')}</button><span class="start-note"><span class="status-dot"></span>No pressure. Just progress.</span></div>
          </aside>
        </div>
        <section class="focus-section"><div class="section-heading"><h2>Find your focus<span>.</span></h2><span>THREE WAYS TO LEVEL UP</span></div><div class="mode-cards">${Object.entries(
          modes,
        )
          .map(
            ([id, mode]) =>
              `<button class="mode-card mode-card-${id}" data-mode="${id}" aria-pressed="false"><div class="mode-art mode-art-${id}" aria-hidden="true">${id === 'gridshot' ? '<span></span><span></span><span></span><span></span>' : id === 'precision' ? '<span class="precision-ring"></span><span class="precision-dot"></span><i></i><b></b>' : '<svg viewBox="0 0 120 80"><path d="M5 62C26 62 23 14 48 22S64 74 89 48s10-22 26-24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 5"/></svg><span></span>'}</div><div class="mode-card-content"><span class="eyebrow">${mode.tag}</span><h3>${mode.name}</h3><p>${mode.description}</p></div><span class="mode-card-check">${icon('arrow-up-right')}</span></button>`,
          )
          .join('')}</div></section>
        <div class="coach-tip"><span class="tip-icon">${icon('zap')}</span><p><strong>Build the habit. The aim will follow.</strong> Even 5 minutes a day makes a difference.</p><span>STAY CONSISTENT</span></div>
      </div>
      <div id="statistics-view" class="page-view hidden"></div>
      <div id="leaderboard-view" class="page-view hidden"></div>
      <footer class="page-footer"><span><span class="status-dot"></span>LESS TALK. MORE TARGETS.</span><span>Made for the love of getting better.<span class="footer-dot">·</span>DEADEYE © ${new Date().getFullYear()}</span></footer>
    </div>
  </main>
  <dialog id="modal" aria-labelledby="modal-title"><div id="modal-content"></div></dialog>
  <div class="toast" id="toast" role="status"></div>
`;

function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    if (!storageWarningShown) {
      storageWarningShown = true;
      toast(
        'Browser storage is unavailable. Progress will last for this visit only.',
      );
    }
  }
}
function toast(message: string) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}
function currentBest() {
  return Math.max(
    0,
    ...sessions
      .filter(
        (s) =>
          s.mode === config.mode &&
          s.duration === config.duration &&
          s.difficulty === config.difficulty,
      )
      .map((s) => s.score),
  );
}
function updateConfig() {
  persist('deadeye-settings-v1', config);
  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((button) => {
      const active = button.dataset.mode === config.mode;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
      if (button.classList.contains('mode-card'))
        button.querySelector('.mode-card-check')!.innerHTML = icon(
          active ? 'check' : 'arrow-up-right',
        );
    });
  document
    .querySelectorAll<HTMLButtonElement>('[data-duration]')
    .forEach((button) => {
      const active = Number(button.dataset.duration) === config.duration;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
  $('#mode-header-icon').innerHTML = icon(modes[config.mode].icon);
  $('#arena-mode-name').innerHTML =
    `${modes[config.mode].name} <span class="mini-badge">${config.mode === 'gridshot' ? 'CLASSIC' : config.mode === 'precision' ? 'CONTROL' : 'FLOW'}</span>`;
  $('#arena-mode-description').textContent = modes[config.mode].short;
  $('.field label span').textContent = `${modes[config.mode].number} / 03`;
  $('#arena-best').innerHTML =
    `${currentBest() ? format(currentBest()) : '--'}<small>PTS</small>`;
  $<HTMLSelectElement>('#difficulty').value = config.difficulty;
  $('.difficulty-bars').dataset.level = config.difficulty;
  $<HTMLInputElement>('#sensitivity').value = String(config.sensitivity);
  $('#sensitivity-value').innerHTML =
    `${config.sensitivity.toFixed(2)}<span>×</span>`;
  $('#sensitivity').style.setProperty(
    '--range-progress',
    `${((config.sensitivity - 0.2) / 1.8) * 100}%`,
  );
  $('#crosshair').className = `crosshair crosshair-${config.crosshair}`;
  $('#sound-button').innerHTML = icon(config.sound ? 'volume-2' : 'volume-x');
  $('#sound-button').setAttribute(
    'aria-label',
    config.sound ? 'Mute sound' : 'Unmute sound',
  );
  $('#sound-button').setAttribute('aria-pressed', String(!config.sound));
  arena?.configure(config);
  if (state === 'idle')
    $('#combo-label').innerHTML =
      `${config.mode === 'tracking' ? 'MOVING TARGET' : config.mode === 'precision' ? '4 TARGETS' : '6 TARGETS'} <span>·</span> UNLIMITED POTENTIAL`;
  icons();
}
function updateStats(next: ArenaStats) {
  const previousHits = stats.hits;
  stats = next;
  $('#hud-score').textContent = String(next.score).padStart(5, '0');
  const seconds = Math.ceil(next.timeLeft);
  $('#hud-time').textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('#hud-accuracy').textContent = next.shots
    ? String(Math.round(next.accuracy))
    : '--';
  $('.hud-timer').classList.toggle(
    'time-low',
    seconds <= 10 && state === 'running',
  );
  if (state === 'running')
    $('#combo-label').innerHTML =
      next.combo > 1
        ? `<strong>${next.combo}× COMBO</strong><span>·</span>${next.hits} HITS`
        : `${next.hits} HITS <span>·</span> ${next.shots} SHOTS`;
  if (next.hits > previousHits) {
    $('#crosshair').classList.remove('hit');
    void $('#crosshair').offsetWidth;
    $('#crosshair').classList.add('hit');
  }
}
function updateState(next: ArenaState) {
  state = next;
  const active =
    next === 'running' || next === 'countdown' || next === 'paused';
  $('#arena-stage').dataset.state = next;
  $('#preview-label').classList.toggle('hidden', next !== 'idle');
  $('#countdown-overlay').classList.toggle('hidden', next !== 'countdown');
  $('#pause-overlay').classList.toggle('hidden', next !== 'paused');
  $('#setup-fields').classList.toggle('locked', active);
  document
    .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
      '[data-mode], [data-duration], #difficulty',
    )
    .forEach((el) => (el.disabled = active));
  $('#arena-state-label').innerHTML =
    `<span class="status-dot"></span>${next === 'idle' ? 'ARENA READY' : next === 'running' ? 'SESSION LIVE' : next === 'paused' ? 'SESSION PAUSED' : next === 'countdown' ? 'GET READY' : 'SESSION COMPLETE'}`;
  $('#start-button').innerHTML =
    next === 'paused'
      ? `${icon('play')}<span>Resume training</span>${icon('arrow-up-right')}`
      : active
        ? `${icon('pause')}<span>Pause session</span><kbd>ESC</kbd>`
        : `${icon('play')}<span>Start training</span>${icon('arrow-up-right')}`;
  $('.system-status').innerHTML =
    `<span class="status-dot"></span>${active ? (next === 'paused' ? 'Taking a breather' : 'Training in progress') : 'All systems ready'}`;
  if (next === 'idle')
    $('#combo-label').innerHTML =
      `${config.mode === 'tracking' ? 'MOVING TARGET' : config.mode === 'precision' ? '4 TARGETS' : '6 TARGETS'} <span>·</span> UNLIMITED POTENTIAL`;
  icons();
}
function updateWeek() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  $('#week-days').innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    .map((label, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      const trained = sessions.some(
        (s) => new Date(s.date).toDateString() === day.toDateString(),
      );
      return `<div class="week-day ${day.toDateString() === today.toDateString() ? 'today' : ''} ${trained ? 'trained' : ''}" title="${day.toLocaleDateString('en', { weekday: 'long' })}: ${trained ? 'Trained' : 'No session yet'}"><span>${label}</span><b>${trained ? icon('check') : ''}</b></div>`;
    })
    .join('');
  const todayCount = sessions.filter(
    (s) => new Date(s.date).toDateString() === today.toDateString(),
  ).length;
  $('#daily-label').textContent = todayCount
    ? `${todayCount} session${todayCount === 1 ? '' : 's'} today. Keep it up.`
    : 'Your first rep is waiting';
  icons();
}
function changeView(next: string) {
  if (state === 'running' || state === 'countdown') arena?.pause();
  view = next;
  document
    .querySelectorAll<HTMLElement>('.page-view')
    .forEach((el) => el.classList.toggle('hidden', el.id !== `${next}-view`));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === next);
    if (el.dataset.view === next) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('#breadcrumb-view').textContent =
    next === 'arena'
      ? 'Training arena'
      : next === 'statistics'
        ? 'Statistics'
        : 'Personal bests';
  $('#page-title').innerHTML =
    next === 'arena'
      ? 'Your aim. <span>Elevated.</span>'
      : next === 'statistics'
        ? 'Progress. <span>Measured.</span>'
        : 'You vs. <span>Yesterday.</span>';
  $('#page-description').textContent =
    next === 'arena'
      ? 'A little focus. A few more reps. A whole new level.'
      : next === 'statistics'
        ? 'Every rep tells a story. Here is yours, so far.'
        : 'Not a race against everyone. A race against your best.';
  if (next === 'statistics') renderStatistics();
  if (next === 'leaderboard') renderLeaderboard();
  document.body.classList.remove('menu-open');
  history.replaceState(null, '', `#${next}`);
  icons();
}
function emptyState(title: string, description: string) {
  return `<div class="empty-state"><span class="empty-icon">${icon('crosshair')}</span><span class="eyebrow">A CLEAN SLATE. A NEW OPPORTUNITY.</span><h3>${title}</h3><p>${description}</p><button class="primary-button" data-view="arena">Enter the arena${icon('arrow-up-right')}</button></div>`;
}
function renderStatistics() {
  const hits = sessions.reduce((sum, s) => sum + s.hits, 0);
  const shots = sessions.reduce((sum, s) => sum + s.shots, 0);
  const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0);
  const recent = sessions.slice(0, 12).reverse();
  const maxScore = Math.max(1, ...recent.map((s) => s.score));
  $('#statistics-view').innerHTML = `<div class="stats-grid">${[
    ['crosshair', 'TARGETS HIT', format(hits), 'One shot at a time'],
    [
      'target',
      'OVERALL ACCURACY',
      shots ? `${Math.round((hits / shots) * 100)}<small>%</small>` : '--',
      'Hits across all sessions',
    ],
    [
      'activity',
      'SESSIONS COMPLETED',
      String(sessions.length),
      'Reps that make a difference',
    ],
    [
      'clock-3',
      'TIME INVESTED',
      `${Math.floor(totalTime / 60)}<small>min</small>`,
      'Time well spent',
    ],
  ]
    .map(
      ([i, label, value, sub]) =>
        `<div class="stat-card"><span>${icon(i)}${label}</span><strong>${value}</strong><p>${sub}</p></div>`,
    )
    .join(
      '',
    )}</div><section class="data-panel"><div class="data-panel-header"><div><h2>Your trajectory</h2><p>Score across your last 12 sessions</p></div><span class="pill">${icon('trending-up')}THE LONG GAME</span></div>${recent.length ? `<div class="score-chart">${recent.map((s, i) => `<div class="chart-column"><span>${format(s.score)}</span><div class="chart-bar" style="--bar-height:${Math.max(3, (s.score / maxScore) * 100)}%" title="${modes[s.mode].name}: ${format(s.score)} points"></div><small>${String(i + 1).padStart(2, '0')}</small></div>`).join('')}</div>` : emptyState('Every expert starts at zero.', 'Complete your first session to see your progress take shape.')}</section><section class="data-panel"><div class="data-panel-header"><div><h2>Recent sessions</h2><p>Your last 20 runs. All the details.</p></div><button class="secondary-button" data-action="export" ${sessions.length ? '' : 'disabled'}>${icon('download')}Export CSV</button></div>${sessions.length ? sessionTable(sessions.slice(0, 20), false) : '<div class="table-empty">No sessions yet. Your first one is a click away.</div>'}</section>`;
  icons();
}
function sessionTable(data: SavedSession[], ranked: boolean) {
  return `<div class="table-scroll"><table><thead><tr><th>${ranked ? 'RANK' : 'DATE'}</th><th>MODE</th><th>SCORE</th><th>ACCURACY</th><th>BEST COMBO</th><th>SESSION</th></tr></thead><tbody>${data.map((s, i) => `<tr><td>${ranked ? `<span class="rank ${i === 0 ? 'rank-first' : ''}">${i === 0 ? icon('trophy') : String(i + 1).padStart(2, '0')}</span>` : new Date(s.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</td><td><span class="table-mode">${icon(modes[s.mode].icon)}${modes[s.mode].name}</span></td><td class="table-score">${format(s.score)}</td><td>${Math.round(s.accuracy)}<span class="muted">%</span></td><td>${s.bestCombo}<span class="muted">×</span></td><td><span class="session-tag">${s.duration}s <span>·</span> ${s.difficulty}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function renderLeaderboard() {
  const filtered = sessions
    .filter(
      (s) =>
        s.mode === leaderboardMode &&
        s.duration === leaderboardDuration &&
        s.difficulty === leaderboardDifficulty,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  $('#leaderboard-view').innerHTML =
    `<div class="record-banner"><span class="record-banner-icon">${icon('trophy')}</span><div><span class="eyebrow">THE ONLY COMPETITION THAT MATTERS</span><h2>Set the bar. Then raise it.</h2><p>Your top 10 runs for each mode, saved right here on this device.</p></div><span class="record-decoration">PB<span>↗</span></span></div><section class="data-panel"><div class="data-panel-header leaderboard-header"><div class="record-tabs" role="group" aria-label="Personal best mode">${Object.entries(
      modes,
    )
      .map(
        ([id, m]) =>
          `<button data-record-mode="${id}" class="${id === leaderboardMode ? 'selected' : ''}" aria-pressed="${id === leaderboardMode}">${icon(m.icon)}${m.name}</button>`,
      )
      .join(
        '',
      )}</div><div class="record-filters"><select id="record-duration" aria-label="Filter records by duration">${[30, 60, 120].map((n) => `<option value="${n}" ${n === leaderboardDuration ? 'selected' : ''}>${n} seconds</option>`).join('')}</select><select id="record-difficulty" aria-label="Filter records by difficulty">${['easy', 'normal', 'hard'].map((d) => `<option value="${d}" ${d === leaderboardDifficulty ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></div></div>${filtered.length ? sessionTable(filtered, true) : emptyState('Your next personal best is waiting.', `Play a ${leaderboardDuration}-second ${modes[leaderboardMode].name} session on ${leaderboardDifficulty} to put your name on the board.`)}<div class="data-panel-footer">${icon('shield-check')}Private by design. No account, no uploads. Just your progress.</div></section>`;
  icons();
}
function openModal(content: string, type: string) {
  if (state === 'running' || state === 'countdown') arena?.pause();
  if (!$<HTMLDialogElement>('#modal').open)
    lastFocus = document.activeElement as HTMLElement;
  $('#modal-content').innerHTML =
    `<button class="modal-close icon-button" data-action="close-modal" aria-label="Close dialog">${icon('x')}</button>${content}`;
  $('#modal').dataset.type = type;
  const modal = $<HTMLDialogElement>('#modal');
  if (!modal.open) modal.showModal();
  icons();
}
function closeModal() {
  const result = $('#modal').dataset.type === 'result';
  $<HTMLDialogElement>('#modal').close();
  if (result) arena?.stop();
  lastFocus?.focus({ preventScroll: true });
}
function openSettings() {
  openModal(
    `<div class="modal-heading-icon">${icon('sliders-horizontal')}</div><span class="eyebrow">MAKE IT YOURS</span><h2 id="modal-title">Dial it in.</h2><p class="modal-description">Small adjustments. Better control.</p><div class="settings-section"><label>Crosshair style</label><div class="crosshair-options">${(['cross', 'dot', 'circle'] as const).map((style) => `<button data-crosshair="${style}" class="${config.crosshair === style ? 'selected' : ''}" aria-pressed="${config.crosshair === style}"><span class="crosshair-sample ${style}">${style === 'cross' ? icon('crosshair') : style === 'circle' ? icon('circle') : '<b></b>'}</span><span>${style === 'cross' ? 'Classic' : style === 'dot' ? 'Dot' : 'Circle'}</span>${config.crosshair === style ? icon('check') : ''}</button>`).join('')}</div></div><div class="settings-row"><div><strong>Sound effects</strong><p>A little feedback for every shot.</p></div><button class="toggle ${config.sound ? 'on' : ''}" id="settings-sound" data-action="sound" role="switch" aria-label="Sound effects" aria-checked="${config.sound}"><span></span></button></div><div class="settings-row"><div><strong>Reset preferences</strong><p>Restore default controls and settings.</p></div><button class="secondary-button" data-action="reset-settings">${icon('rotate-ccw')}Reset</button></div><div class="settings-footnote">${icon('shield-check')}Preferences are saved automatically on this device.</div><button class="primary-button modal-done" data-action="close-modal">All set${icon('check')}</button>`,
    'settings',
  );
}
function openHelp() {
  openModal(
    `<div class="modal-heading-icon">${icon('keyboard')}</div><span class="eyebrow">THE BASICS</span><h2 id="modal-title">Less guessing. More aiming.</h2><p class="modal-description">Choose a mode, set your pace, and hit Start training.</p><div class="help-controls">${[
      [
        '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>',
        'Move around the arena',
      ],
      [icon('mouse'), 'Move mouse to aim · Click to shoot'],
      ['<kbd>ESC</kbd>', 'Pause and release your mouse'],
      ['<kbd>F</kbd>', 'Expand the arena'],
      ['<kbd>M</kbd>', 'Toggle sound effects'],
    ]
      .map(([key, text]) => `<div><span>${key}</span><p>${text}</p></div>`)
      .join(
        '',
      )}</div><div class="help-tip">${icon('sparkles')}<p><strong>On a touch screen?</strong> Drag anywhere in the arena to aim. Tap to shoot, or hold the fire button for Tracking.</p></div><div class="help-mode"><strong>${modes[config.mode].name} · Your selected mode</strong><p>${modes[config.mode].detail}</p></div><button class="primary-button modal-done" data-action="close-modal">Let's get to it${icon('arrow-up-right')}</button>`,
    'help',
  );
}
function finishSession(result: SessionResult) {
  const best = currentBest();
  const isBest = result.score > best;
  sessions.unshift({
    ...result,
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
  });
  sessions = sessions.slice(0, 100);
  persist('deadeye-sessions-v1', sessions);
  updateWeek();
  $('#arena-best').innerHTML = `${format(currentBest())}<small>PTS</small>`;
  exitExpanded();
  openModal(
    `<div class="modal-heading-icon result-icon">${icon(isBest ? 'trophy' : 'check')}</div><span class="eyebrow">${isBest ? 'A NEW PERSONAL BEST' : 'ANOTHER REP IN THE BOOKS'}</span><h2 id="modal-title">${isBest ? 'You raised the bar.' : 'Better than standing still.'}</h2><p class="modal-description">${modes[result.mode].name} <span>·</span> ${result.duration} seconds <span>·</span> ${result.difficulty}</p><div class="result-score"><span>FINAL SCORE</span><strong>${format(result.score)}</strong>${isBest ? '<span class="new-best">NEW PERSONAL BEST</span>' : `<span>PERSONAL BEST ${format(best)}</span>`}</div><div class="result-stats"><div><span>ACCURACY</span><strong>${Math.round(result.accuracy)}<small>%</small></strong></div><div><span>TARGETS HIT</span><strong>${result.hits}</strong></div><div><span>BEST COMBO</span><strong>${result.bestCombo}<small>×</small></strong></div><div><span>REACTION</span><strong>${result.hits ? result.reactionTime : '--'}<small>ms</small></strong></div></div><p class="result-note">${result.shots === 0 ? 'Ready when you are. Aim with your mouse, then click to take your first shot.' : result.accuracy >= 80 ? 'Clean shots. Solid focus. Keep that momentum going.' : 'Slow is smooth. Smooth is fast. Keep finding your rhythm.'}</p><button class="primary-button modal-done" data-action="play-again">${icon('rotate-ccw')}Run it back${icon('arrow-up-right')}</button><button class="text-button result-back" data-action="close-modal">Back to the arena</button>`,
    'result',
  );
}
function startSession() {
  if (!arena) {
    toast(
      'WebGL is unavailable. Enable hardware acceleration and reload to enter the arena.',
    );
    return;
  }
  if (state === 'paused') {
    arena.resume();
    return;
  }
  if (state === 'running' || state === 'countdown') {
    arena.pause();
    return;
  }
  arena.start(config);
  $('#arena-stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function exitExpanded() {
  $('.arena-panel').classList.remove('expanded');
  document.body.classList.remove('arena-expanded');
  $('.fullscreen-button').innerHTML =
    `${icon('maximize')}<span>Fullscreen</span>`;
  icons();
}
function toggleExpanded() {
  const expanded = $('.arena-panel').classList.toggle('expanded');
  document.body.classList.toggle('arena-expanded', expanded);
  $('.fullscreen-button').innerHTML =
    `${icon(expanded ? 'minimize' : 'maximize')}<span>${expanded ? 'Exit fullscreen' : 'Fullscreen'}</span>`;
  icons();
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>(
    'button, a.brand',
  );
  if (!button || (button instanceof HTMLButtonElement && button.disabled))
    return;
  if (button.classList.contains('brand')) {
    event.preventDefault();
    changeView('arena');
  }
  if (button.dataset.view) changeView(button.dataset.view);
  if (
    button.dataset.mode &&
    !['countdown', 'running', 'paused'].includes(state)
  ) {
    config.mode = button.dataset.mode as TrainingMode;
    if (view !== 'arena') changeView('arena');
    updateConfig();
    document.body.classList.remove('menu-open');
  }
  if (button.dataset.duration) {
    config.duration = Number(button.dataset.duration);
    updateConfig();
  }
  if (button.dataset.recordMode) {
    leaderboardMode = button.dataset.recordMode as TrainingMode;
    renderLeaderboard();
  }
  if (button.dataset.crosshair) {
    config.crosshair = button.dataset.crosshair as ArenaConfig['crosshair'];
    updateConfig();
    openSettings();
  }
  switch (button.dataset.action) {
    case 'start':
      startSession();
      break;
    case 'resume':
      arena?.resume();
      break;
    case 'pause':
      arena?.pause();
      break;
    case 'end':
      arena?.stop();
      exitExpanded();
      toast('Session ended. Take your next rep when you are ready.');
      break;
    case 'play-again':
      closeModal();
      startSession();
      break;
    case 'help':
      openHelp();
      break;
    case 'settings':
      openSettings();
      break;
    case 'close-modal':
      closeModal();
      break;
    case 'menu':
      document.body.classList.toggle('menu-open');
      break;
    case 'close-menu':
      document.body.classList.remove('menu-open');
      break;
    case 'fullscreen':
      toggleExpanded();
      break;
    case 'sound':
      config.sound = !config.sound;
      arena?.setMuted(!config.sound);
      updateConfig();
      if ($('#settings-sound')) {
        $('#settings-sound').classList.toggle('on', config.sound);
        $('#settings-sound').setAttribute('aria-checked', String(config.sound));
      }
      toast(`Sound ${config.sound ? 'on' : 'off'}`);
      break;
    case 'reset-settings':
      if (state === 'idle' || state === 'finished')
        config = { ...defaultConfig };
      else
        config = { ...config, sensitivity: 1, sound: true, crosshair: 'cross' };
      arena?.setMuted(false);
      updateConfig();
      openSettings();
      toast('Preferences restored to defaults.');
      break;
    case 'export': {
      const header =
        'Date,Mode,Duration,Difficulty,Score,Hits,Shots,Accuracy,Best Combo,Reaction Time (ms)';
      const rows = sessions.map((s) =>
        [
          s.date,
          s.mode,
          s.duration,
          s.difficulty,
          s.score,
          s.hits,
          s.shots,
          s.accuracy.toFixed(1),
          s.bestCombo,
          s.reactionTime,
        ].join(','),
      );
      const url = URL.createObjectURL(
        new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'deadeye-sessions.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Your session history has been exported.');
      break;
    }
  }
});
$('#difficulty').addEventListener('change', (event) => {
  config.difficulty = (event.target as HTMLSelectElement)
    .value as ArenaConfig['difficulty'];
  updateConfig();
});
$('#sensitivity').addEventListener('input', (event) => {
  config.sensitivity = Number((event.target as HTMLInputElement).value);
  updateConfig();
});
document.addEventListener('change', (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.id === 'record-duration') {
    leaderboardDuration = Number(target.value);
    renderLeaderboard();
  }
  if (target.id === 'record-difficulty') {
    leaderboardDifficulty = target.value as ArenaConfig['difficulty'];
    renderLeaderboard();
  }
});
document.addEventListener('keydown', (event) => {
  if (
    (event.target as Element).matches('input, select, textarea') ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.repeat
  )
    return;
  if ($<HTMLDialogElement>('#modal').open) return;
  if (event.key === '?' || event.key.toLowerCase() === 'h') {
    event.preventDefault();
    openHelp();
  }
  if (event.key.toLowerCase() === 'm') $('#sound-button').click();
  if (event.key.toLowerCase() === 'f' && view === 'arena') {
    event.preventDefault();
    toggleExpanded();
  }
  if (event.key === 'Escape') {
    document.body.classList.remove('menu-open');
    if (state === 'idle' || state === 'finished') exitExpanded();
  }
});
$<HTMLDialogElement>('#modal').addEventListener('cancel', (event) => {
  event.preventDefault();
  closeModal();
});
$('#modal').addEventListener('click', (event) => {
  if (event.target === $('#modal')) {
    const rect = $('#modal').getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeModal();
  }
});
let touchFire: ReturnType<typeof setInterval> | undefined;
$('.touch-shoot').addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  arena?.shoot();
  if (config.mode === 'tracking')
    touchFire = setInterval(() => arena?.shoot(), 85);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('.touch-shoot').addEventListener(name, () => {
    clearInterval(touchFire);
  });

icons();
try {
  arena = new Arena($('#arena-canvas'), {
    onStats: updateStats,
    onState: updateState,
    onCountdown: (count) => {
      $('#countdown-number').textContent = count ? String(count) : 'GO';
    },
    onFinish: finishSession,
  });
} catch (error) {
  console.error('Arena initialization failed:', error);
  $('#arena-canvas').innerHTML =
    `<div class="webgl-error">${icon('crosshair')}<h3>Your arena needs WebGL.</h3><p>Enable hardware acceleration in your browser, then reload to start training.</p><button class="secondary-button" onclick="location.reload()">Try again</button></div>`;
  $('#preview-label').classList.add('hidden');
}
updateConfig();
updateWeek();
const initialView = location.hash.slice(1);
changeView(
  ['arena', 'statistics', 'leaderboard'].includes(initialView)
    ? initialView
    : 'arena',
);
