# ERLEtek robot layout: print mission (Foxglove)

This repository holds a Foxglove layout for one print mission of the ERLEtek robot (BRIAN),
from "plan loaded" to "print done". The layout shows the state of each node, the reason for
the state, what the robot and the actuators do, and when the operator must act.

The layout reads the topics of the ROS 2 stack in the `brian` repository (ROS 2 Jazzy). It
works with the mock stack and with the robot.

| File | What |
|---|---|
| `print_mission.layout.json` | The layout. Import it in the Foxglove app. Do not edit it: `make_layout.py` writes it. |
| `make_layout.py` | The source of the layout: panels, tabs, split sizes. It embeds `scripts/*.ts`. |
| `scripts/*.ts` | The User Scripts of the layout (sources). |
| `foxglove_bridge.yaml` | The reference bridge parameters for the layout. |

To change the layout, edit `make_layout.py` or a script. Then run `python3 make_layout.py`
and import the new JSON. The app keeps the changes that you make in the app. It does not
write them to this repository. To keep them, export the layout and copy the changes into
`make_layout.py`.

## Screen size

The layout is for a small laptop screen. The target is a MacBook Air 13.6" at its default
scaled resolution of 1470 × 956 points. After the macOS menu bar, the window title bar and
the Foxglove bars, about 1400 × 820 points stay for the panels. The layout also fits the 15"
model (1710 × 1107) and a 1920 × 1080 screen at 150 % scaling.

Thus the layout has one band row at the top and at most four panels for each tab (the
operator tab has five buttons and one warning). Each tab has at most two plots.

## Start the stack and the bridge

Do these steps in the development container of `brian`. The mock nodes use
`ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST` (see `docs/system_emulation.md` in `brian`). Thus
the bridge must run in the same container, with the same discovery range and the same
`ROS_DOMAIN_ID` as the stack.

Terminal 1, in the container: the mock stack.

```bash
cd ~/devel/brian/ros_ws
make build
source install/setup.bash
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export ROS_DOMAIN_ID=87          # optional; use the same value in terminal 2
ros2 launch system_manager mock_system_bringup.launch.py
```

Terminal 2, in the container: the bridge. The container mounts only the `brian` repository.
It cannot read `foxglove_bridge.yaml` of this repository. Thus give the parameters on the
command line:

```bash
source ~/devel/brian/ros_ws/install/setup.bash
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export ROS_DOMAIN_ID=87          # the value of terminal 1
ros2 run foxglove_bridge foxglove_bridge --ros-args -p port:=8765 -p include_hidden:=true \
  -p "asset_uri_allowlist:=['^package://(?:[-\w%]+/)*[-\w%.]+\.(?:dae|fbx|glb|gltf|jpeg|jpg|mtl|obj|png|stl|STL|tif|tiff|urdf|webp|xacro)\$']"
```

Keep the quotes as they are. The `\$` stops the shell. The bridge gets the same allowlist as
in `foxglove_bridge.yaml`.

The two parameters:

- `include_hidden:=true`: the action feedback topics (`.../_action/feedback`) are hidden
  topics. The panels "Print progress (%)" and "Segment" read them.
- `asset_uri_allowlist`: adds the upper-case `.STL` of the robot meshes. The default list has
  only `.stl`. Without it, the 3D panel shows the robot without its body.

Alternative: copy the file into the container, then use it.

```bash
# On the host, in this repository. Find the container name with "docker ps".
docker cp foxglove_bridge.yaml erletek_dev_container_v1.2.0:/tmp/foxglove_bridge.yaml
# In the container, after the two "export" lines:
ros2 run foxglove_bridge foxglove_bridge --ros-args --params-file /tmp/foxglove_bridge.yaml
```

## Connect and import

The container uses the host network. The bridge listens on port 8765.

1. In the Foxglove app, open a connection: **Open connection** → **Foxglove WebSocket** →
   `ws://<host>:8765`. On the same computer, `<host>` is `localhost`. For the robot, use
   its address.
