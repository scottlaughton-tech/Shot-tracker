# Shot Tracker – notes for Claude

Read **docs/DEVELOPER.md** first: architecture, data model, API, triangulation, compass handling,
design decisions, known limitations and the backlog are all there. User-facing docs: README.md and
the in-app help in `components/HelpSheet.tsx`; keep both in sync with user-visible changes.

## Working rules
- The owner is a novice: explain changes in plain language and ask when a choice is genuinely theirs.
- Pushing to `main` deploys to production on Vercel (https://shot-tracker-henna-beta.vercel.app).
  Only push work that passes the checks below; tell the user to reload the page afterwards.
- Before pushing: `npm test`, `npx tsc --noEmit -p .`, `npm run build`.
- For UI changes, run a production server and check it with Playwright at phone size
  (see "Running and checking changes" in docs/DEVELOPER.md). Map tiles are blocked in the cloud sandbox.
- Don't run `pkill -f next-server` in the same shell command as other steps: it ends that command
  (exit 144). Run it on its own.
- Keep all styling in `app/globals.css`, in its commented sections.
- Triangulation changes must keep `lib/geo.test.ts` passing; add a test for any new behavior.
- Anything that changes how bearings are converted (magnetic/true) needs extra care: it silently
  moves every line on the map.
