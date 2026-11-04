"use client";
// Plain-language instructions, opened from the ⓘ button in the top bar.

export default function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet help" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How to use Shot Tracker">
        <div className="row between help-head">
          <h2>How to use Shot Tracker</h2>
          <button className="lp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <section>
          <h3>First time only</h3>
          <ol>
            <li>Type in the party passcode.</li>
            <li>When your phone asks to use your <b>location</b>, tap <b>Allow</b>.</li>
            <li>On an iPhone, the first time you report a shot it asks about <b>motion &amp; orientation</b>. Tap <b>Allow</b>. That&apos;s the compass.</li>
            <li>Tip: put it on your home screen so it opens like an app.
              <br />iPhone: tap the Share button (square with an arrow), then <b>Add to Home Screen</b>.
              <br />Android: tap the ⋮ menu, then <b>Add to Home screen</b>.</li>
          </ol>
        </section>

        <section>
          <h3>🔊 You heard a shot</h3>
          <ol>
            <li>Tap the orange <b>Heard a shot</b> button right away. The time is saved the moment you tap it.</li>
            <li>Hold the phone <b>flat</b>, like a plate, and point the <b>top of the phone</b> where the sound came from.</li>
            <li>A red line on the map shows where you&apos;re pointing. Turn until it lines up.</li>
            <li>Tap the big green <b>REGISTER SHOT</b> button. Done.</li>
          </ol>
          <p className="help-note">Keep the phone away from your rifle. Metal throws the compass off.
            If the compass acts up, tap <b>Enter manually</b> and type the direction from a regular compass.</p>
        </section>

        <section>
          <h3>Reading the shot lines</h3>
          <ul>
            <li>Each person who heard the shot gets a dashed line from where they were standing.</li>
            <li>Where the lines meet there&apos;s a <b>circled number</b>. That&apos;s the best guess of where the shot came from.
              The shaded patch around it is where it most likely was.</li>
            <li>It needs <b>at least 2 people</b> to report the same shot. 3 or more is better.</li>
            <li>A <b>grey</b> line didn&apos;t match the others, so it isn&apos;t counted.</li>
            <li>Sound echoes off hills and lakes. Treat the spot as a place to start looking, not a sure thing.</li>
          </ul>
        </section>

        <section>
          <h3>🦌 You saw a deer</h3>
          <ol>
            <li>Tap the brown <b>Deer</b> button.</li>
            <li>Pick <b>Buck, Doe, Fawn</b> or <b>Not sure</b>, and how many.</li>
            <li><b>Where is the deer?</b> Choose <b>Where I am</b>, or <b>Pick on map</b> if it was across the way.
              With Pick on map, slide the map until the crosshair is on the spot, then tap <b>Use this spot</b>.</li>
            <li><b>Which way was it going?</b> The easiest is <b>On map</b>: slide the map the way the deer went.
              Or pick <b>Not moving</b>.</li>
            <li>Tap <b>Send report</b>.</li>
          </ol>
        </section>

        <section>
          <h3>🍂 You found deer sign</h3>
          <ol>
            <li>Tap the purple <b>Sign</b> button.</li>
            <li>Pick what you found: scrape, rub, droppings, tracks or a bed.</li>
            <li>Stand at the sign, or use <b>Pick on map</b>. Then tap <b>Send report</b>.</li>
          </ol>
        </section>

        <section>
          <h3>🟧 Marking your blind or stand</h3>
          <ol>
            <li>Tap the orange <b>Add blind</b> button (top left of the map).</li>
            <li>Give it a name, like &ldquo;Cedar ridge&rdquo;, and pick the type.</li>
            <li>Stand at it, or use <b>Pick on map</b>. Then tap <b>Send report</b>.</li>
          </ol>
        </section>

        <section>
          <h3>Getting around the map</h3>
          <ul>
            <li><b>Move</b> the map by sliding one finger. <b>Zoom</b> by pinching with two fingers.</li>
            <li><b>Tap anything</b> on the map (a deer, a blind, a shot) to see details.</li>
            <li><b>Blue dot</b> = you. The small black arrow shows which way your phone is facing.</li>
            <li><b>📍</b> brings the map back to you.</li>
            <li><b>📏 Ruler</b>: tap it, then tap two or more spots (or blinds) to measure the distance. Tap <b>Done</b> when finished.</li>
            <li>The <b>stack-of-paper</b> button (top right) switches to a satellite photo and back.</li>
            <li><b>☰ Layers</b> (top right): tap the big colored buttons to hide or show shots, deer, sign or blinds.
              Below that is a list. Tap any line in the list to jump to it on the map.</li>
            <li><b>🔕 / 🔔</b> turns on a beep when someone else reports something. It&apos;s off by default so it won&apos;t spook deer.</li>
          </ul>
        </section>

        <section>
          <h3>🦌 The hunting game (Last Light)</h3>
          <ul>
            <li>Tap the <b>🦌</b> at the top left to open the game. Turn your phone <b>sideways</b>.</li>
            <li><b>Tap</b> where you want to look: the scope comes up there and stays up. <b>Slide</b> your finger to aim, then press the red <b>FIRE</b> button with your other thumb. The red <b>✕</b> lowers the rifle.</li>
            <li>The first buck is close and easy. Every buck you drop takes you up a <b>level</b>: farther out and moving faster. If <b>3 bucks</b> you shot at get away, the hunt is over.</li>
            <li><b>⛶</b> makes it full screen. On iPhone, add the game to your home screen for full screen.</li>
            <li>The <b>How to play</b> button in the game explains the scope marks. Scores go on the party leaderboard.</li>
          </ul>
        </section>

        <section>
          <h3>If something looks wrong</h3>
          <ul>
            <li>Pull down on the page, or close and reopen it, to get the latest version.</li>
            <li>If the compass seems off, wave the phone slowly in a figure 8 a few times.</li>
            <li>No signal? Reports can&apos;t be sent until you have signal again.</li>
          </ul>
        </section>

        <section className="help-danger">
          <h3>Deleting and clearing (be careful)</h3>
          <ul>
            <li>Anything you delete is gone <b>for everyone</b> in the party, and can&apos;t be brought back.</li>
            <li><b>One mistake:</b> tap it on the map and press <b>🗑 Delete</b>.</li>
            <li><b>Clear everything of one kind</b> (for example all shots): open <b>☰ Layers</b>, choose the tab,
              tap <b>Edit</b>, then scroll to the bottom for the <b>Clear all</b> button.</li>
          </ul>
        </section>

        <button className="btn primary big" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
