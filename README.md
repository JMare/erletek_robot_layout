# ERLEtek robot layout: print mission (Foxglove)

[print_mission.layout.json](print_mission.layout.json) is a
Foxglove layout for one print mission, from "plan loaded" to "print done". It shows the state of
each node, the reason for the state, what the robot and the actuators do, and when the operator
must act.

| File in `` | What |
|---|---|
| `print_mission.layout.json` | The layout. Import it in the Foxglove app. |
| `foxglove_bridge.yaml` | Bridge parameters for the layout: hidden topics on, `.STL` meshes allowed. |
| `scripts/*.ts` | The User Scripts of the layout (sources). |
| `make_layout.py` | Writes the layout from the panel list and `scripts/*.ts`. |

To change the layout, edit `make_layout.py` or a script, then run `python3 make_layout.py`.
Changes that you make in the app stay in the app. Export the layout to keep them.

## Start the stack and the bridge

The mock nodes use `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST` (see
[docs/system_emulation.md](../../../../docs/system_emulation.md)). Thus the bridge must run in
the same container, with the same discovery range and the same `ROS_DOMAIN_ID` as the stack.

Terminal 1, in the container: the mock stack.

```bash
cd ~/brian/ros_ws
make build
source install/setup.bash
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export ROS_DOMAIN_ID=87          # optional; use the same value in terminal 2
ros2 launch system_manager mock_system_bringup.launch.py
```

Terminal 2, in the container: the bridge.

```bash
source ~/brian/ros_ws/install/setup.bash
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export ROS_DOMAIN_ID=87          # the value of terminal 1
ros2 run foxglove_bridge foxglove_bridge --ros-args --params-file \
  $(ros2 pkg prefix etk_system_tools)/share/etk_system_tools/foxglove_bridge.yaml
```

You can also use `ros2 launch etk_system_tools monitoring.launch.xml foxglove:=true`, with the
same two `export` lines. That bridge has the default parameters. It does not send hidden topics,
so these panels stay empty: "Print progress", "execute_plan feedback" and the segment progress in
"Segment". It also refuses the `.STL` meshes, so the 3D panel shows the robot without its body.

## Connect and import

The container uses the host network. The bridge listens on port 8765.

1. In the Foxglove app on the host, open a connection: **Foxglove WebSocket**,
   `ws://localhost:8765`.
2. Open the **Layouts** menu, then **Import from file**. Select
   `ros_ws/src/system_management/etk_system_tools/print_mission.layout.json`.

Connect when the stack runs. The User Scripts use the topic types of the connection. Before the
topics exist, a script shows a type error and publishes nothing.

## Panels

The top band is always visible. Its four tiles in the first line tell where the mission is:

| Tile | Source | What it tells |
|---|---|---|
| SM: System Manager state | `/system_manager/state` | `IDLE`, `READY`, `OPERATING`, `ERROR` |
| MC: Mission Controller state | `/mission_controller/state` | `UNARMED` to `OPERATING`, `ERROR` |
| LOP: layer phase | `/mission_controller/mission_state` | The five Layer Operation Phases. Amber = the MC waits for the operator. |
| Operator: action needed now | User Script `mission_summary` | The next operator action, or "No action: the robot works" |

The second line shows the `/act` layer: ARMED or DISARMED, the RC deadman, and the holder of the
drive, the lift and the vibe (MC 50, UI 100, RC 255 = no client). The panel "Why" at the right
shows the state names, the `message` of the SM and of the MC, the plan ID, the layer, the
pending requests, the last holder change, and the operator action in words.

| Tab | Panels |
|---|---|
| 1 Mission timeline | State Transitions of the SM, MC, LOP, layer, operator action, `/act`, holders, path executor, lift motion and vibe run. Print progress (%), `execute_plan` feedback, mission log. |
| 2 Robot and path | 3D in `map`: robot (URDF), the segment path that Nav2 follows (green), the lookahead point (orange), the driven trail (blue), the footprint. Plots: speed (segment limit, Nav2 command, into the arbiter, arbiter to drive, actual), turn rate, segment progress and distance to the segment end. |
| 3 Actuators | Lift position and target (mm). Vibe actual and setpoint (Hz). State Transitions of the arbiter levels (holder, requested, change reason) and of the driver states. Health and `ready` of drive, lift, vibe and gate; drive energized; PHCU link and armed stream. |
| 4 Logs | `/rosout` of `system_manager`, `mission_controller`, `arbiter` and `path_executor` (INFO and up); all nodes (WARN and up). |
| 5 Operator (mock only) | Call Service buttons: GRANT (`/act/system/command`, 3), request arm, clear error, green light, cut done. **These buttons act on the system.** Use them in mock mode only. |

