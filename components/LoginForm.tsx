"use client";
import { useState } from "react";

export default function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (res.ok) window.location.href = "/";
    else setError("That passcode isn't right.");
  }

  return (
    <form onSubmit={submit} className="stack">
      <label>
        Party passcode
        <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoCapitalize="none"
          autoComplete="off" placeholder="Ask your party leader" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy || !code}>{busy ? "Checking…" : "Enter"}</button>
    </form>
  );
}
