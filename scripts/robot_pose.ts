// Robot pose and driven trail in the map, for the print_mission layout.
//
// Robot: the footprint of the tracked robot, drawn in base_link, pointing forward (+x). The
// entity is "frame locked" in base_link, so the 3D panel puts it at the latest TF pose of
// base_link in the map. The panel reads the TF itself. The body is transparent so the plan and
// the trail stay visible through it, and a crosshair marks base_link at the center of the frame
// (where the pose is published).
//
// Trail: the path that the robot drove, in map. The script composes the two TF links
// map -> odom and odom -> base_link of /tf and /tf_static:
//
//   robot    map -> odom comes from ekf_global (GPS) on /tf and moves; odom -> base_link
//            comes from ekf_local on /tf
//   mock     map -> odom is a static identity on /tf_static; odom -> base_link comes from
//            ekf_local on /tf
//
// Thus the trail shows the map pose, also when the GPS corrects map -> odom. A /odometry/local
// trail would show the odom pose only. The script adds a point when the robot moved 2 cm or
// more, and keeps the last 5000 points. A new plan on /system_manager/loaded_plan starts a new
// trail.
//
// Source: scripts/robot_pose.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";
import { SceneEntity, SceneUpdate } from "@foxglove/schemas";

export const inputs = ["/tf", "/tf_static", "/system_manager/loaded_plan"];
export const output = "/studio_script/robot_pose";

type Event = Input<"/tf"> | Input<"/tf_static"> | Input<"/system_manager/loaded_plan">;
type Time = Input<"/tf">["receiveTime"];
type Vec = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };
type Pose = { t: Vec; q: Quat };

