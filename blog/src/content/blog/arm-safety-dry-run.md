---
title: "从机械臂安全回移植到 Dry-Run 验证：一次 ROS 2 控制链安全适配"
description: "从控制权隔离、动作白名单到真实 ROS 2 Action 验收，记录机械臂安全适配层的 Dry-Run 验证过程。"
pubDate: 2026-08-07
category: insight
tags: ["ROS 2", "OpenClaw", "机械臂安全", "Dry-Run", "ROS 2 Action", "控制权", "FK/IK", "接口隔离"]
---
## 记录目的

今天的目标不是直接开放机械臂抓取，而是先为现有旧版 OpenClaw 控制链增加一层独立、可审计、默认拒绝硬件输出的安全适配层。整个过程不改动厂商工作区源码，不替换现车的初始化姿态，也不把软件命令回显误认为真实的机械臂反馈。

虽然现在机器人的主流方向是大模型越聪明，那么机器人的上限也就越高，但是这也并不意味着大模型每次调用机械臂或者其他部件，编写和发布的命令都是100%有效正确，所以安全也成了一个至关重要的问题，硬件如果不加安全锁，那么损坏仪器的代价是非常高的，在进入测试阶段前，希望大家先做好安全模块，后面再去考虑对速率进行优化。

博主还想说，写的每一个教程和记录都是具有时效性的，有可能今天还有用，明天就会失效，AI时代发展太快，技术也在不断革新，所以大家一定要多借助AI，去查找资料，用AI去进行创作，去进行可回退的试错，就像博主用的OpenClaw内置小车，现在官网最新版本的文件已经不支持我这个版本的OpenClaw了，但是开发还是得在这个条件下去进行，所以大家看看概念就好，具体要去做的，多参考AI的意见。

废话不多说，本次工作的核心是先把“谁能控制机械臂、能调用什么、参数是否可信、退出后是否干净”这些基础问题收紧，再用真实 ROS 图和真实服务做 dry-run 验收。

## 今日系统链路

```text
OpenClaw / openclaw_brain
        |
        | ROS 2 Action
        v
/m3pro_safe/action_service
        |
        | 白名单解析 + 参数校验 + 审计记录
        v
OPENCLAW_DRY 状态机
        |
        +--> InitArmPose: 仅模拟并记录
        +--> 查询类动作: 仅返回状态
        +--> 其他动作: 拒绝

机械臂原始控制话题：/arm_joint、/arm6_joints
本次安全节点不创建这两类发布器。
```

## 一、冻结实机基线

先通过只读检查记录了设备、软件栈、ROS 图和关键厂商文件哈希，用于后续对比与回滚判断。

### 平台与资源

```text
Model: NVIDIA Jetson Orin Nano Engineering Reference Developer Kit Super
Kernel: 5.15.148-tegra
Memory: 7.4 GiB total, about 5.0 GiB available
Disk: 233 GiB total, 72 GiB used, 152 GiB available
```

### 原始机械臂控制图

```text
/arm_joint:    joy_ctrl -> YB_Node
/arm6_joints:  joy_ctrl -> YB_Node
```

检查结果表明，现车控制端没有提供机械臂真实关节反馈、停止、舵机卸力或 torque-off 接口。因此软件层的职责被明确限定为：阻止错误的下一条命令、记录命令边界、在冲突时锁定并退出；不把它包装成硬件急停。

基线记录已保存于：

```text
D:\AutomataCar\.analysis\arm_safety_baseline_20260807T224910.md
```

厂商关键文件也已在 Jetson 上保留 SHA-256 清单备份：

```text
/home/jetson/m3pro_safety_backups/openclaw-arm-safe-20260807T225300+0800
```

## 二、独立安全覆盖工作区

所有新增代码放在安全覆盖工作区，不覆盖以下厂商工作区：

```text
/home/jetson/yahboomcar_ws
/home/jetson/M3Pro_ws
```

新增工作区位置：

```text
/home/jetson/m3pro_safety_ws
D:\AutomataCar\safety_overlay_ws
```

本次新增两个 ROS 2 包。

### 1. `m3pro_safe_interfaces`

该包定义独立的安全接口，避免让 OpenClaw 直接依赖两套同名但字段不兼容的厂商 `ArmKinemarics` 服务。

```text
ArmSafetyState.msg
ConfirmArmCommand.srv
SetArmLockout.srv
SolveKinematics.srv
```

其中 `ArmSafetyState` 明确包含当前模式、控制权、锁定状态、配置哈希、最后下发的角度、命令状态，以及下面两个硬件能力标志：

```text
hardware_feedback_available=false
hardware_stop_available=false
```

这两个字段让上层系统知道：当前能看到的是软件侧的命令记录，不是机械臂真实状态。

