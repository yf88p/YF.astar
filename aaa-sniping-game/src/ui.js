const icons = {
  mark: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 1v8m0 14v8M1 16h8m14 0h8"/><path d="m16 7 9 9-9 9-9-9Z"/><path d="M13 16h6m-3-3v6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/><g class="ui-sound-on"><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></g><path class="ui-sound-off" d="m17 9 5 6m0-6-5 6"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  scope: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 1v7m0 8v7M1 12h7m8 0h7"/></svg>',
  fire: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.5 9A8 8 0 1 0 20 14M20 4v6h-6"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>',
  breath: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v9m0-5c-2-5-6-1-7 4s-3 9 1 9c3 0 4-3 4-6m2-7c2-5 6-1 7 4s3 9-1 9c-3 0-4-3-4-6"/></svg>',
  wind: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 8h12c5 0 4-6 1-5M3 12h16c4 0 3 6 0 5M3 16h8c4 0 3 6 0 5"/></svg>',
};

function reticle() {
  const dots = [];
  for (let step = 1; step <= 5; step += 1) {
    const distance = step * 42;
    for (const direction of [-1, 1]) {
      dots.push(`<circle cx="${500 + distance * direction}" cy="500" r="3"/><circle cx="500" cy="${500 + distance * direction}" r="3"/>`);
      dots.push(`<path d="M${500 + (distance - 21) * direction} 496v8M496 ${500 + (distance - 21) * direction}h8" fill="none"/>`);
    }
  }
  return `<svg class="ui-reticle" viewBox="0 0 1000 1000" aria-hidden="true">
    <g class="ui-reticle-lines"><path d="M0 500h493m14 0h493M500 0v493m0 14v493" fill="none"/>
    <path d="M0 500h235m530 0h235M500 765v235" class="ui-reticle-post" fill="none"/>${dots.join('')}
    <path d="M582 686h112M582 686v-12m28 12v-22m28 22v-33m28 33v-47m28 47v-64" fill="none"/>
    </g><circle class="ui-reticle-center" cx="500" cy="500" r="2.4"/>
    <g class="ui-reticle-labels"><text x="578" y="708">8</text><text x="634" y="708">6</text><text x="686" y="708">4</text><text x="580" y="742">1.7 M</text></g>
  </svg>`;
}

/**
 * Engine callbacks: start/resume/restart/fire/reload/fullscreen/brief(),
 * aim/steady(enabled), sound(muted). Breath is normalized (0..1), time is seconds.
 * update() accepts partial state; setMode() owns the visible game mode.
 * showDebrief() also accepts accuracy (0..100), headshots, and success.
 */