2. Open the **Layouts** menu, then **Import from file**. Select `print_mission.layout.json`
   of this repository.

Connect when the stack runs. A User Script runs only when all its input topics exist. Before
that, it shows an error and publishes nothing. The script `actuator_status` needs the four
`/act/*/health` topics, `/act/drive/state` and `/phcu/diagnostics`. Thus the PHCU node and
the drive must run.

## Panels

### Band (always visible)

One row above the tabs. Read it from left to right.

| Tile | Source | What it tells |
|---|---|---|
| SM state | `/system_manager/state` | `IDLE`, `READY`, `OPERATING`, `ERROR` |
| MC state | `/mission_controller/state` | `UNARMED` to `OPERATING`, `ERROR` |
| Layer phase (LOP) | `/mission_controller/mission_state` | The five Layer Operation Phases. Amber: the MC waits for the operator. |
| Layer | script `mission_summary` | Current layer / total layers |
| /act gate | script `mission_summary` | `/act ARMED`, `/act DISARMED` or `RC LOST` |
| Operator: do now | script `mission_summary` | The next operator action, or "No action: the robot works" |

### Tabs

| Tab | Panels |
|---|---|
| 1 Mission | **Why**: what to do now, the SM and the MC state with the reason, the phase and the layer, the plan, `/act`, the holders, the requests that wait for GRANT, the last holder change. **Mission timeline**: SM, MC, LOP, layer, operator action, `/act`. **Print progress (%)**. **Mission log**: `system_manager`, `mission_controller`, arbiter, `path_executor` (INFO and up). |
| 2 Robot and path | **3D** in `map`: the robot, the segment path that Nav2 follows (green), the lookahead point (orange), the driven trail (blue), the footprint. **Speed**: segment limit, Nav2 command, arbiter to drive, actual. **Segment**: progress and distance to the segment end. **Drive chain**: path executor status, drive holder, drive energized. |
| 3 Actuators | **Actuators** table: one row for the drive, the lift, the vibe, the gate and the PHCU board. **Actuator timeline**: `/act`, the holders, drive energized, lift motion, vibe run. **Lift height (mm)**: position and target. **Vibe frequency (Hz)**: actual and setpoint. |
| 4 Logs | Mission nodes (INFO and up). All nodes (WARN and up). |
| 5 Operator (mock only) | Buttons: 1 Request arm, 2 GRANT, 3 Green light, 4 Cut done, Clear error. |

The columns of the **Actuators** table:

| Column | What |
|---|---|
| holder | The client that holds the actuator: MC (50), UI (100), or RC (no client, 255). Then the client that waits for GRANT. |
| health | `OK`, `OUTAGE` or `FAULT`. `OLD (x s)` when the last health message is older than 1 s. The MC then refuses the green light. |
| ready | `NO (setup)`: the actuator needs operator setup, for example the lift is not homed. For the PHCU board: the link. |
| state | Drive: energized. Lift: motion, position → target, calibration. Vibe: state, run, actual and setpoint frequency, VFD fault. Gate: state. PHCU board: armed stream and the diagnostics message. |

The State Transitions panels show the constant names of a field (for example `OPERATING`).

### Operator tab: acts on the real system

**The buttons of tab 5 call services on the system that the app connects to.** When the app
connects to the robot, the buttons act on the robot: GRANT gives the actuators to the MC, and
"Green light" starts a print segment. Use tab 5 in mock mode only. On the robot, the GUI and
the RC are the operator.

## Read a mission run

Read the band from left to right. Then read tab 1: "Why" at the left, the timeline at the
right, from top to bottom. The examples are from a mock run.

1. **Start.** SM `IDLE`, MC `UNARMED`, LOP `NONE`. `mock_rc` ARMs `/act`: the `/act` tile
   shows `/act ARMED`. In "Why", `holders` shows "RC (no client)" for the three actuators.
   Operator: "Upload a print plan".
