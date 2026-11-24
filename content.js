// ===========================================================================
//  WHAT A GESTURE CAN DO TO THE PAGE
// ===========================================================================
//
//  Every name in the ACTIONS list below can be used as the "action" of a
//  gesture in gestures.js. Add your own by writing one more entry.
//
// ---------------------------------------------------------------------------

// How much each step changes things. Make them bigger for a stronger reaction.
var SCROLL_STEP = 200; // pixels
var ZOOM_STEP = 0.1; // 0.1 = 10%

function zoomBy(step) {
  var current = parseFloat(document.body.style.zoom || 1);
  var next = current + step;
  if (next < 0.5) {
    next = 0.5;
  }
  if (next > 3) {
    next = 3;
  }
  document.body.style.zoom = next.toFixed(2);
}

// ---- the actions ----------------------------------------------------------
//
//  Use any of these names in gestures.js, for example:  action: "ZOOM_IN"
//
var ACTIONS = {
  // ---- scrolling ----
  SCROLL_UP: function () {
    window.scrollBy({ top: -SCROLL_STEP, behavior: "smooth" });
  },
  SCROLL_DOWN: function () {
    window.scrollBy({ top: SCROLL_STEP, behavior: "smooth" });
  },
  SCROLL_LEFT: function () {
    window.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" });
  },
  SCROLL_RIGHT: function () {
    window.scrollBy({ left: SCROLL_STEP, behavior: "smooth" });
  },

  // ---- page size ----
  ZOOM_IN: function () {
    zoomBy(ZOOM_STEP);
  },
  ZOOM_OUT: function () {
    zoomBy(-ZOOM_STEP);
  },
  ZOOM_RESET: function () {
    document.body.style.zoom = "1";
  }
};

// ===========================================================================
//  RECEIVING GESTURES FROM THE BACKGROUND
// ===========================================================================
//
//  The camera and MediaPipe model now run in an offscreen document owned by
//  background.js (see offscreen.js) — this script never touches the camera
//  or the model, and it is never injected into the page's MAIN world. By the
//  time a message reaches here, background.js has already decided which tab
//  is active and which gesture/action to apply; this script's only job is to
//  run the matching function from the ACTIONS table above, on this page.

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.target !== "content") return false;

  if (message.type === "gesture") {
    var run = ACTIONS[message.action];
    if (run) {
      run();
      sendResponse({ status: "done" });
    } else {
      // Almost always a typo in the "action" of a gesture in gestures.js.
      sendResponse({ status: "unknown action: " + message.action });
    }
    return false;
  }

  return false;
});
