// Print plan in the map, for the print_mission layout.
//
// Reads the plan that the System Manager holds (/system_manager/loaded_plan, latched) and the
// mission state of the Mission Controller. Draws each segment of each layer as one line in the
// frame of the plan (map or odom):
//
//   colour    the segment type: approach (alignment) blue, print green, return purple
//   width     the segment status: the running segment is the widest, the next segment (the MC
//             waits for the operator) is wide, the other segments are thin
//   opacity   done and skipped segments are faint, the segments to do are clear
//
// The layers of a wall have the same path in the plane, so their lines overlap in the top-down
// view. The current layer is on top, with a label on each of its segments. Before a print, the
// labels are on the start layer. An empty plan (no plan loaded) removes all lines.
//
// Source: scripts/mission_plan.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";
import { SceneEntity, SceneUpdate } from "@foxglove/schemas";

export const inputs = ["/system_manager/loaded_plan", "/mission_controller/mission_state"];
export const output = "/studio_script/mission_plan";

type Event = Input<"/system_manager/loaded_plan"> | Input<"/mission_controller/mission_state">;
type Plan = Input<"/system_manager/loaded_plan">["message"];
type Segment = Plan["layers"][number]["print_segment"];
type MissionState = Input<"/mission_controller/mission_state">["message"];
type Time = Input<"/system_manager/loaded_plan">["receiveTime"];
type Rgb = { r: number; g: number; b: number };
type Status = "skipped" | "done" | "todo" | "next" | "running";

// Constants of cpr_interfaces/msg/MissionState.
const LOP_NONE = 0;
const LOP_ALIGNING = 1;
const LOP_READY_TO_START = 2;
const LOP_PRINTING = 3;
const LOP_WAITING_TO_RETURN = 4;
const LOP_RETURNING = 5;

const SEGMENTS: { field: "alignment_segment" | "print_segment" | "return_segment"; label: string; rgb: Rgb }[] = [
  { field: "alignment_segment", label: "approach", rgb: { r: 0.38, g: 0.65, b: 0.98 } },
  { field: "print_segment", label: "print", rgb: { r: 0.29, g: 0.87, b: 0.5 } },
  { field: "return_segment", label: "return", rgb: { r: 0.75, g: 0.52, b: 0.99 } },
];

// Line width (pixels), opacity, and height (m) for each status. The height only puts the
// important lines on top in the top-down view.
const STYLE: Record<Status, { width: number; alpha: number; z: number }> = {
  skipped: { width: 1.5, alpha: 0.15, z: 0.0 },
  done: { width: 2, alpha: 0.3, z: 0.01 },
  todo: { width: 2.5, alpha: 0.75, z: 0.02 },
  next: { width: 5, alpha: 1.0, z: 0.03 },
  running: { width: 8, alpha: 1.0, z: 0.04 },
};
const WHITE = { r: 1, g: 1, b: 1, a: 0.95 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

let plan: Plan | undefined;
let mission: MissionState | undefined;

// [index of the current segment in the plan (layer 1 approach = 0), the MC drives it now].
// undefined: no print runs.
function current(m: MissionState | undefined): [number, boolean] | undefined {
  if (m === undefined || m.state === LOP_NONE || m.current_layer < 1) {
    return undefined;
  }
  const base = (m.current_layer - 1) * 3;
  switch (m.state) {
    case LOP_ALIGNING:
      return [base, true];
    case LOP_READY_TO_START:
      return [base + 1, false]; // the print segment is next: the MC waits for the green light
    case LOP_PRINTING:
      return [base + 1, true];
    case LOP_WAITING_TO_RETURN:
      return [base + 2, false]; // the return segment is next: the MC waits for cut done
    case LOP_RETURNING:
      return [base + 2, true];
    default:
      return undefined;
  }
}

function status(pl: Plan, layer: number, index: number, now: [number, boolean] | undefined): Status {
  if (layer < pl.start_layer) {
    return "skipped";
  }
  if (now === undefined) {
    return "todo";
  }
  const [cur, running] = now;
  if (index < cur) {
    return "done";
  }
  if (index === cur) {
    return running ? "running" : "next";
  }
  return "todo";
}

function entity(time: Time, frameId: string, id: string): SceneEntity {
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

function frameOf(segment: Segment): string {
  return segment.waypoints[0]?.header.frame_id ?? "map";
}

export default function script(event: Event): SceneUpdate {
  if (event.topic === "/system_manager/loaded_plan") {
    plan = event.message;
  } else {
    mission = event.message;
  }
  const time = event.receiveTime;
  const update: SceneUpdate = {
    deletions: [{ timestamp: time, type: 1, id: "" }], // ALL: the update replaces the drawing
    entities: [],
  };
  const p = plan;
  if (p === undefined || p.plan_uuid === "" || p.layers.length === 0) {
    return update;
  }

  const now = current(mission);
  // The layer with the labels: the current layer, else the start layer.
  const focus = now !== undefined ? Math.floor(now[0] / 3) + 1 : Math.max(p.start_layer, 1);
  let minX = Infinity;
  let maxY = -Infinity;

  p.layers.forEach((layer, i) => {
    const layerNumber = i + 1;
    SEGMENTS.forEach((kind, k) => {
      const segment = layer[kind.field];
      if (segment.waypoints.length < 2) {
        return;
      }
      const s = status(p, layerNumber, i * 3 + k, now);
      const style = STYLE[s];
      // The focus layer above the other layers that have the same status.
      const z = style.z + (layerNumber === focus ? 0.005 : 0);
      const e = entity(time, frameOf(segment), `layer${layerNumber}_${kind.label}`);
      e.lines.push({
        type: 0, // LINE_STRIP
        pose: { position: { x: 0, y: 0, z: 0 }, orientation: IDENTITY },
        thickness: style.width,
        scale_invariant: true,
        points: segment.waypoints.map((w) => ({ x: w.pose.position.x, y: w.pose.position.y, z })),
        color: { ...kind.rgb, a: style.alpha },
        colors: [],
        indices: [],
      });
      for (const w of segment.waypoints) {
        minX = Math.min(minX, w.pose.position.x);
        maxY = Math.max(maxY, w.pose.position.y);
      }
      if (layerNumber === focus) {
        const mid = segment.waypoints[Math.floor(segment.waypoints.length / 2)]!.pose.position;
        const mark = s === "running" ? " (now)" : s === "next" ? " (next)" : "";
        e.texts.push({
          pose: { position: { x: mid.x, y: mid.y, z: 0.1 }, orientation: IDENTITY },
          billboard: true,
          font_size: 13,
          scale_invariant: true,
          color: { ...kind.rgb, a: 1.0 },
          text: `L${layerNumber} ${kind.label}${mark}`,
        });
      }
      update.entities.push(e);
    });
  });

  // Plan name and layer count, above the top left corner of the plan.
  const first = p.layers[0]!.alignment_segment;
  const title = entity(time, frameOf(first), "plan_title");
  title.texts.push({
    pose: { position: { x: minX, y: maxY + 0.4, z: 0.1 }, orientation: IDENTITY },
    billboard: true,
    font_size: 14,
    scale_invariant: true,
    color: WHITE,
    text: `${p.plan_name || p.plan_uuid}: ${p.layers.length} layers, start layer ${p.start_layer}`,
  });
  update.entities.push(title);
  return update;
}
