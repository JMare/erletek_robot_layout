// Robot pose and driven trail in the map, for the print_mission layout.
//
// Robot: a triangle in base_link that points forward (+x). The entity is "frame locked" in
// base_link, so the 3D panel puts it at the latest TF pose of base_link in the map. The panel
// reads the TF itself.
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
// Triangle: 0.9 m long, 0.6 m wide, base_link at 1/3 of the length from the back.
const NOSE_M = 0.6;
const TAIL_M = 0.3;
const HALF_WIDTH_M = 0.3;
const ROBOT_COLOR = { r: 0.98, g: 0.8, b: 0.08, a: 0.9 };
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
  const z = 0.2; // above the plan lines and the trail
  const outline = [
    { x: NOSE_M, y: 0, z },
    { x: -TAIL_M, y: HALF_WIDTH_M, z },
    { x: -TAIL_M, y: -HALF_WIDTH_M, z },
  ];
  e.triangles.push({
    pose: { position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY },
    points: outline,
    color: ROBOT_COLOR,
    colors: [],
    indices: [],
  });
  e.lines.push({
    type: 1, // LINE_LOOP
    pose: { position: { x: 0, y: 0, z: 0.01 }, orientation: IDENTITY },
    thickness: 2,
    scale_invariant: true,
    points: outline,
    color: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
    colors: [],
    indices: [],
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
