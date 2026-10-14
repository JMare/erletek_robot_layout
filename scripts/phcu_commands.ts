// PHCU commands for the print_mission layout.
//
// /phcu/diagnostics holds the commanded vibe (run, setpoint) as text key-values. This script
// turns them into fields that the Plot and State Transitions panels can show.
//
// Source: etk_system_tools/config/foxglove/scripts/phcu_commands.ts. make_layout.py copies
// this file into print_mission.layout.json.
import { Input } from "./types";

export const inputs = ["/phcu/diagnostics"];
export const output = "/studio_script/phcu_commands";

type Output = {
  vibe_run: boolean; // the PHCU node runs the vibe (latched /act/vibe/driver/run)
  vibe_hz_setpoint: number; // the frequency that the PHCU node sends (Hz)
  lift_armed: boolean; // the PHCU node gets a fresh armed stream from the arbiter
  link_up: boolean; // the PHCU heartbeat is present
  summary: string; // DiagnosticStatus message: "OK" or the problems
};

function value(event: Input<"/phcu/diagnostics">, key: string): string | undefined {
  for (const kv of event.message.values) {
    if (kv.key === key) {
      return kv.value;
    }
  }
  return undefined;
}

export default function script(event: Input<"/phcu/diagnostics">): Output | undefined {
  const run = value(event, "vibe_run");
  const hz = value(event, "vibe_hz_setpoint");
  if (run === undefined || hz === undefined) {
    return undefined;
  }
  return {
    vibe_run: run === "true",
    vibe_hz_setpoint: Number(hz),
    lift_armed: value(event, "armed") === "true",
    link_up: value(event, "link_up") === "true",
    summary: event.message.message,
  };
}
