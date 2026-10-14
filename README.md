# ERLEtek robot layout: print mission (Foxglove)

This repository holds a Foxglove layout for one print mission of the ERLEtek robot (BRIAN),
from "plan loaded" to "print done". The layout shows the mission from above (the plan and
the robot in the `map` frame), the states and their reasons, the drive and the printhead as
analog plots (commanded against actual), and the logs.

The layout reads the topics of the ROS 2 stack in the `brian` repository (ROS 2 Jazzy). It
works with the mock stack and with the robot. It only reads topics: it has no panel that
calls a service.

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

Thus the layout has one band row at the top and at most four large panels for each tab.

## Start the stack and the bridge

### Mock mode

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
It cannot read `foxglove_bridge.yaml` of this repository. Thus give the parameter on the
command line:

```bash
source ~/devel/brian/ros_ws/install/setup.bash
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
export ROS_DOMAIN_ID=87          # the value of terminal 1
ros2 run foxglove_bridge foxglove_bridge --ros-args -p port:=8765 -p include_hidden:=true
```

`include_hidden:=true`: the action feedback topics (`.../_action/feedback`) are hidden topics.
The "Print progress (%)" plot reads one of them.

Alternative: copy the file into the container, then use it.

```bash
# On the host, in this repository. Find the container name with "docker ps".
docker cp foxglove_bridge.yaml <container>:/tmp/foxglove_bridge.yaml
# In the container, after the two "export" lines:
ros2 run foxglove_bridge foxglove_bridge --ros-args --params-file /tmp/foxglove_bridge.yaml
```

### Robot

Start the bridge on a computer of the robot, with the `ROS_DOMAIN_ID` of the robot and with
the same parameter (`include_hidden:=true`). The layout needs the nodes of a print mission:
the `/act` layer, the DCU, the PHCU, the System Manager, mission control (Nav2 and the Mission
Controller) and the localization. The localization must give `map → odom`: the global EKF
(`robot_localization_launch.py global:=true`). Without `map → odom`, the mission map cannot
show the robot.

## Connect and import

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

One row above the tabs. It is the only place for the states: the tabs do not show them again.
Read it from left to right.

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
| 1 Mission | **Mission map**: the plan and the robot from above, in `map`. **Why**: what to do now in words, the reason for the SM state and for the MC state, the plan ID, the last holder change of the actuators. **Linear speed** and **Rotation rate**: commanded against actual. |
| 2 Printhead and progress | **Lift height**: target against actual. **Vibe frequency**: commanded against actual. **Actuators** table: holder, health, ready and state of the drive, the lift, the vibe, the gate and the PHCU board. **Print progress (%)**. |
| 3 Logs | Mission nodes (SM, MC, arbiter, path executor; INFO and up). All nodes (WARN and up). |

### Mission map

A 3D panel in its 2D mode: an orthographic camera that looks down on `map`. `+x` is to the
right, `+y` is up, and the grid has 1 m squares. The panel shows no robot model, no map and
no costmap. It shows only the markers of three User Scripts:

| Marker | Script | Inputs |
|---|---|---|
| The plan: one line for each segment of each layer | `mission_plan` | `/system_manager/loaded_plan`, `/mission_controller/mission_state` |
| The robot (yellow triangle that points forward) and its driven trail (white line) | `robot_pose` | `/tf`, `/tf_static`, `/system_manager/loaded_plan` |
| The Nav2 lookahead point (orange dot) | `lookahead_marker` | `/lookahead_point` |

The plan lines:

| Line | Means |
|---|---|
| Blue | Approach (alignment segment): from the robot to the start of the print. |
| Green | Print segment. |
| Purple | Return segment. |
| Widest line, label "(now)" | The segment that the robot drives now. |
| Wide line, label "(next)" | The segment that comes next: the MC waits for the operator (green light or cut done). |
| Faint line | A segment that is done, or a layer before the start layer. |

The layers of a wall have the same path in the plane. Thus their lines are on top of each
other. The current layer is on top and has a label on each segment (for example
`L2 print (now)`). Before a print, the labels are on the start layer. The title above the
plan gives the plan name, the number of layers and the start layer. When no plan is loaded,
the map shows no plan.

