// Nav2 lookahead point for the print_mission layout.
//
// The 3D panel does not draw geometry_msgs/PointStamped. This script draws the Regulated
// Pure Pursuit lookahead point (/lookahead_point, in base_link) as an orange dot: the point on
// the segment that Nav2 steers to. The dot is 0.3 m higher than the point, so that it is
// above the plan lines and the robot in the top-down view. It goes away 1 s after the last
// point, so it shows only while a segment runs.
//
// Source: scripts/lookahead_marker.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";
import { SceneUpdate } from "@foxglove/schemas";

export const inputs = ["/lookahead_point"];
export const output = "/studio_script/lookahead_marker";

export default function script(event: Input<"/lookahead_point">): SceneUpdate {
  const p = event.message.point;
  const pose = { position: { x: p.x, y: p.y, z: p.z + 0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const color = { r: 1.0, g: 0.6, b: 0.0, a: 1.0 };
  return {
    deletions: [],
    entities: [
      {
        timestamp: event.receiveTime,
        frame_id: event.message.header.frame_id,
        id: "lookahead",
        lifetime: { sec: 1, nsec: 0 },
        frame_locked: true,
        metadata: [],
        arrows: [],
        cubes: [],
        spheres: [{ pose, size: { x: 0.12, y: 0.12, z: 0.12 }, color }],
        cylinders: [],
        lines: [],
        triangles: [],
        texts: [],
        models: [],
      },
    ],
  };
}
