"use client";
// Screens and touch controls for the hunting game. The 3D engine lives in game/engine.
//  - one finger anywhere (not on a button) = scope up, slide to aim, lift to lower the rifle
//  - FIRE button (right thumb) shoots, + / − change magnification
import { useCallback, useEffect, useRef, useState } from "react";
import type { Game, Hud } from "../engine/Game";
import { STRIKES, type Banner, type HuntStatus, type HuntSummary } from "../engine/Hunt";
import type { GameScore } from "@/lib/store";
import { isMuted, setMuted, startAmbience, unlockAudio } from "../engine/audio";
import DeerDiagram from "./DeerDiagram";

type Screen = "menu" | "play" | "results" | "board" | "help";

/** Real full screen where the browser allows it (Android, desktop); iPhone Safari doesn't. */
function canFullscreen() {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}
function isStandalone() {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function loadName() { try { return localStorage.getItem("st:name") ?? ""; } catch { return ""; } }
function saveName(v: string) { try { localStorage.setItem("st:name", v); } catch {} }

export default function GameRoot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const aimPointer = useRef<{ id: number; x: number; y: number; sx: number; sy: number; t: number; opened: boolean } | null>(null);
  const [scopeTip, setScopeTip] = useState(0);
  const [tipNow, setTipNow] = useState(0);
  useEffect(() => {
    if (!scopeTip) return;
    setTipNow(Date.now());
    const t = window.setTimeout(() => setTipNow(Date.now()), 5200);
    return () => window.clearTimeout(t);
  }, [scopeTip]);
  const [screen, setScreen] = useState<Screen>("menu");
  const [progress, setProgress] = useState<{ f: number; label: string }>({ f: 0, label: "Starting" });
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState<HuntStatus>({ level: 1, strikes: 0 });
  const [banners, setBanners] = useState<Banner[]>([]);
  const [summary, setSummary] = useState<HuntSummary | null>(null);
  const [portrait, setPortrait] = useState(false);
  const [error, setError] = useState("");
  const [mute, setMute] = useState(false);
  const [fsTip, setFsTip] = useState(false);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const f = () => { setIsFs(!!document.fullscreenElement); gameRef.current?.resize(); };
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
    if (canFullscreen()) {
      const orient = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).then(() => orient?.lock?.("landscape")).catch(() => setFsTip(true));
    } else setFsTip(true);
  };
  const showFsButton = !isStandalone();

  const pushBanner = useCallback((b: Banner) => {
    if (location.search.includes("debug")) console.log(`[g] banner: ${b.title} | ${b.detail ?? ""} | ${b.points ?? ""}`);
    setBanners((list) => [...list.slice(-1), b]);
    window.setTimeout(() => setBanners((list) => list.filter((x) => x.id !== b.id)), b.tone === "good" ? 4200 : 3400);
  }, []);

  // Build the world while the menu is showing.
  useEffect(() => {
    let disposed = false;
    let game: Game | null = null;
    (async () => {
      try {
        const { Game } = await import("../engine/Game");
        if (disposed || !canvasRef.current || !overlayRef.current) return;
        game = new Game(canvasRef.current, overlayRef.current, {
          hud: setHud,
          banner: pushBanner,
          score: setScore,
          status: setStatus,
          end: (s) => { setSummary(s); setScreen("results"); aimPointer.current = null; },
        });
        gameRef.current = game;
        if (location.search.includes("debug")) {
          (window as unknown as { __game: Game }).__game = game;
          (window as unknown as { __audio: unknown }).__audio = await import("../engine/audio");
        }
        await game.init((f, label) => setProgress({ f, label }));
        if (disposed) return;
        game.start();
        setReady(true);
        if (new URLSearchParams(location.search).has("autostart")) { game.startHunt(); setScreen("play"); }
      } catch (e) {
        console.error(e);
        setError("This phone's browser couldn't start the 3D graphics.");
      }
    })();
    return () => { disposed = true; game?.dispose(); };
  }, [pushBanner]);

  useEffect(() => {
    const check = () => {
      setPortrait(window.innerHeight > window.innerWidth * 1.05 && window.matchMedia("(pointer: coarse)").matches);
      gameRef.current?.resize();
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    const vis = () => {
      const g = gameRef.current;
      if (!g) return;
      if (document.hidden) { g.paused = true; g.endAim(true); aimPointer.current = null; setScreen((s) => (s === "play" ? "menu" : s)); }
    };
    document.addEventListener("visibilitychange", vis);
    const stop = (e: Event) => e.preventDefault(); // iOS pinch-zoom
    document.addEventListener("gesturestart", stop);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  // keyboard (desktop): space/F fire, +/- zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (!g || screen !== "play") return;
      if (e.code === "Space" || e.key === "f") { e.preventDefault(); g.fire(); }
      if (e.key === "+" || e.key === "=") g.zoomStep(1);
      if (e.key === "-") g.zoomStep(-1);
      if (e.key === "Escape") g.closeScope();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // Scope controls: a tap on the field brings the scope up right there and it STAYS up.
  // Slide (as many times as you like) to aim; a quick tap outside the circle moves the scope
  // to that spot; the ✕ button lowers the rifle.
  const onDown = useCallback((e: React.PointerEvent) => {
    const g = gameRef.current;
    if (!g || screen !== "play" || aimPointer.current) return;
    const opened = !g.scoped;
    aimPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), opened };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (opened) { g.openScope(e.clientX, e.clientY); setScopeTip(Date.now()); }
  }, [screen]);
  const onMove = useCallback((e: React.PointerEvent) => {
    const p = aimPointer.current;
    if (!p || p.id !== e.pointerId) return;
    gameRef.current?.moveAim(e.clientX - p.x, e.clientY - p.y, e.timeStamp || performance.now());
    p.x = e.clientX; p.y = e.clientY;
  }, []);
  const onUp = useCallback((e: React.PointerEvent) => {
    const p = aimPointer.current;
    if (!p || p.id !== e.pointerId) return;
    aimPointer.current = null;
    const g = gameRef.current;
    // (use the last position we saw: some browsers report 0,0 on the lift)
    const tap = Math.hypot(p.x - p.sx, p.y - p.sy) < 10 && performance.now() - p.t < 650;
    if (g && g.scoped && tap && !p.opened && !g.insideScope(p.sx, p.sy)) g.jumpScope(p.sx, p.sy);
  }, []);
  const lower = (e: React.PointerEvent) => { e.stopPropagation(); e.preventDefault(); gameRef.current?.closeScope(); aimPointer.current = null; };

  const fire = (e: React.PointerEvent) => { e.stopPropagation(); e.preventDefault(); gameRef.current?.fire(); };
  const zoom = (dir: 1 | -1) => (e: React.PointerEvent) => { e.stopPropagation(); e.preventDefault(); gameRef.current?.zoomStep(dir); };

  const startHunt = () => {
    unlockAudio();
    startAmbience();
    gameRef.current?.startHunt();
    setSummary(null);
    setBanners([]);
    setScreen("play");
    // Android: full screen and hold landscape (iPhone Safari doesn't allow this; harmless there)
    try {
      const orient = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: "hide" })
        ?.then(() => orient?.lock?.("landscape"))
        .catch(() => {});
    } catch {}
  };

  return (
    <div className="game-root">
      <canvas ref={canvasRef} className="game-canvas" />
      <canvas ref={overlayRef} className="game-overlay" />

      {screen === "play" && (
        <div className="game-touch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="g-top">
            <button className="g-quit" onPointerDown={(e) => e.stopPropagation()} onClick={() => { if (gameRef.current) { gameRef.current.endAim(true); gameRef.current.paused = true; } setScreen("menu"); }} aria-label="Pause">❚❚</button>
            <button className="g-quit" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setMuted(!isMuted()); setMute(isMuted()); }} aria-label={mute ? "Sound on" : "Sound off"}>{mute ? "🔇" : "🔊"}</button>
            {showFsButton && <button className="g-quit" onPointerDown={(e) => e.stopPropagation()} onClick={toggleFullscreen} aria-label={isFs ? "Leave full screen" : "Full screen"}>{isFs ? "⤡" : "⛶"}</button>}
            {hud && <Ammo hud={hud} />}
            <div className="g-level" aria-label={`Level ${status.level}, ${status.strikes} of ${STRIKES} strikes`}>
              Level {status.level}
              <span className="g-strikes">{Array.from({ length: STRIKES }, (_, i) => <span key={i} className={i < status.strikes ? "on" : ""}>✕</span>)}</span>
            </div>
          </div>
          <div className="g-score" aria-label="Score">{score} <span>pts</span></div>
          <div className="g-banners" aria-live="polite">
            {banners.map((b) => (
              <div key={b.id} className={`g-banner ${b.tone}`}>
                <b>{b.title}</b>{b.points != null && <span className="g-pts">{b.points > 0 ? "+" : ""}{b.points}</span>}
                {b.detail && <div className="g-bd">{b.detail}</div>}
              </div>
            ))}
          </div>
          {!hud?.scoped && <div className="g-hint">Tap where you want to look through the scope.</div>}
          {hud?.scoped && tipNow - scopeTip < 5000 && <div className="g-hint">Slide to aim · tap another spot to move the scope · ✕ lowers the rifle</div>}
          <div className="g-right" onPointerDown={(e) => e.stopPropagation()}>
            {hud?.scoped && <button className="g-zoom g-lower" onPointerDown={lower} aria-label="Lower the rifle">✕</button>}
            <button className="g-zoom" onPointerDown={zoom(1)} aria-label="More magnification">+</button>
            <div className="g-power">{hud?.zoom ?? 8}×</div>
            <button className="g-zoom" onPointerDown={zoom(-1)} aria-label="Less magnification">−</button>
            <button className={`g-fire ${hud?.scoped && hud.chamber === "ready" ? "" : "off"}`} onPointerDown={fire} aria-label="Fire">
              {hud?.chamber === "cycling" ? "BOLT" : hud?.chamber === "reloading" ? "LOAD" : hud?.chamber === "empty" ? "EMPTY" : "FIRE"}
            </button>
          </div>
        </div>
      )}

      {screen === "menu" && (
        <div className="g-menu">
          <div className="g-card">
            <h1>Last Light</h1>
            <p className="g-sub">An old field in the bush, the last hour of daylight. Every buck you drop takes you up a level: farther out, moving faster, the light fading.
              <b> Three bucks that get away and you&apos;re out.</b></p>
            {error ? <p className="g-error">{error}</p> : (
              <>
                {hud && gameRef.current?.hunt && !gameRef.current.hunt.over && (
                  <button className="g-btn primary" onClick={() => { if (gameRef.current) gameRef.current.paused = false; setScreen("play"); }}>Back to the hunt</button>
                )}
                <button className={`g-btn ${gameRef.current?.hunt && !gameRef.current.hunt.over ? "" : "primary"}`} disabled={!ready} onClick={startHunt}>
                  {ready ? (gameRef.current?.hunt ? "Start a new hunt" : "Start the hunt") : `Building the woods… ${Math.round(progress.f * 100)}%`}
                </button>
              </>
            )}
            <div className="g-row">
              <button className="g-btn" onClick={() => setScreen("help")}>How to play</button>
              <button className="g-btn" onClick={() => setScreen("board")}>Leaderboard</button>
            </div>
            {showFsButton && <button className="g-btn" onClick={toggleFullscreen}>{isFs ? "Leave full screen" : "⛶ Full screen"}</button>}
            <a className="g-btn" href="/">Back to the map</a>
          </div>
        </div>
      )}

      {fsTip && (
        <div className="g-menu" onClick={() => setFsTip(false)}>
          <div className="g-card wide g-help" onClick={(e) => e.stopPropagation()}>
            <h1>Full screen on iPhone</h1>
            <p className="g-sub">iPhone&apos;s Safari doesn&apos;t let web pages go full screen. To play full screen, put the game on your home screen:</p>
            <ol>
              <li>Tap the <b>Share</b> button (the square with an arrow) at the bottom or top of Safari.</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
              <li>Open <b>Last Light</b> from your home screen. It opens without Safari&apos;s bars.</li>
            </ol>
            <p className="g-sub">The first time, it may ask for the party passcode again.</p>
            <button className="g-btn primary" onClick={() => setFsTip(false)}>Got it</button>
          </div>
        </div>
      )}

      {screen === "help" && <HowTo onClose={() => setScreen("menu")} />}
      {screen === "board" && <Board onClose={() => setScreen(summary ? "results" : "menu")} />}
      {screen === "results" && summary && (
        <Results summary={summary} onAgain={startHunt} onBoard={() => setScreen("board")} onMenu={() => setScreen("menu")} />
      )}

      {portrait && (
        <div className="g-rotate">
          <div className="g-rotate-phone" aria-hidden="true">📱</div>
          <p>Turn your phone sideways to play.</p>
        </div>
      )}
    </div>
  );
}

