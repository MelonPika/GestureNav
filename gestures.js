// ===========================================================================
//  ADD YOUR OWN GESTURES HERE
// ===========================================================================
//
//  MediaPipe gives us 21 landmarks per hand (see fingerjoint_pic.webp):
//
//      0        = wrist
//      1  2  3  4   = thumb   (4  = tip)
//      5  6  7  8   = index   (8  = tip,  5 = knuckle)
//      9 10 11 12   = middle  (12 = tip,  9 = knuckle)
//     13 14 15 16   = ring    (16 = tip)
//     17 18 19 20   = pinky   (20 = tip, 17 = knuckle)
//
//  Each landmark is an object { x: ..., y: ..., z: ... }, from 0 to 1:
//
//      x : 0 = left edge,  1 = right edge
//      y : 0 = TOP edge,   1 = bottom edge   <-- y grows DOWNWARD!
//      z : roughly how far the point is from the camera (noisy, rarely useful)
//
//  "Is this fingertip higher on screen than its knuckle?" (lm[8].y < lm[6].y)
//  sounds simple, but it only works when the hand happens to be upright and
//  facing the camera — rotate the hand (or show the back of it) and it
//  silently breaks. That's why fingerUp() below instead compares each tip's
//  DISTANCE FROM THE WRIST to its joint's distance from the wrist — a curled
//  finger is always closer to the wrist than a straight one, no matter which
//  way the hand is turned, which hand it is, or which side faces the camera.
//
// ---------------------------------------------------------------------------


// ---- tuning ---------------------------------------------------------------

// How far a fingertip must sit from the wrist relative to its middle joint,
// as a fraction of the hand's own size, before it counts as "extended".
// Bigger = harder to trigger (less flicker), smaller = more sensitive.
var FINGER_MARGIN = 0.02;

// How far the thumb tip must clear its base vertically, as a fraction of the
// hand's own size, before it counts as pointing up or down. Without this,
// the thumb flickers between up/down whenever it sits level with its base.
// (How long a pose must be HELD before it fires at all — CONFIRM_MS — lives
// in camera.js, next to the detection loop that times it.)
var THUMB_GAP_RATIO = 0.35;


// ---- reading the hand -----------------------------------------------------

// Straight-line distance between two landmarks, in the same 0..1 units.
function dist(a, b) {
  var dx = a.x - b.x, dy = a.y - b.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  return d > 0.0001 ? d : 0.0001; // never 0 — it gets used as a divisor/scale
}

// Roughly how big this hand looks on screen: wrist to the middle knuckle.
// Every "how far is far enough" check below is scaled by this, so a hand
// close to the camera and one far away are judged the same way.
function palmSize(lm) {
  return dist(lm[0], lm[9]);
}

// A finger is "up" (extended) when its tip sits FURTHER FROM THE WRIST than
// its middle joint — a curled finger pulls its tip back toward the palm.
// Comparing DISTANCES instead of comparing screen up/down is what makes this
// work no matter how the hand is rotated or tilted, whether the palm or the
// back of the hand faces the camera, and for either the left or right hand —
// a simple "tip.y < joint.y" check only works when the hand happens to be
// held upright and facing the camera, and silently breaks otherwise (which is
// why a rotated fist used to get misread as an open palm).
function fingerUp(lm, tip, joint) {
  return dist(lm[0], lm[tip]) > dist(lm[0], lm[joint]) + FINGER_MARGIN * palmSize(lm);
}

