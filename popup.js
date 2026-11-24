// GESTURES comes from gestures.js, which popup.html loads before this file.
// The live camera feed itself now lives in its own window (camera.html) —
// this popup is just the Start/Stop switch and a readout of what's happening.
const toggleBtn = document.getElementById("toggle");
const gestureEl = document.getElementById("gesture");
const errorEl   = document.getElementById("error");
const diagEl    = document.getElementById("diag");
const legendEl  = document.querySelector(".legend");

// Build the legend from the GESTURES table — adding a gesture there is enough.
const LABELS = Object.fromEntries(GESTURES.map((g) => [g.name, g.label]));
legendEl.replaceChildren(
  ...GESTURES.map((g) => {
    const span = document.createElement("span");
    span.textContent = g.label;
    return span;
  })
);

let running = false;

function ask(type, extra) {
  return chrome.runtime.sendMessage({ target: "background", type, ...extra });
}

function renderError(text) {
  // The camera now belongs to the page being controlled, so a refusal is that
  // site's permission — fixable from its own address-bar camera icon.
  if (/NotAllowedError/i.test(text || "") || /Permission dismissed/i.test(text || "")) {
    errorEl.textContent =
      "This site blocked the camera. Click the camera icon in the address bar, " +
      "choose Allow, then reload the page.";
    return;
  }
  // OS-level block: no browser-side setting can help.
  if (/by system/i.test(text || "")) {
    errorEl.textContent =
      "Blocked by the operating system. Windows: Settings → Privacy & security → " +
      "Camera → turn on 'Camera access', then restart Chrome.";
    return;
  }
  errorEl.textContent = text || "";
}

// Poll the camera window for diagnostic info while running.
let pollTimer = null;
function pollDiag() {
  ask("diag")
    .then((s) => {
      diagEl.textContent = s ? `video:${s.w}x${s.h}` : "camera window: no reply";
    })
    .catch((e) => {
      diagEl.textContent = `camera window: ${e.message}`;
    });
}

function renderRunning(on) {
  running = on;
  toggleBtn.disabled = false;
  toggleBtn.textContent = on ? "Stop" : "Start";
  toggleBtn.classList.toggle("on", on);
  if (!on) gestureEl.textContent = "";

  clearInterval(pollTimer);
  pollTimer = null;
  diagEl.textContent = "";
  if (on) {
    pollDiag();
    pollTimer = setInterval(pollDiag, 1000);
  }
}

toggleBtn.addEventListener("click", async () => {
  toggleBtn.disabled = true;
  toggleBtn.textContent = running ? "Stopping…" : "Starting…";
  renderError("");

  if (running) {
    await ask("stop");
    renderRunning(false);
    return;
  }

  const res = await ask("start");
  if (res?.ok) {
    renderRunning(true);
  } else {
    renderRunning(false);
    renderError(res ? `${res.name}: ${res.message}` : "Background did not respond.");
  }
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.gesture) gestureEl.textContent = LABELS[changes.gesture.newValue] || "";
  if (changes.error)   renderError(changes.error.newValue);
  // Catches the camera stopping itself (e.g. the 10s idle auto-stop) so the
  // button doesn't keep saying "Stop" after the camera has actually turned off.
  if (changes.running && changes.running.newValue !== running) {
    renderRunning(changes.running.newValue);
  }
});

// Read current state on open.
// Wrap in a timeout: MV3 service workers can go idle and take time to wake.
// Without a timeout the promise may hang indefinitely, leaving the button
// stuck on "..." and disabled — which is the bug seen in the screenshot.
const statusTimeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error("Timeout")), 3000)
);

Promise.race([ask("status"), statusTimeout])
  .then((s) => {
    renderRunning(!!s?.running);
    gestureEl.textContent = LABELS[s?.gesture] || "";
    renderError(s?.error);
  })
  .catch(() => {
    // Service worker was asleep or unreachable — safe default: show Start button.
    renderRunning(false);
  });