The plan comes from the System Manager on `/system_manager/loaded_plan`
(`cpr_interfaces/msg/PrintPlan`, reliable, transient local, depth 1). The SM publishes it when
it loads a plan and when it clears the plan (an empty plan). Because the topic is latched, the
plan shows also when the app connects after the upload. See `docs/system_manager.md` in
`brian`.

The robot pose comes from TF. The panel draws the triangle in `base_link`, at the latest TF
pose of `base_link` in `map`. For the trail, the script composes the two TF links
`map → odom` and `odom → base_link`:

| Mode | `map → odom` | `odom → base_link` |
|---|---|---|
| Robot | The global EKF (GPS), on `/tf`. It changes when the GPS corrects the pose. | The local EKF, on `/tf`. |
| Mock | A static identity transform, on `/tf_static`. | The local EKF, on `/tf`. |

Thus the robot and the trail are in `map` in the two modes. A trail from `/odometry/local`
would be in `odom`: on the robot, it would not agree with the plan. The trail adds a point
when the robot moved 2 cm or more, and keeps the last 5000 points. A new plan starts a new
trail.

The camera fits a plan from x = −0.75 m to 4.75 m and y = 0 m to 1.5 m (the `wall_3m` test
mission). For other plans, pan and zoom with the mouse.

### Analog plots

| Plot | Series | Topic and field |
|---|---|---|
| Linear speed (m/s) | Segment limit (MC), points only | `/speed_limit` `speed_limit`: the MC publishes it at the start of each segment |
| | Nav2 command | `/mission_controller/nav_cmd_vel` `twist.linear.x` |
| | Commanded (to drive) | `/act/drive/driver/cmd_vel` `twist.linear.x`: the arbiter output, from the RC, the UI or the MC |
| | Actual (odometry) | `/act/drive/odom` `twist.twist.linear.x`: `diff_drive`, from the drive encoders |
| Rotation rate (rad/s) | Nav2 command, Commanded (to drive), Actual (odometry) | The same topics, `angular.z` |
| Lift height (mm) | Target, Actual | `/act/lift/state` `target_mm`, `position_mm` |
| Vibe frequency (Hz) | Setpoint | script `phcu_commands`: `vibe_hz_setpoint` of `/phcu/diagnostics` |
| | Commanded | script `phcu_commands`: the setpoint while the vibe runs, else 0 |
| | Actual (VFD) | `/act/vibe/state` `hz_actual` |
| Print progress (%) | Planned path length done | `/system_manager/execute_plan/_action/feedback` `feedback.progress_percentage` |

The arbiter forwards a drive command only while the holder of the drive sends commands. Nav2
sends commands only during a segment. Thus the command lines stop when no client commands
the drive. The actual line continues.

The columns of the **Actuators** table:

| Column | What |
|---|---|
| holder | The client that holds the actuator: MC (50), UI (100), or RC (no client, 255). Then the client that waits for GRANT. |
| health | `OK`, `OUTAGE` or `FAULT`. `OLD (x s)` when the last health message is older than 1 s. The MC then refuses the green light. |
| ready | `NO (setup)`: the actuator needs operator setup, for example the lift is not homed. For the PHCU board: the link. |
| state | Drive: energized. Lift: motion, position → target, calibration. Vibe: state, run, actual and setpoint frequency, VFD fault. Gate: state. PHCU board: armed stream and the diagnostics message. |

## No service buttons

The layout has no panel that calls a service. An earlier version had an "Operator (mock
only)" tab with buttons for request arm, GRANT, green light, cut done and clear error. When
the app connects to the robot, such buttons move the robot. On the robot, the GUI and the RC
are the operator. To send System Manager commands from a terminal, use the shell tool of
`brian` (see `docs/run_a_mission.md` in `brian`), or `ros2 service call` and
`ros2 action send_goal`.

The 3D panel has publish tools (click to publish a point or a pose). The layout does not use
them. Do not use them on the robot.

## Read a mission run

Read the band from left to right. Then read tab 1: the mission map at the left, "Why" and the
drive plots at the right. The examples are from a mock run.

1. **Start.** SM `IDLE`, MC `UNARMED`, LOP `NONE`. `mock_rc` ARMs `/act`: the `/act` tile
   shows `/act ARMED`. The mission map shows the robot and no plan. Operator: "Upload a print
   plan".
