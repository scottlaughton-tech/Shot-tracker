"use client";
// Screens and touch controls for the hunting game. The 3D engine lives in game/engine.
//  - one finger anywhere (not on a button) = scope up, slide to aim, lift to lower the rifle
//  - FIRE button (right thumb) shoots, + / − change magnification
import { useCallback, useEffect, useRef, useState } from "react";
import type { Game, Hud } from "../engine/Game";
import type { Banner, HuntSummary } from "../engine/Hunt";
import type { GameScore } from "@/lib/store";
import { isMuted, setMuted, startAmbience, unlockAudio } from "../engine/audio";

type Screen = "menu" | "play" | "results" | "board" | "help";

function loadName() { try { return localStorage.getItem("st:name") ?? ""; } catch { return ""; } }
function saveName(v: string) { try { localStorage.setItem("st:name", v); } catch {} }

export default function GameRoot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const aimPointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [progress, setProgress] = useState<{ f: number; label: string }>({ f: 0, label: "Starting" });
  const [ready, setReady] = useState(false);
  const [hud, setHud] = useState<Hud | null>(null);
  const [score, setScore] = useState(0);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [summary, setSummary] = useState<HuntSummary | null>(null);
  const [portrait, setPortrait] = useState(false);
  const [error, setError] = useState("");
  const [mute, setMute] = useState(false);

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
          end: (s) => { setSummary(s); setScreen("results"); aimPointer.current = null; },
        });
        gameRef.current = game;
        if (location.search.includes("debug")) (window as unknown as { __game: Game }).__game = game;
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
    const stop = (e: Event) => e.preventDefault(); // iOS pinch-zoom
    document.addEventListener("gesturestart", stop);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
      document.removeEventListener("gesturestart", stop);
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  const onDown = useCallback((e: React.PointerEvent) => {
    const g = gameRef.current;
    if (!g || screen !== "play" || aimPointer.current) return;
    aimPointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    g.beginAim(e.clientX, e.clientY);
  }, [screen]);
  const onMove = useCallback((e: React.PointerEvent) => {
    const p = aimPointer.current;
    if (!p || p.id !== e.pointerId) return;
    gameRef.current?.moveAim(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
  }, []);
  const onUp = useCallback((e: React.PointerEvent) => {
    const p = aimPointer.current;
    if (!p || p.id !== e.pointerId) return;
    aimPointer.current = null;
    gameRef.current?.endAim();
  }, []);

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
            <button className="g-quit" onPointerDown={(e) => e.stopPropagation()} onClick={() => setScreen("menu")} aria-label="Pause">❚❚</button>
            <button className="g-quit" onPointerDown={(e) => e.stopPropagation()} onClick={() => { setMuted(!isMuted()); setMute(isMuted()); }} aria-label={mute ? "Sound on" : "Sound off"}>{mute ? "🔇" : "🔊"}</button>
            {hud && <Ammo hud={hud} />}
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
          {!hud?.scoped && <div className="g-hint">Touch and hold where you want to look. Slide to aim.</div>}
          <div className="g-right" onPointerDown={(e) => e.stopPropagation()}>
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
            <p className="g-sub">An old field in the bush, the last hour of daylight. Bucks are moving. You have <b>10 rounds</b>.</p>
            {error ? <p className="g-error">{error}</p> : (
              <>
                {hud && gameRef.current?.hunt && !gameRef.current.hunt.over && (
                  <button className="g-btn primary" onClick={() => setScreen("play")}>Back to the hunt</button>
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
            <a className="g-btn" href="/">Back to the map</a>
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
  const spare = hud.rounds - inMag;
  return (
    <div className="g-ammo" aria-label={`${hud.rounds} rounds left`}>
      {Array.from({ length: inMag }, (_, i) => <span key={`m${i}`} className="g-round" />)}
      {spare > 0 && <span className="g-spare">+{spare}</span>}
      {hud.chamber === "reloading" && <span className="g-spare">reloading…</span>}
      {hud.rounds === 0 && <span className="g-spare">empty</span>}
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
      body: JSON.stringify({ name: n.trim(), score: summary.score, kills: summary.kills, shots: summary.shots, best: summary.best }),
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
        <p className="g-sub">{summary.kills} {summary.kills === 1 ? "buck" : "bucks"} down · {summary.shots} {summary.shots === 1 ? "shot" : "shots"} fired</p>
        {summary.bucks.length === 0 ? <p className="g-sub">No bucks hit this time.</p> : (
          <div className="g-bucks">
            {summary.bucks.map((b) => (
              <div key={b.id} className={`g-buck ${b.status}`}>
                <div className="row between"><b>{b.antlerPoints}-point buck</b><b>{b.score > 0 ? "+" : ""}{b.score}</b></div>
                {b.parts.map((p, i) => <div key={i} className="row between g-part"><span>{p.label}</span><span>{p.pts > 0 ? "+" : ""}{p.pts}</span></div>)}
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
                <span className="g-bk">{r.kills} {r.kills === 1 ? "buck" : "bucks"}</span>
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
          <li><b>Look:</b> touch and hold anywhere to bring up the scope. Slide your finger to aim. Lift it to lower the rifle.</li>
          <li><b>Shoot:</b> with your other thumb, press the red <b>FIRE</b> button.</li>
          <li><b>Zoom:</b> <b>+</b> and <b>−</b> change the scope from 4× to 16×.</li>
          <li><b>Bullet drop:</b> the rifle is a .308 sighted in at 200 m. Farther than that, the bullet drops. Use the marks under the crosshair: <b>3</b> is for 300 m, <b>4</b> for 400 m, and so on.</li>
          <li><b>How far is he?</b> No rangefinder. Use the scale at the bottom left of the scope: put the buck's belly on the bottom line. The number his back touches is the distance in hundreds of metres.</li>
          <li><b>Moving bucks:</b> the bullet takes time to get there. Aim ahead of him. Each drop mark is as wide as the lead for a <b>walking</b> buck at that range. The dots are for a <b>trotting</b> buck.</li>
          <li><b>Where to hit:</b> behind the shoulder (heart and lungs) or the head scores best. Neck and spine drop him. Gut, rump and legs only wound. A wounded buck runs, so finish him or lose points.</li>
          <li><b>Score:</b> every buck down earns points, plus more for a better hit, a longer shot, a moving buck, a one-shot kill and a bigger rack.</li>
          <li>You have <b>10 rounds</b>: 5 in the rifle and 5 more. Reloading takes a few seconds.</li>
        </ul>
        <button className="g-btn primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