### 2. `m3pro_arm_safe`

该包实现了 OpenClaw 的机械臂安全适配层，默认工作模式为：

```text
OPENCLAW_DRY
```

包内包含：

```text
安全 Action Server
机械臂 ROS 图守卫
严格动作解析器
Pydantic 配置模型
JSONL 审计日志
FK/IK 隔离适配器
```

安全 Action Server 的公开地址为：

```text
/m3pro_safe/action_service
```

安全状态、提案、确认和锁定接口为：

```text
/m3pro_safe/arm/state
/m3pro_safe/arm/proposal
/m3pro_safe/arm/confirm
/m3pro_safe/arm/lockout
```

## 三、控制边界与白名单

安全层没有沿用厂商 `action_service.py` 中的动态方法分派方式。取而代之的是对动作字符串进行 AST 级解析，拒绝未知动作、私有方法、表达式注入、缺少参数和额外参数。

首批允许的动作只有：

```text
InitArmPose()
GetArmSafetyState()
GetLastCommandedArmAngles()
```

`InitArmPose()` 固定使用实车当前初始化数据：

```text
raw_angles = [90, 130, 0, 5, 90, 0]
runtime_ms = 2000
```

在 dry-run 下，调用 `InitArmPose()` 的结果是：

```text
InitArmPose validated and simulated; no arm topic was published
```

也就是说，系统记录并验证该姿态，但不会发布 `/arm_joint` 或 `/arm6_joints`。

`GetLastCommandedArmAngles()` 的语义被限定为“最后被安全层记录的下发值”，而非真实舵机反馈。

## 四、参数模型与审计能力

安全配置按五类信息组织：

```text
source_limits
validated_envelope
named_poses
joint6_mapping
runtime_profile
```

今天写入的设备配置只启用了当前实车初始化姿态和 `2000 ms` 运行时间。Joint 6 的公共角度到原始角度映射被单独保留：

```text
raw = 180 - public_angle
```

但初始配置状态为：

```text
enabled = false
calibration_status = UNVERIFIED_ON_THIS_DEVICE
```

这避免了两套代码路径重复反转 Joint 6 的语义。

配置模型会拒绝：

```text
NaN
Inf
布尔值
字符串数字
负时间
溢出值
```

每次请求会写入 JSONL 审计记录，包含请求 ID、动作、规范化参数、模式、结果、原因与配置哈希；审计输出不会记录 API Key。

## 五、部署中修复的工程问题

今天的部署不是一次上传后就结束，而是在真实 Jetson 环境中逐项修正了几个会影响可靠性的细节。

### 1. 正确声明 Python ROS 2 包类型

`m3pro_arm_safe` 初次构建时被 colcon 识别为 CMake 包。已在 `package.xml` 中加入：

```xml
<export>
  <build_type>ament_python</build_type>
</export>
```

随后两个新增包均完成远端构建：

```text
m3pro_safe_interfaces
m3pro_arm_safe
```

### 2. 修复 ROS 环境加载顺序

ROS 的 `setup.bash` 在 `set -u` 环境下会触发未绑定变量问题。所有新增启动脚本均调整为：

```bash
set -eo pipefail
source .../setup.bash
set -u
```

这样脚本既保留失败即停与管道错误检测，也能稳定加载 ROS 环境。

### 3. 修复子进程退出清理

dry-run 测试中发现，单独停止 `ros2 launch` 父进程可能留下安全节点子进程。启动脚本已改用 `setsid` 创建独立进程组，并在退出时对进程组发出 `SIGINT`、`SIGTERM` 和等待清理。

重新验收后，安全节点输出：

```text
process has finished cleanly
```

并确认 ROS 图中不再保留 `/m3pro_arm_safe_action_server`。

### 4. 隔离两套 `ArmKinemarics`

实机同时存在两套同名服务接口：

```text
yahboomcar_ws: 完整 float64 FK/IK 接口
M3Pro_ws: 字段不兼容的接口
```

直接 source 安全工作区总 `setup.bash` 会把 `M3Pro_ws` 重新带入环境。为此，FK/IK 启动脚本改为仅加载：

```text
/opt/ros/humble
/home/jetson/yahboomcar_ws/install
m3pro_safe_interfaces 的 local_setup.bash
m3pro_arm_safe 的 package.bash
```

经过清洁环境验证，`ArmKinemarics` 显示为完整的 `float64 tar_x`、`float64 cur_joint6`、`float64 joint6` 接口，没有混入旧版 `float32 cur_joint1` 定义。

### 5. 补齐 ROS 2 Action 底层映射

OpenClaw 使用 ROS 2 Action，实际由五组底层服务与话题组成。启动脚本已补齐以下映射，使旧客户端可通过安全 Action Server 通信：