2. **Plan loaded.** Upload the plan with the GUI (`ui:=true`) or with the CLI:
   ```bash
   ros2 run cpr_path_execution upload_mission.py wall.mission
   ```
   The SM stays `IDLE`. The mission map shows the plan, with the labels on the start layer.
   "Why" shows the plan ID, and `sm_reason` shows "Plan … loaded, waiting for the Mission
   Controller to be ARMED (GRANT on the RC)". Tab 2, "Actuators": the holder column shows
   "MC waits for GRANT". Operator: "GRANT on the RC". A faulty plan does not change the state
   or the map. `sm_reason` gives the first failed check, for example "layer 2: print_segment
   linear_speed is 0.05 m/s, must be > 0 and <= 0.03983 m/s".
3. **GRANT.** Use the RC (D-pad Right), or `auto_grant:=true` in mock mode. The holders go to
   "MC (50)". `last_change` shows `GRANTED`. MC `ARMED`, then SM `READY`. Operator: "Start the
   print".
4. **Execute.** Send the goal:
   ```bash
   ros2 action send_goal --feedback /system_manager/execute_plan cpr_interfaces/action/ExecutePrint "{}"
   ```
   MC `OPERATING`, SM `OPERATING`, LOP `1 ALIGNING`, Layer = `start_layer`.
5. **Each layer.**
   - `1 ALIGNING`: tab 2, the lift target goes to the alignment height and the actual height
     follows. The blue approach line has the label "(now)". The robot moves on it, with the
     orange lookahead point in front of it. "Linear speed": the limit point shows the segment
     speed, and the Nav2 command, the commanded speed and the actual speed follow it.
   - `2 READY TO START` (amber): the robot stops. The green print line has the label "(next)".
     Operator: "Give the GREEN LIGHT". The MC refuses the green light when it does not hold
     all three actuators, or when a health is old, not `OK` or not ready (tab 2,
     "Actuators"). The reply of the service gives the reason.
   - `3 PRINTING`: the lift goes to the print height. The commanded vibe frequency goes to the
     setpoint and the actual frequency follows (when the segment has `enable_vibrations`). The
     robot drives the print line. The print progress goes up.
   - `4 WAITING TO RETURN` (amber): the vibe stops and the robot stops. The purple return line
     has the label "(next)". Operator: "Cut, then confirm CUT DONE".
   - `5 RETURNING`: the robot drives the return line. Then `1 ALIGNING` of the next layer: the
     lines of the layer that is done become faint, and the labels go to the next layer. The
     Layer tile goes up by 1.
6. **Print done.** After the last `RETURNING`: MC `ARMED`, LOP `NONE`, SM `IDLE` with "Print of
   plan … completed". The SM clears the plan: the mission map shows no plan. The SM calls MC
   `~/disarm`: the holders go to "RC (no client)", `last_change` shows `RELEASED`, MC
   `UNARMED`, and the plan is "(none)".

**Control loss.** The RC takes an actuator (holder "RC (no client)", `last_change` `TAKEN`),
or the operator presses REVOKE or DISARM. Outside a print: MC `PARTIALLY ARMED` or `UNARMED`,
SM `READY` → `IDLE` ("Mission Controller not ARMED any more … call request_arm and GRANT").
During a print: the MC stays `OPERATING`, `mc_reason` shows "lost control of: drive", and the
Operator tile is red ("Control lost: see Why"). Loss of the drive stops the robot and fails
the segment. Loss of the lift or the vibe fails the next MC lift or vibe call.

**Error.** A failed goal puts the MC and the SM in `ERROR`. `sm_reason` gives the reason, for
example "layer 2 print: lost control of the drive (held at level 255 (RC))". LOP goes to
`NONE`. The plan stays on the map. Operator: "Clear the error"
(`/system_manager/clear_error_request`): SM `IDLE`, the plan is cleared, the holders are
released.

**RC lost.** The `/act` tile shows `RC LOST`. The arbiter DISARMs `/act` after 1 s. The MC
loses the three actuators: `mc_reason` shows "lost control of: drive, lift, vibe (/act not
armed)".
