import { createIcons, icons } from 'lucide';
import { Vector3 } from 'three';
import { CityScene } from './scene';
import { clone, createCity, extractBlocks, getAlignment, heightAt, History, quantities, type Building, type City, type Parcel, type Point, type Road } from './core/model';
import { Traffic, type Vehicle } from './core/traffic';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
const drawIcons = () => createIcons({ icons, attrs: { 'aria-hidden': 'true' } });
type Tool = 'select' | 'terrain' | 'road' | 'river' | 'zone' | 'building' | 'move' | 'split';
type Selection = { kind: 'building' | 'road' | 'terrain' | 'vehicle' | 'parcel'; id: string };
let city = createCity('riverfront', 42);
let startupNotice = '';
try {
  const saved = localStorage.getItem('forma.city.v1');
  if (saved) {
    const value = JSON.parse(saved);
    if (value.roads?.length <= 600 && value.buildings?.length <= 3000) city = new History(value).current;
  }
} catch { startupNotice = 'The local recovery file was invalid. Your file was not overwritten; Riverfront is open instead.'; }
let history = new History(city);
let traffic = new Traffic(city, Math.round(city.settings.traffic * 200));
let tool: Tool = 'select', panelTab = 'overview', mode: 'orbit' | 'street' | 'follow' = 'orbit';
let selection: Selection | null = null, paused = false, speed = 1, busy = false, generationTime = 0, rebuildTime = 0;
let draft: Point[] = [], pointerDown: Point | null = null, stroke: Point[] = [], movingNode: string | null = null;
let brushMode: 'raise' | 'lower' | 'smooth' | 'flatten' = 'raise';
let brushRadius = 65, brushStrength = 1.5, roadProfile: 'local' | 'boulevard' = 'boulevard', roadWidth = 18, roadLevel = 0, roadClearance = 5, roadGrade = 12;
let riverWidth = 80, riverLevel = -1, selectedZone: Parcel['zone'] = 'residential';
let toastTimer = 0, selectedVehicle: string | null = null, guide = !sessionStorage.getItem('forma.guide.dismissed');
const overlays = { parcels: false, lanes: false, signals: false, queues: false };
let worker: Worker | null = null;

$('#app').innerHTML = `
  <header class="topbar">
    <button class="brand" data-action="home" aria-label="Forma city studio home"><svg viewBox="0 0 30 34" fill="none"><path d="M3 29V15l8-5v19m4 0V4l12 8v17M3 22l8-5m4 3 12 8" stroke="currentColor" stroke-linejoin="round"/></svg><span class="brand-name">forma</span><span class="brand-tag">PROCEDURAL<br>CITY STUDIO</span></button>
    <nav class="main-tabs" aria-label="Workspace"><button class="main-tab active" data-workspace="design">${icon('pen-tool')}Design</button><button class="main-tab" data-workspace="explore">${icon('compass')}Explore</button><button class="main-tab" data-workspace="capture">${icon('camera')}Capture</button></nav>
    <div class="project-name"><span id="project-name">${esc(city.name)}</span>${icon('chevron-down')}<span class="saved" id="saved-label">${icon('cloud-check')}Local project</span></div>
    <div class="header-actions"><div class="history-buttons"><button class="icon-button" id="undo" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icon('undo-2')}</button><button class="icon-button" id="redo" data-action="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${icon('redo-2')}</button></div><span class="header-divider"></span><button class="secondary" data-action="new">${icon('plus')}New city</button><button class="primary" data-action="export">${icon('upload')}Export${icon('chevron-down')}</button><button class="icon-button mobile-panel" data-action="panel" aria-label="Toggle inspector">${icon('panel-right')}</button></div>
  </header>
  <main class="workspace">
    <nav class="toolrail" aria-label="City editing tools">
      ${[['select','mouse-pointer-2','Select','V'],['terrain','mountain','Terrain','T'],['river','waves','Water','W'],['road','route','Roads','R'],['zone','blocks','Districts','B'],['building','building-2','Buildings','I']].map(([t,i,n,k]) => `<button class="tool ${t==='select'?'active':''}" data-tool="${t}" title="${n} (${k})" aria-label="${n} tool">${icon(i)}<span>${n}</span></button>`).join('')}
      <div class="tool-separator"></div><button class="tool" data-action="views" title="Saved camera views" aria-label="Saved views">${icon('bookmark')}<span>Views</span></button>
      <div class="rail-bottom"><button class="tool" data-action="layers" title="Editing overlays" aria-label="Layers">${icon('layers')}<span>Layers</span></button><button class="icon-button" data-action="help" title="Quick start & controls" aria-label="Help">${icon('circle-help')}</button></div>
    </nav>
    <section class="viewport" aria-label="City canvas">
      <div id="canvas" class="canvas-wrap"></div>
      <div class="scene-heading"><div class="eyebrow">YOUR WORLD, IN THE MAKING</div><h1 id="scene-title">${esc(city.name)}.</h1><p class="small">A little planning. Endless possibility.</p><div class="scene-badge"><span class="dot"></span><span id="scene-meta">960 x 960 m &nbsp; / &nbsp; SEED ${String(city.seed).padStart(4,'0')}</span></div></div>
      <div class="view-top"><button class="perspective-button" data-action="home">${icon('box')}Perspective${icon('chevron-down')}</button><button class="icon-button" data-action="present" aria-label="Presentation mode" title="Presentation (P)">${icon('maximize')}</button></div>
      <div class="compass">N<svg viewBox="0 0 36 36" fill="none"><circle cx="18" cy="18" r="16" stroke="currentColor" opacity=".3"/><path d="m18 5 5 18-5-4-5 4Z" stroke="currentColor" fill="#7c8d6720"/><path d="M18 20v10M3 18h4m22 0h4" stroke="currentColor" opacity=".4"/></svg></div>
      <div id="guide" class="guide-card ${guide?'':'hidden'}"><button class="icon-button close" data-action="dismiss-guide" aria-label="Dismiss tip">${icon('x')}</button><div class="eyebrow">A SMALL START, A WHOLE NEW CITY</div><h3>Make your next connection.</h3><p>Draw a boulevard across the river.<br>We'll take care of the bridge.</p><button class="text-link" data-action="bridge-guide">Let's build a bridge ${icon('arrow-up-right')}</button><div class="guide-progress"><i></i><i></i><i></i></div></div>
      <div id="draft-bar" class="draft-bar hidden"><span id="draft-count">0 points</span><button class="secondary" data-action="cancel-draft">${icon('x')}Cancel</button><button class="primary" data-action="finish-road">Finish <kbd>Enter</kbd></button></div>
      <div id="scene-message" class="scene-message hidden"></div>
      <div class="scene-foot"><div class="scale" id="scale-label">100 m</div><div class="navigation" aria-label="Camera mode"><button data-mode="orbit" class="active">${icon('orbit')}Orbit</button><button data-mode="street">${icon('footprints')}Street</button><button data-mode="follow">${icon('car-front')}Follow</button><span class="header-divider"></span><button class="icon-button" data-action="home" title="Frame whole city" aria-label="Frame city">${icon('scan')}</button></div><div class="zoom-controls"><button class="icon-button" data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button class="icon-button" data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button></div></div>
      <div id="busy" class="busy hidden"><div class="busy-card"><span class="spinner"></span><h3>Resolving your city</h3><p class="small">Checking connections, parcels, and setbacks.</p><button class="secondary" data-action="cancel-build">Cancel rebuild</button></div></div>
    </section>
    <aside class="inspector" id="inspector" aria-label="City inspector"></aside>
  </main>
  <section class="transport" aria-label="Simulation controls"><div class="playback"><button class="icon-button" data-action="reset-traffic" title="Reset seeded traffic" aria-label="Reset traffic">${icon('rotate-ccw')}</button><button class="play-button" id="play-button" data-action="play" title="Pause / play (Space)" aria-label="Pause traffic">${icon('pause')}</button><button class="icon-button" data-action="step" title="One fixed simulation step (1/60 s)" aria-label="Single step">${icon('step-forward')}</button><button class="speed-button" data-action="speed" id="speed-button">1x</button></div><div class="time-readout"><div id="sim-time">00:00:00</div><small>SIMULATION TIME</small></div><div class="traffic-live"><span class="dot"></span><span id="vehicle-count">${traffic.vehicles.length} vehicles moving</span></div><div class="daylight-control"><span class="daylight-label" id="daylight-label">${icon('sun')}Daylight</span><div class="sun-slider"><input id="day-slider" type="range" min="0" max="24" step="0.25" value="${city.settings.day}" aria-label="Time of day"><div class="sun-ticks"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></div><span class="day-time" id="day-time">14:00</span></div><div class="transport-end"><button class="icon-button" data-action="night" title="Toggle day/night" aria-label="Toggle night">${icon('moon')}</button><button class="icon-button" data-action="screenshot" title="Export current view" aria-label="Take snapshot">${icon('camera')}</button></div></section>
  <footer class="statusbar"><span class="row">${icon('mouse')}<span id="controls-hint">Drag to orbit &nbsp; / &nbsp; Scroll to zoom &nbsp; / &nbsp; Right-drag to pan</span></span><span class="coordinates" id="coordinates">X 0 &nbsp; Z 0</span><div class="status-right"><span class="render-stats" id="render-stats"></span><span class="row"><span class="dot"></span><span id="model-status">All systems in harmony</span></span><span class="version-label">FORMA 1.0</span></div></footer>
  <div id="toast" class="toast" role="status" aria-live="polite"></div><div id="modal-root"></div><button class="secondary exit-presentation" data-action="present">${icon('minimize')}Exit presentation <kbd>Esc</kbd></button><input type="file" id="import-file" accept=".json,application/json" hidden>
`;

