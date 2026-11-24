BEFORE LOADING THIS EXTENSION, download these 4 files manually (already
included in this folder if you got it from Cai Sheng — only needed if you're
building from scratch):

1. vision_bundle.mjs
   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs
   → Save as: vision_bundle.mjs (in root folder)

2. wasm/vision_wasm_internal.js
   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.js
   → Save as: wasm/vision_wasm_internal.js

3. wasm/vision_wasm_internal.wasm
   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm/vision_wasm_internal.wasm
   → Save as: wasm/vision_wasm_internal.wasm

4. hand_landmarker.task
   https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
   → Save as: hand_landmarker.task (in root folder)

WORKSHOP: students only edit gestures.js. It holds the 21-landmark map, the
helpers that turn landmarks into plain finger booleans, and the GESTURES table.
Adding one entry there is enough — the popup legend, the camera window's live
label and the dispatched action all read from that same table. content.js
lists the actions a gesture is allowed to trigger.

Final folder structure:
mediapipe_code/
├── manifest.json
├── gestures.js              ← THE FILE STUDENTS EDIT (landmarks + rules)
├── popup.html / popup.js    toolbar popup: just the Start/Stop switch
├── camera.html / camera.js  the camera window: camera + MediaPipe + live preview
├── background.js            opens/owns the camera window, relays gestures to the active tab
├── content.js                performs the scroll/zoom in the page
├── vision_bundle.mjs        ← download this
├── hand_landmarker.task     ← download this
└── wasm/
    ├── vision_wasm_internal.js    ← download this
    └── vision_wasm_internal.wasm  ← download this

Then load unpacked in chrome://extensions

FIRST RUN: click the toolbar icon and press Start. This opens a small, REAL
camera window (camera.html) — Chrome will show its normal "Allow camera?"
prompt right there, because this is a visible window, not a hidden one. Choose
"Allow on every visit" so you don't get asked again. That's it — no separate
permission page needed.

HOW IT WORKS: the camera + MediaPipe model run entirely inside that small
camera window, which belongs to the extension itself. It shows you the live
feed and detected gesture directly, so you can see exactly what the detector
is seeing. Every ~66ms it decides on a gesture and sends just the gesture name
+ action to background.js, which relays that one message to whichever normal
browser window/tab you're actually looking at. content.js there performs the
scroll/zoom/etc.

WHY A SEPARATE WINDOW INSTEAD OF INJECTING INTO THE PAGE: MediaPipe used to
run inside the controlled page itself (the old page-world.js, injected into
the page's MAIN world). That broke on any site with a strict Content-Security-
Policy or Trusted Types (banking sites, Google, YouTube, school/government
portals). Because the camera window is its own extension page, it never
touches the target page's DOM or its CSP at all — only the already-decided
gesture name crosses over, via a plain chrome.tabs.sendMessage to content.js.
So the extension now works on every https:// page, no exceptions, and you get
a visible camera window to debug gestures with as a bonus.