// Turns the 21 raw landmarks into the simple object your rules use below.
function readHand(lm) {
  var hand = {};

  hand.index = fingerUp(lm, 8, 6);
  hand.middle = fingerUp(lm, 12, 10);
  hand.ring = fingerUp(lm, 16, 14);
  hand.pinky = fingerUp(lm, 20, 18);

  // "Up" / "down" for the thumb is deliberately read on screen (not relative
  // to the hand): a thumbs-up/down is a gesture the user aims at the camera
  // on purpose, so screen-vertical IS the meaningful axis here, the same way
  // for either hand. The gap scales with palmSize so it behaves the same
  // close to the camera or far from it.
  var thumbGap = THUMB_GAP_RATIO * palmSize(lm);
  hand.thumbUp = lm[4].y < lm[2].y - thumbGap;
  hand.thumbDown = lm[4].y > lm[2].y + thumbGap;

  // Is the thumb sticking OUT, or folded across the palm? Measured as the
  // real on-screen distance (not just one axis) from the far side of the
  // hand, the pinky knuckle (17) — folded in, the tip sits closer to the
  // pinky knuckle than the thumb's own base does. Using full 2D distance
  // instead of only x (which assumed an upright hand) keeps this correct no
  // matter how the hand is rotated, and for the palm or the back of the hand.
  hand.thumb = dist(lm[4], lm[17]) > dist(lm[2], lm[17]);

  // Count how many of the four fingers are extended. The thumb is not counted.
  hand.count = 0;
  if (hand.index) {
    hand.count = hand.count + 1;
  }
  if (hand.middle) {
    hand.count = hand.count + 1;
  }
  if (hand.ring) {
    hand.count = hand.count + 1;
  }
  if (hand.pinky) {
    hand.count = hand.count + 1;
  }

  // The raw 21 landmarks, for rules that want to read coordinates directly.
  hand.lm = lm;

  return hand;
}


// ---- the gestures ---------------------------------------------------------
//
//  name   internal id, must be unique
//  label  what the popup shows
//  action what the page does — must exist in content.js
//  test your rule: return true when the hand matches
//
//  Rules are checked TOP TO BOTTOM and the FIRST match wins, so put specific
//  gestures above general ones. A fist matches almost anything, so it is last.


//  ---- WHAT YOU CAN USE INSIDE test() --------------------------------------
//
//   h.index      is the index finger straight?   true = straight, false = bent
//   h.middle     is the middle finger straight?  true = straight, false = bent
//   h.ring       is the ring finger straight?    true = straight, false = bent
//   h.pinky      is the pinky straight?          true = straight, false = bent
//
//   h.count      how many of those four fingers are straight, from 0 to 4.
//                The thumb is NOT counted ！
//                For "all five fingers open" write:  h.count === 4 && h.thumb
//
//   h.thumb      is the thumb sticking OUT?  false = folded across the palm
//   h.thumbUp    is the thumb pointing UP?
//   h.thumbDown  is the thumb pointing DOWN?
//
//   h.thumb is about the thumb being open or closed
//
//   h.lm         the raw 21 coordinates, e.g. h.lm[8].y is the index tip.
//                Only needed for more complicated gestures.
//
//
//  ---- WHAT YOU CAN PUT IN action: -----------------------------------------
//
//   Scrolling    SCROLL_UP    SCROLL_DOWN   SCROLL_LEFT   SCROLL_RIGHT
//   Page size    ZOOM_IN      ZOOM_OUT      ZOOM_RESET
//
//   That's the full list — it lives in content.js, in the ACTIONS table.
//   Add your own there if you want more.
//


var GESTURES = [
  {
    name: "THUMBS_UP",
    label: "👍 Thumbs Up — Scroll Up",//if thumbs up is captured,scroll up the page
    action: "SCROLL_UP",
    test: function (h) {
      // fingers curled and thumb pointing up. Not also requiring h.thumb here:
      // that check assumes the palm faces the camera, but a real thumbs-up
      // turns the hand sideways, which made it misfire — thumbUp's own
      // dead zone (THUMB_GAP_RATIO) already keeps a flat, tucked-in thumb
      // from matching by accident.
      return h.count === 0 && h.thumbUp;//edit these to change logic
    }
  },
  {
    name: "THUMBS_DOWN",
    label: "👎 Thumbs Down — Scroll Down",
    action: "SCROLL_DOWN",
    test: function (h) {
      // same as above, but pointing down
      return h.count === 0 && h.thumbDown;
    }
  },
  {
    name: "OPEN_PALM",
    label: "🖐 Open Palm — Zoom Out",
    action: "ZOOM_OUT",
    test: function (h) {
      return h.count === 4;
    }
  },
  {
    name: "FIST",
    label: "✊ Fist — Zoom In",
    action: "ZOOM_IN",
    test: function (h) {
      // everything closed: the four fingers curled AND the thumb folded in
      return h.count === 0 && !h.thumb;
    }
  }
];


// Goes through the list above and returns the first gesture that matches.
// Returns null when the hand does not match any of them.
// (Do not delete this — camera.js calls it every frame.)
function detectGesture(lm) {
  var hand = readHand(lm);

  for (var i = 0; i < GESTURES.length; i++) {
    if (GESTURES[i].test(hand)) {
      return GESTURES[i];
    }
  }

  return null;
}