```text
send_goal
get_result
cancel_goal
feedback
status
```

映射目标统一为：

```text
/m3pro_safe/action_service
```

## 六、目标机验收结果

### 1. 本地与远端单元测试

本地安全包测试：

```text
21 passed
```

Jetson 目标机直接运行测试：

```text
21 passed
```

Jetson 上通过 `colcon test` 的结果：

```text
21 tests, 0 errors, 0 failures, 0 skipped
```

### 2. 手柄控制权守卫

当原厂 `joy_ctrl` 正在发布机械臂话题时，安全服务拒绝启动：

```text
拒绝启动：/arm_joint 当前发布者数量为 1。
exit code: 73
```

拒绝后，原厂手柄的两个机械臂话题发布者数量仍保持为 1，证明安全层没有抢占或杀掉原厂手柄。

### 3. 安全 Action Server dry-run

在临时停止 `joy_ctrl` 后，执行 dry-run 验收脚本：

```text
InitArmPose()       -> accepted, SIMULATED
pubSix_Arm()        -> rejected, ACTION_NOT_ALLOWED
/arm_joint          -> 0 publisher
/arm6_joints        -> 0 publisher
```

验收脚本最终输出：

```text
ARM_SAFE_DRY_RUN_ACCEPTED
DRY_RUN_ZERO_RAW_OUTPUT_VERIFIED
```

手柄随后被按原厂命令恢复，并重新确认两个机械臂话题各只有 `joy_ctrl` 一个发布者。

### 4. 运行时冲突守卫

额外验证了“安全节点已经运行后，手柄又重新出现”的场景。

当 `joy_ctrl` 恢复发布 `/arm_joint` 后，安全节点检测到图冲突，写入 lockout 并自行退出：

```text
ARM_TOPIC_BUSY: /arm_joint already has publisher(s): joy_ctrl
```

这说明控制权检查不仅发生在启动前，也能覆盖运行中的发布者冲突。

### 5. FK/IK 隔离适配器

在完整 `ArmKinemarics` 服务和安全适配器同时运行时，对现车初始化角度进行 FK 查询：

```text
[90, 130, 0, 5, 90, 0]
```

获得的 FK 位姿为：

```text
[0.160542, 0.000227, 0.215929, 0.000087, 0.785398, 0.000037]
```

将该位姿连续进行三次 IK 查询，三次结果一致：

```text
[90.0, 129.916857, 0.086947, 4.954970, 89.999941, 0.0]
```

同时，携带 `NaN` 的 IK 请求被正确拒绝：

```text
all kinematics values must be finite
```

整个 FK/IK 验证期间，原始机械臂话题发布者数量没有变化。

### 6. OpenClaw dry-run 启动链

已使用真实 `openclaw_brain` 与安全 Action Server 完成短时 dry-run 启动检查。安全节点启动时记录了初始化姿态的模拟结果，运行结束后清理完成；检查期间两条原始机械臂话题均维持零安全层发布者。

验收输出：

```text
OPENCLAW_DRY_CHAIN_ZERO_OUTPUT_VERIFIED
```

## 七、今日安全收尾

车辆断电前，已停止本轮启动的 OpenClaw、安全节点和 FK/IK 适配器，并进一步停止原厂 `joy_ctrl`。最终 ROS 图状态为：

```text
/arm_joint:    0 publisher, 1 subscriber
/arm6_joints: 0 publisher, 1 subscriber
/cmd_vel:      0 publisher, 1 subscriber
```

底层 `YB_Node` 保持为订阅者，没有被停止。这样车辆重新上电前不会保留后台机械臂或底盘控制发布器。

## 八、今天的学习收获

1. ROS 2 的安全不能只靠“接口名称不同”。真正的控制边界必须检查 ROS 图上的发布者、订阅者和进程退出状态。
2. `ros2 launch` 的父进程退出不等于所有子进程退出。对无人值守控制功能，进程组管理与退出验证是功能本身的一部分。
3. 同名 ROS 接口在多工作区环境中非常危险。source 顺序看起来只是环境细节，实际会改变 Python/C++ 类型解析结果。
4. 对机械臂而言，“最后发送的角度”与“机械臂真实到位”是两件完全不同的事。状态模型必须把它们分开。
5. dry-run 的价值不只是“不让机械臂动”，还包括验证 OpenClaw、Action、解析器、参数模型、审计和退出链路能否在真实设备上闭环运行。

## 阶段结论

今天完成了从实机基线、独立安全接口、干运行 Action Server、控制权守卫、接口隔离，到目标机测试和安全收尾的一整套基础工作。当前安全覆盖层以 `OPENCLAW_DRY` 为默认模式，所有机械臂相关输出均可在 ROS 图、进程状态和审计日志中追溯。
