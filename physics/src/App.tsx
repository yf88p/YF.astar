import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { OrbitalScene } from './scene';

type IconName = 'sound' | 'muted' | 'expand' | 'collapse' | 'reset' | 'arrow' | 'hand' | 'sliders' | 'minus' | 'plus' | 'close' | 'gravity';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    sound: <><path d="m11 5-6 4H2v6h3l6 4z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    muted: <><path d="m11 5-6 4H2v6h3l6 4z" /><path d="m16 9 5 6m0-6-5 6" /></>,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    collapse: <path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5" />,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
    arrow: <path d="M5 19 19 5M5 5h14v14" />,
    hand: <><path d="M8 12V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l2 2" /><path d="M16 11V8" /></>,
    sliders: <><path d="M4 7h6m4 0h6M4 17h10m4 0h2" /><circle cx="12" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14M12 5v14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    gravity: <><circle cx="12" cy="7" r="3" /><path d="M12 13v8m-4-4 4 4 4-4M4 3l-1 1m17-1 1 1" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function OrbitalMark() {
  return <svg className="brand-mark" width="38" height="38" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><circle cx="20" cy="20" r="16" /><ellipse cx="20" cy="20" rx="7" ry="16" transform="rotate(-35 20 20)" /><ellipse cx="20" cy="20" rx="16" ry="7" transform="rotate(-35 20 20)" /><circle cx="29" cy="7" r="2.5" fill="currentColor" stroke="var(--background)" strokeWidth="2" /></svg>;
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OrbitalScene | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sound, setSound] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState(false);
  const [gravity, setGravity] = useState(1);
  const [bounce, setBounce] = useState(0.66);
  const [count, setCount] = useState(18);
  const [energy, setEnergy] = useState(0);
  const [swirling, setSwirling] = useState(false);
  const [toast, setToast] = useState('');
  const swirlTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!stageRef.current) return;
    try {
      sceneRef.current = new OrbitalScene(stageRef.current, {
        onReady: () => setReady(true),
        onDrag: setDragging,
        onEnergy: setEnergy,
      });
    } catch (err) {
      console.error('Unable to initialize the 3D playground:', err);
      setError(true);
    }
    const onFullscreen = () => setExpanded(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
      document.removeEventListener('fullscreenchange', onFullscreen);
      clearTimeout(swirlTimer.current);
      clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.world.gravity = gravity * 6;
  }, [gravity]);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.world.bounciness = bounce;
  }, [bounce]);

  function notify(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }

  function swirl() {
    sceneRef.current?.swirl();
    setSwirling(true);
    clearTimeout(swirlTimer.current);
    swirlTimer.current = setTimeout(() => setSwirling(false), 1250);
  }

  function reset() {
    setGravity(1);
    setBounce(0.66);
    setCount(18);
    setSwirling(false);
    clearTimeout(swirlTimer.current);
    sceneRef.current?.reset(18);
    notify('A fresh little world.');
  }

  async function toggleSound() {
    if (!sceneRef.current) return;
    const enabled = await sceneRef.current.audio.setEnabled(!sound);
    setSound(enabled);
    if (enabled) sceneRef.current.audio.impact({ speed: 2.8, x: 0, kind: 'marble' });
    notify(enabled ? 'Sound on. Listen a little closer.' : 'Sound off. Enjoy the quiet.');
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notify('Your browser is already showing the full playground.');
    } catch {
      notify('Fullscreen is not available in this browser.');
    }
  }

  function keyboardMove(event: KeyboardEvent<HTMLDivElement>) {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-0.4, 0], ArrowRight: [0.4, 0], ArrowUp: [0, 0.4], ArrowDown: [0, -0.4],
    };
    if (directions[event.key]) {
      event.preventDefault();
      sceneRef.current?.nudge(...directions[event.key]);
    } else if (event.key === ' ') {
      event.preventDefault();
      swirl();
    }
  }

  const motion = dragging ? 'In your hands' : energy > 12 ? 'In motion' : energy > 0.12 ? 'Settling in' : 'At ease';

  return (
    <main className={`app ${dragging ? 'is-dragging' : ''} ${ready ? 'is-ready' : ''}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="header">
        <a className="brand" href="./" aria-label="Orbital home"><OrbitalMark /><span>orbital<span className="brand-period">.</span></span></a>
        <span className="header-caption">A SMALL EXPERIMENT IN PLAY</span>
        <div className="header-actions">
          <span className="live-label"><span className="live-dot" /> LIVE PHYSICS</span>
          <span className="header-divider" />
          <button className={`icon-button sound-button ${sound ? 'is-active' : ''}`} onClick={toggleSound} aria-label={sound ? 'Mute impact sounds' : 'Enable impact sounds'} aria-pressed={sound} title={sound ? 'Sound on' : 'Sound off'}><Icon name={sound ? 'sound' : 'muted'} /></button>
          <button className="icon-button fullscreen-button" onClick={toggleFullscreen} aria-label={expanded ? 'Exit fullscreen' : 'Enter fullscreen'} title="Fullscreen"><Icon name={expanded ? 'collapse' : 'expand'} size={18} /></button>
        </div>
      </header>

      <section className="playground" aria-label="Interactive marble playground">
        <div ref={stageRef} className="stage" role="application" aria-label="Glass sphere with marbles. Drag the sphere to move it. With keyboard focus, use arrow keys to move and Space to swirl." tabIndex={0} onKeyDown={keyboardMove} />

        <div className="introduction">
          <div className="eyebrow"><span className="eyebrow-line" /> DIGITAL OBJECT No. 001</div>
          <h1>A little world.<br />In your <em>hands.</em></h1>
          <p className="intro-copy">A glass sphere. A handful of marbles.<br />And a little room for curiosity.</p>
          <div className="primary-actions">
            <button className={`swirl-button ${swirling ? 'is-swirling' : ''}`} onClick={swirl} disabled={!ready || error}><span>{swirling ? 'There they go...' : 'Give it a swirl'}</span><Icon name="arrow" size={17} /></button>
            <button className="reset-button icon-button" aria-label="Reset the playground" title="Start fresh" onClick={reset} disabled={!ready || error}><Icon name="reset" size={18} /></button>
          </div>
          <div className="interaction-hint"><span className="hand-icon"><Icon name="hand" size={19} /></span><span>Or just grab it. It’s yours to move.</span></div>
        </div>

        <div className="specimen-label" aria-hidden="true"><span className="specimen-cross">+</span><span>FIG. 001<span>THE ORBITAL SPHERE</span></span></div>
        <div className="material-label" aria-hidden="true"><span className="material-line" /><span>Nothing scripted.<br /><strong>Just physics.</strong></span></div>

        <div className={`grab-label ${dragging ? 'grab-label-active' : ''}`} aria-hidden="true"><span className="grab-dot" />{dragging ? 'A little movement goes a long way' : 'Go on, give it a nudge'}</div>

        {!ready && !error && <div className="loading-label"><span className="loading-ring" />Making room for a little wonder...</div>}
        {error && <div className="error-card" role="alert"><OrbitalMark /><h2>A little more graphics power.</h2><p>This playground needs WebGL. Enable hardware acceleration in your browser, then give it another try.</p><button className="swirl-button" onClick={() => window.location.reload()}>Try again<Icon name="reset" size={17} /></button></div>}

        <div className="bottom-left-note"><span className="note-number">01 /</span><p>Move a little. Notice a lot.<br /><span>Some things don’t need a purpose.</span></p></div>

        <div className="control-dock">
          {settings && <section id="physics-settings" className="settings-panel" aria-label="Physics settings" onKeyDown={(event) => { if (event.key === 'Escape') setSettings(false); }}>
            <div className="settings-heading"><span>Make it your own</span><button className="icon-button" onClick={() => setSettings(false)} aria-label="Close physics settings"><Icon name="close" size={16} /></button></div>
            <div className="setting-row"><label htmlFor="gravity">Gravity</label><output htmlFor="gravity">{gravity.toFixed(1)}<span> g</span></output></div>
            <input id="gravity" type="range" min="0" max="2" step="0.1" value={gravity} style={{ '--range': `${gravity / 2 * 100}%` } as CSSProperties} onChange={(event) => setGravity(Number(event.target.value))} />
            <div className="range-labels"><button onClick={() => setGravity(0)}>Weightless</button><button onClick={() => setGravity(1)}>Earth</button><button onClick={() => setGravity(2)}>Heavy</button></div>
            <div className="setting-row bounce-row"><label htmlFor="bounce">Bounciness</label><output htmlFor="bounce">{Math.round(bounce * 100)}<span>%</span></output></div>
            <input id="bounce" type="range" min="0.1" max="0.95" step="0.01" value={bounce} style={{ '--range': `${(bounce - 0.1) / 0.85 * 100}%` } as CSSProperties} onChange={(event) => setBounce(Number(event.target.value))} />
            <div className="marble-count-row"><span>Marbles</span><div className="stepper"><button className="icon-button" disabled={count <= 6} onClick={() => { setCount(count - 6); sceneRef.current?.reset(count - 6); }} aria-label="Remove six marbles"><Icon name="minus" size={14} /></button><output>{count}</output><button className="icon-button" disabled={count >= 36} onClick={() => { setCount(count + 6); sceneRef.current?.reset(count + 6); }} aria-label="Add six marbles"><Icon name="plus" size={14} /></button></div></div>
            <p className="settings-note">Same little world. Different possibilities.</p>
          </section>}
          <div className="dock-main">
            <span className="marble-swatch-stack" aria-hidden="true"><i /><i /><i /></span>
            <div className="dock-stat"><strong>{count} marbles</strong><span>A happy little collection</span></div>
            <span className="dock-divider" />
            <button className={`tune-button ${settings ? 'is-active' : ''}`} onClick={() => setSettings(!settings)} aria-expanded={settings} aria-controls="physics-settings" aria-label="Tune physics"><Icon name="sliders" size={19} /><span>Tune</span></button>
          </div>
        </div>
      </section>

      <footer className="footer">
        <span className="footer-signature">BUILT FOR THE JOY OF IT.</span>
        <div className="motion-status"><span className={`motion-dot ${energy > 12 || dragging ? 'moving' : ''}`} /><span>{motion}</span><span className="status-divider">/</span><span>{gravity === 0 ? 'Zero gravity' : `${gravity.toFixed(1)}g gravity`}</span></div>
        <span className="footer-right">A pause from the ordinary<span className="footer-spark">✳</span></span>
      </footer>
      <div className={`toast ${toast ? 'toast-visible' : ''}`} role="status">{toast}</div>
    </main>
  );
}
