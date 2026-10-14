#!/usr/bin/env python3
"""Write print_mission.layout.json, the Foxglove layout for a print-mission run.

This file is the source of truth for the layout: the panel list, the tabs and the split
sizes. The layout embeds the User Scripts of scripts/*.ts. Edit this file or a script, then
run, from any directory:

    python3 make_layout.py

All paths are relative to this file. The output is a layout file for "Import from file" in
the Foxglove app. See README.md.

Screen target: about 1400 x 820 points of panel area (MacBook Air 13.6", 1470 x 956 points).
Thus: one band row, at most 4 panels for each tab (the operator tab has 5 buttons and one
warning), at most 2 plots for each tab.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE / 'scripts'
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
    assert panel_id not in config_by_id, panel_id
    config_by_id[panel_id] = {'foxglovePanelTitle': title, **config}
    return panel_id


def split(direction, items, sizes=None):
    """Mosaic split of the items. sizes: percentages, default equal."""
    if sizes is None:
        sizes = [100.0 / len(items)] * len(items)
    assert len(sizes) == len(items)
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


def raw(name, title, topic_path, font_size=13):
    return panel('RawMessages', name, title, {
        'topicPath': topic_path,
        'diffEnabled': False,
        'diffMethod': 'custom',
        'diffTopicPath': '',
        'showFullMessageForDiff': False,
        'expansion': 'all',
        'fontSize': font_size,
    })


def table(name, title, topic_path):
    return panel('Table', name, title, {'topicPath': topic_path})


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


SUMMARY = '/studio_script/mission_summary'
ACTUATORS = '/studio_script/actuator_status'
PHCU = '/studio_script/phcu_commands'

# ---------------------------------------------------------------------------------------------
# Band: one row, always visible. Where are we, and what must the operator do now.

SM_RULES = [
    rule(0, 'SM IDLE', GREY),
    rule(1, 'SM READY', BLUE),
    rule(2, 'SM OPERATING', GREEN),
    rule(3, 'SM ERROR', RED),
]
MC_RULES = [
    rule(0, 'MC UNARMED', GREY),
    rule(1, 'MC PARTIALLY ARMED', AMBER),
    rule(2, 'MC ARMED', BLUE),
    rule(3, 'MC OPERATING', GREEN),
    rule(4, 'MC ERROR', RED),
]
LOP_RULES = [
    rule(0, 'LOP NONE', GREY),
    rule(1, '1 ALIGNING', BLUE),
    rule(2, '2 READY TO START', AMBER),
    rule(3, '3 PRINTING', GREEN),
    rule(4, '4 WAITING TO RETURN', AMBER),
    rule(5, '5 RETURNING', BLUE),
]
ACT_RULES = [
    rule('armed', '/act ARMED', GREEN),
    rule('disarmed', '/act DISARMED', RED),
    rule('rc_lost', 'RC LOST', RED),
]
OPERATOR_RULES = [
    rule('none', 'No action: the robot works', GREEN),
    rule('wait', 'Wait', GREY),
    rule('upload', 'Upload a print plan', BLUE),
    rule('arm', 'ARM on the RC (D-pad Up)', AMBER),
    rule('grant', 'GRANT on the RC (D-pad Right)', AMBER),
    rule('request_arm', 'Request arm, then GRANT', AMBER),
    rule('execute', 'Start the print (execute_plan)', BLUE),
    rule('green_light', 'Give the GREEN LIGHT', AMBER),
    rule('cut_done', 'Cut, then confirm CUT DONE', AMBER),
    rule('control_lost', 'Control lost: see Why', RED),
    rule('clear_error', 'Clear the error', RED),
    rule('rc', 'Switch on the RC', RED),
]

band = row([
    indicator('sm_state', 'SM state', '/system_manager/state.state', SM_RULES),
    indicator('mc_state', 'MC state', '/mission_controller/state.state', MC_RULES),
    indicator('lop', 'Layer phase (LOP)', '/mission_controller/mission_state.state', LOP_RULES),
    raw('layer', 'Layer', f'{SUMMARY}.layer_text'),
    indicator('act', '/act gate', f'{SUMMARY}.act_code', ACT_RULES),
    indicator('operator', 'Operator: do now', f'{SUMMARY}.operator_wait', OPERATOR_RULES),
], [13, 15, 18, 8, 12, 34])

# ---------------------------------------------------------------------------------------------
# Tab 1: mission. Where are we, why, and what must the operator do now.

why = raw('why', 'Why: do now, state and reason, phase, plan, holders', SUMMARY)
timeline = transitions('timeline', 'Mission timeline', [
    series('/system_manager/state.state', 'SM'),
    series('/mission_controller/state.state', 'MC'),
    series('/mission_controller/mission_state.state', 'LOP'),
    series('/mission_controller/mission_state.current_layer', 'Layer'),
    series(f'{SUMMARY}.operator_wait', 'Operator'),
    series(f'{SUMMARY}.act_code', '/act'),
])
progress = plot('progress', 'Print progress (%)', [
    series('/system_manager/execute_plan/_action/feedback.feedback.progress_percentage',
           'Planned path length done (%)', GREEN),
], min_y=0, max_y=100, window_s=1800)

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
mission_log = log('mission_log', 'Mission log (SM, MC, arbiter, path executor)', 2, OTHER_LOGGERS)

tab_mission = row([
    column([why, mission_log], [58, 42]),
    column([timeline, progress], [62, 38]),
], [55, 45])

# ---------------------------------------------------------------------------------------------
# Tab 2: robot and path.

three_d = panel('3D', 'map', 'Robot in map: path (green), lookahead (orange), trail (blue)', {
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
speed = plot('speed', 'Speed (m/s): limit, Nav2, to drive, actual', [
    series('/speed_limit.speed_limit', 'Segment limit', GREY),
    series('/mission_controller/nav_cmd_vel.twist.linear.x', 'Nav2 command', AMBER),
    series('/act/drive/driver/cmd_vel.twist.linear.x', 'Arbiter to drive', TEAL),
    series('/odometry/local.twist.twist.linear.x', 'Actual (EKF)', GREEN),
])
segment = plot('segment', 'Segment: progress (0 to 1), distance to end (m)', [
    series('/mission_controller/print_action/_action/feedback.feedback.segment_progress',
           'Progress', GREEN),
    series('/path_executor/execute_path/_action/feedback.feedback.distance_to_goal',
           'Distance to end (m)', BLUE),
], min_y=0)
drive_chain = transitions('drive_chain', 'Drive chain', [
    series('/path_executor/status.data', 'Path executor'),
    series(f'{SUMMARY}.drive_holder', 'Drive holder'),
    series('/act/drive/state.energized', 'Drive energized'),
])

tab_robot = row([
    three_d,
    column([speed, segment, drive_chain], [42, 33, 25]),
], [60, 40])

# ---------------------------------------------------------------------------------------------
# Tab 3: actuators.

actuators = table('actuators', 'Actuators: holder, health, ready, state', f'{ACTUATORS}.rows')
control = transitions('control', 'Actuator timeline', [
    series(f'{SUMMARY}.act_code', '/act'),
    series(f'{SUMMARY}.drive_holder', 'Drive holder'),
    series(f'{SUMMARY}.lift_holder', 'Lift holder'),
    series(f'{SUMMARY}.vibe_holder', 'Vibe holder'),
    series('/act/drive/state.energized', 'Drive energized'),
    series('/act/lift/state.motion', 'Lift motion'),
    series(f'{PHCU}.vibe_run', 'Vibe run'),
])
lift = plot('lift', 'Lift height (mm)', [
    series('/act/lift/state.position_mm', 'Position', GREEN),
    series('/act/lift/state.target_mm', 'Target', AMBER),
])
vibe = plot('vibe', 'Vibe frequency (Hz)', [
    series('/act/vibe/state.hz_actual', 'Actual (VFD)', GREEN),
    series(f'{PHCU}.vibe_hz_setpoint', 'Setpoint', AMBER),
], min_y=0)

tab_actuators = row([
    column([actuators, control], [42, 58]),
    column([lift, vibe]),
], [58, 42])

# ---------------------------------------------------------------------------------------------
# Tab 4: logs. Full width: log lines are long.

tab_logs = column([
    log('mission_log_full', 'Mission nodes: INFO and up', 2, OTHER_LOGGERS),
    log('warnings_log', 'All nodes: WARN and up', 3),
], [60, 40])

# ---------------------------------------------------------------------------------------------
# Tab 5: operator, mock mode only. These panels act on the system that the app connects to.

warning = indicator(
    'operator_warning', 'WARNING: mock mode only',
    '/system_manager/state.state', [],
    'WARNING: these buttons call services on the connected system. '
    'On the robot, they move the robot. Use them in mock mode only.',
    RED)
tab_operator = column([
    warning,
    row([
        call_service('request_arm', '1 Request arm', '/system_manager/request_arm', 'Request arm',
                     'The MC asks for drive, lift and vibe. Then press GRANT.', BLUE),
        call_service('grant', '2 GRANT (plays the RC)', '/act/system/command',
                     'GRANT', 'Calls /act/system/command with command 3 (GRANT): '
                     'the arbiter gives every pending request to its client.', AMBER,
                     '{\n  "command": 3\n}'),
        call_service('clear_error', 'Clear error', '/system_manager/clear_error_request',
                     'Clear error', 'SM ERROR -> IDLE. Clears the loaded plan.', RED),
    ]),
    row([
        call_service('green_light', '3 Green light (start_layer)', '/system_manager/start_layer',
                     'Green light', 'Only in READY_TO_START. The MC starts the print segment.', GREEN),
        call_service('cut_done', '4 Cut done', '/system_manager/cut_done', 'Cut done',
                     'Only in WAITING_TO_RETURN. The MC starts the return segment.', GREEN),
    ]),
], [18, 41, 41])

# ---------------------------------------------------------------------------------------------

tabs_id = 'Tab!mission_tabs'
config_by_id[tabs_id] = {
    'activeTabIdx': 0,
    'tabs': [
        {'title': '1 Mission', 'layout': tab_mission},
        {'title': '2 Robot and path', 'layout': tab_robot},
        {'title': '3 Actuators', 'layout': tab_actuators},
        {'title': '4 Logs', 'layout': tab_logs},
        {'title': '5 Operator (mock only)', 'layout': tab_operator},
    ],
}


def user_script(file_name, title):
    return {'name': title, 'sourceCode': (SCRIPTS / file_name).read_text()}


layout = {
    'configById': config_by_id,
    'globalVariables': {},
    'userNodes': {
        'b6f1c2a0-0001-4d6e-9a51-print0mission': user_script('mission_summary.ts', 'mission_summary'),
        'b6f1c2a0-0002-4d6e-9a51-print0mission': user_script('phcu_commands.ts', 'phcu_commands'),
        'b6f1c2a0-0003-4d6e-9a51-print0mission': user_script('lookahead_marker.ts', 'lookahead_marker'),
        'b6f1c2a0-0004-4d6e-9a51-print0mission': user_script('odom_trail.ts', 'odom_trail'),
        'b6f1c2a0-0005-4d6e-9a51-print0mission': user_script('actuator_status.ts', 'actuator_status'),
    },
    'playbackConfig': {'speed': 1.0},
    'layout': column([band, tabs_id], [10, 90]),
}

OUT.write_text(json.dumps(layout, indent=2) + '\n')
panels = len(config_by_id) - 1
print(f'wrote {OUT.relative_to(HERE)} ({panels} panels in the band and 5 tabs)')