const MAP = "map";
const ODOM = "odom";
const BASE = "base_link";
const MIN_STEP_M = 0.02;
const MAX_POINTS = 5000;
// Send the robot entity again after this time, also when the robot does not move: a panel
// that opens later (for example after a tab change) then shows it.
const RESEND_S = 1.0;
// Footprint of the tracked robot. base_link is at the center of the frame (pose is published
// there): the footprint is centered on it. 0.90 m long; chassis 0.90 m wide; 1.20 m wide
// including the tracks, so each track band is 0.15 m wide.
const LENGTH_M = 0.9;
const CHASSIS_WIDTH_M = 0.9;
const TOTAL_WIDTH_M = 1.2;
const TRACK_WIDTH_M = (TOTAL_WIDTH_M - CHASSIS_WIDTH_M) / 2; // 0.15 per side
const TRACK_CENTER_Y = (CHASSIS_WIDTH_M + TOTAL_WIDTH_M) / 4; // 0.525: middle of a track band
// Transparent body so the plan and the trail show through; solid outline for the extents.
const BODY_COLOR = { r: 0.98, g: 0.8, b: 0.08, a: 0.22 };
const TRACK_COLOR = { r: 0.15, g: 0.16, b: 0.2, a: 0.6 };
const OUTLINE_COLOR = { r: 0.98, g: 0.8, b: 0.08, a: 0.95 };
const HEADING_COLOR = { r: 0.98, g: 0.8, b: 0.08, a: 0.9 };
const CENTER_COLOR = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
const CENTER_DOT_COLOR = { r: 0.9, g: 0.1, b: 0.1, a: 1.0 };
// Nozzle (printhead tip): 0.36 m behind base_link in the plane (printhead_tip_joint). Its z
// changes with the lift, which does not matter from above. Marked in cyan so the print point
// is visible, not only the center of the robot.
const NOZZLE_X = -0.36;
const NOZZLE_COLOR = { r: 0.1, g: 0.85, b: 0.95, a: 1.0 };
const TRAIL_COLOR = { r: 0.95, g: 0.95, b: 0.95, a: 0.8 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

let mapOdom: Pose | undefined;
let odomBase: Pose | undefined;
let planUuid = "";
const trail: Vec[] = [];
let lastSent = -Infinity;

function seconds(t: Time): number {
  return t.sec + t.nsec * 1e-9;
}

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
  // v' = q v q*
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

function emptyEntity(time: Time, frameId: string, id: string): SceneEntity {
  return {
    timestamp: time,
    frame_id: frameId,
    id,
    lifetime: { sec: 0, nsec: 0 },
    frame_locked: true,
    metadata: [],
    arrows: [],
    cubes: [],
    spheres: [],
    cylinders: [],
    lines: [],
    triangles: [],
    texts: [],
    models: [],
  };
}

function robotEntity(time: Time): SceneEntity {
  const e = emptyEntity(time, BASE, "robot");
  const half = LENGTH_M / 2; // 0.45: front (+x) and back (-x) edges
  const totalHalf = TOTAL_WIDTH_M / 2; // 0.6: outer edge of the tracks

  // Tracks: a dark band on each side that runs the full length of the robot.
  for (const sign of [1, -1]) {
    e.cubes.push({
      pose: { position: { x: 0, y: sign * TRACK_CENTER_Y, z: 0.19 }, orientation: IDENTITY },
      size: { x: LENGTH_M, y: TRACK_WIDTH_M, z: 0.001 },
      color: TRACK_COLOR,
    });
  }

  // Chassis: a transparent box so the plan and the trail show through.
  e.cubes.push({
    pose: { position: { x: 0, y: 0, z: 0.2 }, orientation: IDENTITY },
    size: { x: LENGTH_M, y: CHASSIS_WIDTH_M, z: 0.001 },
    color: BODY_COLOR,
  });

  // Outline of the full footprint (chassis plus tracks): the true extents of the robot.
  e.lines.push({
    type: 1, // LINE_LOOP
    pose: { position: { x: 0, y: 0, z: 0.21 }, orientation: IDENTITY },
    thickness: 2,
    scale_invariant: true,
    points: [
      { x: half, y: totalHalf, z: 0 },
      { x: half, y: -totalHalf, z: 0 },
      { x: -half, y: -totalHalf, z: 0 },
      { x: -half, y: totalHalf, z: 0 },
    ],
    color: OUTLINE_COLOR,
    colors: [],
    indices: [],
  });

  // Heading: a filled triangle that points forward (+x), so the facing is clear.
  e.triangles.push({
    pose: { position: { x: 0, y: 0, z: 0.22 }, orientation: IDENTITY },
    points: [
      { x: 0.33, y: 0, z: 0 },
      { x: 0.05, y: 0.2, z: 0 },
      { x: 0.05, y: -0.2, z: 0 },
    ],
    color: HEADING_COLOR,
    colors: [],
    indices: [],
  });

  // base_link marker: a crosshair and a dot at the center of the frame.
  e.lines.push({
    type: 2, // LINE_LIST
    pose: { position: { x: 0, y: 0, z: 0.25 }, orientation: IDENTITY },
    thickness: 2,
    scale_invariant: true,
    points: [
      { x: -0.14, y: 0, z: 0 }, { x: 0.14, y: 0, z: 0 },
      { x: 0, y: -0.14, z: 0 }, { x: 0, y: 0.14, z: 0 },
    ],
    color: CENTER_COLOR,
    colors: [],
    indices: [],
  });
  e.spheres.push({
    pose: { position: { x: 0, y: 0, z: 0.26 }, orientation: IDENTITY },
    size: { x: 0.08, y: 0.08, z: 0.001 },
    color: CENTER_DOT_COLOR,
  });

  // Nozzle marker (printhead tip): a cyan crosshair and dot, 0.36 m behind base_link.
  e.lines.push({
    type: 2, // LINE_LIST
    pose: { position: { x: NOZZLE_X, y: 0, z: 0.25 }, orientation: IDENTITY },
    thickness: 2,
    scale_invariant: true,
    points: [
      { x: -0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 },
      { x: 0, y: -0.1, z: 0 }, { x: 0, y: 0.1, z: 0 },
    ],
    color: NOZZLE_COLOR,
    colors: [],
    indices: [],
  });
  e.spheres.push({
    pose: { position: { x: NOZZLE_X, y: 0, z: 0.26 }, orientation: IDENTITY },
    size: { x: 0.08, y: 0.08, z: 0.001 },
    color: NOZZLE_COLOR,
  });

  // Labels, upright regardless of the robot's heading.
  e.texts.push({
    pose: { position: { x: 0, y: -0.14, z: 0.27 }, orientation: IDENTITY },
    billboard: true,
    font_size: 11,
    scale_invariant: true,
    color: CENTER_COLOR,
    text: "base_link",
  });
  e.texts.push({
    pose: { position: { x: NOZZLE_X, y: -0.14, z: 0.27 }, orientation: IDENTITY },
    billboard: true,
    font_size: 11,
    scale_invariant: true,
    color: NOZZLE_COLOR,
    text: "nozzle",
  });
  return e;
}

function trailEntity(time: Time): SceneEntity {
  const e = emptyEntity(time, MAP, "trail");
  if (trail.length >= 2) {
    e.lines.push({
      type: 0, // LINE_STRIP
      pose: { position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY },
      thickness: 2,
      scale_invariant: true,
      points: trail.slice(),
      color: TRAIL_COLOR,
      colors: [],
      indices: [],
    });
  }
  return e;
}

// true when the trail got a new point.
function addTrailPoint(): boolean {
  if (mapOdom === undefined || odomBase === undefined) {
    return false;
  }
  const p = compose(mapOdom, odomBase).t;
  const last = trail[trail.length - 1];
  if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP_M) {
    return false;
  }
  trail.push({ x: p.x, y: p.y, z: 0.05 });
  if (trail.length > MAX_POINTS) {
    trail.shift();
  }
  return true;
}

export default function script(event: Event): SceneUpdate | undefined {
  let changed = false;
  switch (event.topic) {
    case "/tf":
    case "/tf_static":
      readTransforms(event.message);
      changed = addTrailPoint();
      break;
    case "/system_manager/loaded_plan":
      if (event.message.plan_uuid !== "" && event.message.plan_uuid !== planUuid) {
        trail.length = 0;
        changed = true;
      }
      planUuid = event.message.plan_uuid;
      break;
  }
  const now = seconds(event.receiveTime);
  if (!changed && now - lastSent < RESEND_S) {
    return undefined;
  }
  lastSent = now;
  return {
    deletions: [],
    entities: [robotEntity(event.receiveTime), trailEntity(event.receiveTime)],
  };
}
