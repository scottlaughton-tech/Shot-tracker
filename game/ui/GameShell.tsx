"use client";
// Loads the game only in the browser (three.js and WebGL don't exist on the server).
import dynamic from "next/dynamic";

const GameRoot = dynamic(() => import("./GameRoot"), {
  ssr: false,
  loading: () => <div className="game-root game-loading-screen"><p>Loading…</p></div>,
});

export default function GameShell() {
  return <GameRoot />;
}
