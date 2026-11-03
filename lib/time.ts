// Shared date/time wording.

/** "just now", "12 min ago", "3 h 5 min ago", "1 day ago", "4 days ago" */
export function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${m % 60} min ago` : `${h} h ago`;
  }
  const d = Math.floor(m / (24 * 60));
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** "Today 11:30 AM", "Yesterday 11:30 AM", or "Mon Nov 2, 11:30 AM" */
export function when(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ms >= startOfToday) return `Today ${time}`;
  if (ms >= startOfToday - 86400000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}