function Ammo({ hud }: { hud: Hud }) {
  const inMag = hud.chamber === "reloading" ? 0 : Math.max(0, hud.mag);
  return (
    <div className="g-ammo" aria-label={`${inMag} rounds in the rifle`}>
      {Array.from({ length: inMag }, (_, i) => <span key={`m${i}`} className="g-round" />)}
      {hud.chamber === "reloading" && <span className="g-spare">reloading…</span>}
    </div>
  );
}

function Results({ summary, onAgain, onBoard, onMenu }: { summary: HuntSummary; onAgain: () => void; onBoard: () => void; onMenu: () => void }) {
  const [name, setName] = useState(loadName);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [rank, setRank] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const save = useCallback(async (n: string) => {
    if (!n.trim()) return;
    setState("saving");
    saveName(n.trim());
    const res = await fetch("/api/game/scores", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n.trim(), score: summary.score, kills: summary.kills, shots: summary.shots, level: summary.level, best: summary.best }),
    }).catch(() => null);
    if (!res || !res.ok) { setState("error"); setMsg(res ? (await res.json().catch(() => ({}))).error ?? "Couldn't save" : "No connection"); return; }
    const j = await res.json();
    setRank(j.rank ?? null);
    setState("saved");
  }, [summary]);
  // save automatically when we already know the name
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && loadName()) { auto.current = true; save(loadName()); } }, [save]);

  return (
    <div className="g-menu">
      <div className="g-card wide">
        <h1>{summary.score} pts</h1>
        <p className="g-sub">Reached <b>level {summary.level}</b> · {summary.kills} {summary.kills === 1 ? "buck" : "bucks"} down · {summary.shots} {summary.shots === 1 ? "shot" : "shots"} fired</p>
        {summary.bucks.length === 0 ? <p className="g-sub">No bucks hit this time.</p> : (
          <div className="g-bucks">
            {summary.bucks.map((b) => (
              <div key={b.id} className={`g-buck ${b.status}`}>
                <div className="row between"><b>{b.antlerPoints}-point buck</b><b>{b.score > 0 ? "+" : ""}{b.score}</b></div>
                <div className="g-buck-body">
                  {b.marks && b.marks.length > 0 && <DeerDiagram marks={b.marks} />}
                  <div className="g-parts">
                    {b.parts.map((p, i) => <div key={i} className="row between g-part"><span>{p.label}</span><span>{p.pts > 0 ? "+" : ""}{p.pts}</span></div>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {state === "saved" ? <p className="g-sub">Saved to the party leaderboard{rank ? ` – you're #${rank}` : ""}.</p> : (
          <div className="g-save">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" maxLength={40} aria-label="Your first name" />
            <button className="g-btn primary" disabled={!name.trim() || state === "saving"} onClick={() => save(name)}>{state === "saving" ? "Saving…" : "Save score"}</button>
          </div>
        )}
        {state === "error" && <p className="g-error">{msg}</p>}
        <button className="g-btn primary" onClick={onAgain}>Hunt again</button>
        <div className="g-row">
          <button className="g-btn" onClick={onBoard}>Leaderboard</button>
          <button className="g-btn" onClick={onMenu}>Menu</button>
        </div>
      </div>
    </div>
  );
}

function Board({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<GameScore[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/game/scores").then((r) => r.json()).then((j) => setRows(j.scores ?? [])).catch(() => setErr("Couldn't load the leaderboard."));
  }, []);
  return (
    <div className="g-menu">
      <div className="g-card wide">
        <h1>Leaderboard</h1>
        {err && <p className="g-error">{err}</p>}
        {!rows && !err && <p className="g-sub">Loading…</p>}
        {rows && rows.length === 0 && <p className="g-sub">No scores yet. Be the first.</p>}
        {rows && rows.length > 0 && (
          <ol className="g-board">
            {rows.map((r) => (
              <li key={r.id}>
                <span className="g-bn">{r.name}</span>
                <span className="g-bk">level {r.level ?? "–"} · {r.kills} {r.kills === 1 ? "buck" : "bucks"}</span>
                <b>{r.score}</b>
              </li>
            ))}
          </ol>
        )}
        <button className="g-btn primary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function HowTo({ onClose }: { onClose: () => void }) {
  return (
    <div className="g-menu">
      <div className="g-card wide g-help">
        <h1>How to play</h1>
        <ul>
          <li><b>Look:</b> tap the spot you want to look at. The scope comes up right there and <b>stays up</b>.</li>
          <li><b>Aim:</b> slide your finger anywhere to move the crosshairs. Lift and slide again as often as you like. A quick swipe moves farther.</li>
          <li><b>Look somewhere else:</b> tap another spot outside the scope and it jumps there. The red <b>✕</b> lowers the rifle.</li>
          <li><b>Listen:</b> a grunt or a snapping stick means a buck is close. The sound comes from his side.</li>
          <li><b>Shoot:</b> with your other thumb, press the red <b>FIRE</b> button.</li>
          <li><b>Zoom:</b> <b>+</b> and <b>−</b> change the scope from 4× to 16×.</li>
          <li><b>Bullet drop:</b> the rifle is a .308 sighted in at 200 m. Farther than that, the bullet drops. Use the marks under the crosshair: <b>3</b> is for 300 m, <b>4</b> for 400 m, and so on.</li>
          <li><b>How far is he?</b> No rangefinder. Use the scale at the bottom left of the scope: put the buck's belly on the bottom line. The number his back touches is the distance in hundreds of metres.</li>
          <li><b>Moving bucks:</b> the bullet takes time to get there. Aim ahead of him. Each drop mark is as wide as the lead for a <b>walking</b> buck at that range. The dots are for a <b>trotting</b> buck.</li>
          <li><b>Where to hit:</b> behind the shoulder (heart and lungs) or the head scores best. Neck and spine drop him. Gut, rump and legs only wound. A wounded buck runs, so finish him or lose points.</li>
          <li><b>Score:</b> every buck down earns points, plus more for a better hit, a longer shot, a moving buck, a one-shot kill and a bigger rack.</li>
          <li><b>Levels:</b> the first buck is close and stands broadside. Every buck you drop takes you up a level: farther out, then walking, trotting and running, and the light fades.</li>
          <li><b>Strikes:</b> if a buck you shot at gets away (missed or wounded), that&apos;s a strike. Three strikes and the hunt is over. A buck you never shot at doesn&apos;t count.</li>
          <li>Ammunition is unlimited. The rifle holds 5; reloading takes a few seconds.</li>
          <li>The sun goes down as you climb the levels, so the far bucks are in dimmer light.</li>
          <li><b>⛶</b> makes the game full screen (on iPhone it shows how to add it to your home screen instead).</li>
        </ul>
        <button className="g-btn primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
