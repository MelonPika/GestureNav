// camera.js — runs inside camera.html, a small REAL browser window (opened by
// background.js via chrome.windows.create). Unlike an invisible offscreen
// document, a real window can show Chrome's native camera-permission prompt
// itself, so there is no separate permission.html dance anymore: just load
// this window and answer the prompt once.
//
// This window owns the camera and the MediaPipe model. It detects the
// gesture, draws the live preview + landmarks for the user to see, and sends
// only the finished gesture name + action to background.js, which relays it
// to whichever tab is active in the OTHER (big) window.

const video     = document.getElementById("video");
const lmCanvas  = document.getElementById("landmarks");
const lmCtx     = lmCanvas.getContext("2d");
const badge     = document.getElementById("badge");
const statusMsg = document.getElementById("statusMsg");
const linkedMsg = document.getElementById("linkedMsg");
const stopBtn   = document.getElementById("stopBtn");
const legendEl  = document.querySelector(".legend");

// Shows which page gestures are currently being sent to. background.js keeps
// this current on its own — switch tabs, switch windows, or just reload the
// page you're on, and this updates with no extra steps from you.
function renderLinked(title) {
  linkedMsg.textContent = title ? `Linked to: ${title}` : "";
}
chrome.storage.session.get("linkedTitle").then((s) => renderLinked(s.linkedTitle));
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.linkedTitle) renderLinked(changes.linkedTitle.newValue);
});

// Build the legend from the GESTURES table, same as popup.html used to.
legendEl.replaceChildren(
  ...GESTURES.map((g) => {
    const span = document.createElement("span");
    span.textContent = g.label;
    return span;
  })
);

const STEP_MS = 66;       // ~15 fps detection loop
const REPEAT_MS = 500;    // once confirmed, how often a still-held gesture re-fires
const CONFIRM_MS = 2000;  // a NEW gesture must hold steady this long before it fires at all

let stream = null;
let landmarker = null;
let running = false;

let lastGesture = "";
let lastFireAt = 0;
let recentGesture = ""; // the last gesture actually fired — repeating it skips the hold

function report(type, payload) {
  chrome.runtime.sendMessage({ target: "background", type, ...payload }).catch(() => {});
}

async function loadModel() {
  if (landmarker) return landmarker;
  const { HandLandmarker, FilesetResolver } = await import(
    chrome.runtime.getURL("vision_bundle.mjs")
  );
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("wasm/"));
  landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: chrome.runtime.getURL("hand_landmarker.task"),
      delegate: "GPU" // a real, rendered window can use the GPU delegate reliably
    },
    runningMode: "VIDEO",
    numHands: 1
  });
  return landmarker;
}

// A NEW gesture must be held steady for CONFIRM_MS before it is allowed to
// fire at all — a brief accidental pose while reaching for your mouse should
// never trigger anything. "NONE" is exempt (dropping back to no-gesture is
// always instant), and so is repeating the gesture you most recently used —
// if you just scrolled with a fist and let go, doing the fist again right
// away does not need to be re-confirmed. Only a genuinely DIFFERENT gesture
// has to wait out the hold.
let candidate = "";
let candidateSince = 0;
function stabilize(raw, now) {
  if (raw !== candidate) {
    candidate = raw;
    candidateSince = now;
  }
  if (candidate === "NONE" || candidate === recentGesture) {
    return { settled: candidate, remainingMs: 0 };
  }
  const held = now - candidateSince;
  if (held >= CONFIRM_MS) {
    return { settled: candidate, remainingMs: 0 };
  }
  return { settled: null, remainingMs: CONFIRM_MS - held };
}

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

function drawLandmarks(lm) {
  const w = lmCanvas.width, h = lmCanvas.height;
  lmCtx.clearRect(0, 0, w, h);
  if (!lm) return;
  lmCtx.strokeStyle = "rgba(66,133,244,.85)";
  lmCtx.lineWidth = 1.5;
  for (const [a, b] of CONNECTIONS) {
    lmCtx.beginPath();
    lmCtx.moveTo(lm[a].x * w, lm[a].y * h);
    lmCtx.lineTo(lm[b].x * w, lm[b].y * h);
    lmCtx.stroke();
  }
  lmCtx.fillStyle = "#00FF88";
  for (const pt of lm) {
    lmCtx.beginPath();
    lmCtx.arc(pt.x * w, pt.y * h, 2.5, 0, Math.PI * 2);
    lmCtx.fill();
  }
}

function setBadge(text, active) {
  badge.textContent = text;
  badge.classList.toggle("active", !!active);
}

function step() {
  if (!running) return;
  const now = performance.now();

  if (video.readyState >= 2 && video.videoWidth > 0) {
    const result = landmarker.detectForVideo(video, now);
    const hasHand = result.landmarks?.length > 0;
    const match = hasHand ? detectGesture(result.landmarks[0]) : null;
    const { settled, remainingMs } = stabilize(match ? match.name : "NONE", now);

    drawLandmarks(hasHand ? result.landmarks[0] : null);

    if (match && remainingMs > 0) {
      // Still counting down to confirmation — show it, but don't act on it yet.
      setBadge(`${match.label} — hold ${Math.ceil(remainingMs / 1000)}s`, false);
    } else {
      setBadge(hasHand ? (match ? `${match.label} ✓` : "Hand detected") : "No hand", !!match);
    }

    if (settled === null) {
      // The pose has not been held for CONFIRM_MS yet — say nothing to the page.
    } else if (settled === "NONE") {
      if (lastGesture !== "") {
        lastGesture = "";
        report("gesture", { gesture: "NONE" });
      }
    } else if (settled !== lastGesture || now - lastFireAt > REPEAT_MS) {
      lastGesture = settled;
      recentGesture = settled;
      lastFireAt = now;
      report("gesture", { gesture: settled, action: match.action });
    }
  }

  requestAnimationFrame(step);
}

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (e) {
    statusMsg.textContent = `${e.name}: ${e.message}`;
    report("error", { name: e.name, message: e.message });
    return;
  }

  video.srcObject = stream;
  await video.play();
  lmCanvas.width = video.videoWidth || 236;
  lmCanvas.height = video.videoHeight || 177;

  statusMsg.textContent = "Loading hand-tracking model…";
  try {
    await loadModel();
  } catch (e) {
    statusMsg.textContent = `${e.name}: ${e.message}`;
    report("error", { name: e.name, message: e.message });
    return;
  }

  running = true;
  statusMsg.textContent = "Controlling the other window";
  report("running", { running: true });
  step();
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  lastGesture = "";
  report("running", { running: false });
}

stopBtn.addEventListener("click", () => {
  stop();
  window.close();
});

// Closing this window (the user's own X button) must release the camera too.
window.addEventListener("pagehide", stop);

// Let background.js ask for a quick status readout (used by popup.html's diag line).
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "camera") return;
  if (msg.type === "status") {
    sendResponse({
      running,
      w: video.videoWidth,
      h: video.videoHeight
    });
  }
});

start();