let scene: CityScene;
try {
  scene = new CityScene($('#canvas'), { pick: onPick, ground: onGround });
  const t = performance.now(); scene.rebuild(city); rebuildTime = performance.now() - t;
  scene.setTraffic(traffic.vehicles); scene.home();
} catch (error) {
  $('#canvas').innerHTML = `<div class="no-webgl"><h1>Your city needs WebGL 2.</h1><p>Enable hardware acceleration or open this studio in a current Chrome, Firefox, or Safari browser. All of your editable city data remains local.</p><p class="small">${esc(error)}</p></div>`;
  throw error;
}

function notify(message: string, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('show'), error ? 8500 : 4800);
}

function persist() {
  try { localStorage.setItem('forma.city.v1', JSON.stringify(city)); $('#saved-label').innerHTML = `${icon('cloud-check')}Saved locally`; }
  catch { $('#saved-label').textContent = 'Export to save'; notify('Local storage is unavailable or full. Export an editable JSON to keep your work.', true); }
}

function syncDocument(structural = true) {
  const previousCity = city;
  city = history.current;
  if (structural || previousCity.seed !== city.seed || previousCity.settings.traffic !== city.settings.traffic) {
    const removed = traffic.vehicles.length;
    traffic.updateCity(city); traffic.reset(Math.round(city.settings.traffic * 200)); traffic.removed = removed;
    selectedVehicle = null; scene.follow(null); scene.setRoute([]);
    if (mode === 'follow') setMode('orbit');
  }
  const t = performance.now(); scene.rebuild(city); rebuildTime = performance.now() - t;
  scene.setTraffic(traffic.vehicles);
  for (const [name, enabled] of Object.entries(overlays)) scene.setOverlay(name as keyof typeof overlays, enabled);
  updateSignals();
  if (selection && ![...city.buildings, ...city.roads, ...city.parcels].some(e => e.id === selection!.id)) selection = null;
  if (selection) scene.select(selection.kind, selection.id);
  $('#project-name').textContent = city.name; $('#scene-title').textContent = `${city.name}.`;
  $('#scene-meta').textContent = `${city.terrain.size} x ${city.terrain.size} m / SEED ${String(city.seed).padStart(4, '0')}`;
  $('#day-slider').setAttribute('value', String(city.settings.day)); $<HTMLInputElement>('#day-slider').value = String(city.settings.day);
  updateTimeUI(city.settings.day); persist(); renderPanel(); updateHistory();
}

function updateHistory() { $<HTMLButtonElement>('#undo').disabled = !history.undoStack.length; $<HTMLButtonElement>('#redo').disabled = !history.redoStack.length; }

function updateSignals() {
  if (!overlays.signals) return;
  const degree = new Map<string, number>();
  city.roads.forEach(r => { degree.set(r.a, (degree.get(r.a) ?? 0) + 1); degree.set(r.b, (degree.get(r.b) ?? 0) + 1); });
  scene.setSignals(traffic.graph.lanes.filter(l => (degree.get(l.to) ?? 0) >= 3).map(l => {
    const p = l.points.at(-1)!;
    return { x: p.x, y: p.y + 0.6, z: p.z, state: traffic.signal(l.to, l.id) };
  }));
}

function presentation(enabled: boolean) {
  document.body.classList.toggle('presentation', enabled);
  scene.setPresentation(enabled);
}

async function transact(action: string, args: Record<string, unknown> = {}, message = 'City updated.', input: City = city, structural = true): Promise<boolean> {
  if (busy) { notify('A rebuild is already running. Cancel it before starting another edit.'); return false; }
  busy = true; $('#busy').classList.remove('hidden');
  const active = new Worker(new URL('./city.worker.ts', import.meta.url), { type: 'module' }); worker = active;
  return new Promise(resolve => {
    const finish = (success: boolean) => { active.terminate(); if (worker === active) worker = null; busy = false; $('#busy').classList.add('hidden'); resolve(success); };
    active.onmessage = event => {
      if (worker !== active) return;
      if (event.data.error) { notify(event.data.error, true); finish(false); return; }
      try {
        generationTime = event.data.milliseconds;
        history.commit(event.data.city);
        if (history.undoStack.length > 40) history.undoStack.shift();
        syncDocument(structural); finish(true);
        notify(message + (structural && city.roads.length ? ' Traffic reset to the city seed.' : ''));
      } catch (error) { notify(String(error), true); finish(false); }
    };
    active.onerror = event => { notify(`Rebuild failed: ${event.message}. Your previous city is intact.`, true); finish(false); };
    active.postMessage({ action, city: input, args });
    active.addEventListener('messageerror', () => { notify('The rebuild could not be read. Your previous city is intact.', true); finish(false); });
    (active as Worker & { cancel?: () => void }).cancel = () => { finish(false); notify('Rebuild cancelled. The previous city is unchanged.'); };
  });
}

function panelHeader(title: string, tab: string = panelTab) {
  return `<div class="inspector-header"><div class="inspector-title"><h2>${title}</h2><button class="icon-button" data-action="panel-overview" title="City overview" aria-label="Back to city overview">${icon('sliders-horizontal')}</button></div><div class="panel-tabs"><button class="panel-tab ${tab==='overview'?'active':''}" data-panel="overview">Overview</button><button class="panel-tab ${tab==='properties'?'active':''}" data-panel="properties">Properties</button><button class="panel-tab ${tab==='library'?'active':''}" data-panel="library">Examples</button></div></div>`;
}

function miniCity() {
  return `<div class="city-preview"><svg viewBox="0 0 250 120" fill="none"><path d="M17 77 112 22l119 39-99 53Z" fill="#d2ddbd"/><path d="m48 59 120 39 21-12L70 47Z" fill="#a0bdb0"/><path d="m79 42 8-5 115 38-8 5Z" fill="#d9dfc9"/><path d="m142 35 9 3-98 56-9-3Z" fill="#b0b99c"/><path d="m152 42 10 3-48 28-10-3Z" fill="#a6b493"/>${Array.from({length:31},(_,i)=>{const x=58+(i%8)*17+(Math.floor(i/8)%2)*6,y=45+Math.floor(i/8)*12+(i%8)*-1.4,h=8+((i*7)%21);return `<path d="m${x} ${y} 8-4 7 3-8 5Z" fill="${['#d7c9ad','#b3c4a0','#d1b8a1'][i%3]}"/><path d="m${x} ${y} 7 4v${h}l-7-4Z" fill="#bcc5a7"/><path d="m${x+7} ${y+4} 8-5v${h}l-8 5Z" fill="${['#c9c9b2','#9fb49e','#c8b29c'][i%3]}"/>`}).join('')}<path d="m78 69 68 23 8-5-69-23Z" fill="#e8e7d7"/><path d="m120 67 10 3-25 14-10-3Z" fill="#c5cbb5"/></svg><span class="preview-label">A WORLD OF YOUR OWN</span><span class="preview-tag">EDITABLE EXAMPLE</span></div>`;
}

function layerList() {
  return `<div class="layer-list">${[['parcels','scan','Parcel boundaries'],['lanes','route','Lane directions'],['signals','traffic-cone','Traffic signals'],['queues','car-front','Vehicle queues']].map(([key,i,name])=>`<label class="layer-row">${icon(i)}<span>${name}</span><input class="switch" type="checkbox" data-overlay="${key}" aria-label="${name}" ${overlays[key as keyof typeof overlays]?'checked':''}></label>`).join('')}</div>`;
}