2. **Plan loaded.** Upload the plan with the GUI (`ui:=true`) or with the CLI:
   ```bash
   ros2 service call /system_manager/upload_print_plan cpr_interfaces/srv/UploadPrintPlan \
     "{plan: $(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))["plan"]))' wall.mission)}"
   ```
   The SM stays `IDLE`. "Why" shows the plan ID, `sm` shows "loaded, waiting for the Mission
   Controller to be ARMED (GRANT on the RC)", and `waiting_for_grant` shows the MC requests.
   Operator: "GRANT on the RC". A faulty plan does not change the state. The `sm` line gives
   the first failed check, for example "layer 2: print_segment linear_speed is 0.05 m/s, must
   be > 0 and <= 0.03983 m/s".
3. **GRANT.** Use the RC (D-pad Right), the GRANT button of tab 5, or `auto_grant:=true`. The
   holders go to "MC (50)". `last_change` shows `GRANTED`. MC `ARMED`, then SM `READY`.
   Operator: "Start the print".
4. **Execute.** Send the goal:
   ```bash
   ros2 action send_goal --feedback /system_manager/execute_plan cpr_interfaces/action/ExecutePrint "{}"
   ```
   MC `OPERATING`, SM `OPERATING` ("Printing plan …"), LOP `1 ALIGNING`, Layer = `start_layer`.
5. **Each layer.**
   - `1 ALIGNING`: tab 3, the lift target goes to the alignment height and the position
     follows. Then tab 2, "Drive chain": the path executor goes to `executing`. "Speed": the
     limit steps to the segment speed, and the Nav2 command and the actual speed follow it.
     The green path, the orange lookahead point and the blue trail move.
   - `2 READY TO START` (amber): the robot stops. Operator: "Give the GREEN LIGHT". The MC
     refuses the green light when it does not hold all three actuators, or when a health is
     old, not `OK` or not ready (tab 3, "Actuators"). The reply of the service gives the
     reason.
   - `3 PRINTING`: the lift goes to the print height. "Vibe run" goes to true and the vibe
     frequency goes up to the setpoint (when the segment has `enable_vibrations`). The robot
     drives the print segment. The print progress goes up.
   - `4 WAITING TO RETURN` (amber): the vibe stops and the robot stops. Operator: "Cut, then
     confirm CUT DONE".
   - `5 RETURNING`: the robot drives the return segment. Then `1 ALIGNING` of the next layer.
     The Layer tile goes up by 1.
6. **Print done.** After the last `RETURNING`: MC `ARMED`, LOP `NONE`, SM `IDLE` with "Print of
   plan … completed". The SM calls MC `~/disarm`: the holders go to "RC (no client)",
   `last_change` shows `RELEASED`, MC `UNARMED`, and the plan is "(none)".

**Control loss.** The RC takes an actuator (holder "RC (no client)", `last_change` `TAKEN`),
or the operator presses REVOKE or DISARM. Outside a print: MC `PARTIALLY ARMED` or `UNARMED`,
SM `READY` → `IDLE` ("Mission Controller not ARMED any more … call request_arm and GRANT").
During a print: the MC stays `OPERATING`, its reason shows "lost control of: drive", and the
Operator tile is red ("Control lost: see Why"). Loss of the drive stops the robot and fails
the segment. Loss of the lift or the vibe fails the next MC lift or vibe call.

**Error.** A failed goal puts the MC and the SM in `ERROR`. The `sm` line gives the reason,
for example "layer 2 print: lost control of the drive (held at level 255 (RC))". LOP goes to
`NONE`. Operator: "Clear the error" (`/system_manager/clear_error_request`): SM `IDLE`, the
plan is cleared, the holders are released.

**RC lost.** The `/act` tile shows `RC LOST`. The arbiter DISARMs `/act` after 1 s. The MC
loses the three actuators: its reason shows "lost control of: drive, lift, vibe (/act not
armed)".
