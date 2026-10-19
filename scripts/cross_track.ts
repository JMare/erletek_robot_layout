// Cross-track error of the print, and segment progress, for the print_mission layout.
//
// Cross-track: how far the nozzle (printhead tip) is from the path that Nav2 follows. The
// nozzle is what shapes the wall; it is 0.36 m behind base_link, so a heading error moves it
// sideways. Sign: positive when the robot is left of the path (cross product of the piece
// direction and the robot's offset from the piece start). The error is reported per layer, in
// the fields layers.l1_mm .. layers.l<MAX_LAYERS>_mm, set only for the layer that prints now
// (NaN otherwise). Every layer prints the same path, so the "vs distance" plot draws one line
// per layer on the same x, with no filter.
//
// Segment progress: how far along the active path base_link is, as a percent, with the time
// and the distance left. The time uses the drive odometry speed.
//
// The nozzle offset is hard-coded (printhead_tip_joint, base_link (-0.36, 0)): the lift TF is
// not published in mock mode or while the lift is uncalibrated, and the lift only moves the
// nozzle in z, which does not matter from above.
//
// The reference path is /path_executor/received_path: exactly the path Nav2 follows, latched,
// in the plan frame (header.frame_id, normally map). A new path arrives at the start of each
// drive segment. The phase and layer come from /mission_controller/mission_state, read live:
// only the drive phases are labelled (ALIGNING -> APPROACH, PRINTING -> PRINT, RETURNING ->
// RETURN). The pose comes from TF, map -> odom -> base_link, like robot_pose.ts (User Scripts
// cannot import each other, so the small TF helpers are copied here).
//
// Note on arcs: even with perfect tracking the nozzle sits about 0.36^2 / 2r outside an arc
// (6.5 mm at r = 10 m). Read it as geometry, not a tracking error.
//
// Source: scripts/cross_track.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";

export const inputs = [
  "/tf",
  "/tf_static",
  "/path_executor/received_path",
  "/mission_controller/mission_state",
  "/act/drive/odom",
];
export const output = "/studio_script/cross_track";

// The "vs distance" plot draws one line per layer: this is the highest layer it can show.
const MAX_LAYERS = 9;

type Event =
  | Input<"/tf">
  | Input<"/tf_static">
  | Input<"/path_executor/received_path">
  | Input<"/mission_controller/mission_state">
  | Input<"/act/drive/odom">;
type MissionState = Input<"/mission_controller/mission_state">["message"];
type Vec = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };
type Pose = { t: Vec; q: Quat };
type Pt = { x: number; y: number };

type Output = {
  segment: string; // APPROACH | PRINT | RETURN (the drive phase of the active path)
  layer: number; // current layer, 1-based
  along_m: number; // distance of base_link along the active path (x-axis of the plot)
  seg_percent: number; // progress along the active segment, 0..100
  remaining: { time: string; distance: string }; // time and distance left on the segment
  layers: { [field: string]: number }; // l1_mm .. l<MAX_LAYERS>_mm: nozzle error of each layer
};

const MAP = "map";
const ODOM = "odom";
const BASE = "base_link";
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

// printhead_tip_joint: the nozzle is 0.36 m behind base_link (x points forward).
const NOZZLE_X = -0.36;
// Search the path only forward from the last piece, about this far ahead: a return loop passes
// near itself, so a global search could jump to the wrong piece.
const SEARCH_AHEAD_M = 1.0;
// Publish only after the robot moved this far along the path: keeps the rate near 10 Hz
// instead of the TF rate, and keeps the robot still (waiting) from filling the plot.
const MIN_STEP_M = 0.005;
// Below this speed, the time left is unknown ("-").
const MIN_SPEED = 0.02;

// Constants of cpr_interfaces/msg/MissionState.
const LOP_ALIGNING = 1;
const LOP_PRINTING = 3;
const LOP_RETURNING = 5;

let mapOdom: Pose | undefined;
let odomBase: Pose | undefined;
let mission: MissionState | undefined;
let speed = 0; // latest |linear.x| of the drive odometry

let pathPts: Pt[] = [];
let cum: number[] = []; // cum[i]: path length from the start to the start of piece i
let segLen: number[] = []; // segLen[i]: length of piece i (points i -> i+1)
let pathTotal = 0; // total path length
let searchStart = 0; // the first piece to search from (forward only)
let lastAlong: number | undefined; // the along of the last published point

function frame(id: string): string {
  return id.startsWith("/") ? id.slice(1) : id;
}

function multiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function rotate(q: Quat, v: Vec): Vec {
  const p = multiply(multiply(q, { x: v.x, y: v.y, z: v.z, w: 0 }), { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return { x: p.x, y: p.y, z: p.z };
}

// a then b: the pose of b's child in a's parent frame.
function compose(a: Pose, b: Pose): Pose {
  const r = rotate(a.q, b.t);
  return { t: { x: a.t.x + r.x, y: a.t.y + r.y, z: a.t.z + r.z }, q: multiply(a.q, b.q) };
}

function readTransforms(message: Input<"/tf">["message"]): void {
  for (const tf of message.transforms) {
    const parent = frame(tf.header.frame_id);
    const child = frame(tf.child_frame_id);
    const pose = { t: tf.transform.translation, q: tf.transform.rotation };
    if (parent === MAP && child === ODOM) {
      mapOdom = pose;
    } else if (parent === ODOM && child === BASE) {
      odomBase = pose;
    }
  }
}

function setPath(poses: Input<"/path_executor/received_path">["message"]["poses"]): void {
  pathPts = poses.map((ps) => ({ x: ps.pose.position.x, y: ps.pose.position.y }));
  cum = [];
  segLen = [];
  let acc = 0;
  for (let i = 0; i + 1 < pathPts.length; i++) {
    const dx = pathPts[i + 1]!.x - pathPts[i]!.x;
    const dy = pathPts[i + 1]!.y - pathPts[i]!.y;
    const len = Math.hypot(dx, dy);
    cum[i] = acc;
    segLen[i] = len;
    acc += len;
  }
  pathTotal = acc;
  searchStart = 0;
  lastAlong = undefined;
}

// The closest point of the path pieces [lo, hi] to p. Returns the distance along the path, the
// signed offset (+ = left of the path), and the piece index.
function project(p: Pt, lo: number, hi: number): { along: number; xte: number; piece: number } | undefined {
  let best: { along: number; xte: number; piece: number } | undefined;
  let bestDist = Infinity;
  for (let i = lo; i <= hi && i < segLen.length; i++) {
    const a = pathPts[i]!;
    const b = pathPts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = segLen[i]!;
    if (len < 1e-9) {
      continue;
    }
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
    t = Math.max(0, Math.min(1, t));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const dist = Math.hypot(p.x - projX, p.y - projY);
    if (dist < bestDist) {
      bestDist = dist;
      const xte = (dx * (p.y - a.y) - dy * (p.x - a.x)) / len; // + = left of the path
      best = { along: cum[i]! + t * len, xte, piece: i };
    }
  }
  return best;
}

// The last piece whose start is within SEARCH_AHEAD_M of the start piece.
function aheadHi(start: number): number {
  let hi = start;
  while (hi < segLen.length - 1 && cum[hi + 1]! - cum[start]! < SEARCH_AHEAD_M) {
    hi++;
  }
  return hi;
}

function segmentLabel(state: number | undefined): string {
  switch (state) {
    case LOP_ALIGNING:
      return "APPROACH";
    case LOP_PRINTING:
      return "PRINT";
    case LOP_RETURNING:
      return "RETURN";
    default:
      return "";
  }
}

export default function script(event: Event): Output | undefined {
  switch (event.topic) {
    case "/tf":
    case "/tf_static":
      readTransforms(event.message);
      break;
    case "/path_executor/received_path":
      setPath(event.message.poses);
      return undefined;
    case "/mission_controller/mission_state":
      mission = event.message;
      return undefined;
    case "/act/drive/odom":
      speed = Math.abs(event.message.twist.twist.linear.x);
      return undefined;
  }

  // A pose update (/tf or /tf_static): compute and maybe publish.
  const segment = segmentLabel(mission?.state);
  if (segment === "" || pathPts.length < 2 || mapOdom === undefined || odomBase === undefined) {
    return undefined;
  }
  const base = compose(mapOdom, odomBase);
  const basePt = { x: base.t.x, y: base.t.y };
  const nozzle = compose(base, { t: { x: NOZZLE_X, y: 0, z: 0 }, q: IDENTITY });
  const nozzlePt = { x: nozzle.t.x, y: nozzle.t.y };

  const b = project(basePt, searchStart, aheadHi(searchStart));
  if (b === undefined) {
    return undefined;
  }
  searchStart = b.piece;
  // The nozzle is just behind base_link: search a small window around its piece.
  const n = project(nozzlePt, Math.max(0, b.piece - 3), Math.min(segLen.length - 1, b.piece + 1));
  const nozzleXte = (n?.xte ?? b.xte) * 1000;

  if (lastAlong !== undefined && Math.abs(b.along - lastAlong) < MIN_STEP_M) {
    return undefined;
  }
  lastAlong = b.along;

  const layerNum = mission?.current_layer ?? 0;
  const layers: { [field: string]: number } = {};
  for (let k = 1; k <= MAX_LAYERS; k++) {
    layers[`l${k}_mm`] = NaN;
  }
  if (segment === "PRINT" && layerNum >= 1 && layerNum <= MAX_LAYERS) {
    layers[`l${layerNum}_mm`] = nozzleXte;
  }

  const metersLeft = Math.max(0, pathTotal - b.along);
  return {
    segment,
    layer: layerNum,
    along_m: b.along,
    seg_percent: pathTotal > 0 ? Math.max(0, Math.min(100, (b.along / pathTotal) * 100)) : 0,
    remaining: {
      time: speed > MIN_SPEED ? `${Math.round(metersLeft / speed)} s` : "-",
      distance: `${metersLeft.toFixed(2)} m`,
    },
    layers,
  };
}