export function createUI(handlers = {}) {
  const root = document.createElement('div');
  root.id = 'game-ui';
  root.dataset.mode = 'menu';
  root.dataset.scoped = 'false';
  root.dataset.muted = 'false';
  root.dataset.locked = 'false';
  root.innerHTML = `
    <div class="ui-atmosphere" aria-hidden="true"></div>
    <div class="ui-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>

    <div class="ui-scope" data-ui="scope" aria-hidden="true">
      <div class="ui-scope-lens">
        ${reticle()}
        <div class="ui-scope-spec"><span>MIL-DOT / FFP</span><strong data-value="zoom">8.0&times;</strong></div>
        <div class="ui-scope-range"><span>RANGE / M</span><strong data-value="range">420</strong><small>ZERO 100 M</small></div>
        <div class="ui-scope-level"><i></i><span></span><i></i></div>
      </div>
    </div>

    <header class="ui-header">
      <div class="ui-brand" aria-label="Silent Ridge">${icons.mark}<span>SILENT RIDGE</span></div>
      <div class="ui-header-center">
        <p class="ui-menu-context">SINGLE PLAYER <b>/</b> ALPINE THEATER</p>
        <div class="ui-field-context"><span class="ui-live-dot"></span><span>OP. DEAD AIR</span><b>/</b><span data-value="top-objective">00 OF 05 NEUTRALIZED</span></div>
      </div>
      <nav class="ui-settings" aria-label="Game settings">
        <span class="ui-settings-label">FIELD SETTINGS</span>
        <button class="ui-icon-button ui-pause-button" type="button" data-action="pause" aria-label="Pause operation" title="Pause operation">${icons.pause}</button>
        <button class="ui-icon-button" type="button" data-action="sound" aria-label="Mute sound" aria-pressed="false" title="Mute sound">${icons.sound}</button>
        <button class="ui-icon-button" type="button" data-action="fullscreen" aria-label="Enter fullscreen" aria-pressed="false" title="Enter fullscreen">${icons.fullscreen}</button>
      </nav>
    </header>

    <main class="ui-menu" data-ui="menu">
      <section class="ui-hero" aria-labelledby="ui-title">
        <p class="ui-eyebrow"><span></span>TACTICAL PRECISION <b>/</b> VOL. 01</p>
        <h1 id="ui-title">DISTANCE IS<br>YOUR ADVANTAGE<span>.</span></h1>
        <div class="ui-mission-copy">
          <p class="ui-operation"><span>01</span> OPERATION DEAD AIR</p>
          <p class="ui-description">A remote relay. Five hostiles. One clear shot.<br> Infiltrate the station and silence the signal<br class="ui-desktop-break"> before it reaches the outside world.</p>
        </div>
        <div class="ui-menu-actions">
          <button class="ui-button ui-button-primary" type="button" data-action="start"><span>ENTER OVERWATCH</span>${icons.arrow}</button>
          <button class="ui-button ui-button-text" type="button" data-action="brief"><span>MISSION BRIEF</span><span class="ui-plus" aria-hidden="true">+</span></button>
        </div>
        <p class="ui-mobile-intro">DRAG TO LOOK <span>/</span> USE FIELD CONTROLS TO ENGAGE</p>
      </section>

      <aside class="ui-locator" aria-label="Location: Karst Relay, Northern Frontier">
        <div class="ui-locator-pin" aria-hidden="true"><span></span></div>
        <div><p>KARST RELAY</p><span>NORTHERN FRONTIER</span><small>SECTOR 07 <b>&nearr;</b></small></div>
      </aside>

      <dl class="ui-mission-meta">
        <div><dt>INSERTION POINT</dt><dd>46&deg; 31&prime; N <span>/</span> 13&deg; 44&prime; E</dd></div>
        <div><dt>LOCAL TIME</dt><dd>04:38 <span>HRS</span></dd></div>
        <div><dt>CONDITIONS</dt><dd>&minus;04&deg; <span>/</span> CLEAR</dd></div>
        <div><dt>ELEVATION</dt><dd>2,840 <span>M ASL</span></dd></div>
      </dl>
    </main>

    <section class="ui-gameplay" data-ui="gameplay" aria-label="Field instruments" hidden>
      <div class="ui-crosshair" data-ui="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <button class="ui-return-button" type="button" data-action="resume">${icons.scope}<span>CLICK TO RETURN TO OVERWATCH</span></button>
      <div class="ui-hud">
        <div class="ui-weapon">
          <p class="ui-hud-label">M24 SWS <span>/</span> 7.62 &times; 51</p>
          <div class="ui-ammo"><strong data-value="ammo">05</strong><span class="ui-ammo-divider">/</span><span data-value="reserve">25</span><div class="ui-ammo-detail"><span data-value="weapon-status">BOLT ACTION</span><div class="ui-rounds" data-ui="rounds" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div></div>
        </div>
        <div class="ui-field-status"><span class="ui-hud-label">UPLINK WINDOW / REMAINING</span><div>${icons.wind}<span data-value="wind">2.4 M/S</span><b>&middot;</b><span data-value="time">05:00</span></div></div>
        <div class="ui-objective">
          <div class="ui-objective-heading"><span class="ui-hud-label">HOSTILES NEUTRALIZED</span><strong data-value="objective">00 <span>/ 05</span></strong></div>
          <div class="ui-targets" data-ui="targets" aria-hidden="true"></div>
          <div class="ui-breath"><span>STABILITY</span><div class="ui-breath-track" data-ui="breath" role="progressbar" aria-label="Breath remaining" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i></i></div><span class="ui-breath-key">SHIFT</span></div>
        </div>
      </div>
      <div class="ui-mobile-controls" aria-label="Touch controls">
        <div class="ui-touch-left"><button class="ui-touch-button" type="button" data-action="aim" aria-label="Toggle scope" aria-pressed="false">${icons.scope}<span>SCOPE</span></button><button class="ui-touch-button" type="button" data-action="steady" aria-label="Hold to steady aim" aria-pressed="false">${icons.breath}<span>STEADY</span></button></div>
        <p class="ui-drag-hint">DRAG TO LOOK</p>
        <div class="ui-touch-right"><button class="ui-touch-button" type="button" data-action="reload" aria-label="Reload">${icons.reload}<span>RELOAD</span></button><button class="ui-touch-button ui-touch-fire" type="button" data-action="fire" aria-label="Fire weapon">${icons.fire}<span>FIRE</span></button></div>
      </div>
    </section>

    <footer class="ui-footer">
      <div class="ui-controls" aria-label="Keyboard and mouse controls"><span><kbd class="ui-mouse-key">&harr;</kbd>LOOK</span><span><kbd>LMB</kbd>FIRE</span><span><kbd>RMB</kbd>SCOPE</span><span><kbd>R</kbd>RELOAD</span><span><kbd>SHIFT</kbd>STEADY</span><span class="ui-pause-hint"><kbd>ESC</kbd>PAUSE</span></div>
      <p class="ui-footer-note"><span></span> PATIENCE. PRECISION. SILENCE.</p>
    </footer>

    <div class="ui-hit" data-ui="hit" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="m9 9 9 9m12 12 9 9M39 9 30 18M18 30l-9 9"/></svg><span data-value="hit-label">CONFIRMED</span></div>
    <div class="ui-toasts" data-ui="toasts" role="status" aria-live="polite" aria-atomic="false"></div>

    <div class="ui-dialog-shell" data-ui="dialog" hidden>
      <div class="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title" tabindex="-1">
        <div class="ui-dialog-top"><span>${icons.mark} SILENT RIDGE <b>/</b> FIELD RECORD</span><button class="ui-icon-button" type="button" data-action="close-dialog" aria-label="Close dialog" title="Close dialog">${icons.close}</button></div>
        <div class="ui-dialog-body">
          <p class="ui-eyebrow" data-value="dialog-eyebrow">MISSION INTELLIGENCE / 01</p>
          <h2 id="ui-dialog-title">THE BRIEF<span>.</span></h2>

          <section data-panel="brief" hidden>
            <p class="ui-dialog-lead">A narrow window. A decisive silence.</p>
            <p class="ui-dialog-copy">Karst Relay is preparing a transmission. You have five minutes to eliminate all five hostiles from the northern ridge before the signal leaves the valley.</p>
            <ol class="ui-brief-steps"><li><span>01</span><div><strong>TAKE THE HIGH GROUND</strong><p>Survey the relay. Use A / D to adjust your position.</p></div></li><li><span>02</span><div><strong>CONTROL THE SHOT</strong><p>RMB or Q to scope. Scroll for 4-12x. Hold Shift to steady.</p></div></li><li><span>03</span><div><strong>LEAVE NO SIGNAL</strong><p>Click or Space to fire. R to reload. P to pause.</p></div></li></ol>
            <div class="ui-brief-kit"><span>ISSUED EQUIPMENT</span><strong>M24 SWS <b>/</b> 7.62 &times; 51 <b>/</b> MIL-DOT OPTIC</strong></div>
            <button class="ui-button ui-button-primary ui-button-wide" type="button" data-ui="brief-continue" data-action="start"><span>ENTER OVERWATCH</span>${icons.arrow}</button>
          </section>

          <section data-panel="paused" hidden>
            <p class="ui-dialog-lead">Hold your position.</p>
            <p class="ui-dialog-copy">The ridge can wait. Return when you're ready to make the next shot.</p>
            <div class="ui-pause-summary"><div><span>CONFIRMED</span><strong data-value="pause-objective">00 / 05</strong></div><div><span>ELAPSED</span><strong data-value="pause-time">00:00</strong></div><div><span>SCORE</span><strong data-value="pause-score">0000</strong></div></div>
            <div class="ui-dialog-actions"><button class="ui-button ui-button-primary ui-button-wide" type="button" data-action="resume"><span>RESUME OPERATION</span>${icons.arrow}</button><button class="ui-button ui-button-outline" type="button" data-action="restart">RESTART MISSION ${icons.reload}</button><button class="ui-button ui-button-text" type="button" data-action="brief">MISSION BRIEF <span class="ui-plus" aria-hidden="true">+</span></button></div>
          </section>

          <section data-panel="complete" hidden>
            <p class="ui-dialog-lead" data-value="debrief-lead">The valley is quiet again.</p>
            <p class="ui-dialog-copy" data-value="debrief-copy">Relay silenced. All hostiles neutralized. A clean operation, without a trace.</p>
            <div class="ui-debrief-score"><span>OPERATION SCORE</span><strong data-value="debrief-score">0000</strong><span class="ui-debrief-stamp">FIELD REPORT <b>/</b> 01</span></div>
            <dl class="ui-debrief-stats"><div><dt>NEUTRALIZED</dt><dd data-value="debrief-kills">05 / 05</dd></div><div><dt>ELAPSED</dt><dd data-value="debrief-time">00:00</dd></div><div data-ui="accuracy-stat" hidden><dt>ACCURACY</dt><dd data-value="debrief-accuracy">--</dd></div><div data-ui="headshots-stat" hidden><dt>HEADSHOTS</dt><dd data-value="debrief-headshots">00</dd></div></dl>
            <button class="ui-button ui-button-primary ui-button-wide" type="button" data-action="restart"><span>RETURN TO THE RIDGE</span>${icons.arrow}</button>
          </section>
        </div>
        <div class="ui-dialog-bottom"><span>46&deg; 31&prime; N / 13&deg; 44&prime; E</span><span>RESTRICTED / EYES ONLY</span></div>
      </div>
    </div>`;

  document.body.append(root);

  const controller = new AbortController();
  const { signal } = controller;
  const nodes = Object.fromEntries([...root.querySelectorAll('[data-ui]')].map((el) => [el.dataset.ui, el]));
  const find = (name) => nodes[name];
  const values = Object.fromEntries([...root.querySelectorAll('[data-value]')].map((el) => [el.dataset.value, el]));
  const panels = [...root.querySelectorAll('[data-panel]')];
  const state = { kills: 0, total: 5, ammo: 5, reserve: 25, scoped: false, zoom: 8, range: 420, breath: 1, reloading: false, score: 0, time: 0, wind: 2.4, muted: false, locked: false };
  let mode = 'menu';
  let dialog = null;
  let returnFocus = null;
  let hitTimer;
  let steadyPointer = null;
  let destroyed = false;
  let debriefSuccess = true;
  const timers = new Set();
  const pad = (value) => String(Math.max(0, Math.floor(Number(value) || 0))).padStart(2, '0');
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clock = (seconds) => `${pad(Math.floor(number(seconds) / 60))}:${pad(number(seconds) % 60)}`;
  const text = (name, value) => {
    if (values[name].textContent !== String(value)) values[name].textContent = String(value);
  };
  const invoke = (name, ...args) => handlers[name]?.(...args);

  function syncScope() {
    const scoped = mode === 'playing' && !dialog && Boolean(state.scoped);
    root.dataset.scoped = String(scoped);
    find('scope').setAttribute('aria-hidden', String(!scoped));
    root.querySelector('[data-action="aim"]').setAttribute('aria-pressed', String(Boolean(state.scoped)));
  }

  function releaseSteady() {
    if (steadyPointer === null) return;
    steadyPointer = null;
    root.querySelector('[data-action="steady"]').setAttribute('aria-pressed', 'false');
    invoke('steady', false);
  }

  function openDialog(name) {
    releaseSteady();
    if (!dialog) returnFocus = document.activeElement;
    dialog = name;
    root.dataset.dialog = name;
    find('dialog').hidden = false;
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    const titles = {
      brief: ['MISSION INTELLIGENCE / 01', 'THE BRIEF'],
      paused: ['OPERATION DEAD AIR / ON HOLD', 'STAND BY'],
      complete: ['OPERATION DEAD AIR / DEBRIEF', debriefSuccess ? 'SIGNAL SILENCED' : 'SIGNAL LOST'],
    };
    if (name === 'brief') {
      const action = mode === 'menu' ? 'start' : mode === 'complete' ? 'restart' : 'resume';
      find('brief-continue').dataset.action = action;
      find('brief-continue').querySelector('span').textContent = action === 'resume' ? 'RESUME OPERATION' : 'ENTER OVERWATCH';
    }
    text('dialog-eyebrow', titles[name][0]);
    root.querySelector('#ui-dialog-title').innerHTML = `${titles[name][1]}<span>.</span>`;
    root.querySelector('[data-action="close-dialog"]').hidden = name === 'complete';
    for (const el of root.querySelectorAll('.ui-header, .ui-menu, .ui-gameplay, .ui-footer')) el.inert = true;
    syncScope();
    root.querySelector(`[data-panel="${name}"] .ui-button`).focus({ preventScroll: true });
  }

  function closeDialog(restoreFocus = true) {
    dialog = null;
    delete root.dataset.dialog;
    find('dialog').hidden = true;
    for (const el of root.querySelectorAll('.ui-header, .ui-menu, .ui-gameplay, .ui-footer')) el.inert = false;
    syncScope();
    if (restoreFocus && returnFocus instanceof HTMLElement && returnFocus.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true });
    else if (find('dialog').contains(document.activeElement)) document.activeElement.blur();
    returnFocus = null;
  }

  function setMode(nextMode) {
    if (destroyed || !['menu', 'playing', 'paused', 'complete'].includes(nextMode)) return;
    releaseSteady();
    mode = nextMode;
    root.dataset.mode = mode;
    find('menu').hidden = mode !== 'menu';
    find('gameplay').hidden = mode !== 'playing';
    if (mode !== 'playing') {
      state.scoped = false;
      find('hit').classList.remove('is-visible');
    }
    if (mode === 'paused' || mode === 'complete') openDialog(mode);
    else closeDialog(mode === 'menu');
    syncScope();
  }

  function update(nextState = {}) {
    if (destroyed) return;
    Object.assign(state, nextState);
    const kills = Math.max(0, Math.floor(number(state.kills)));
    const total = Math.max(1, Math.floor(number(state.total, 5)));
    const ammo = Math.max(0, Math.floor(number(state.ammo)));
    const breath = Math.min(1, Math.max(0, number(state.breath, 1)));
    text('ammo', pad(ammo));
    text('reserve', pad(state.reserve));
    text('weapon-status', state.reloading ? 'RELOADING' : ammo === 0 ? 'RELOAD / R' : 'BOLT ACTION');
    root.dataset.reloading = String(Boolean(state.reloading));
    root.dataset.empty = String(ammo === 0);
    text('top-objective', `${pad(kills)} / ${pad(total)} CONFIRMED / ${clock(Math.max(0, (state.timeLimit ?? 300) - state.time))}`);
    const objective = `${pad(kills)} / ${pad(total)}`;
    if (values.objective.dataset.current !== objective) {
      values.objective.innerHTML = `${pad(kills)} <span>/ ${pad(total)}</span>`;
      values.objective.dataset.current = objective;
    }
    const targetCount = Math.min(total, 20);
    const targets = find('targets');
    if (targets.children.length !== targetCount) targets.innerHTML = '<i></i>'.repeat(targetCount);
    [...targets.children].forEach((target, index) => target.classList.toggle('is-confirmed', index < kills));
    [...find('rounds').children].forEach((round, index) => round.classList.toggle('is-spent', index >= ammo));
    find('breath').style.setProperty('--breath', String(breath));
    find('breath').setAttribute('aria-valuenow', String(Math.round(breath * 100)));
    root.dataset.lowBreath = String(breath < 0.2);
    text('zoom', `${number(state.zoom, 8).toFixed(1)}\u00d7`);
    text('range', state.range == null ? '---' : Math.max(0, Math.round(number(state.range))));
    text('time', clock(Math.max(0, (state.timeLimit ?? 300) - state.time)));
    text('wind', typeof state.wind === 'string' ? state.wind : `${number(state.wind).toFixed(1)} M/S`);
    text('pause-objective', objective);
    text('pause-time', clock(state.time));
    text('pause-score', String(Math.round(number(state.score))).padStart(4, '0'));
    text('debrief-kills', objective);
    text('debrief-time', clock(state.time));
    text('debrief-score', Math.round(number(state.score)).toLocaleString('en-US'));
    root.dataset.muted = String(Boolean(state.muted));
    root.dataset.locked = String(Boolean(state.locked));
    const soundButton = root.querySelector('[data-action="sound"]');
    soundButton.setAttribute('aria-pressed', String(Boolean(state.muted)));
    soundButton.setAttribute('aria-label', state.muted ? 'Unmute sound' : 'Mute sound');
    soundButton.title = state.muted ? 'Unmute sound' : 'Mute sound';
    syncScope();
  }

  function toast(message, type = 'info') {
    if (destroyed || !message) return;
    const item = document.createElement('div');
    item.className = 'ui-toast';
    item.dataset.type = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';
    const marker = document.createElement('span');
    marker.className = 'ui-toast-marker';
    marker.textContent = item.dataset.type === 'error' || item.dataset.type === 'warning' ? '!' : '+';
    const copy = document.createElement('span');
    copy.textContent = String(message);
    item.append(marker, copy);
    find('toasts').append(item);
    while (find('toasts').children.length > 3) find('toasts').firstElementChild.remove();
    const timer = setTimeout(() => { item.remove(); timers.delete(timer); }, 3600);
    timers.add(timer);
  }

  function hit(headshot = false) {
    if (destroyed || mode !== 'playing') return;
    clearTimeout(hitTimer);
    find('hit').dataset.headshot = String(Boolean(headshot));
    text('hit-label', headshot ? 'HEADSHOT' : 'HIT CONFIRMED');
    find('hit').classList.add('is-visible');
    hitTimer = setTimeout(() => find('hit').classList.remove('is-visible'), 650);
  }

  function showDebrief(stats = {}) {
    if (destroyed) return;
    update(stats);
    find('accuracy-stat').hidden = stats.accuracy == null;
    find('headshots-stat').hidden = stats.headshots == null;
    if (stats.accuracy != null) text('debrief-accuracy', `${Math.round(Math.min(100, Math.max(0, number(stats.accuracy))))}%`);
    if (stats.headshots != null) text('debrief-headshots', pad(stats.headshots));
    const success = stats.success !== false && number(state.kills) >= number(state.total);
    debriefSuccess = success;
    text('debrief-lead', success ? 'The valley is quiet again.' : 'Every operation leaves a lesson.');
    text('debrief-copy', success ? 'Relay silenced. All hostiles neutralized. A clean operation, without a trace.' : 'The signal got through. Reassess your approach and return to the ridge.');
    setMode('complete');
  }

  function begin(action) {
    if (action !== 'resume') {
      update({ kills: 0, time: 0, score: 0, scoped: false, breath: 1, reloading: false, locked: false });
      find('accuracy-stat').hidden = true;
      find('headshots-stat').hidden = true;
      find('toasts').replaceChildren();
    }
    setMode('playing');
    invoke(action);
  }

  function dismissDialog() {
    if (dialog === 'brief') {
      if (mode === 'paused' || mode === 'complete') openDialog(mode);
      else closeDialog();
    } else if (dialog === 'paused') begin('resume');
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('.ui-dialog-shell')) event.stopPropagation();
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    event.stopPropagation();
    switch (button.dataset.action) {
      case 'start': case 'resume': case 'restart': begin(button.dataset.action); break;
      case 'pause': invoke('pause'); break;
      case 'brief': openDialog('brief'); invoke('brief'); break;
      case 'close-dialog': dismissDialog(); break;
      case 'sound': update({ muted: !state.muted }); invoke('sound', state.muted); break;
      case 'fullscreen':
        if (handlers.fullscreen) invoke('fullscreen');
        else {
          const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
          if (request) request.catch(() => toast('Fullscreen is unavailable in this browser.', 'warning'));
          else toast('Fullscreen is unavailable in this browser.', 'warning');
        }
        break;
      case 'aim':
        if (mode === 'playing') invoke('aim', !state.scoped);
        break;
      case 'fire': case 'reload':
        if (mode === 'playing') invoke(button.dataset.action);
        break;
      case 'steady':
        // Pointer users hold; keyboard and assistive-technology users can toggle.
        if (mode === 'playing' && event.detail === 0) {
          if (steadyPointer === null) {
            steadyPointer = 'keyboard';
            button.setAttribute('aria-pressed', 'true');
            invoke('steady', true);
          } else releaseSteady();
        }
        break;
    }
  }, { signal });

  root.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.action === 'steady' && mode === 'playing' && event.button === 0) {
      steadyPointer = event.pointerId;
      button.setPointerCapture(event.pointerId);
      button.setAttribute('aria-pressed', 'true');
      invoke('steady', true);
    }
  }, { signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, (event) => {
      if (event.target.closest('button, .ui-dialog-shell')) event.stopPropagation();
      if (event.pointerId === steadyPointer) releaseSteady();
    }, { signal });
  }
  // Keep legacy engine mouse/touch listeners from treating interface actions as shots.
  for (const type of ['mousedown', 'mouseup', 'touchstart', 'touchend', 'touchcancel', 'contextmenu']) {
    root.addEventListener(type, (event) => {
      if (event.target.closest('button, .ui-dialog-shell')) event.stopPropagation();
      if (type === 'contextmenu' && event.target.closest('button')) event.preventDefault();
    }, { signal });
  }
  find('dialog').addEventListener('pointerdown', (event) => event.stopPropagation(), { signal });
  find('dialog').addEventListener('click', (event) => {
    if (event.target === find('dialog') && dialog === 'brief') dismissDialog();
  }, { signal });
  document.addEventListener('keydown', (event) => {
    if (!dialog) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissDialog();
    } else if (event.key === 'Tab') {
      const focusable = [...find('dialog').querySelectorAll('button:not([disabled]), [href], [tabindex="0"]')].filter((el) => !el.closest('[hidden]'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !find('dialog').contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !find('dialog').contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  }, { capture: true, signal });
  window.addEventListener('blur', releaseSteady, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseSteady(); }, { signal });
  document.addEventListener('fullscreenchange', () => {
    const button = root.querySelector('[data-action="fullscreen"]');
    const active = Boolean(document.fullscreenElement);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    button.title = active ? 'Exit fullscreen' : 'Enter fullscreen';
  }, { signal });

  update();
  return {
    root,
    setMode,
    update,
    toast,
    hit,
    showDebrief,
    showBrief() { if (!destroyed) openDialog('brief'); },
    destroy() {
      if (destroyed) return;
      releaseSteady();
      destroyed = true;
      controller.abort();
      clearTimeout(hitTimer);
      timers.forEach(clearTimeout);
      timers.clear();
      root.remove();
    },
  };
}
