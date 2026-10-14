// Actuator status table for the print_mission layout.
//
// One row for each actuator (drive, lift, vibe, gate) and one row for the PHCU board. The
// columns tell who holds the actuator, its health, if it is ready, and what it does now.
// The Table panel "Actuators: holder, health, ready, state" shows the rows.
//
// The Mission Controller refuses the green light when a health message is older than
// health_timeout_s (1.0 s), not OK, or not ready. The health column shows the age when the
// message is older than HEALTH_OLD_S.
//
// Source: scripts/actuator_status.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";

export const inputs = [
  "/act/status",
  "/act/drive/health",
  "/act/lift/health",
  "/act/vibe/health",
  "/act/gate/health",
  "/act/drive/state",
  "/phcu/diagnostics",
];
export const output = "/studio_script/actuator_status";

type Row = {
  actuator: string;
  holder: string; // client that holds the actuator, and the client that waits for GRANT
  health: string; // OK, OUTAGE or FAULT, with the age when old
  ready: string; // false = needs operator setup (for example, lift not homed)
  state: string; // what the actuator does now
};

type Output = {
  rows: Row[];
};

type Event =
  | Input<"/act/status">
  | Input<"/act/drive/health">
  | Input<"/act/lift/health">
  | Input<"/act/vibe/health">
  | Input<"/act/gate/health">
  | Input<"/act/drive/state">
  | Input<"/phcu/diagnostics">;

type ActStatus = Input<"/act/status">["message"];
type ActuatorStatus = ActStatus["drive"];
type Health = Input<"/act/drive/health">["message"];
type DriveState = Input<"/act/drive/state">["message"];
type Diagnostics = Input<"/phcu/diagnostics">["message"];
type Time = Input<"/act/status">["receiveTime"];

// Constants of etk_actuation_interfaces/msg/ActuatorHealth.
const HEALTH_NAMES = ["OK", "OUTAGE", "FAULT"];
// The Mission Controller parameter health_timeout_s.
const HEALTH_OLD_S = 1.0;
const NO_DATA = "(no data)";

type Received<T> = { message: T; time: Time };

// The last message of each input. The script runs once for each input message.
let act: ActStatus | undefined;
let drive: DriveState | undefined;
let diagnostics: Diagnostics | undefined;
const health: Record<string, Received<Health> | undefined> = {};

function seconds(t: Time): number {
  return t.sec + t.nsec * 1e-9;
}

function levelName(level: number): string {
  switch (level) {
    case 255:
      return "RC";
    case 100:
      return "UI";
    case 50:
      return "MC";
    default:
      return `level ${level}`;
  }
}

function holder(status: ActuatorStatus | undefined): string {
  if (status === undefined) {
    return NO_DATA;
  }
  const who = status.level === 255 ? "RC (no client)" : `${levelName(status.level)} (${status.level})`;
  if (status.requested_level > 0) {
    return `${who}; ${levelName(status.requested_level)} waits for GRANT`;
  }
  return who;
}

function healthText(actuator: string, now: Time): string {
  const h = health[actuator];
  if (h === undefined) {
    return NO_DATA;
  }
  const text = HEALTH_NAMES[h.message.health] ?? `UNKNOWN (${h.message.health})`;
  const age = seconds(now) - seconds(h.time);
  return age > HEALTH_OLD_S ? `${text}, OLD (${age.toFixed(1)} s)` : text;
}

function readyText(actuator: string): string {
  const h = health[actuator];
  if (h === undefined) {
    return NO_DATA;
  }
  return h.message.ready ? "yes" : "NO (setup)";
}

function diag(key: string): string {
  if (diagnostics === undefined) {
    return "?";
  }
  for (const kv of diagnostics.values) {
    if (kv.key === key) {
      return kv.value;
    }
  }
  return "?";
}

function stale(validKey: string): string {
  return diag(validKey) === "false" ? ", telemetry OLD" : "";
}

function driveState(): string {
  if (drive === undefined) {
    return NO_DATA;
  }
  return drive.energized ? "energized" : "NOT energized";
}

function liftState(): string {
  if (diagnostics === undefined) {
    return NO_DATA;
  }
  return (
    `${diag("lift_motion")}, ${diag("lift_position_mm")} mm -> ${diag("lift_target_mm")} mm, ` +
    `${diag("lift_cal")}${stale("lift_valid")}`
  );
}

function vibeState(): string {
  if (diagnostics === undefined) {
    return NO_DATA;
  }
  const run = diag("vibe_run") === "true" ? "run" : "stop";
  const fault = diag("vfd_fault") === "true" ? ", VFD FAULT" : "";
  return (
    `${diag("vibe_state")}, ${run}, ${diag("vibe_hz_actual")} Hz (setpoint ${diag("vibe_hz_setpoint")})` +
    `${fault}${stale("vibe_valid")}`
  );
}

function gateState(): string {
  if (diagnostics === undefined) {
    return NO_DATA;
  }
  return `${diag("gate_state")}${stale("gate_valid")}`;
}

function phcuRow(): Row {
  if (diagnostics === undefined) {
    return { actuator: "PHCU board", holder: "-", health: NO_DATA, ready: "-", state: NO_DATA };
  }
  const link = diag("link_up") === "true" ? "link up" : "link DOWN";
  const armed = diag("armed") === "true" ? "gets armed" : "NOT armed";
  const faults = diag("faults");
  return {
    actuator: "PHCU board",
    holder: "-",
    health: faults === "0x0000" ? diag("phcu_state") : `${diag("phcu_state")}, faults ${faults}`,
    ready: link,
    state: `${armed}; ${diagnostics.message}`,
  };
}

export default function script(event: Event): Output {
  switch (event.topic) {
    case "/act/status":
      act = event.message;
      break;
    case "/act/drive/health":
      health.drive = { message: event.message, time: event.receiveTime };
      break;
    case "/act/lift/health":
      health.lift = { message: event.message, time: event.receiveTime };
      break;
    case "/act/vibe/health":
      health.vibe = { message: event.message, time: event.receiveTime };
      break;
    case "/act/gate/health":
      health.gate = { message: event.message, time: event.receiveTime };
      break;
    case "/act/drive/state":
      drive = event.message;
      break;
    case "/phcu/diagnostics":
      diagnostics = event.message;
      break;
  }

  const now = event.receiveTime;
  const row = (actuator: string, status: ActuatorStatus | undefined, state: string): Row => ({
    actuator,
    holder: holder(status),
    health: healthText(actuator, now),
    ready: readyText(actuator),
    state,
  });

  return {
    rows: [
      row("drive", act?.drive, driveState()),
      row("lift", act?.lift, liftState()),
      row("vibe", act?.vibe, vibeState()),
      row("gate", act?.gate, gateState()),
      phcuRow(),
    ],
  };
}
