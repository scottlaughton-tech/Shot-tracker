import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import GameShell from "@/game/ui/GameShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Last Light – Shot Tracker" };
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: "#000000",
};

export default async function GamePage() {
  if (!(await isAuthed())) redirect("/login");
  return <GameShell />;
}
