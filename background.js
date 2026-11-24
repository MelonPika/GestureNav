// background.js — service worker. The camera and MediaPipe now run in
// camera.html, a small REAL browser window opened with chrome.windows.create
// — not inside the page being controlled, and not an invisible offscreen
// document either. The user sees the camera window directly (so the native
// permission prompt and the live preview both just work), and this script's
// only job is to relay the gesture camera.js already decided on over to
// whichever tab is active in the OTHER window.

const CAMERA_URL = "camera.html";
const CAMERA_WIDTH = 300;
const CAMERA_HEIGHT = 320;

// Extensions cannot be injected into chrome://, the New Tab page or the Web
// Store, so there is nothing to apply a page action to there.
const INJECTABLE = /^https?:/;

const setState = (patch) => chrome.storage.session.set(patch);

async function getCameraWindowId() {
  const { cameraWindowId } = await chrome.storage.session.get("cameraWindowId");
  if (!cameraWindowId) return null;
  try {
    await chrome.windows.get(cameraWindowId); // throws if it no longer exists
    return cameraWindowId;
  } catch {
    await setState({ cameraWindowId: null });
    return null;
  }
}

async function openCameraWindow() {
  const existing = await getCameraWindowId();
  if (existing) {
    await chrome.windows.update(existing, { focused: true });
    return existing;
  }
  const win = await chrome.windows.create({
    url: CAMERA_URL,
    type: "popup",
    width: CAMERA_WIDTH,
    height: CAMERA_HEIGHT,
    focused: true
  });
  await setState({ cameraWindowId: win.id });
  return win.id;
}

async function closeCameraWindow() {
  const id = await getCameraWindowId();
  if (id) await chrome.windows.remove(id).catch(() => {});
  await setState({ cameraWindowId: null });
}

async function askCamera(type, extra) {
  return chrome.runtime.sendMessage({ target: "camera", type, ...extra });
}

async function activeTab() {
  // Exclude the camera's own popup window — the user controls whichever
  // normal browser window they're actually looking at, not this one.
  const camId = await getCameraWindowId();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab && tab.windowId !== camId) return tab;

  const all = await chrome.tabs.query({ active: true });
  return all.find((t) => t.windowId !== camId) || tab;
}

async function askContent(tabId, type, extra) {
  return chrome.tabs.sendMessage(tabId, { target: "content", type, ...extra });
}

// Re-checks which tab the extension would currently control and writes it to
// storage purely so the camera window can show "Linked to: <page title>".
// forwardGesture() always looks this up fresh on its own anyway — this is
// only for the on-screen confirmation, so switching tabs or reloading the
// page updates the label right away instead of only on the next gesture.
async function refreshLinkedTab() {
  const tab = await activeTab();
  if (tab && INJECTABLE.test(tab.url || "")) {
    await setState({ linkedTitle: tab.title || tab.url, linkedUrl: tab.url });
  } else {
    await setState({ linkedTitle: "", linkedUrl: "" });
  }
}

// ------------------------------------------------------------------- start/stop

async function start() {
  await setState({ error: null });
  try {
    await openCameraWindow();
  } catch (e) {
    const message = "Could not open the camera window — try again.";
    await setState({ running: false, error: message });
    return { ok: false, name: "NoCameraWindow", message };
  }
  await refreshLinkedTab();
  // camera.js reports its own "running"/"error" once the camera + model are
  // actually ready (popup.js listens for that via storage.session), so this
  // just confirms the window opened.
  return { ok: true };
}

async function stop() {
  await closeCameraWindow();
  await setState({ running: false, gesture: "" });
  return { ok: true };
}

async function status() {
  const stored = await chrome.storage.session.get(["gesture", "error"]);
  const id = await getCameraWindowId();
  if (!id) return { running: false, ...stored };
  const live = await askCamera("status").catch(() => null);
  return { running: live?.running === true, ...stored, ...live };
}

// ---------------------------------------------------------------- dispatch

async function forwardGesture(gesture, action) {
  await setState({ gesture });
  if (!action) return;

  // Every gesture now maps to a scroll or zoom action, which content.js
  // performs on the page — hand it to whichever (non-camera) window's
  // active tab the user is actually looking at right now.
  const tab = await activeTab();
  if (!tab?.id || !INJECTABLE.test(tab.url || "")) return;
  await askContent(tab.id, "gesture", { gesture, action }).catch(() => {
    setState({ error: "Reload this page once for the extension to reach it." });
  });
}

// ---------------------------------------------------------------- message hub

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "background") return;
  (async () => {
    switch (msg.type) {
      case "start":
        sendResponse(await start());
        break;
      case "stop":
        sendResponse(await stop());
        break;
      case "status":
        // Wrap in try/catch — the service worker may have just woken up. Without
        // this the sendResponse never fires and the popup button sticks on "...".
        try {
          sendResponse(await status());
        } catch {
          sendResponse({ running: false });
        }
        break;
      case "diag":
        sendResponse(await askCamera("status").catch(() => null));
        break;
      case "gesture":
        await forwardGesture(msg.gesture, msg.action);
        sendResponse({ ok: true });
        break;
      case "running":
        await setState({ running: msg.running });
        sendResponse({ ok: true });
        break;
      case "error":
        await setState({ error: `${msg.name}: ${msg.message}`, running: false });
        sendResponse({ ok: true });
        break;
    }
  })();
  return true; // keep message channel open for async sendResponse
});

// The user closed the camera window directly (its own X button) — drop the
// state that says it's still running.
chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.session.get("cameraWindowId");
  if (stored.cameraWindowId === windowId) {
    await setState({ running: false, gesture: "", cameraWindowId: null });
  }
});

// Keep "Linked to: <page>" current with zero effort from the user — switch
// tabs, switch windows, or just reload the current page, and this fires.
chrome.tabs.onActivated.addListener(() => refreshLinkedTab());
chrome.windows.onFocusChanged.addListener(() => refreshLinkedTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // "complete" covers a plain reload; a title change covers client-side
  // navigation (SPAs) that never fires a fresh "complete" status.
  if (changeInfo.status === "complete" || changeInfo.title) refreshLinkedTab();
});

// Clean up session state on extension reload or install.
chrome.runtime.onStartup.addListener(() => chrome.storage.session.clear());
chrome.runtime.onInstalled.addListener(() => chrome.storage.session.clear());
