#!/usr/bin/env python3
"""Write print_mission.layout.json, the Foxglove layout for a print-mission run.

This file is the source of truth for the layout: the panel list, the tabs and the split
sizes. The layout embeds the User Scripts of scripts/*.ts. Edit this file or a script, then
run, from any directory:

    python3 make_layout.py

All paths are relative to this file. The output is a layout file for "Import from file" in
the Foxglove app. See README.md.

Screen target: about 1400 x 820 points of panel area (MacBook Air 13.6", 1470 x 956 points).
Thus: one band row and at most 4 large panels for each tab.

The layout only reads topics. It has no panel that calls a service or publishes: a viewer
must not move the robot.
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


def series(value, label, color=None, line=True, width=None):
    """A plot series. line=False: points only (for a topic that publishes once per change)."""
    item = {'value': value, 'enabled': True, 'timestampMethod': 'receiveTime', 'label': label}
    if color is not None:
        item['color'] = color
    if not line:
        item['showLine'] = False
    if width is not None:
        item['lineSize'] = width
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


SUMMARY = '/studio_script/mission_summary'
ACTUATORS = '/studio_script/actuator_status'
PHCU = '/studio_script/phcu_commands'
MISSION_PLAN = '/studio_script/mission_plan'
ROBOT_POSE = '/studio_script/robot_pose'
LOOKAHEAD = '/studio_script/lookahead_marker'

# ---------------------------------------------------------------------------------------------
# Band: one row, always visible. The only place for the states: where are we, and what must
# the operator do now. The tabs do not show these states again.

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
    raw('layer', 'Layer', f'{SUMMARY}.codes.layer_text'),
    indicator('act', '/act gate', f'{SUMMARY}.codes.act_code', ACT_RULES),
    indicator('operator', 'Operator: do now', f'{SUMMARY}.codes.operator_wait', OPERATOR_RULES),
], [13, 15, 18, 8, 12, 34])

# ---------------------------------------------------------------------------------------------
# Tab 1: mission. The plan and the robot from above, why the states are what they are, and
# the drive: commanded against actual.

# Frames of the robot (URDF) and of the localization. The map view hides their axes: the
# robot is a triangle of the script robot_pose. A frame that is not in this list shows small
# axes with no label.
FRAMES = [
    'map', 'odom', 'base_link', 'left_sprocket_link', 'right_sprocket_link',
    'lift_platform_link', 'print_head_link', 'gps_primary_link', 'gps_secondary_link',
    'tm500_imu_link',
]

# A 3D panel with an orthographic camera that looks down (the "2D" mode of the panel), fixed
# in map. It draws only the script markers and the grid: no robot model, no maps. The
# camera fits the wall_3m test mission (x -0.75 to 4.75 m, y 0 to 1.5 m). Pan and zoom with
# the mouse for other plans.
mission_map = panel('3D', 'mission_map', 'Mission map (map frame, from above)', {
    'cameraState': {
        'distance': 7,  # orthographic: the height of the view (m)
        'perspective': False,
        'phi': 0,
        'thetaOffset': 0,  # map +x to the right, +y up
        'target': [0, 0, 0],
        'targetOffset': [2.0, 0.75, 0],
        'targetOrientation': [0, 0, 0, 1],
        'fovy': 45,
        'near': 0.01,
        'far': 1000,
    },
    'followMode': 'follow-none',
    'followTf': 'map',
    'scene': {
        'backgroundColor': '#111827',
        'transforms': {'showLabel': False, 'axisScale': 0.05, 'editable': False},
    },
    'transforms': {f'frame:{frame}': {'visible': False} for frame in FRAMES},
    'topics': {
        MISSION_PLAN: {'visible': True},
        ROBOT_POSE: {'visible': True},
        LOOKAHEAD: {'visible': True},
    },
    'layers': {
        'grid': {
            'visible': True, 'layerId': 'foxglove.Grid', 'instanceId': 'grid', 'label': 'Grid (1 m)',
            'frameId': 'map', 'size': 20, 'divisions': 20, 'lineWidth': 1, 'color': '#ffffff26',
            'position': [0, 0, -0.01], 'rotation': [0, 0, 0],
        },
    },
    'publish': {
        'type': 'point', 'poseTopic': '/move_base_simple/goal', 'pointTopic': '/clicked_point',
        'poseEstimateTopic': '/initialpose', 'poseEstimateXDeviation': 0.5,
        'poseEstimateYDeviation': 0.5, 'poseEstimateThetaDeviation': 0.26179939,
    },
    'imageMode': {},
})

why = raw('why', 'Why: do now, reasons, plan, last holder change', f'{SUMMARY}.why')

# Commanded: what the drive gets from the arbiter (/act/drive/driver/cmd_vel), from the RC,
# the UI or the MC. Nav2 command: what the Nav2 controller asks during a segment (the MC relays
# it to the arbiter). Actual: the diff_drive odometry of the drive encoders.
DRIVE_CMD = '/act/drive/driver/cmd_vel.twist'
NAV2_CMD = '/mission_controller/nav_cmd_vel.twist'
ACTUAL = '/act/drive/odom.twist.twist'

linear = plot('linear', 'Linear speed (m/s): commanded vs actual', [
    series('/speed_limit.speed_limit', 'Segment limit (MC)', GREY, line=False),
    series(f'{NAV2_CMD}.linear.x', 'Nav2 command', AMBER),
    series(f'{DRIVE_CMD}.linear.x', 'Commanded (to drive)', BLUE, width=2),
    series(f'{ACTUAL}.linear.x', 'Actual (odometry)', GREEN, width=2),
], window_s=120)
rotation = plot('rotation', 'Rotation rate (rad/s): commanded vs actual', [
    series(f'{NAV2_CMD}.angular.z', 'Nav2 command', AMBER),
    series(f'{DRIVE_CMD}.angular.z', 'Commanded (to drive)', BLUE, width=2),
    series(f'{ACTUAL}.angular.z', 'Actual (odometry)', GREEN, width=2),
], window_s=120)

tab_mission = row([
    mission_map,
    column([why, linear, rotation], [30, 35, 35]),
], [58, 42])

# ---------------------------------------------------------------------------------------------
# Tab 2: printhead and progress.

lift = plot('lift', 'Lift height (mm): target vs actual', [
    series('/act/lift/state.target_mm', 'Target', AMBER, width=2),
    series('/act/lift/state.position_mm', 'Actual', GREEN, width=2),
], window_s=300)
vibe = plot('vibe', 'Vibe frequency (Hz): commanded vs actual', [
    series(f'{PHCU}.vibe_hz_setpoint', 'Setpoint', GREY),
    series(f'{PHCU}.vibe_hz_command', 'Commanded (setpoint while run, else 0)', AMBER, width=2),
    series('/act/vibe/state.hz_actual', 'Actual (VFD)', GREEN, width=2),
], min_y=0, window_s=300)
actuators = table('actuators', 'Actuators: holder, health, ready, state', f'{ACTUATORS}.rows')
progress = plot('progress', 'Print progress (%)', [
    series('/system_manager/execute_plan/_action/feedback.feedback.progress_percentage',
           'Planned path length done (%)', GREEN, width=2),
], min_y=0, max_y=100, window_s=1800)

tab_printhead = row([
    column([lift, vibe]),
    column([actuators, progress], [55, 45]),
], [55, 45])

# ---------------------------------------------------------------------------------------------
# Tab 3: logs. Full width: log lines are long.

# Loggers that are not part of the mission flow. The mission log hides them; the warnings
# log shows all.
OTHER_LOGGERS = [
    'controller_server', 'diffbot_base_controller', 'controller_manager',
    'controller_manager.hardware_component.system.dcu', 'controller_manager.pal_statistics',
    'resource_manager', 'rclcpp', 'local_costmap.local_costmap', 'lifecycle_manager_navigation',
    'map_server', 'map_io', 'phcu_node', 'signal_tower', 'watchdog', 'mock_rc', 'dcu',
    'ekf_local', 'robot_state_publisher', 'joint_state_broadcaster', 'map_to_odom',
    'spawner_diffbot_base_controller', 'spawner_joint_state_broadcaster', 'pluginlib.ClassLoader',
    'kdl_parser', 'foxglove_bridge', 'etk_api_bridge', 'bench_mon',
]

tab_logs = column([
    log('mission_log', 'Mission nodes (SM, MC, arbiter, path executor): INFO and up', 2,
        OTHER_LOGGERS),
    log('warnings_log', 'All nodes: WARN and up', 3),
], [60, 40])

# ---------------------------------------------------------------------------------------------

TABS = [
    ('1 Mission', tab_mission),
    ('2 Printhead and progress', tab_printhead),
    ('3 Logs', tab_logs),
]
tabs_id = 'Tab!mission_tabs'
config_by_id[tabs_id] = {
    'activeTabIdx': 0,
    'tabs': [{'title': title, 'layout': layout} for title, layout in TABS],
}


def user_script(file_name, title):
    return {'name': title, 'sourceCode': (SCRIPTS / file_name).read_text()}


USER_SCRIPTS = ['mission_summary', 'phcu_commands', 'lookahead_marker', 'mission_plan',
                'robot_pose', 'actuator_status']
layout = {
    'configById': config_by_id,
    'globalVariables': {},
    'userNodes': {
        f'b6f1c2a0-{i + 1:04d}-4d6e-9a51-print0mission': user_script(f'{name}.ts', name)
        for i, name in enumerate(USER_SCRIPTS)
    },
    'playbackConfig': {'speed': 1.0},
    'layout': column([band, tabs_id], [10, 90]),
}

OUT.write_text(json.dumps(layout, indent=2) + '\n')
panels = len(config_by_id) - 1
print(f'wrote {OUT.relative_to(HERE)} ({panels} panels in the band and {len(TABS)} tabs, '
      f'{len(USER_SCRIPTS)} user scripts)')
