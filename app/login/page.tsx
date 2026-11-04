import { redirect } from "next/navigation";
import { authMode, isAuthed } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  if (await isAuthed()) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  const mode = authMode();
  return (
    <main className="center-page">
      <div className="card">
        <h1>🦌 Shot Tracker</h1>
        {mode === "missing" ? (
          <p className="error">
            This site has no party passcode yet. In Vercel, open the project → Settings → Environment
            Variables, add <code>PARTY_PASSCODE</code>, then redeploy.
          </p>
        ) : (
          <LoginForm />
        )}
      </div>
    </main>
  );
}