The State Transitions panels show the constant names of a field (for example `OPERATING`). The
arbiter levels have no constants, so they show the numbers 50, 100 and 255.

## Read a mission run

Read the top band from left to right, and the timeline from top to bottom. The examples are
from a mock run.

1. **Start.** SM `IDLE`, MC `UNARMED` ("the MC holds no actuator"), LOP `NONE`. `mock_rc` ARMs
   `/act`. The three holders show "RC, no client (255)". Operator: "Upload a print plan".
2. **Plan loaded.** Upload the plan with the GUI (`ui:=true`) or with the CLI:
   ```bash
   ros2 service call /system_manager/upload_print_plan cpr_interfaces/srv/UploadPrintPlan \
     "{plan: $(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["plan"]))' wall.mission)}"
   ```
   The SM stays `IDLE`. "Why" shows the plan ID and "loaded, waiting for the Mission Controller
   to be ARMED (GRANT on the RC)". The holders show "MC waits for GRANT". Operator: "Press
   GRANT". A faulty plan does not change the state; the SM message gives the first failed check,
   for example "layer 2: print_segment linear_speed is 0.05 m/s, must be > 0 and <= 0.03983 m/s".
3. **GRANT.** Use the RC (D-pad Right), the GRANT button of tab 5, or `auto_grant:=true`. The
   holders go to "MC (50)", with the change reason `GRANTED`. MC `ARMED`, then SM `READY`.
   Operator: "Start the print".
4. **Execute.** Send the goal:
   ```bash
   ros2 action send_goal --feedback /system_manager/execute_plan cpr_interfaces/action/ExecutePrint "{}"
   ```
   MC `OPERATING`, SM `OPERATING` ("Printing plan …"), LOP `ALIGNING`, layer = `start_layer`.
5. **Each layer.**
   - `ALIGNING`: tab 3, the lift target goes to the alignment height and the position follows.
     Then "Path executor" goes to `executing`. Tab 2: the speed limit steps to the segment
     speed, the Nav2 command and the actual speed follow it. The green path, the orange
     lookahead point and the blue trail move.
   - `READY_TO_START` (amber): the robot stops. Operator: "Give the GREEN LIGHT". The MC
     refuses the green light when it does not hold all three actuators, or when a health is old,
     not `OK` or not `ready`. The reply gives the reason.
   - `PRINTING`: the lift goes to the print height. "Vibe run" goes to true and the vibe
     frequency goes up to the setpoint (when the segment has `enable_vibrations`). The robot
     drives the print segment. The print progress goes up.
   - `WAITING_TO_RETURN` (amber): the vibe stops and the robot stops. Operator: "Cut, then
     confirm CUT DONE".
   - `RETURNING`: the robot drives the return segment. Then `ALIGNING` of the next layer, with
     the layer number + 1.
6. **Print done.** After the last `RETURNING`: MC `ARMED`, LOP `NONE`, SM `IDLE` with "Print of
   plan … completed". The SM calls MC `~/disarm`: the holders go to "RC, no client" (change
   reason `RELEASED`), MC `UNARMED`, the plan ID is empty.

**Control loss.** The RC takes an actuator (holder 255, change reason `TAKEN`), or the operator
presses REVOKE or DISARM. Outside a print: MC `PARTIALLY_ARMED` or `UNARMED`, SM `READY` → `IDLE`
("Mission Controller not ARMED any more … call request_arm and GRANT"). During a print: the MC
stays `OPERATING`, its message shows "lost control of: drive", and the operator tile is red.
Loss of the drive stops the robot and fails the segment. Loss of the lift or the vibe fails the
next MC lift or vibe call.

**Error.** A failed goal puts the MC and the SM in `ERROR`. The SM message gives the reason, for
example "layer 2 print: lost control of the drive (held at level 255 (RC))". LOP goes to `NONE`.
Operator: "Clear the error" (`/system_manager/clear_error_request`): SM `IDLE`, the plan is
cleared, the holders are released.

**RC lost.** "RC deadman" goes red and the arbiter DISARMs `/act` after 1 s. The MC loses
the three actuators: its message shows "lost control of: drive, lift, vibe (/act not armed)".

