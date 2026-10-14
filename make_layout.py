#!/usr/bin/env python3
"""Write print_mission.layout.json, the Foxglove layout for a print-mission run.

The layout embeds the User Scripts of scripts/*.ts. Edit the scripts or this file, then run:

    python3 make_layout.py

The output is a layout file for "Import layout" in the Foxglove app. See ../../README.md.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'print_mission.layout.json'

GREY = '#6b7280'
BLUE = '#2563eb'
GREEN = '#16a34a'
AMBER = '#d97706'
RED = '#dc2626'
PURPLE = '#7c3aed'
TEAL = '#0891b2'

config_by_id = {}


def panel(kind, name, title, config):
    panel_id = f'{kind}!{name}'
    config_by_id[panel_id] = {'foxglovePanelTitle': title, **config}
    return panel_id


def split(direction, items, sizes=None):
    """Mosaic split of the items. sizes: percentages, default equal."""
    if sizes is None:
        sizes = [100.0 / len(items)] * len(items)
    if len(items) == 1:
        return items[0]
    first_pct = 100.0 * sizes[0] / sum(sizes)
    return {
        'direction': direction,
        'first': items[0],
        'second': split(direction, items[1:], sizes[1:]),
        'splitPercentage': round(first_pct, 2),
    }


def row(items, sizes=None):
    return split('row', items, sizes)


def column(items, sizes=None):
    return split('column', items, sizes)


def rule(value, label, color, operator='='):
    return {'operator': operator, 'rawValue': str(value), 'color': color, 'label': label}


def indicator(name, title, path, rules, fallback_label='no data', fallback_color=GREY):
    return panel('Indicator', name, title, {
        'path': path,
        'style': 'background',
        'fallbackColor': fallback_color,
        'fallbackLabel': fallback_label,
        'rules': rules,
    })


def series(value, label, color=None):
    item = {'value': value, 'enabled': True, 'timestampMethod': 'receiveTime', 'label': label}
    if color is not None:
        item['color'] = color
    return item


def plot(name, title, paths, min_y=None, max_y=None, window_s=180):
    config = {
        'paths': paths,
        'showLegend': True,
        'legendDisplay': 'top',
        'showPlotValuesInLegend': True,
        'showXAxisLabels': True,
        'showYAxisLabels': True,
        'isSynced': True,
        'xAxisVal': 'timestamp',
        'followingViewWidth': window_s,
        'sidebarDimension': 240,
    }
    if min_y is not None:
        config['minYValue'] = min_y
    if max_y is not None:
        config['maxYValue'] = max_y
    return panel('Plot', name, title, config)


def transitions(name, title, paths):
    return panel('StateTransitions', name, title, {'paths': paths, 'isSynced': True, 'showPoints': True})


def raw(name, title, topic_path):
    return panel('RawMessages', name, title, {
        'topicPath': topic_path,
        'diffEnabled': False,
        'diffMethod': 'custom',
        'diffTopicPath': '',
        'showFullMessageForDiff': False,
        'expansion': 'all',
        'fontSize': 13,
    })


def log(name, title, min_level, hidden_names=()):
    return panel('RosOut', name, title, {
        'topicToRender': '/rosout',
        'searchTerms': [],
        'minLogLevel': min_level,
        'nameFilter': {n: {'visible': False} for n in hidden_names},
    })


def call_service(name, title, service, button, tooltip, color, payload='{}'):
    return panel('CallService', name, title, {
        'serviceName': service,
        'requestPayload': payload,
        'layout': 'vertical',
        'buttonText': button,
        'buttonTooltip': tooltip,
        'buttonColor': color,
    })


# ---------------------------------------------------------------------------------------------
# Top band: always visible. Where are we, and why.

SM_RULES = [
    rule(0, 'IDLE: no plan, or waits for MC ARMED', GREY),
    rule(1, 'READY: plan loaded, MC ARMED', BLUE),
    rule(2, 'OPERATING: print runs', GREEN),
    rule(3, 'ERROR: see SM message', RED),
]
MC_RULES = [
    rule(0, 'UNARMED: holds nothing', GREY),
    rule(1, 'PARTIALLY_ARMED: holds some', AMBER),
    rule(2, 'ARMED: holds drive, lift, vibe', BLUE),
    rule(3, 'OPERATING: runs the goal', GREEN),
    rule(4, 'ERROR: goal failed', RED),
]
LOP_RULES = [
    rule(0, 'NONE (MC not OPERATING)', GREY),
    rule(1, '1 ALIGNING: lift, then drive to start', BLUE),
    rule(2, '2 READY_TO_START: waits for green light', AMBER),
    rule(3, '3 PRINTING: lift, vibe, print segment', GREEN),
    rule(4, '4 WAITING_TO_RETURN: waits for cut done', AMBER),
    rule(5, '5 RETURNING: return segment', BLUE),
]
OPERATOR_RULES = [
    rule('none', 'No action: the robot works', GREEN),
    rule('wait', 'Wait', GREY),
    rule('upload', 'Upload a print plan', BLUE),
    rule('arm', 'ARM on the RC (D-pad Up)', AMBER),
    rule('grant', 'Press GRANT on the RC (D-pad Right)', AMBER),
    rule('request_arm', 'Request arm, then GRANT', AMBER),
    rule('execute', 'Start the print (execute_plan)', BLUE),
    rule('green_light', 'Give the GREEN LIGHT (start_layer)', AMBER),
    rule('cut_done', 'Cut, then confirm CUT DONE', AMBER),
    rule('control_lost', 'Control lost: see MC message', RED),
    rule('clear_error', 'Clear the error', RED),
    rule('rc', 'Switch on the RC', RED),
]


def holder_rules(actuator):
    return [
        rule(50, f'{actuator}: MC (50)', BLUE),
        rule(100, f'{actuator}: UI (100)', PURPLE),
        rule(255, f'{actuator}: RC, no client (255)', GREY),
    ]


band_states = row([
    indicator('sm_state', 'SM: System Manager state', '/system_manager/state.state', SM_RULES),
    indicator('mc_state', 'MC: Mission Controller state', '/mission_controller/state.state', MC_RULES),
    indicator('lop', 'LOP: layer phase', '/mission_controller/mission_state.state', LOP_RULES),
    indicator('operator', 'Operator: action needed now', '/studio_script/mission_summary.operator_wait',
              OPERATOR_RULES),
])
band_act = row([
    indicator('act_armed', '/act safety gate', '/act/status.armed',
              [rule('true', 'ARMED', GREEN)], 'DISARMED', RED),
    indicator('rc_present', 'RC deadman', '/act/status.rc_present',
              [rule('true', 'RC present', GREEN)], 'RC NOT present', RED),
    indicator('drive_holder', 'Drive: holder', '/act/status.drive.level', holder_rules('Drive')),
    indicator('lift_holder', 'Lift: holder', '/act/status.lift.level', holder_rules('Lift')),
    indicator('vibe_holder', 'Vibe: holder', '/act/status.vibe.level', holder_rules('Vibe')),
])
band = row([
    column([band_states, band_act]),
    raw('summary', 'Why: state names, reasons, layer, holders, next operator action',
        '/studio_script/mission_summary'),
], [62, 38])

# ---------------------------------------------------------------------------------------------
# Tab 1: mission timeline.

timeline = transitions('timeline', 'Mission timeline: read from top to bottom, left to right', [
    series('/system_manager/state.state', 'SM state'),
    series('/mission_controller/state.state', 'MC controller state'),
    series('/mission_controller/mission_state.state', 'LOP (mission state)'),
    series('/mission_controller/mission_state.current_layer', 'Layer'),
    series('/studio_script/mission_summary.operator_wait', 'Operator action needed'),
    series('/act/status.armed', '/act ARMED'),
    series('/act/status.rc_present', 'RC present'),
    series('/studio_script/mission_summary.drive_holder', 'Drive holder'),
    series('/studio_script/mission_summary.lift_holder', 'Lift holder'),
    series('/studio_script/mission_summary.vibe_holder', 'Vibe holder'),
    series('/path_executor/status.data', 'Path executor'),
    series('/act/lift/state.motion', 'Lift motion'),
    series('/studio_script/phcu_commands.vibe_run', 'Vibe run'),
])
progress = plot('progress', 'Print progress (%): planned path length done', [
    series('/system_manager/execute_plan/_action/feedback.feedback.progress_percentage',
           'Print progress (%)', GREEN),
], min_y=0, max_y=100, window_s=1800)
sm_feedback = raw('sm_feedback', 'execute_plan feedback (SM to GUI)',
                  '/system_manager/execute_plan/_action/feedback.feedback')

# Loggers that are not part of the mission flow. The mission log hides them; the
# warnings log shows all.
OTHER_LOGGERS = [
    'controller_server', 'diffbot_base_controller', 'controller_manager',
    'controller_manager.hardware_component.system.dcu', 'controller_manager.pal_statistics',
    'resource_manager', 'rclcpp', 'local_costmap.local_costmap', 'lifecycle_manager_navigation',
    'map_server', 'map_io', 'phcu_node', 'signal_tower', 'watchdog', 'mock_rc', 'dcu',
    'ekf_local', 'robot_state_publisher', 'joint_state_broadcaster', 'map_to_odom',
    'spawner_diffbot_base_controller', 'spawner_joint_state_broadcaster', 'pluginlib.ClassLoader',
    'kdl_parser', 'foxglove_bridge', 'etk_api_bridge', 'bench_mon',
]
mission_log = log('mission_log', 'Mission log: system_manager, mission_controller, arbiter, path_executor',
                  2, OTHER_LOGGERS)

tab_mission = row([
    timeline,
    column([progress, sm_feedback, mission_log], [25, 20, 55]),
], [58, 42])

# ---------------------------------------------------------------------------------------------
# Tab 2: robot and path.

three_d = panel('3D', 'map', 'Robot in map: segment path (green), lookahead (orange), driven trail (blue)', {
    'cameraState': {
        'distance': 6,
        'perspective': True,
        'phi': 50,
        'thetaOffset': 45,
        'target': [0.5, 0, 0],
        'targetOffset': [0, 0, 0],
        'targetOrientation': [0, 0, 0, 1],
        'fovy': 45,
        'near': 0.01,
        'far': 5000,
    },
    'followMode': 'follow-none',
    'followTf': 'map',
    'scene': {'transforms': {'labelSize': 0.06, 'axisScale': 0.4}},
    'transforms': {},
    'topics': {
        '/received_global_plan': {
            'visible': True, 'type': 'line', 'lineWidth': 0.04,
            'gradient': ['#22c55eff', '#22c55eff'],
        },
        '/lookahead_collision_arc': {
            'visible': True, 'type': 'line', 'lineWidth': 0.015,
            'gradient': ['#f59e0bb0', '#f59e0bb0'],
        },
        '/studio_script/lookahead_marker': {'visible': True},
        '/studio_script/odom_trail': {'visible': True},
        '/local_costmap/published_footprint': {'visible': True, 'lineWidth': 0.02, 'color': '#e5e7eb'},
        '/map': {'visible': True, 'alpha': 0.3},
        '/local_costmap/costmap': {'visible': False},
    },
    'layers': {
        'grid': {
            'visible': True, 'layerId': 'foxglove.Grid', 'instanceId': 'grid', 'label': 'Grid (1 m)',
            'frameId': 'map', 'size': 10, 'divisions': 10, 'lineWidth': 1, 'color': '#248eff40',
            'position': [0, 0, 0], 'rotation': [0, 0, 0],
        },
        'robot': {
            'visible': True, 'layerId': 'foxglove.Urdf', 'instanceId': 'robot',
            'label': 'Robot (URDF from /robot_description)', 'sourceType': 'topic',
            'topic': '/robot_description', 'framePrefix': '', 'displayMode': 'auto',
        },
    },
    'publish': {
        'type': 'point', 'poseTopic': '/move_base_simple/goal', 'pointTopic': '/clicked_point',
        'poseEstimateTopic': '/initialpose', 'poseEstimateXDeviation': 0.5,
        'poseEstimateYDeviation': 0.5, 'poseEstimateThetaDeviation': 0.26179939,
    },
    'imageMode': {},
})
speed = plot('speed', 'Speed (m/s): segment limit, Nav2 command, sent to /act, forwarded, actual', [
    series('/speed_limit.speed_limit', 'Segment speed limit (/speed_limit)', GREY),
    series('/mission_controller/nav_cmd_vel.twist.linear.x', 'Nav2 command (nav_cmd_vel)', AMBER),
    series('/act/drive/cmd.cmd.twist.linear.x', 'Into the arbiter (/act/drive/cmd)', PURPLE),
    series('/act/drive/driver/cmd_vel.twist.linear.x', 'Arbiter to drive (driver/cmd_vel)', TEAL),
    series('/odometry/local.twist.twist.linear.x', 'Actual (EKF /odometry/local)', GREEN),
])
turn = plot('turn', 'Turn rate (rad/s): Nav2 command vs actual', [
    series('/mission_controller/nav_cmd_vel.twist.angular.z', 'Nav2 command', AMBER),
    series('/odometry/local.twist.twist.angular.z', 'Actual (EKF)', GREEN),
])
segment = plot('segment', 'Segment: progress (0 to 1) and distance to goal (m)', [
    series('/mission_controller/print_action/_action/feedback.feedback.segment_progress',
           'Segment progress (MC feedback)', GREEN),
    series('/path_executor/execute_path/_action/feedback.feedback.distance_to_goal',
           'Distance to segment end (m)', BLUE),
], min_y=0)

tab_robot = row([
    three_d,
    column([speed, turn, segment], [40, 25, 35]),
], [60, 40])

# ---------------------------------------------------------------------------------------------
# Tab 3: actuators.

lift = plot('lift', 'Lift height (mm): position vs target', [
    series('/act/lift/state.position_mm', 'Position', GREEN),
    series('/act/lift/state.target_mm', 'Target (segment_height_mm)', AMBER),
])
vibe = plot('vibe', 'Vibe frequency (Hz): actual vs setpoint', [
    series('/act/vibe/state.hz_actual', 'Actual (VFD)', GREEN),
    series('/studio_script/phcu_commands.vibe_hz_setpoint', 'Setpoint (PHCU node)', AMBER),
], min_y=0)
control = transitions('control', 'Actuator control: arbiter levels and driver states', [
    series('/act/status.armed', '/act ARMED'),
    series('/act/status.rc_present', 'RC present'),
    series('/act/status.drive.level', 'Drive holder level'),
    series('/act/status.drive.requested_level', 'Drive requested level'),
    series('/act/status.drive.change_reason', 'Drive change reason'),
    series('/act/status.lift.level', 'Lift holder level'),
    series('/act/status.lift.requested_level', 'Lift requested level'),
    series('/act/status.lift.change_reason', 'Lift change reason'),
    series('/act/status.vibe.level', 'Vibe holder level'),
    series('/act/status.vibe.requested_level', 'Vibe requested level'),
    series('/act/status.vibe.change_reason', 'Vibe change reason'),
    series('/act/drive/state.energized', 'Drive energized'),
    series('/act/lift/state.motion', 'Lift motion'),
    series('/studio_script/phcu_commands.vibe_run', 'Vibe run'),
])


def health(actuator):
    return indicator(f'{actuator}_health', f'{actuator.capitalize()} health',
                     f'/act/{actuator}/health.health',
                     [rule(0, f'{actuator}: OK', GREEN), rule(1, f'{actuator}: OUTAGE', AMBER),
                      rule(2, f'{actuator}: FAULT', RED)])


def ready(actuator):
    return indicator(f'{actuator}_ready', f'{actuator.capitalize()} ready',
                     f'/act/{actuator}/health.ready',
                     [rule('true', f'{actuator}: ready', GREEN)],
                     f'{actuator}: NOT ready (setup)', AMBER)


health_grid = column([
    row([health(a) for a in ('drive', 'lift', 'vibe', 'gate')]),
    row([ready(a) for a in ('drive', 'lift', 'vibe', 'gate')]),
    row([
        indicator('drive_energized', 'Drive energized', '/act/drive/state.energized',
                  [rule('true', 'Drive energized', GREEN)], 'Drive NOT energized', AMBER),
        indicator('phcu_link', 'PHCU link', '/act/phcu/status.link_up',
                  [rule('true', 'PHCU link up', GREEN)], 'PHCU link DOWN', RED),
        indicator('phcu_armed', 'PHCU armed stream', '/studio_script/phcu_commands.lift_armed',
                  [rule('true', 'PHCU gets armed', GREEN)], 'PHCU NOT armed', AMBER),
    ]),
])

tab_actuators = row([
    column([lift, vibe]),
    column([control, health_grid], [62, 38]),
], [45, 55])

# ---------------------------------------------------------------------------------------------
# Tab 4: logs.

tab_logs = row([
    log('mission_log_full', 'Mission nodes: all messages (INFO and up)', 2, OTHER_LOGGERS),
    log('warnings_log', 'All nodes: warnings and errors', 3),
])

# ---------------------------------------------------------------------------------------------
# Tab 5: operator, mock mode only. These panels act on the system.

warning = indicator(
    'operator_warning', 'WARNING',
    '/system_manager/state.state', [],
    'WARNING: the buttons below call services on the running system. '
    'Use them in mock mode only. On the robot, the GUI and the RC are the operator.',
    RED)
tab_operator = column([
    warning,
    row([
        call_service('grant', 'GRANT (plays the RC, mock only)', '/act/system/command',
                     'GRANT', 'Calls /act/system/command with command 3 (GRANT): '
                     'the arbiter gives every pending request to its client.', AMBER,
                     '{\n  "command": 3\n}'),
        call_service('request_arm', 'Request arm', '/system_manager/request_arm', 'Request arm',
                     'The MC asks for drive, lift and vibe. Then press GRANT.', BLUE),
        call_service('clear_error', 'Clear error', '/system_manager/clear_error_request',
                     'Clear error', 'SM ERROR -> IDLE. Clears the loaded plan.', RED),
    ]),
    row([
        call_service('green_light', 'Green light (start_layer)', '/system_manager/start_layer',
                     'Green light', 'Only in READY_TO_START. The MC starts the print segment.', GREEN),
        call_service('cut_done', 'Cut done', '/system_manager/cut_done', 'Cut done',
                     'Only in WAITING_TO_RETURN. The MC starts the return segment.', GREEN),
    ]),
], [16, 42, 42])

# ---------------------------------------------------------------------------------------------

tabs_id = 'Tab!mission_tabs'
config_by_id[tabs_id] = {
    'activeTabIdx': 0,
    'tabs': [
        {'title': '1 Mission timeline', 'layout': tab_mission},
        {'title': '2 Robot and path', 'layout': tab_robot},
        {'title': '3 Actuators', 'layout': tab_actuators},
        {'title': '4 Logs', 'layout': tab_logs},
        {'title': '5 Operator (mock only)', 'layout': tab_operator},
    ],
}


def user_script(file_name, title):
    return {'name': title, 'sourceCode': (HERE / 'scripts' / file_name).read_text()}


layout = {
    'configById': config_by_id,
    'globalVariables': {},
    'userNodes': {
        'b6f1c2a0-0001-4d6e-9a51-print0mission': user_script('mission_summary.ts', 'mission_summary'),
        'b6f1c2a0-0002-4d6e-9a51-print0mission': user_script('phcu_commands.ts', 'phcu_commands'),
        'b6f1c2a0-0003-4d6e-9a51-print0mission': user_script('lookahead_marker.ts', 'lookahead_marker'),
        'b6f1c2a0-0004-4d6e-9a51-print0mission': user_script('odom_trail.ts', 'odom_trail'),
    },
    'playbackConfig': {'speed': 1.0},
    'layout': column([band, tabs_id], [24, 76]),
}

OUT.write_text(json.dumps(layout, indent=2) + '\n')
print(f'wrote {OUT} ({len(config_by_id)} panels)')
