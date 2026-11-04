import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import GameShell from "@/game/ui/GameShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Last Light – Shot Tracker",
  // "Add to Home Screen" on iPhone opens the game full screen, without Safari's bars
  appleWebApp: { capable: true, title: "Last Light", statusBarStyle: "black-translucent" },
  other: { "apple-mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: "#000000",
};

export default async function GamePage() {
  if (!(await isAuthed())) redirect("/login?next=/game");
  return <GameShell />;
}
