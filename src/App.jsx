import * as React from 'react';
import {
  Barcode, Button, DataList, DecodeText, Dialog, Field, Gauge, GridBackground, Hatch, Input, LogStream, Menu,
  Meter, MonohudProvider, Panel, Progress, Readout, Select, Status, Switch, Tabs, Tag, Tooltip, useToast,
} from '@monohud/react';
import {
  createBench, EXAMPLES, FIELDS, TOOLS, TWO, TYPES, fA, fV, fW, health, valueText,
} from './engine.js';
import { HAND_LEVELS, mission } from './missions.js';

const pad = (v, n = 2) => String(v).padStart(n, '0');
const stamp = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}.${Math.floor((s % 1) * 10)}`;
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const SPEEDS = [{ value: 1, label: 'Real time' }, { value: 0.25, label: '0.25× slow' }, { value: 0.05, label: '0.05× slow' }];
const EXAMPLE_ITEMS = Object.entries(EXAMPLES).map(([value, x]) => ({ value, label: x.name }));
const THEMES = [['mono', 'Mono'], ['sodium', 'Sodium'], ['ion', 'Ion'], ['ember', 'Ember']];
const HINTS = {
  select: 'Click a part to edit it. Drag a part to move it, or empty bench to pan. Click a switch to flip it.',
  pan: 'Drag to move around the bench. Scroll to zoom.',
  delete: 'Click a part to delete it.',
  bjt: 'Click a grid point to place the transistor, base on the left.',
  wire: 'Drag between grid points to draw a wire.',
};
let logId = 0;

export function App() {
  const [theme, setTheme] = React.useState(() => store.get('cbh-theme', 'mono'));
  const [motion, setMotion] = React.useState('full');
  const [sound, setSound] = React.useState(false);
  const [surge, setSurge] = React.useState(0);
  const [redUntil, setRedUntil] = React.useState(0);
  React.useEffect(() => store.set('cbh-theme', theme), [theme]);

  // A burnout tears the signal, then it settles back.
  React.useEffect(() => {
    if (surge <= 0) return undefined;
    const id = setTimeout(() => setSurge((s) => (s < 0.02 ? 0 : s * 0.82)), 70);
    return () => clearTimeout(id);
  }, [surge]);

  return (
    <MonohudProvider theme={theme} motion={motion} sound={sound} distortion={Math.min(1, 0.1 + surge)}
      alert={redUntil > Date.now() ? 'red' : 'none'} className="app">
      <GridBackground />
      <Bench {...{ theme, setTheme, motion, setMotion, sound, setSound, setSurge, setRedUntil }} />
    </MonohudProvider>
  );
}

function Bench({ theme, setTheme, motion, setMotion, sound, setSound, setSurge, setRedUntil }) {
  const { toast } = useToast();
  const cvRef = React.useRef(null), scopeRef = React.useRef(null);
  const [bench, setBench] = React.useState(null);
  const [, setVer] = React.useState(0);
  const [, setTick] = React.useState(0);
  const [log, setLog] = React.useState([]);
  const [mode, setMode] = React.useState('sim');
  const [unlocked, setUnlocked] = React.useState(() => store.get('cbh-unlocked', 1));
  const [level, setLevel] = React.useState(() => store.get('cbh-unlocked', 1));
  const [game, setGame] = React.useState({ status: 'idle', hold: 0, reason: '', clearT: 0 });
  const modeRef = React.useRef(mode); modeRef.current = mode;
  const gameRef = React.useRef(game); gameRef.current = game;

  const report = React.useCallback(({ t, msg, bad }) => {
    logId += 1;
    setLog((l) => [...l.slice(-60), { id: String(logId), time: stamp(t), text: msg, level: bad ? 'danger' : undefined }]);
  }, []);

  React.useEffect(() => {
    const b = createBench(cvRef.current, scopeRef.current, {
      onLog: report,
      onChange: () => setVer((v) => v + 1),
      onFail: (e) => {
        setSurge(0.85); setRedUntil(Date.now() + 2400); setTimeout(() => setRedUntil(0), 2500);
        toast({ title: `${e.name} failed`, description: `${TYPES[e.type].label} overloaded`, type: 'danger', timeout: 2600 });
        if (modeRef.current === 'game' && gameRef.current.status === 'playing') setGame((g) => ({ ...g, status: 'failed', reason: `${e.name} burned out.` }));
      },
    });
    if (b.restore()) report({ t: 0, msg: 'Restored your last circuit.' }); else b.loadExample('series');
    setBench(b);
    return () => b.destroy();
  }, [report, setSurge, setRedUntil, toast]);

  // Readouts refresh eight times a second; the canvas runs at full frame rate on its own.
  React.useEffect(() => { const id = setInterval(() => setTick((x) => x + 1), 125); return () => clearInterval(id); }, []);

  const m = React.useMemo(() => mission(level), [level]);

  const startLevel = React.useCallback((lv) => {
    if (!bench) return;
    const mm = mission(lv);
    bench.load(mm.setup, { allowed: mm.allowed, persist: false });
    setLevel(lv); setGame({ status: 'playing', hold: 0, reason: '', clearT: 0, lastT: 0 });
    report({ t: 0, msg: `Mission ${pad(lv)}: ${mm.title}.` });
  }, [bench, report]);

  const switchMode = (next) => {
    if (!bench || next === mode) return;
    setMode(next);
    if (next === 'game') startLevel(level);
    else { setGame((g) => ({ ...g, status: 'idle' })); bench.load(() => {}, { persist: true }); if (!bench.restore()) bench.loadExample('series'); report({ t: 0, msg: 'Back on the open bench.' }); }
  };

  // Goal checking: everything must stay true for `hold` simulated seconds.
  const goalState = bench && mode === 'game' ? m.goals.map((g) => { try { return g.test(bench); } catch { return false; } }) : [];
  const allMet = goalState.length > 0 && goalState.every(Boolean);
  React.useEffect(() => {
    if (!bench || mode !== 'game' || game.status !== 'playing') return;
    const t = bench.t, dt = Math.max(0, t - (game.lastT ?? t));
    const hold = allMet ? game.hold + dt : 0;
    if (hold >= m.hold) {
      const next = level + 1;
      if (next > unlocked) { setUnlocked(next); store.set('cbh-unlocked', next); }
      setGame({ status: 'won', hold: m.hold, reason: '', clearT: t, lastT: t });
      setSurge(0.4);
      report({ t, msg: `Mission ${pad(level)} clear: ${m.title}.` });
      toast({ title: `Level ${pad(level)} clear`, description: m.title, type: 'ok', timeout: 3000 });
    } else if (hold !== game.hold || t !== game.lastT) setGame((g) => ({ ...g, hold, lastT: t }));
  });

  const sel = bench?.selected;
  const parts = bench ? bench.els.filter((e) => e.type !== 'wire') : [];
  const worst = parts.reduce((w, e) => Math.max(w, e.failed ? 0 : e.stress || 0), 0);
  const failedCount = parts.filter((e) => e.failed).length;
  const condition = failedCount ? 'danger' : worst > 1 ? 'warn' : 'ok';

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1 className="brand__name"><DecodeText text="CIRCUIT BENCH" duration={900} /></h1>
          <Barcode value="CB-HUD-01" />
          <Status tone={!bench?.running ? 'idle' : condition} pulse={condition !== 'ok'}>
            {!bench?.running ? 'Paused' : failedCount ? `${failedCount} part${failedCount > 1 ? 's' : ''} failed` : worst > 1 ? 'Overheating' : 'Nominal'}
          </Status>
        </div>
        <Tabs.Root value={mode} onValueChange={switchMode}>
          <Tabs.List aria-label="Mode">
            <Tabs.Tab value="sim">Simulator</Tabs.Tab>
            <Tabs.Tab value="game">Missions</Tabs.Tab>
          </Tabs.List>
        </Tabs.Root>
        <div className="top__facts">
          <Readout label="Sim time" value={bench ? bench.t.toFixed(2) : '0.00'} unit="s" size="sm" />
          <Readout label="Nodes" value={bench?.nodes ?? 0} size="sm" />
          <Readout label="Parts" value={parts.length} size="sm" />
          <Menu.Root>
            <Menu.Trigger render={<Button size="sm" />}>Settings</Menu.Trigger>
            <Menu.Content align="end">
              {THEMES.map(([v, l]) => <Menu.Item key={v} onClick={() => setTheme(v)} hint={theme === v ? 'Active' : undefined}>{l} palette</Menu.Item>)}
              <Menu.Separator />
              <Menu.Item onClick={() => setMotion(motion === 'full' ? 'subtle' : 'full')}>{motion === 'full' ? 'Reduce motion' : 'Full motion'}</Menu.Item>
              <Menu.Item onClick={() => setSound(!sound)} hint={sound ? 'On' : 'Off'}>Interface sound</Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </div>
      </header>

      <div className="bar">
        <div className="tools" role="toolbar" aria-label="Parts">
          {TOOLS.map((tl, i) => tl ? (
            <Tooltip key={tl[0]} content={`${tl[1]} · ${tl[2]}`}>
              <Button size="sm" variant={bench?.tool === tl[0] ? 'primary' : 'ghost'} aria-pressed={bench?.tool === tl[0]}
                disabled={bench ? !bench.allowedTool(tl[0]) : true} onClick={() => bench.setTool(tl[0])}>
                {tl[1]}
              </Button>
            </Tooltip>
          ) : <span key={i} className="tools__sep" aria-hidden="true" />)}
        </div>
        <div className="run">
          <Button size="sm" variant={bench?.running ? 'secondary' : 'primary'} onClick={() => bench.togglePlay()}>{bench?.running ? 'Pause' : 'Run'}</Button>
          <Select className="run__speed" items={SPEEDS} value={bench?.speed ?? 1} onValueChange={(v) => bench.setSpeed(v)} aria-label="Simulation speed" />
          {mode === 'sim' && <>
            <Select className="run__examples" items={EXAMPLE_ITEMS} value={null} placeholder="Load example" onValueChange={(v) => v && bench.loadExample(v)} />
            <Button size="sm" onClick={() => bench.repairAll()}>Reset parts</Button>
            <Button size="sm" variant="ghost" onClick={() => bench.clear()}>Clear</Button>
          </>}
        </div>
      </div>

      <main className={`work work--${mode}`}>
        <div className="side">
          {mode === 'game' && <MissionPanel m={m} game={game} goalState={goalState} unlocked={unlocked}
            onRestart={() => startLevel(level)} onLevel={startLevel} />}
          <Inspector bench={bench} sel={sel} />
        </div>

        <Panel title={mode === 'game' ? `Mission ${pad(level)}` : 'Bench'} meta={bench ? `X${bench.center.x} Y${bench.center.y} / ${Math.round(bench.zoom * 100)}%` : ''} className="stage" enterDelay={120}>
          <div className="stage__wrap">
            <canvas ref={cvRef} className="stage__cv" aria-label="Circuit drawing area. Drag to draw parts, scroll to zoom, drag empty space to pan." />
            <p className="stage__hint mh-micro">{bench ? HINTS[bench.tool] || `Drag between two grid points to place a ${TYPES[bench.tool].label.toLowerCase()}. The first point is the + side.` : ''}</p>
            <div className="stage__zoom">
              <Button size="sm" variant="ghost" aria-label="Zoom out" onClick={() => bench.zoomOut()}>−</Button>
              <Button size="sm" variant="ghost" onClick={() => bench.fit()}>Fit</Button>
              <Button size="sm" variant="ghost" aria-label="Zoom in" onClick={() => bench.zoomIn()}>+</Button>
            </div>
          </div>
        </Panel>

        <div className="side side--right">
          <Panel title="Probe" meta={sel && sel.type !== 'wire' ? sel.name : 'NO TARGET'} enterDelay={200}>
            <canvas ref={scopeRef} className="scope" aria-label="Voltage and current of the selected part over time" />
            <div className="scope__legend mh-micro"><span><i className="sw sw--v" />Voltage</span><span><i className="sw sw--i" />Current</span><span>6 S WINDOW</span></div>
          </Panel>
          <Panel title="Health" meta={`${parts.length - failedCount}/${parts.length} OK`} className="health" enterDelay={280}>
            <div className="health__list">
              {parts.filter((e) => e.type !== 'dc' && e.type !== 'ac' && e.type !== 'switch').map((e) => {
                const hp = health(e);
                return (
                  <button key={e.id} type="button" className="health__row" data-selected={e === sel ? '' : undefined} onClick={() => bench.select(e)}>
                    <Meter label={`${e.name} · ${valueText(e)}`} value={hp} hideScale tone={e.failed || hp < 30 ? 'danger' : hp < 70 ? 'warn' : 'ok'} />
                  </button>
                );
              })}
              {!parts.length && <p className="mh-micro">No parts on the bench</p>}
            </div>
          </Panel>
          <Panel title="Events" meta={`${log.length} entries`} className="events" enterDelay={360}>
            <LogStream entries={log} label="Event log" className="events__log" />
          </Panel>
        </div>
      </main>

      <Dialog.Root open={mode === 'game' && game.status === 'won'} onOpenChange={() => {}}>
        <Dialog.Content code={`MSN-${pad(level, 3)} / CLEAR`} title={`Level ${pad(level)} clear`}
          description={level >= HAND_LEVELS ? 'The next calibration runs tighter: odder supplies, narrower windows, lower ceilings.' : `“${m.title}” is done. The next mission asks more of the same parts.`}>
          <DataList rows={[
            { label: 'Mission', value: m.title.toUpperCase() },
            { label: 'Sim time', value: `${game.clearT.toFixed(2)} S` },
            { label: 'Parts used', value: bench ? bench.els.filter((e) => e.type !== 'wire' && !e.locked).length : 0 },
            { label: 'Unlocked', value: `LEVEL ${pad(unlocked)}`, tone: 'ok' },
          ]} />
          <Dialog.Actions>
            <Button variant="ghost" onClick={() => startLevel(level)}>Replay</Button>
            <Button variant="primary" onClick={() => startLevel(level + 1)}>Next level</Button>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

function MissionPanel({ m, game, goalState, unlocked, onRestart, onLevel }) {
  const pct = Math.min(100, (game.hold / m.hold) * 100);
  return (
    <Panel title="Mission" meta={`LVL ${pad(m.level)} / ${pad(unlocked)} UNLOCKED`} className="mission" enterDelay={80}>
      <div className="stack">
        <div className="row row--between">
          <Readout label="Level" value={pad(m.level)} size="lg" note={m.level > HAND_LEVELS ? 'ENDLESS' : `${pad(m.level)} OF ${pad(HAND_LEVELS)}`} />
          {game.status === 'failed' ? <Tag tone="danger">FAILED</Tag> : game.status === 'won' ? <Tag tone="ok">CLEAR</Tag> : <Tag tone="accent">LIVE</Tag>}
        </div>
        <p className="mission__title"><DecodeText key={m.level} text={m.title} duration={500} /></p>
        <p className="mission__brief">{m.brief}</p>
        <ul className="goals">
          {m.goals.map((g, i) => (
            <li key={g.text} data-met={goalState[i] ? '' : undefined}>
              <span className="goals__mark" aria-hidden="true" />{g.text}<span className="sr">{goalState[i] ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
        <Progress label={`Hold ${m.hold.toFixed(1)} s`} value={pct} tone={game.status === 'failed' ? 'danger' : 'ok'} cells={12} gap={3} hideScale />
        {game.status === 'failed'
          ? <p className="mission__fail">{game.reason} Restart to try again.</p>
          : <p className="mh-micro mission__hint">HINT / {m.hint}</p>}
        <Hatch hazard={game.status === 'failed'} tone={game.status === 'failed' ? 'danger' : undefined} />
        <div className="row">
          <Button size="sm" variant="ghost" disabled={m.level <= 1} onClick={() => onLevel(m.level - 1)}>Prev</Button>
          <Button size="sm" variant={game.status === 'failed' ? 'primary' : 'secondary'} onClick={onRestart}>Restart</Button>
          <Button size="sm" variant="ghost" disabled={m.level >= unlocked} onClick={() => onLevel(m.level + 1)}>Next</Button>
        </div>
      </div>
    </Panel>
  );
}

function NumField({ bench, e, k, label }) {
  const [err, setErr] = React.useState('');
  return (
    <Field label={label}>
      <Input key={`${e.id}-${k}`} defaultValue={String(e.props[k])} inputMode="decimal" disabled={e.locked}
        onChange={(ev) => {
          const v = parseFloat(ev.target.value);
          if (!(v > 0) && !(k === 'V' && v === 0)) { setErr('Enter a number above 0'); return; }
          setErr(''); bench.setProp(e, k, v);
        }} />
      {err && <span className="field-err">{err}</span>}
    </Field>
  );
}
function Inspector({ bench, sel }) {
  if (!sel) {
    return (
      <Panel title="Inspector" meta="IDLE" className="inspector" enterDelay={160}>
        <div className="stack help">
          <p>Pick a part in the toolbar, then drag between two grid points to place it. Click a part to edit it.</p>
          <DataList rows={[
            { label: 'Move', value: 'DRAG PART' }, { label: 'Stretch', value: 'DRAG END' },
            { label: 'Pan', value: 'DRAG EMPTY / H' }, { label: 'Zoom', value: 'SCROLL' },
            { label: 'Delete', value: 'DEL' }, { label: 'Flip', value: 'F' }, { label: 'Rotate Q', value: 'R' },
            { label: 'Pause', value: 'SPACE' }, { label: 'Parts', value: '1 – 9' },
          ]} />
        </div>
      </Panel>
    );
  }
  const e = sel, T = TYPES[e.type], bjt = e.type === 'bjt', hp = health(e);
  const load = Math.round((e.stress || 0) * 100);
  return (
    <Panel title={e.name || 'Wire'} meta={T.label.toUpperCase()} className="inspector" enterDelay={0} key={e.id}>
      <div className="stack">
        <div className="row row--between">
          <span className="mh-micro">ID {pad(e.id, 4)}{e.locked ? ' / MISSION PART' : ''}</span>
          {e.failed ? <Tag tone="danger">FAILED</Tag> : e.locked ? <Tag tone="idle">LOCKED</Tag> : <Tag tone="ok">ONLINE</Tag>}
        </div>
        {(FIELDS[e.type] || []).map(([k, label, kind, opts]) => kind === 'num'
          ? <NumField key={k} bench={bench} e={e} k={k} label={label} />
          : kind === 'sel'
            ? <Select key={k} label={label} disabled={e.locked} items={opts.map(([v, l]) => ({ value: v, label: l }))} value={e.props[k]} onValueChange={(v) => bench.setProp(e, k, v)} />
            : <Switch key={k} checked={!!e.props[k]} onCheckedChange={(v) => (k === 'closed' ? bench.toggleSwitch(e) : bench.setProp(e, k, v))}>{label}</Switch>)}
        {e.type !== 'wire' && <>
          <hr className="rule" />
          <div className="readouts">
            <Readout label={bjt ? 'Vce' : e.type === 'capacitor' ? 'Charge' : 'Voltage'} value={fV(bjt ? e.Vce || 0 : e.type === 'capacitor' ? e.vc : e.Vd || 0)} size="sm" />
            <Readout label={bjt ? 'Ic' : 'Current'} value={fA(bjt ? e.Ic || 0 : e.I || 0)} size="sm" note={bjt ? `IB ${fA(e.Ib || 0)}` : undefined} />
            <Readout label="Power" value={fW(Math.abs(e.P || 0))} size="sm" />
          </div>
          {!['dc', 'ac', 'switch'].includes(e.type) && (
            <div className="vitals">
              <Gauge label="Load vs rating" unit="%" value={Math.min(150, load)} max={150} size={104} tone={load > 100 ? 'danger' : load > 80 ? 'warn' : 'accent'} />
              <Meter label="Health" value={hp} hideScale tone={e.failed || hp < 30 ? 'danger' : hp < 70 ? 'warn' : 'ok'} />
            </div>
          )}
        </>}
        <div className="row row--wrap">
          {e.type !== 'wire' && !e.locked && <Button size="sm" onClick={() => bench.flip(e)}>{bjt ? 'NPN / PNP' : 'Flip'}</Button>}
          {bjt && !e.locked && <Button size="sm" onClick={() => bench.rotate(e)}>Rotate</Button>}
          {e.type === 'switch' && <Button size="sm" onClick={() => bench.toggleSwitch(e)}>{e.props.closed ? 'Open' : 'Close'}</Button>}
          {(e.failed || e.heat > 0) && <Button size="sm" onClick={() => bench.repair(e)}>Repair</Button>}
          {!e.locked && <Button size="sm" variant="danger" onClick={() => bench.remove(e)}>Delete</Button>}
        </div>
        {!bjt && !e.locked && (
          <Select label="Replace with" placeholder="Choose a part" value={null}
            items={TWO.filter((x) => x !== e.type && bench.allowedTool(x)).map((x) => ({ value: x, label: TYPES[x].label }))}
            onValueChange={(v) => v && bench.replace(e, v)} />
        )}
      </div>
    </Panel>
  );
}
