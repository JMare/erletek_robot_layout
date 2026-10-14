// PHCU commands for the print_mission layout.
//
// /phcu/diagnostics holds the commanded vibe (run, setpoint) as text key-values. This script
// turns them into numbers for the "Vibe frequency" plot:
//
//   vibe_hz_setpoint   the frequency that the PHCU node sends (Hz), also when the vibe stops
//   vibe_hz_command    the setpoint while the vibe runs, else 0: the commanded frequency, to
//                      compare with the actual frequency (/act/vibe/state hz_actual)
//
// Source: scripts/phcu_commands.ts. make_layout.py copies this file into
// print_mission.layout.json.
import { Input } from "./types";

export const inputs = ["/phcu/diagnostics"];
export const output = "/studio_script/phcu_commands";

type Output = {
  vibe_hz_setpoint: number;
  vibe_hz_command: number;
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
  const setpoint = Number(hz);
  return {
    vibe_hz_setpoint: setpoint,
    vibe_hz_command: run === "true" ? setpoint : 0,
  };
}
