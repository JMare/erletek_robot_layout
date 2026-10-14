// Mission summary for the print_mission layout.
//
// Reads the System Manager (SM) state, the Mission Controller (MC) controller and mission
// states, and the /act arbiter status. Publishes one message: the action that the operator
// must do now, the reason for each state, the plan and the last holder change.
//
// The band tiles show the states, from the fields of "codes" and from the state topics. The
// "Why" panel shows the fields of "why": the text that the tiles cannot show.
//
// Source: scripts/mission_summary.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";

export const inputs = [
  "/system_manager/state",
  "/mission_controller/state",
  "/mission_controller/mission_state",
  "/act/status",
];
export const output = "/studio_script/mission_summary";

type Why = {
  // What the operator must do now, in words.
  do_now: string;
  // The reason for the state, for example "Plan ... loaded, waiting for ...". The state name
  // is in the band.
  sm_reason: string;
  mc_reason: string;
  plan: string;
  // Why the actuators changed holder last, for example "drive GRANTED, lift GRANTED, ...".
  last_change: string;
};

type Codes = {
  // Short code for the "Operator" tile: none, wait, upload, arm, grant, request_arm,
  // execute, green_light, cut_done, control_lost, clear_error, rc.
  operator_wait: string;
  // Short code for the "/act" tile: armed, disarmed, rc_lost.
  act_code: string;
  // Text for the "Layer" tile, for example "2 / 3".
  layer_text: string;
};

type Output = {
  why: Why;
  codes: Codes;
};

type Event =
  | Input<"/system_manager/state">
  | Input<"/mission_controller/state">
  | Input<"/mission_controller/mission_state">
  | Input<"/act/status">;

type SmState = Input<"/system_manager/state">["message"];
type McState = Input<"/mission_controller/state">["message"];
type MissionState = Input<"/mission_controller/mission_state">["message"];
type ActStatus = Input<"/act/status">["message"];

// Constants of etk_actuation_interfaces/msg/ActuatorStatus (change_reason).
const CHANGE_NAMES = ["NONE", "TAKEN", "RELEASED", "REVOKED", "DISARMED", "GRANTED"];

const SM_IDLE = 0;
const SM_READY = 1;
const SM_OPERATING = 2;
const SM_ERROR = 3;
const MC_ARMED = 2;
const MC_OPERATING = 3;
const LOP_ALIGNING = 1;
const LOP_READY_TO_START = 2;
const LOP_PRINTING = 3;
const LOP_WAITING_TO_RETURN = 4;
const LOP_RETURNING = 5;
// etk_actuation_interfaces/msg/Priority
const LEVEL_MC = 50;

const NO_DATA = "(no data)";

// The last message of each input. The script runs once for each input message.
let sm: SmState | undefined;
let mc: McState | undefined;
let mission: MissionState | undefined;
let act: ActStatus | undefined;

function name(names: string[], value: number | undefined): string {
  if (value === undefined) {
    return NO_DATA;
  }
  return names[value] ?? `UNKNOWN (${value})`;
}

// The reason, "(none)" when it is empty.
function reason(text: string | undefined): string {
  if (text === undefined) {
    return NO_DATA;
  }
  return text !== "" ? text : "(none)";
}

function lastChange(status: ActStatus | undefined): string {
  if (status === undefined) {
    return NO_DATA;
  }
  return [
    `drive ${name(CHANGE_NAMES, status.drive.change_reason)}`,
    `lift ${name(CHANGE_NAMES, status.lift.change_reason)}`,
    `vibe ${name(CHANGE_NAMES, status.vibe.change_reason)}`,
  ].join(", ");
}

function mcRequestsPending(status: ActStatus): boolean {
  return [status.drive, status.lift, status.vibe].some((s) => s.requested_level === LEVEL_MC);
}

// [code, text]: what the operator must do now.
function operatorAction(): [string, string] {
  if (sm === undefined || act === undefined) {
    return ["wait", "Wait for /system_manager/state and /act/status."];
  }
  if (!act.rc_present) {
    return ["rc", "Switch on the RC. The arbiter gets no deadman, so /act is DISARMED."];
  }
  if (sm.state === SM_ERROR) {
    return ["clear_error", "Read the SM reason. Fix the cause. Then call /system_manager/clear_error_request."];
  }
  if (sm.state === SM_IDLE) {
    if (sm.current_plan_id === "") {
      return ["upload", "Upload a print plan: /system_manager/upload_print_plan (GUI or CLI)."];
    }
    if (!act.armed) {
      return ["arm", "ARM the /act layer on the RC: hold D-pad Up."];
    }
    if (mcRequestsPending(act)) {
      return ["grant", "Press GRANT on the RC (D-pad Right). The MC asks for the drive, the lift and the vibe."];
    }
    if (mc !== undefined && mc.state !== MC_ARMED) {
      return ["request_arm", "The MC does not hold all three actuators. Call /system_manager/request_arm, then press GRANT."];
    }
    return ["wait", "Wait. The SM goes to READY at the next MC state message."];
  }
  if (sm.state === SM_READY) {
    return ["execute", "Start the print: send a goal to the /system_manager/execute_plan action."];
  }
  if (sm.state === SM_OPERATING) {
    if (mc !== undefined && mc.state === MC_OPERATING && mc.message !== "") {
      return [
        "control_lost",
        `The MC reports "${mc.message}". The print continues or fails. To get control back: /system_manager/request_arm, then GRANT.`,
      ];
    }
    switch (mission?.state) {
      case LOP_ALIGNING:
        return ["none", "No action. The lift goes to the alignment height, then the robot drives to the layer start."];
      case LOP_READY_TO_START:
        return ["green_light", "Check the robot at the layer start. Then give the green light: /system_manager/start_layer."];
      case LOP_PRINTING:
        return ["none", "No action. The lift goes to the print height, then the robot prints the layer."];
      case LOP_WAITING_TO_RETURN:
        return ["cut_done", "Cut the wall end. Then confirm: /system_manager/cut_done."];
      case LOP_RETURNING:
        return ["none", "No action. The robot drives the return segment."];
      default:
        return ["wait", "Wait for the MC mission state."];
    }
  }
  return ["wait", `Unknown SM state ${sm.state}.`];
}

function actCode(status: ActStatus | undefined): string {
  if (status === undefined) {
    return "";
  }
  if (!status.rc_present) {
    return "rc_lost";
  }
  return status.armed ? "armed" : "disarmed";
}

export default function script(event: Event): Output {
  switch (event.topic) {
    case "/system_manager/state":
      sm = event.message;
      break;
    case "/mission_controller/state":
      mc = event.message;
      break;
    case "/mission_controller/mission_state":
      mission = event.message;
      break;
    case "/act/status":
      act = event.message;
      break;
  }

  const [code, text] = operatorAction();

  let layerText = "-";
  if (mission !== undefined && mission.total_layers > 0) {
    layerText = `${mission.current_layer} / ${mission.total_layers}`;
  }
  let plan = NO_DATA;
  if (sm !== undefined) {
    plan = sm.current_plan_id !== "" ? sm.current_plan_id : "(none)";
  }

  return {
    why: {
      do_now: text,
      sm_reason: reason(sm?.message),
      mc_reason: reason(mc?.message),
      plan,
      last_change: lastChange(act),
    },
    codes: {
      operator_wait: code,
      act_code: actCode(act),
      layer_text: layerText,
    },
  };
}
