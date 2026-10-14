// Odometry trail for the print_mission layout.
//
// The 3D panel does not draw nav_msgs/Odometry. This script keeps the positions of
// /odometry/local (the local EKF, frame odom) and draws them as one line: the path that the
// robot drove. It adds a point when the robot moved 2 cm or more, and keeps the last 5000.
//
// Source: etk_system_tools/config/foxglove/scripts/odom_trail.ts. make_layout.py copies this
// file into print_mission.layout.json.
import { Input } from "./types";
import { SceneUpdate } from "@foxglove/schemas";

export const inputs = ["/odometry/local"];
export const output = "/studio_script/odom_trail";

const MIN_STEP_M = 0.02;
const MAX_POINTS = 5000;

type Point = { x: number; y: number; z: number };
const trail: Point[] = [];

export default function script(event: Input<"/odometry/local">): SceneUpdate | undefined {
  const p = event.message.pose.pose.position;
  const last = trail[trail.length - 1];
  if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP_M) {
    return undefined;
  }
  trail.push({ x: p.x, y: p.y, z: 0.01 });
  if (trail.length > MAX_POINTS) {
    trail.shift();
  }
  if (trail.length < 2) {
    return undefined;
  }
  return {
    deletions: [],
    entities: [
      {
        timestamp: event.receiveTime,
        frame_id: event.message.header.frame_id,
        id: "odom_trail",
        lifetime: { sec: 0, nsec: 0 },
        frame_locked: true,
        metadata: [],
        arrows: [],
        cubes: [],
        spheres: [],
        cylinders: [],
        lines: [
          {
            type: 0, // LINE_STRIP
            pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
            thickness: 3,
            scale_invariant: true,
            points: trail.slice(),
            color: { r: 0.2, g: 0.6, b: 1.0, a: 1.0 },
            colors: [],
            indices: [],
          },
        ],
        triangles: [],
        texts: [],
        models: [],
      },
    ],
  };
}
