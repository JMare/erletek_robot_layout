// PHCU commands for the print_mission layout.
//
// /phcu/diagnostics holds the commanded vibe (run, setpoint) as text key-values. This script
// turns them into fields that the Plot and State Transitions panels can show.
//
// Source: scripts/phcu_commands.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";

export const inputs = ["/phcu/diagnostics"];
export const output = "/studio_script/phcu_commands";

type Output = {
  vibe_run: boolean; // the PHCU node runs the vibe (latched /act/vibe/driver/run)
  vibe_hz_setpoint: number; // the frequency that the PHCU node sends (Hz)
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
  };
}