function overviewPanel() {
  const q = quantities(city);
  return `${miniCity()}<div class="row between"><h3 class="city-title">${esc(city.name)}</h3><span class="pill"><span class="dot"></span>LIVE CITY</span></div><p class="city-description">${city.water.length?'Two banks. One connected community.':city.buildings.length?'A neighborhood shaped by your imagination.':'An open landscape. A fresh perspective.'}<br>Shape what comes next.</p><div class="stat-grid"><div><div class="stat-value">${fmt(q.buildings)}</div><div class="stat-label">${icon('building-2')}Buildings</div></div><div><div class="stat-value">${fmt(q.roadLength/1000,1)}<small>km</small></div><div class="stat-label">${icon('route')}Road network</div></div><div><div class="stat-value">${fmt(q.area/1e6,2)}<small>km²</small></div><div class="stat-label">${icon('scan')}City area</div></div><div><div class="stat-value">${fmt(q.parcels)}</div><div class="stat-label">${icon('blocks')}Buildable parcels</div></div></div><hr><div class="section-title">City character<span class="density-value" id="density-readout">${Math.round(city.settings.density*100)}% occupied</span></div><input type="range" id="density" aria-label="Development density" min="0" max="100" value="${city.settings.density*100}"><div class="density-legend"><span>ROOM TO BREATHE</span><span>URBAN ENERGY</span></div><div class="seed-field"><label for="seed">City seed</label><input type="number" id="seed" min="0" max="4294967295" value="${city.seed}" aria-label="City seed"><button data-action="random-seed" title="Choose a new seed" aria-label="Randomize seed">${icon('shuffle')}</button></div><button class="primary full generate-button" data-action="regenerate">${icon('sprout')}Regenerate city</button><hr><div class="section-title">Scene layers${icon('layers')}</div>${layerList()}<div class="panel-note">${icon('mouse-pointer-2')}<span>Select a building or road to make it your own.</span></div>`;
}

function roadPanel() {
  return `<div class="tool-title">${icon('route')}<h3>Make connections.</h3></div><p class="small">Click to place points. Press Enter to build.<br>Intersections and bridges resolve together.</p><div class="profile-grid"><button class="profile-card ${roadProfile==='local'?'active':''}" data-profile="local">${icon('git-commit-vertical')}Local street<small>Quiet, two-way streets</small></button><button class="profile-card ${roadProfile==='boulevard'?'active':''}" data-profile="boulevard">${icon('align-vertical-space-around')}Boulevard<small>A generous connection</small></button></div><div class="fields"><label>Width (m)<input type="number" id="road-width" min="4" max="40" step="1" value="${roadWidth}"></label><label>Maximum grade (%)<input type="number" id="road-grade" min="1" max="12" step="1" value="${roadGrade}"></label></div><div class="fields spaced"><label>Road level<select id="road-level"><option value="0" ${roadLevel===0?'selected':''}>Ground</option><option value="1" ${roadLevel===1?'selected':''}>Elevated +12 m</option></select></label><label>Deck clearance (m)<input type="number" id="road-clearance" min="5" max="30" value="${roadClearance}"></label></div><div class="panel-note">${icon('link')}<span>8 m endpoint snapping creates shared nodes. Different levels never connect automatically.</span></div><div class="hint-list"><div><span>1</span>Click a road or open ground to begin</div><div><span>2</span>Add corners, or cross the river</div><div><span>3</span>Press Enter to finish your road</div></div><details id="precise-road"><summary>Precise coordinates</summary><div class="fields"><label>X (m)<input id="point-x" type="number" value="0" min="-480" max="480"></label><label>Z (m)<input id="point-z" type="number" value="-90" min="-480" max="480"></label></div><button class="secondary full spaced" data-action="add-point">${icon('plus')}Add point</button><div id="coordinate-list" class="coordinate-list">${draft.length?draft.map(p=>`${fmt(p.x,1)}, ${fmt(p.z,1)}`).join(' &rarr; '):'No points yet'}</div><button class="primary full spaced" data-action="finish-road">Build road</button></details><p class="small spaced">Supported: straight polylines, T / four-way junctions, angles ≥25°. Road ends need enough land for a continuous bridge approach.</p>`;
}

function terrainPanel() {
  return `<div class="tool-title">${icon('mountain')}<h3>Shape the ground.</h3></div><p class="small">Paint a landscape with a gentle hand. Each completed stroke is one undoable edit.</p><div class="profile-grid">${[['raise','mountain','Raise'],['lower','arrow-down-to-line','Lower'],['smooth','waves','Smooth'],['flatten','minus','Flatten']].map(([key,i,n])=>`<button class="profile-card ${brushMode===key?'active':''}" data-brush="${key}">${icon(i)}${n}</button>`).join('')}</div><label>Brush radius <span class="mono" id="radius-readout">${brushRadius} m</span><input type="range" id="brush-radius" min="20" max="160" value="${brushRadius}"></label><label class="spaced">Strength (m per sample)<input id="brush-strength" type="number" min="0.1" max="4" step="0.1" value="${brushStrength}"></label><div class="panel-note">${icon('shield-check')}<span>Road grades are checked before a stroke commits. If a road exceeds 12%, the entire stroke is rejected.</span></div><div class="metric-table"><div><span>Heightfield</span><strong>${city.terrain.resolution} x ${city.terrain.resolution} samples</strong></div><div><span>Minimum elevation</span><strong>${fmt(Math.min(...city.terrain.heights),1)} m</strong></div><div><span>Maximum elevation</span><strong>${fmt(Math.max(...city.terrain.heights),1)} m</strong></div><div><span>Brush stroke cap</span><strong>24 samples</strong></div></div><p class="small spaced">Flatten uses the elevation at the start of the stroke. Smooth blends neighboring height samples.</p>`;
}

function riverPanel() {
  return `<div class="tool-title">${icon('waves')}<h3>Find your flow.</h3></div><p class="small">Draw a river centerline, then press Enter. The visible river and bridge classification share the same water region.</p><div class="fields spaced"><label>River width (m)<input id="river-width" type="number" min="4" max="480" value="${riverWidth}"></label><label>Water elevation (m)<input id="river-level" type="number" min="-50" max="50" value="${riverLevel}"></label></div><div class="panel-note">${icon('info')}<span>A new river replaces the old water region and carves a bed. Existing terrain edits are not restored. Infeasible roads reject the transaction.</span></div><details><summary>Precise centerline</summary><div class="fields"><label>X (m)<input id="point-x" type="number" value="-480"></label><label>Z (m)<input id="point-z" type="number" value="0"></label></div><button class="secondary full spaced" data-action="add-point">${icon('plus')}Add point</button><div id="coordinate-list" class="coordinate-list">${draft.length?draft.map(p=>`${fmt(p.x,1)}, ${fmt(p.z,1)}`).join(' &rarr; '):'No points yet'}</div><button class="primary full spaced" data-action="finish-road">Carve river</button></details>${city.water.length?`<button class="secondary full spaced" data-action="water-apply">Apply water width & level</button>`:''}<p class="small spaced">Water is static. No hydrology or flood simulation is implied.</p>`;
}

function zoningPanel() {
  const counts = {residential:0,commercial:0,mixed:0,park:0}; city.parcels.forEach(p=>counts[p.zone]++);
  return `<div class="tool-title">${icon('blocks')}<h3>A sense of place.</h3></div><p class="small">Choose a use, then click a parcel or building. Closed road cycles define blocks; open roads never invent a neighborhood.</p><div class="zone-pills">${Object.keys(counts).map(z=>`<button data-zone="${z}" class="${selectedZone===z?'active':''}"><i></i>${{residential:'Residential',commercial:'Commercial',mixed:'Mixed-use',park:'Park'}[z]}</button>`).join('')}</div><div class="metric-table">${Object.entries(counts).map(([z,n])=>`<div><span>${z==='mixed'?'Mixed-use':z[0].toUpperCase()+z.slice(1)}</span><strong>${n} parcels</strong></div>`).join('')}<div><span>Closed blocks</span><strong>${extractBlocks(city).length}</strong></div></div><button class="primary full spaced" data-action="regenerate">${icon('sprout')}Generate neighborhoods</button><div class="panel-note">${icon('shield-check')}<span>Buildings retain a minimum 2 m parcel setback. Tiny or water-covered areas remain open.</span></div><p class="small spaced">User-edited buildings are protected. If rezoning or a road change removes their host, remove the override in the building inspector first.</p>`;
}

function buildingPanel(b: Building) {
  const p = city.parcels.find(p=>p.id===b.parcelId)!;
  const xs=p.polygon.map(v=>v.x), zs=p.polygon.map(v=>v.z);
  const setbacks=[b.x-b.width/2-Math.min(...xs),Math.max(...xs)-b.x-b.width/2,b.z-b.depth/2-Math.min(...zs),Math.max(...zs)-b.z-b.depth/2];
  return `<div class="row between"><div class="tool-title">${icon('building-2')}<h3>Your architecture.</h3></div></div><div class="row between"><span class="pill">${p.zone.toUpperCase()}</span><button class="secondary" data-action="focus">${icon('focus')}Focus</button></div><p class="entity-id">${esc(b.id)}</p><div class="fields"><label>Floors<input id="building-floors" type="number" min="1" max="80" value="${b.floors}"></label><label>Height (3.2 m / floor)<input disabled value="${fmt(b.floors*3.2,1)} m"></label></div><div class="fields spaced"><label>Footprint width (m)<input id="building-width" type="number" min="3" step="0.1" value="${b.width}"></label><label>Footprint depth (m)<input id="building-depth" type="number" min="3" step="0.1" value="${b.depth}"></label></div><label class="spaced">Roof form<select id="building-roof">${['flat','gable','terrace'].map(r=>`<option value="${r}" ${b.roof===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></label><label class="spaced">Facade palette</label><div class="palette">${['#dedbcb','#d6aa91','#c6b396','#b58471','#e7e1d1','#adb59d','#c4bcaa','#d8bfaa'].map((color,i)=>`<button class="swatch ${b.palette%8===i?'active':''}" data-palette="${i}" style="background:${color}" aria-label="Facade palette ${i+1}" title="${['Chalk','Blush','Sandstone','Terracotta','Ivory','Sage','Limestone','Clay'][i]}"></button>`).join('')}</div><button class="primary full spaced" data-action="apply-building">Apply building changes</button><div class="metric-table"><div><span>Actual smallest setback</span><strong>${fmt(Math.min(...setbacks),2)} m</strong></div><div><span>Footprint area</span><strong>${fmt(b.width*b.depth,1)} m²</strong></div><div><span>Estimated floor area</span><strong>${fmt(b.width*b.depth*b.floors)} m²</strong></div><div><span>Override</span><strong>${b.edited?'Protected user edit':'Procedural'}</strong></div></div><p class="small spaced">Floor area = footprint × floors; not usable or leasable area. Footprint edits must remain inside the host parcel with 2 m setbacks.</p>${b.edited?'<button class="secondary full spaced" data-action="release-building">Remove override protection</button>':''}`;
}

function selectedRoadPanel(r: Road) {
  const a=city.nodes.find(n=>n.id===r.a)!, b=city.nodes.find(n=>n.id===r.b)!, alignment=getAlignment(city,r);
  return `<div class="tool-title">${icon(alignment.bridge?'cable':'route')}<h3>${alignment.bridge?'Across the water.':'A connected street.'}</h3></div><div class="row between"><span class="pill">${alignment.bridge?'BRIDGE':r.level?'ELEVATED':r.profile.toUpperCase()}</span><button class="secondary" data-action="focus">${icon('focus')}Focus</button></div><p class="entity-id">${esc(r.id)} &nbsp; / &nbsp; ${r.a} → ${r.b}</p><div class="metric-table"><div><span>Length</span><strong>${fmt(Math.hypot(b.x-a.x,b.z-a.z),1)} m</strong></div><div><span>Maximum actual grade</span><strong>${fmt(alignment.maxGrade*100,2)}%</strong></div><div><span>Road width</span><strong>${r.width} m</strong></div><div><span>Deck clearance above water</span><strong>${r.clearance} m</strong></div><div><span>Elevation range</span><strong>${fmt(Math.min(...alignment.points.map(p=>p.y)),1)} to ${fmt(Math.max(...alignment.points.map(p=>p.y)),1)} m</strong></div><div><span>Directed lanes</span><strong>${traffic.graph.lanes.filter(l=>l.roadId===r.id).length}</strong></div></div><div class="subheading">Move a shared endpoint</div><label>Endpoint<select id="move-endpoint"><option value="${a.id}">A / ${a.id}</option><option value="${b.id}">B / ${b.id}</option></select></label><div class="fields spaced"><label>X (m)<input type="number" id="node-x" value="${a.x}"></label><label>Z (m)<input type="number" id="node-z" value="${a.z}"></label></div><button class="primary full spaced" data-action="move-node">Move endpoint</button><div class="fields spaced"><button class="secondary" data-action="drag-node">${icon('move')}Drag node</button><button class="secondary" data-action="split-road">${icon('scissors')}Split midpoint</button></div><div class="fields spaced"><button class="secondary" data-action="extend-road">${icon('plus')}Extend</button><button class="secondary danger" data-action="delete-road">${icon('trash-2')}Delete</button></div><button class="secondary full spaced" data-action="spawn-road-route">${icon('car-front')}Drive this road</button><div class="panel-note">${icon('info')}<span>Structural changes reset all vehicles and routes to the city seed. No car remains on deleted geometry.</span></div>`;
}

function explorePanel() {
  const v=traffic.vehicles.find(v=>v.id===selectedVehicle);
  return `<div class="tool-title">${icon('compass')}<h3>Life between places.</h3></div><p class="small">Real routes. Shared streets. Select a vehicle to see where it's going.</p><div class="traffic-state"><span class="dot"></span> ${traffic.vehicles.length} active vehicles · 60 Hz simulation</div><label>Active vehicle target<input id="traffic-count" type="number" min="0" max="200" value="${Math.round(city.settings.traffic*200)}"></label><button class="secondary full spaced" data-action="apply-traffic">Reset seeded traffic</button>${v?`<div class="subheading">Following ${esc(v.id)}</div><div class="metric-table"><div><span>Speed</span><strong id="selected-speed">${fmt(v.speed*3.6,1)} km/h</strong></div><div><span>Route</span><strong>${v.route.length} directed links</strong></div><div><span>Next signal</span><strong id="selected-signal">${traffic.signal(traffic.graph.lanes.find(l=>l.id===v.laneId)!.to,v.laneId)}</strong></div></div><button class="primary full spaced" data-action="follow-selected">${icon('car-front')}Follow vehicle</button>`:''}<div class="subheading">On the move</div><div class="vehicle-list">${traffic.vehicles.slice(0,30).map(v=>`<button data-vehicle="${v.id}" class="${selectedVehicle===v.id?'active':''}"><span class="row"><i style="background:#${v.color.toString(16).padStart(6,'0')}"></i>${v.id}</span><span>${fmt(v.speed*3.6)} km/h ${icon('chevron-right')}</span></button>`).join('')||'<p class="small">No reachable lanes. Draw a road, then reset traffic.</p>'}</div><div class="subheading">Traffic overlays</div>${layerList()}<div class="panel-note">${icon('traffic-cone')}<span>NS green 12 s, all-red 2 s, EW green 12 s, all-red 2 s. Cars stop and reserve the junction before entering, even on green.</span></div><p class="small spaced">6 m center spacing (4 m car + 2 m gap). Top speed 11 m/s. Unreachable or unsafe spawns excluded: ${traffic.excluded}.</p><details><summary>Plan a route between nodes</summary><label>From node<select id="route-from">${city.nodes.map(n=>`<option value="${n.id}">${n.id} (${fmt(n.x)}, ${fmt(n.z)})</option>`).join('')}</select></label><label class="spaced">To node<select id="route-to">${city.nodes.map((n,i)=>`<option value="${n.id}" ${i===city.nodes.length-1?'selected':''}>${n.id} (${fmt(n.x)}, ${fmt(n.z)})</option>`).join('')}</select></label><button class="primary full spaced" data-action="spawn-route">Plan & follow route</button></details>`;
}

function libraryPanel() {
  return `<div class="eyebrow">THREE DIFFERENT BEGINNINGS</div><h3 class="city-title spaced">Where will you start?</h3><p class="small spaced">Each example is a fully editable city, generated locally from your seed.</p>${[['riverfront','Riverfront','A downtown with room to flow.'],['hillside','Hillside','Streets that follow the landscape.'],['garden','Garden City','A gentler mix of city and nature.']].map(([id,n,d])=>`<button class="sample-card" data-example="${id}"><div class="sample-thumb ${id}"></div><div><strong>${n}</strong><p>${d}</p></div></button>`).join('')}<button class="secondary full spaced" data-example="empty">${icon('plus')}Start with an empty landscape</button><div class="panel-note">${icon('undo-2')}<span>Loading an example is undoable. Your previous city stays in this session's history.</span></div><button class="secondary full spaced" data-action="import">${icon('folder-open')}Open editable city JSON</button>`;
}

function viewsPanel() {
  return `<div class="tool-title">${icon('bookmark')}<h3>A different perspective.</h3></div><p class="small">Keep the viewpoints that tell your city's story. Views travel with the editable JSON.</p><label class="spaced">View name<input id="view-name" type="text" maxlength="80" value="View ${city.views.length+1}"></label><button class="primary full spaced" data-action="save-view">${icon('bookmark-plus')}Save current camera</button><div class="spaced">${city.views.map((v,i)=>`<button class="list-button" data-view="${i}"><span>${esc(v.name)}</span>${icon('arrow-up-right')}</button>`).join('')||'<p class="small">No saved views yet. Orbit to a favorite spot and save it above.</p>'}</div><button class="secondary full spaced" data-action="home">${icon('scan')}Return to skyline</button>`;
}

function propertiesPanel() {
  const q=quantities(city);
  return `<div class="tool-title">${icon('ruler')}<h3>The real dimensions.</h3></div><label class="spaced">City name<input id="city-name" type="text" maxlength="120" value="${esc(city.name)}"></label><button class="secondary full spaced" data-action="rename">Rename city</button><div class="metric-table"><div><span>Terrain area</span><strong>${fmt(q.area)} m²</strong></div><div><span>Road centerline length</span><strong>${fmt(q.roadLength,1)} m</strong></div><div><span>Road segments / nodes</span><strong>${city.roads.length} / ${city.nodes.length}</strong></div><div><span>Closed ground blocks</span><strong>${extractBlocks(city).length}</strong></div><div><span>Parcels / buildings</span><strong>${q.parcels} / ${q.buildings}</strong></div><div><span>Estimated floor area</span><strong>${fmt(q.floorArea)} m²</strong></div><div><span>Directed lanes / connectors</span><strong>${traffic.graph.lanes.length} / ${traffic.graph.connectors.length}</strong></div><div><span>Generation / mesh rebuild</span><strong>${fmt(generationTime)} / ${fmt(rebuildTime)} ms</strong></div><div><span>Document format</span><strong>Forma JSON v1 · metres</strong></div></div><div class="panel-note">${icon('info')}<span>Floor area is the sum of each rectangular footprint × floor count. This is a geometric estimate, not a population or economic model.</span></div><p class="small spaced">The studio supports 600 road segments, 3,000 buildings, 200 vehicles, and 40 undo transactions. Cancel rebuilding before commit to keep the last valid city.</p>`;
}

function capturePanel() {
  return `<div class="tool-title">${icon('camera')}<h3>Worth a closer look.</h3></div><p class="small">Capture the city you've made, not just the idea of it.</p><div class="export-options"><button class="export-option" data-action="screenshot">${icon('image')}<span><strong>Current-scene image</strong><p>Clean PNG, without editing overlays</p></span></button><button class="export-option" data-action="glb">${icon('box')}<span><strong>3D city geometry</strong><p>GLB · metres · instanced meshes</p></span></button><button class="export-option" data-action="json">${icon('file-json')}<span><strong>Editable city document</strong><p>Versioned JSON · complete model</p></span></button></div><button class="primary full spaced" data-action="present">${icon('maximize')}Enter presentation mode</button><button class="secondary full spaced" data-action="views">${icon('bookmark')}Saved camera views</button><div class="panel-note">${icon('hard-drive-download')}<span>All exports are made on your device. No account, server, or external assets required.</span></div>`;
}

function renderPanel() {
  let body: string, title='City overview';
  if (panelTab==='library') {body=libraryPanel();title='Your starting points';}
  else if (panelTab==='explore') {body=explorePanel();title='Explore your city';}
  else if (panelTab==='views') {body=viewsPanel();title='Camera views';}
  else if (panelTab==='capture') {body=capturePanel();title='Capture & export';}
  else if (panelTab==='layers') {body=`<div class="tool-title">${icon('layers')}<h3>See the connections.</h3></div><p class="small" style="margin-bottom:24px">Readable layers for understanding your city.</p>${layerList()}<div class="panel-note">${icon('info')}<span>Lane colors show direction. Signal discs show actual approach phases. Queues mark waiting vehicles.</span></div>`;title='Scene layers';}
  else if (tool==='road') {body=roadPanel();title='Road builder';}
  else if (tool==='terrain') {body=terrainPanel();title='Terrain sculptor';}
  else if (tool==='river') {body=riverPanel();title='Water & river';}
  else if (tool==='zone') {body=zoningPanel();title='Neighborhoods';}
  else if (selection?.kind==='building' && city.buildings.some(b=>b.id===selection?.id)) {body=buildingPanel(city.buildings.find(b=>b.id===selection?.id)!);title='Building inspector';}
  else if (selection?.kind==='road' && city.roads.some(r=>r.id===selection?.id)) {
    const r=city.roads.find(r=>r.id===selection?.id)!;
    body=selectedRoadPanel(r)+`<details><summary>Edit road width & profile</summary><label>Profile<select id="selected-road-profile"><option value="local" ${r.profile==='local'?'selected':''}>Local street</option><option value="boulevard" ${r.profile==='boulevard'?'selected':''}>Boulevard</option></select></label><div class="fields spaced"><label>Width (m)<input id="selected-road-width" type="number" min="4" max="40" value="${r.width}"></label><label>Deck clearance (m)<input id="selected-road-clearance" type="number" min="5" max="30" value="${r.clearance}"></label></div><button class="primary full spaced" data-action="apply-road-profile">Apply road profile</button><p class="small spaced">Parcel setbacks and the 12% grade limit are rechecked. Protected buildings can prevent widening.</p></details>`;
    title='Road inspector';
  }
  else if (tool==='building') {body=`<div class="empty-panel">${icon('building-2')}<h3>Give a building character.</h3><p>Click any building to adjust its height,<br>footprint, facade, and roof.</p></div><div class="panel-note">${icon('shield-check')}<span>Your edits are protected when other neighborhoods change.</span></div>`;title='Building inspector';}
  else if (panelTab==='properties') body=propertiesPanel();
  else body=overviewPanel();
  $('#inspector').innerHTML = `${panelHeader(title)}<div class="panel-body">${body}</div>`;
  document.querySelectorAll<HTMLInputElement>('#road-width, #selected-road-width').forEach(input => input.min = '8');
  drawIcons();
}

function setTool(next: Tool) {
  cancelDraft(); tool=next; selection=null; scene.select('', ''); panelTab='overview';
  scene.setTool(next==='building'?'select':next); if(mode!=='orbit')setMode('orbit');
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(e=>e.classList.toggle('active',e.dataset.tool===next));
  if(next==='zone') {overlays.parcels=true;scene.setOverlay('parcels',true);}
  $('#guide').classList.add('hidden');
  $('#controls-hint').textContent = ({road:'Click to add points / Enter to build / Escape to cancel',river:'Click a centerline / Enter to carve / Escape to cancel',terrain:'Drag to sculpt / One stroke, one undo',zone:'Choose zoning / Click a parcel to apply',move:'Drag a shared node / Attached roads move together',split:'Click a road to split',building:'Click a building to inspect / Drag to orbit',select:'Drag to orbit / Scroll to zoom / Right-drag to pan'})[next];
  if(window.innerWidth<=800 && next!=='select') document.body.classList.add('panel-open');
  renderPanel();
}

function setMode(next: 'orbit'|'street'|'follow') {
  if(next==='follow') {
    const v=traffic.vehicles.find(v=>v.id===selectedVehicle)??traffic.vehicles[0];
    if(!v){notify('There are no active vehicles. Draw connected roads and reset traffic.');return;}
    selectVehicle(v.id, false); scene.follow(v.id);
  }
  mode=next;scene.setMode(next);
  if(next!=='orbit'){tool='select';scene.setTool('select');document.querySelectorAll('[data-tool]').forEach(e=>e.classList.remove('active'));}
  document.querySelectorAll<HTMLElement>('[data-mode]').forEach(e=>e.classList.toggle('active',e.dataset.mode===next));
  $('#scene-message').classList.toggle('hidden',next==='orbit');
  $('#scene-message').textContent=next==='street'?'WASD to walk · Drag to look · Shift to move faster · Esc to skyline':next==='follow'?`Following ${selectedVehicle} · Esc to skyline`:'';
}

function onPick(kind: 'building'|'road'|'terrain'|'vehicle', id:string, point:Point) {
  if(busy)return;
  if(kind==='vehicle'){selectVehicle(id);return;}
  if(tool==='zone'){zoneAt(point);return;}
  selection={kind,id};scene.select(kind,id);panelTab='overview';
  if(kind==='building'||kind==='road') {tool='select';scene.setTool('select');document.body.classList.add('panel-open');}
  renderPanel();
}

function snapped(p: Point): Point {
  let point={x:Math.round(p.x),z:Math.round(p.z)};
  if(tool==='road') {
    const n=city.nodes.filter(n=>n.level===roadLevel).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
    if(n&&Math.hypot(n.x-p.x,n.z-p.z)<=8)point={x:n.x,z:n.z};
    else for(const r of city.roads.filter(r=>r.level===roadLevel)) {
      const a=city.nodes.find(n=>n.id===r.a)!,b=city.nodes.find(n=>n.id===r.b)!;const dx=b.x-a.x,dz=b.z-a.z;const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
      const q={x:a.x+t*dx,z:a.z+t*dz};if(Math.hypot(q.x-p.x,q.z-p.z)<5){point=q;break;}
    }
  }
  return point;
}

function onGround(point: Point, phase: 'down'|'move'|'up', event: PointerEvent) {
  $('#coordinates').textContent=`X ${fmt(point.x)} / Z ${fmt(point.z)}`;
  if(busy)return;
  if(phase==='down') pointerDown=point;
  if(tool==='terrain') {
    scene.setBrush(point,brushRadius);
    if(phase==='down')stroke=[point];
    if(phase==='move'&&(event.buttons&1)&&stroke.length&&stroke.length<24&&Math.hypot(point.x-stroke.at(-1)!.x,point.z-stroke.at(-1)!.z)>brushRadius*.32)stroke.push(point);
    if(phase==='up'&&stroke.length){const points=stroke;stroke=[];void transact('sculpt',{points,radius:brushRadius,strength:brushMode==='smooth'||brushMode==='flatten'?Math.min(1,brushStrength):brushStrength,mode:brushMode,height:heightAt(city,points[0].x,points[0].z)},'Terrain stroke committed.');}
  } else if(tool==='road'||tool==='river') {
    const p=snapped(point); if(phase==='move')scene.preview([...draft,p],tool==='river'?riverWidth:roadWidth);
    if(phase==='up'&&pointerDown&&Math.hypot(point.x-pointerDown.x,point.z-pointerDown.z)<12)addPoint(p);
  } else if(tool==='zone'&&phase==='up')zoneAt(point);
  else if(tool==='move') {
    if(phase==='down'){const n=city.nodes.reduce<City['nodes'][number]|null>((a,b)=>!a||Math.hypot(b.x-point.x,b.z-point.z)<Math.hypot(a.x-point.x,a.z-point.z)?b:a,null);movingNode=n&&Math.hypot(n.x-point.x,n.z-point.z)<20?n.id:null;}
    if(phase==='move'&&movingNode){const n=city.nodes.find(n=>n.id===movingNode)!;scene.preview([n,snapped(point)],3);}
    if(phase==='up'&&movingNode){const id=movingNode;movingNode=null;scene.preview([],0);void transact('move',{id,point:snapped(point)},'Shared node moved.');}
  }
  if(phase==='up')pointerDown=null;
}

function addPoint(p: Point) {
  if(draft.length&&Math.hypot(p.x-draft.at(-1)!.x,p.z-draft.at(-1)!.z)<2)return;
  if(draft.length>=32){notify('One drawing supports up to 32 points. Finish this road, then extend it.',true);return;}
  draft.push(p);scene.preview(draft,tool==='river'?riverWidth:roadWidth);updateDraft();
}
function updateDraft(){ $('#draft-bar').classList.toggle('hidden',!draft.length);$('#draft-count').textContent=`${draft.length} points · ${fmt(draft.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-draft[i].x,p.z-draft[i].z),0))} m`;const list=document.querySelector('#coordinate-list');if(list)list.innerHTML=draft.map(p=>`${fmt(p.x,1)}, ${fmt(p.z,1)}`).join(' &rarr; ')||'No points yet'; }
function cancelDraft(){draft=[];stroke=[];movingNode=null;if(scene){scene.preview([],0);scene.setBrush(null,0);}$('#draft-bar').classList.add('hidden');}
async function finishRoad(){if(draft.length<2){notify('Add at least two distinct points before finishing.');return;}const ok=tool==='river'?await transact('river',{points:draft,width:riverWidth,level:riverLevel},'River carved.'):await transact('road',{points:draft,options:{profile:roadProfile,width:roadWidth,level:roadLevel,clearance:roadClearance,maxGrade:roadGrade/100}},'Road connected. Parcels updated.');if(ok)cancelDraft();else scene.preview(draft,roadWidth,false);}

function pointInside(point:Point,polygon:Point[]){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.z>point.z)!==(b.z>point.z)&&point.x<(b.x-a.x)*(point.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
function zoneAt(point:Point){const parcel=city.parcels.find(p=>pointInside(point,p.polygon));if(!parcel){notify('No buildable parcel here. Draw a closed road cycle first.');return;}const next=clone(city);next.parcels.find(p=>p.id===parcel.id)!.zone=selectedZone;void transact('rebuild',{},`Parcel zoned ${selectedZone}.`,next,false);}

function selectVehicle(id:string, open=true){const v=traffic.vehicles.find(v=>v.id===id);if(!v)return;selectedVehicle=id;selection={kind:'vehicle',id};scene.select('vehicle',id);showRoute(v);if(open){panelTab='explore';renderPanel();document.body.classList.add('panel-open');}if(mode==='follow')scene.follow(id);}
function showRoute(v:Vehicle){const points:Vector3[]=[];v.route.forEach((id,i)=>{const lane=traffic.graph.lanes.find(l=>l.id===id);if(!lane)return;if(i){const connector=traffic.graph.connectors.find(c=>c.from===v.route[i-1]&&c.to===id);if(connector)points.push(...connector.points.map(p=>new Vector3(p.x,p.y,p.z)));}points.push(...lane.points.map(p=>new Vector3(p.x,p.y,p.z)));});scene.setRoute(points);}
function spawnRoute(from:string,to:string){const route=traffic.routeBetween(from,to);if(!route.length){notify('Those destinations are unreachable on the directed lane graph. No route was spawned.',true);return;}const v=traffic.spawnRoute(from,to);if(!v){notify('The route is reachable, but its entry lane has no safe spawn space. Try again after traffic clears.',true);return;}scene.setTraffic(traffic.vehicles);selectVehicle(v.id);setMode('follow');paused=false;updatePlay();notify(`Route planned across ${v.route.length} directed links. Following ${v.id}.`);}

function updatePlay(){$('#play-button').innerHTML=icon(paused?'play':'pause');$('#play-button').setAttribute('aria-label',paused?'Play traffic':'Pause traffic');drawIcons();}
function clock(time:number){const s=Math.floor(time);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
function updateTimeUI(h:number){$('#day-time').textContent=`${String(Math.floor(h)%24).padStart(2,'0')}:${String(Math.round(h%1*60)).padStart(2,'0')}`;$('#daylight-label').innerHTML=`${icon(h<6||h>19?'moon':'sun')}${h<6||h>19?'Nightfall':'Daylight'}`;drawIcons();}

function modal(content: string){$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="icon-button close" data-action="close-modal" aria-label="Close dialog">${icon('x')}</button>${content}</section></div>`;drawIcons();$('.modal .close').focus();}
function newModal(){modal(`<div class="eyebrow">EVERY CITY STARTS SOMEWHERE</div><h2 id="modal-title">A place for your imagination.</h2><p>Begin with a blank landscape or take an editable example in a completely new direction.</p><div class="example-grid">${[['riverfront','Riverfront','Bridges, boulevards, and a growing skyline.'],['hillside','Hillside','Rolling terrain and a quieter neighborhood.'],['garden','Garden City','Mixed density with pockets of green.'],['empty','Blank landscape','No roads. No rules, except good connections.']].map(([id,n,d])=>`<button class="example-choice" data-example="${id}">${id==='empty'?`<div class="empty-thumb">${icon('plus')}</div>`:`<div class="sample-thumb ${id}"></div>`}<strong>${n}</strong><p>${d}</p></button>`).join('')}</div><div class="modal-footer"><label>Starting seed<input id="example-seed" type="number" min="0" max="4294967295" value="42"></label><span class="small">Your current city stays in undo history.</span></div><button class="secondary full spaced" data-action="import">${icon('folder-open')}Open an existing city</button>`);}
function helpModal(){modal(`<div class="eyebrow">WELCOME TO FORMA</div><h2 id="modal-title">Small moves. Living cities.</h2><p>A creative space for the places that don't exist yet. Everything is generated here, on your device.</p><div class="help-grid"><div class="help-step"><h3>01 / Shape a landscape</h3><p>Start an empty city. Raise, lower, smooth, or flatten the terrain. Draw a river centerline with the Water tool.</p><div class="row">${icon('mountain')}Terrain <kbd>T</kbd> Water <kbd>W</kbd></div></div><div class="help-step"><h3>02 / Make connections</h3><p>Draw a road point by point. Close a loop to generate parcels. Same-level crossings connect; elevated roads stay separate.</p><div class="row">${icon('route')}Roads <kbd>R</kbd> Finish <kbd>Enter</kbd></div></div><div class="help-step"><h3>03 / Give it character</h3><p>Zone parcels as homes, commerce, mixed-use, or parks. Select a building to change its footprint, floors, facade, and roof.</p><div class="row">${icon('building-2')}Districts <kbd>B</kbd> Buildings <kbd>I</kbd></div></div><div class="help-step"><h3>04 / Watch it come alive</h3><p>Pause, step, or follow seeded traffic on real lane routes. Walk with WASD. Save viewpoints and export your city.</p><div class="row">${icon('car-front')}Pause <kbd>Space</kbd> Skyline <kbd>Esc</kbd></div></div></div><div class="panel-note">${icon('cable')}<span>Try your first bridge: in Riverfront, draw a boulevard from (0, -90) to (0, 90). It connects both waterfronts with a 5 m-clearance deck and 10% approaches.</span></div><p class="small spaced">Orbit: drag · Pan: right-drag · Zoom: scroll · Undo: Ctrl+Z · Redo: Ctrl+Shift+Z · Presentation: P · Help: ?</p><button class="primary full spaced" data-action="bridge-guide">Build your first bridge ${icon('arrow-right')}</button>`);}
function exportModal(){modal(`<div class="eyebrow">TAKE YOUR CITY WITH YOU</div><h2 id="modal-title">Made here. Yours to keep.</h2><p>Export the actual scene, or save the complete editable city. Everything stays on your device.</p>${capturePanel().split('<div class="export-options">')[1]?`<div class="export-options">${capturePanel().split('<div class="export-options">')[1].split('</div><button')[0]}</div>`:''}<p class="small spaced">${city.buildings.length} buildings · ${city.roads.length} road segments · ${city.terrain.size} m terrain · JSON version 1</p>`);}
function downloadJSON(){const blob=new Blob([JSON.stringify(city,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`forma-${city.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('Editable city exported. Seed, terrain, topology, overrides, settings, and views included.');}

document.addEventListener('click',async event=>{
  const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
  const d=target.dataset;
  if(d.tool){setTool(d.tool as Tool);return;}
  if(d.mode){setMode(d.mode as typeof mode);return;}
  if(d.panel){panelTab=d.panel;tool='select';scene.setTool('select');selection=null;scene.select('','');renderPanel();return;}
  if(d.workspace){document.querySelectorAll<HTMLElement>('[data-workspace]').forEach(b=>b.classList.toggle('active',b===target));panelTab=d.workspace==='design'?'overview':d.workspace;setTool('select');panelTab=d.workspace==='design'?'overview':d.workspace;renderPanel();if(d.workspace!=='design')document.body.classList.add('panel-open');return;}
  if(d.profile){roadProfile=d.profile as typeof roadProfile;roadWidth=roadProfile==='local'?10:18;renderPanel();return;}
  if(d.brush){brushMode=d.brush as typeof brushMode;renderPanel();return;}
  if(d.zone){selectedZone=d.zone as typeof selectedZone;renderPanel();return;}
  if(d.palette){document.querySelectorAll('.swatch').forEach(el=>el.classList.remove('active'));target.classList.add('active');return;}
  if(d.vehicle){selectVehicle(d.vehicle);return;}
  if(d.view!==undefined){scene.loadView(city.views[Number(d.view)]);mode='orbit';notify(`Camera restored: ${city.views[Number(d.view)].name}`);return;}
  if(d.example){const seed=Number(document.querySelector<HTMLInputElement>('#example-seed')?.value??city.seed);$('#modal-root').innerHTML='';if(await transact('create',{example:d.example,seed},'New beginning loaded.')){setTool('select');scene.home();document.body.classList.remove('panel-open');guide=d.example==='riverfront';$('#guide').classList.toggle('hidden',!guide);}return;}
  const action=d.action;if(!action)return;
  switch(action){
    case 'home': setMode('orbit');scene.home();break;
    case 'zoom-in':case 'zoom-out':{const offset=scene.camera.position.clone().sub(scene.controls.target).multiplyScalar(action==='zoom-in'?.8:1.25);scene.loadView({position:scene.controls.target.clone().add(offset).toArray(),target:scene.controls.target.toArray()});break;}
    case 'new':newModal();break;
    case 'help':helpModal();break;
    case 'export':exportModal();break;
    case 'close-modal':$('#modal-root').innerHTML='';break;
    case 'panel':document.body.classList.toggle('panel-open');break;
    case 'panel-overview':setTool('select');break;
    case 'layers':panelTab='layers';renderPanel();document.body.classList.add('panel-open');break;
    case 'views':setTool('select');panelTab='views';renderPanel();document.body.classList.add('panel-open');break;
    case 'dismiss-guide':$('#guide').classList.add('hidden');sessionStorage.setItem('forma.guide.dismissed','1');guide=false;break;
    case 'bridge-guide':$('#modal-root').innerHTML='';setTool('road');roadProfile='boulevard';roadWidth=18;renderPanel();notify('Connect (0, -90) to (0, 90), using the canvas or Precise coordinates. Press Enter to build.');break;
    case 'cancel-draft':cancelDraft();break;
    case 'finish-road':await finishRoad();break;
    case 'add-point':addPoint({x:Number($<HTMLInputElement>('#point-x').value),z:Number($<HTMLInputElement>('#point-z').value)});break;
    case 'cancel-build':(worker as (Worker&{cancel?:()=>void})|null)?.cancel?.();break;
    case 'undo':case 'redo':if(busy){notify('Cancel the rebuild before using history.');break;}if(action==='undo')history.undo();else history.redo();cancelDraft();syncDocument();notify(`${action==='undo'?'Undo':'Redo'} restored a complete city transaction. Traffic reset.`);break;
    case 'regenerate':{const next=clone(city);next.seed=Number(document.querySelector<HTMLInputElement>('#seed')?.value??city.seed);next.settings.density=Number(document.querySelector<HTMLInputElement>('#density')?.value??city.settings.density*100)/100;await transact('rebuild',{},'Neighborhoods regenerated. Protected buildings preserved.',next,false);break;}
    case 'random-seed':$<HTMLInputElement>('#seed').value=String(crypto.getRandomValues(new Uint32Array(1))[0]);notify('New seed chosen. Regenerate to apply it; protected buildings keep their edits.');break;
    case 'apply-building':{if(selection?.kind!=='building')break;const next=clone(city),b=next.buildings.find(b=>b.id===selection!.id)!;b.floors=Number($<HTMLInputElement>('#building-floors').value);b.width=Number($<HTMLInputElement>('#building-width').value);b.depth=Number($<HTMLInputElement>('#building-depth').value);b.roof=$<HTMLSelectElement>('#building-roof').value as Building['roof'];b.palette=Number(document.querySelector<HTMLElement>('.swatch.active')?.dataset.palette??b.palette);b.edited=true;await transact('rebuild',{},'Building updated and protected.',next,false);break;}
    case 'release-building':{const next=clone(city);const b=next.buildings.find(b=>b.id===selection?.id);if(b)b.edited=false;await transact('validate',{},'Override protection removed. Future generation may replace this building.',next,false);break;}
    case 'focus':if(selection)scene.focus(selection.kind,selection.id);break;
    case 'move-node':await transact('move',{id:$<HTMLSelectElement>('#move-endpoint').value,point:{x:Number($<HTMLInputElement>('#node-x').value),z:Number($<HTMLInputElement>('#node-z').value)}},'Shared endpoint moved.');break;
    case 'apply-road-profile':{const next=clone(city),r=next.roads.find(r=>r.id===selection?.id);if(r){r.width=Number($<HTMLInputElement>('#selected-road-width').value);r.clearance=Number($<HTMLInputElement>('#selected-road-clearance').value);r.profile=$<HTMLSelectElement>('#selected-road-profile').value as Road['profile'];await transact('rebuild',{},'Road profile updated with validated parcels.',next);}break;}
    case 'drag-node':tool='move';scene.setTool('move');notify('Drag an endpoint of this road. Every attached street follows the shared node.');document.body.classList.remove('panel-open');break;
    case 'split-road':{const r=city.roads.find(r=>r.id===selection?.id);if(r){const a=city.nodes.find(n=>n.id===r.a)!,b=city.nodes.find(n=>n.id===r.b)!;await transact('split',{id:r.id,point:{x:(a.x+b.x)/2,z:(a.z+b.z)/2}},'Road split at its midpoint.');}break;}
    case 'delete-road':if(selection?.kind==='road')await transact('delete',{id:selection.id},'Road deleted. Obsolete vehicles and routes removed.');break;
    case 'extend-road':{const r=city.roads.find(r=>r.id===selection?.id);if(r){const node=city.nodes.find(n=>n.id===r.b)!;setTool('road');roadLevel=r.level;roadProfile=r.profile;roadWidth=r.width;addPoint(node);renderPanel();}break;}
    case 'spawn-road-route':{const r=city.roads.find(r=>r.id===selection?.id);if(r)spawnRoute(r.a,r.b);break;}
    case 'water-apply':await transact('river',{points:city.water[0].points,width:riverWidth,level:riverLevel},'River width and elevation updated.');break;
    case 'play':paused=!paused;updatePlay();break;
    case 'step':paused=true;traffic.step();scene.setTraffic(traffic.vehicles);updatePlay();break;
    case 'speed':speed=speed===4?.5:speed===.5?1:speed*2;$('#speed-button').textContent=`${speed}x`;break;
    case 'reset-traffic':traffic.reset(Math.round(city.settings.traffic*200));selectedVehicle=null;scene.setTraffic(traffic.vehicles);scene.setRoute([]);if(mode==='follow')setMode('orbit');notify('Traffic reset to the same seed and initial conditions.');if(panelTab==='explore')renderPanel();break;
    case 'apply-traffic':{const count=Number($<HTMLInputElement>('#traffic-count').value);if(!Number.isInteger(count)||count<0||count>200){notify('Choose 0 to 200 vehicles.',true);break;}const next=clone(city);next.settings.traffic=count/200;if(await transact('validate',{},'Traffic settings saved.',next,false)){traffic.reset(count);scene.setTraffic(traffic.vehicles);renderPanel();}break;}
    case 'follow-selected':setMode('follow');break;
    case 'spawn-route':spawnRoute($<HTMLSelectElement>('#route-from').value,$<HTMLSelectElement>('#route-to').value);break;
    case 'night':{const h=city.settings.day>6&&city.settings.day<19?22:14;const next=clone(city);next.settings.day=h;history.commit(next);city=history.current;scene.setTime(h);$<HTMLInputElement>('#day-slider').value=String(h);updateTimeUI(h);persist();updateHistory();break;}
    case 'rename':{const next=clone(city);next.name=$<HTMLInputElement>('#city-name').value.trim();await transact('validate',{},'City renamed.',next,false);break;}
    case 'save-view':{const next=clone(city);next.views.push({name:$<HTMLInputElement>('#view-name').value.trim()||`View ${next.views.length+1}`,...scene.saveView()});await transact('validate',{},'Camera view saved.',next,false);break;}
    case 'present':presentation(!document.body.classList.contains('presentation'));break;
    case 'screenshot':scene.screenshot();notify('Current-scene PNG captured without editor overlays.');break;
    case 'glb':try{notify('Exporting the actual city geometry…');const result=await scene.exportGLB();notify(`GLB exported: ${fmt(result.bytes/1e6,2)} MB, ${result.meshes} instanced mesh definitions. Units: metres.`);}catch(e){notify(String(e),true);}break;
    case 'json':downloadJSON();break;
    case 'import':$<HTMLInputElement>('#import-file').click();break;
  }
});

document.addEventListener('input',event=>{const e=event.target as HTMLInputElement;const value=Number(e.value);if(e.id==='day-slider'){scene.setTime(value);updateTimeUI(value);}if(e.id==='density')$('#density-readout').textContent=`${Math.round(value)}% occupied`;if(e.id==='brush-radius'){brushRadius=value;$('#radius-readout').textContent=`${value} m`;}});
document.addEventListener('change',async event=>{
  const e=event.target as HTMLInputElement;const value=Number(e.value);
  if(e.dataset.overlay){const key=e.dataset.overlay as keyof typeof overlays;overlays[key]=e.checked;scene.setOverlay(key,e.checked);updateSignals();return;}
  switch(e.id){
    case 'road-width':roadWidth=value;break;case 'road-grade':roadGrade=value;break;case 'road-level':roadLevel=value;break;case 'road-clearance':roadClearance=value;break;case 'brush-strength':brushStrength=value;break;case 'river-width':riverWidth=value;break;case 'river-level':riverLevel=value;break;
    case 'move-endpoint':{const n=city.nodes.find(n=>n.id===e.value)!;$<HTMLInputElement>('#node-x').value=String(n.x);$<HTMLInputElement>('#node-z').value=String(n.z);break;}
    case 'day-slider':{const next=clone(city);next.settings.day=value;history.commit(next);city=history.current;persist();updateHistory();break;}
    case 'import-file':{const file=e.files?.[0];if(!file)break;if(file.size>8_000_000){notify('Editable JSON files are limited to 8 MB.',true);e.value='';break;}try{const value=JSON.parse(await file.text());const ok=await transact('import',{value},'Editable city loaded and validated.');if(ok){$('#modal-root').innerHTML='';setTool('select');scene.home();}}catch(error){notify(`Import rejected: ${error instanceof Error?error.message:String(error)}. Current work is unchanged.`,true);}e.value='';break;}
  }
});

document.addEventListener('keydown',event=>{
  if(event.key==='Tab' && $('#modal-root').children.length) {
    const focusable=Array.from(document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal input, .modal select, .modal a[href]'));
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    return;
  }
  if(event.key==='Escape'){if(busy){(worker as (Worker&{cancel?:()=>void})|null)?.cancel?.();return;}$('#modal-root').innerHTML='';presentation(false);cancelDraft();if(mode!=='orbit'){setMode('orbit');scene.home();}else setTool('select');document.body.classList.remove('panel-open');return;}
  if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;
  if(event.ctrlKey||event.metaKey){if(event.key.toLowerCase()==='z'){event.preventDefault();$(`[data-action="${event.shiftKey?'redo':'undo'}"]`).click();}if(event.key.toLowerCase()==='s'){event.preventDefault();downloadJSON();}return;}
  if($('#modal-root').children.length)return;
  if(event.code==='Space'){event.preventDefault();paused=!paused;updatePlay();return;}
  if(event.key==='Enter'&&(tool==='road'||tool==='river')){event.preventDefault();void finishRoad();return;}
  if(event.key==='Backspace'&&draft.length){event.preventDefault();draft.pop();scene.preview(draft,roadWidth);updateDraft();return;}
  if(mode==='street')return;
  const map:Record<string,Tool>={v:'select',t:'terrain',w:'river',r:'road',b:'zone',i:'building'};
  if(map[event.key.toLowerCase()])setTool(map[event.key.toLowerCase()]);
  if(event.key.toLowerCase()==='p')presentation(!document.body.classList.contains('presentation'));
  if(event.key==='?')helpModal();
  if(event.key==='Delete'&&selection?.kind==='road')void transact('delete',{id:selection.id},'Road deleted; obsolete traffic removed.');
});

let previous=performance.now(),uiTime=0;
function frame(now:number) {
  const dt=(now-previous)/1000; previous=now;
  if(!paused&&!busy)traffic.advance(dt,speed);
  scene.setTraffic(traffic.vehicles);
  if(now-uiTime>250) {
    uiTime=now; updateSignals();
    $('#sim-time').textContent=clock(traffic.time);
    $('#vehicle-count').textContent=`${traffic.vehicles.length} vehicles ${paused?'paused':'on the move'}`;
    const stats=scene.stats();
    $('#render-stats').textContent=`${stats.fps} FPS / ${fmt(stats.triangles/1000)}k triangles`;
    const a=new Vector3(0,0,0).project(scene.camera), b=new Vector3(100,0,0).project(scene.camera);
    const canvas=scene.renderer.domElement.getBoundingClientRect();
    const hundred=Math.hypot((b.x-a.x)*canvas.width/2,(b.y-a.y)*canvas.height/2);
    const distance=hundred>150?20:hundred>75?50:100;
    $('#scale-label').style.width=`${Math.max(12,hundred*distance/100)}px`;
    $('#scale-label').textContent=`${distance} m`;
    if(selectedVehicle) {
      const v=traffic.vehicles.find(v=>v.id===selectedVehicle);
      if(v) {
        const s=document.querySelector('#selected-speed'); if(s)s.textContent=`${fmt(v.speed*3.6,1)} km/h`;
        const signal=document.querySelector('#selected-signal'); if(signal)signal.textContent=traffic.signal(traffic.graph.lanes.find(l=>l.id===v.laneId)!.to,v.laneId);
      }
    }
  }
  requestAnimationFrame(frame);
}
renderPanel();updateHistory();updateTimeUI(city.settings.day);drawIcons();requestAnimationFrame(frame);
if(startupNotice)notify(startupNotice,true);

// Transparent model access for reproducible browser checks, never a second city state.
Object.assign(window,{forma:{get city(){return city;},get traffic(){return traffic;},get history(){return history;},get busy(){return busy;},get timings(){return {generationTime,rebuildTime};},scene,transact,get paused(){return paused;},set paused(v:boolean){paused=v;updatePlay();},project(x:number,z:number,y?:number){const v=new Vector3(x,y??heightAt(city,x,z),z).project(scene.camera);const r=scene.renderer.domElement.getBoundingClientRect();return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};}}});
