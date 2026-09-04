---
title: "从语音链路到受限运动会话：ROS 2 小车的系统化排错与安全设计"
description: "从 Jetson 内存诊断、USB 麦克风恢复到安全网关拒绝动作，记录语音控制链路的系统化排错与受限运动会话设计。"
pubDate: 2026-08-14
category: debug
tags: ["ROS 2", "OpenClaw", "Jetson", "ASR", "systemd", "语音控制", "安全网关", "系统化排错"]
---

## 1. 记录目的

这不是一份“今天输入了哪些命令”的流水账，而是一次把语音交互、系统资源、USB 硬件和底盘控制串起来的学习记录。

今天的目标有三个：

1. 理解小车内存为什么会接近 90%，并在不破坏底盘、相机和机械臂功能的前提下释放资源。
2. 让“你好，小亚”的语音唤醒从服务启动，走到真实麦克风、真实识别和真实状态切换。
3. 解释“左转”已经被识别，为什么车辆仍然不动，并建立下一步的受限运动会话设计。

这一天让我更清楚地意识到：机器人不是一个程序，也不是一个模型。它是硬件、Linux、音频、ROS 2、服务、模型、安全网关和执行器共同组成的系统。

## 2. 先画出系统，而不是先猜原因

今天处理的语音控制链可以表示为：

```text
人说话
→ C-Media USB 麦克风
→ PulseAudio / PyAudio 录音流
→ VAD 语音分段
→ DashScope ASR
→ 唤醒词与对话状态机
→ OpenClaw Brain 本地规则或 IPC
→ ROS Action
→ m3pro_control_gateway
→ /cmd_vel
→ YB_Node 与底盘
```

这张链路图很重要。以后遇到“没有反应”时，不能直接问“模型是不是坏了”，而要逐段确认：

```text
设备是否存在
→ 服务是否运行
→ 数据是否进入系统
→ 数据是否被正确识别
→ 动作是否生成
→ 动作是否通过安全层
→ 执行器是否真的收到输出
```

## 3. 第一件事：90% 内存并不自动等于内存泄漏

### 现象

桌面上看到小车内存接近 90%，担心服务会卡死、影响后续相机和导航功能。

### 证据

通过 `free -h`、`ps` 和 systemd cgroup 数据确认：

- `openclaw_brain` 的 RSS 约为 2.5 GB。
- 常驻成本主要来自本地 `SenseVoiceSmall` 的匿名内存；系统同时出现了明显的 Swap 使用。
- 结合观测窗口内 RSS 没有持续攀升、服务 `NRestarts=0`、没有 OOM 等证据，暂未发现内存泄漏迹象。

因此，眼前的问题不是“程序无限泄漏”，而是“本地 ASR 模型对 8 GB Jetson 的常驻成本过高”。

### 处理决定

本轮不盲目限制内存，也不直接把模型丢到 GPU。在本次 Jetson、模型和参数组合的实测中，CUDA 没有带来预期的内存节省，反而占用了更多 RAM。

最后采用的处理方式是：

- 将运行时 ASR 切换到 DashScope `paraformer-realtime-v2`。
- API Key 继续从 systemd 的环境文件读取，不写进日志。
- FunASR 只在明确启用本地 ASR 时才导入。
- 停止并禁用当前任务不需要的 `jupyterlab.service`。

### 验证结果

```text
openclaw_brain：约 2.5 GB → 约 86～120 MB
系统可用内存：约 1.0 GB → 约 4.2 GB
Swap：约 1.1 GB → 接近 0
```

这不是单纯的优化数字。它给语音、相机、ROS 节点和后续控制功能留下了可用余量。

云端 ASR 换来了资源余量，也引入了网络、时延、成本和语音数据合规边界；无论识别服务部署在哪里，底盘控制都不应绕过本地安全网关与超时停机机制。

## 4. 第二件事：服务 active，不代表麦克风真的在工作

### 现象

语音 Brain 显示 `active`，但喊“你好，小亚”没有任何回应。

### 排查过程

先看语音日志，没有新的 `ASR_TEXT`；再看 `user_speech.wav`，修改时间没有更新。这说明问题还停留在录音层，云端模型根本没有拿到新的语音。

继续检查后发现：

- PulseAudio 默认输入已经退回 Jetson 板载输入。
- `lsusb` 和 `/proc/asound/cards` 中没有 C-Media USB Audio Device。
- 同一 USB 链路中的 `/dev/ttyUSB1` 也消失。
- 内核日志记录了 USB Hub 的断连、重新枚举失败和 `unable to enumerate USB device`。

### 根因判断

故障首先落在 USB 设备枚举这一层，而不是 Python、ROS 2 或 DashScope 本身。结合断连日志和软件重绑 Hub 后仍无法恢复的现象，问题最可能位于下级 Hub、线材或供电链路；完整断电复位后，设备才重新枚举。

### 恢复后验证

断电复位后，以下状态恢复：

```text
C-Media USB Audio Device
同一 USB 链路中的 /dev/ttyUSB1
PulseAudio 默认输入 → C-Media
```

随后为服务增加了 C-Media 输入源等待和固定 `PULSE_SOURCE`，避免开机过早时静默绑定到错误输入。服务运行时仍应结合其运行用户与 PulseAudio 连接环境复核实际输入源。

## 5. 第三件事：语音识别正确，不等于唤醒词一定匹配

### 现象

现场说“你好，小亚”后，系统录到了声音，云端 ASR 也返回了文本，但没有进入唤醒状态。

### 关键日志

```text
ASR_TEXT=你好小杨
normalized=你好小杨
```

原来的唤醒逻辑只接受精确的 `你好小亚`。中文同音识别让语音链已经走通，却停在字符串匹配这一层。

### 处理决定

没有把唤醒逻辑改成任意模糊匹配，而是只加入经过真实识别验证的有限别名：

```text
你好小亚
你好小杨
你好小雅
```

停止词也加入了对应的有限别名。这样既能适应实际 ASR 结果，又不会把很多无关句子误当作唤醒词。

### 验证结果

现场已经看到：

```text
ASR_TEXT=你好小亚
WAKEWORD_MATCH canonical=你好小亚 matched=你好小亚
```

这一步的意义是：语音功能不再只是“服务启动成功”，而是完成了“真实麦克风 → 真实 ASR → 唤醒状态机”的现场闭环。

## 6. 第四件事：左转没有执行，真正断点在安全网关

### 现象

唤醒成功后，说“向左转”，小车没有转动。

### 实际链路

日志显示语音和本地动作匹配都没有问题：

```text
ASR_TEXT=你能够向左转吗
→ 本地匹配：左转
→ set_cmdvel(0, 0, 0.3, 2)
→ ActionServer 拒绝动作列表
→ LOCKED：拒绝未授权底盘动作
```

其中 `set_cmdvel` 的参数含义以当前网关接口定义为准。本次请求没有超过网关配置的角速度和时长限制。车辆不动的原因是：网关仍处于 `LOCKED`，没有获得运动授权。

### 结论

这是一次很重要的认识：模型生成动作，不等于底盘会执行动作。动作还必须经过 ROS Action、安全网关、速度限制和授权状态。

### 下一阶段的控制规则

今天开始把原来“人工脚本授权”的网关，改造成更符合语音控制的受限会话：

```text
“你好，小亚”
→ 打开限时运动会话
→ 仅允许受限速度、受限时长的底盘动作
→ 30 秒无新语音后自动回到 LOCKED
→ “小亚，停止”撤销权限并发布零速度
```

已经完成了基线备份、隔离 ROS Domain 的状态机验证和时序风险审查。由于小车电量不足，最终实机验收暂停在构建一致性检查之后；下次上电后仍需完成低速动作、撤权、停止词和超时锁定的实车验证，不能把当前状态视为可直接开放运动控制。

## 7. 今天自己需要掌握的基础命令

下面不是要求机械背诵，而是要知道每一类命令在系统链路中回答什么问题。

### 服务和日志

```bash
systemctl is-enabled m3pro-openclaw-ready.target
systemctl status m3pro-openclaw-brain.service --no-pager
journalctl -u m3pro-openclaw-brain.service --since '10 min ago' --no-pager
sudo systemctl start m3pro-openclaw-brain.service
sudo systemctl stop m3pro-openclaw-brain.service
```

需要记住：

- `is-enabled` 回答“下次开机还会不会自动启动”。
- `status` 回答“进程现在是否活着、最近是否失败”。
- `journalctl -u` 回答“该服务实际输出了什么证据”。
- `start` 和 `stop` 会改变系统状态，执行前必须知道目标服务负责什么。

### 内存和进程

```bash
free -h
ps -eo pid,ppid,comm,%mem,rss,etime,args --sort=-rss | head -n 20
systemctl show m3pro-openclaw-brain.service -p MemoryCurrent -p NRestarts
```

需要记住：

- `free -h` 看总内存、可用内存和 Swap。
- `ps ... --sort=-rss` 找出真正占内存最多的进程。
- `MemoryCurrent` 看服务整体内存。
- `NRestarts` 判断服务是否反复崩溃重启。

### USB、声卡和串口

```bash
lsusb
cat /proc/asound/cards
ls -l /dev/ttyUSB* /dev/mic /dev/myserial
pactl info
arecord -l
```

需要记住：

- `lsusb`：USB 设备有没有被 Linux 枚举。
- `/proc/asound/cards`：声卡有没有被 ALSA 识别。
- `/dev/ttyUSB*`：USB 串口编号是否变化。
- `pactl info`：当前客户端连接的默认输入和输出到底是谁。

### ROS 2 状态

```bash
ros2 node info /m3pro_control_gateway
ros2 action info /action_service
ros2 topic info /cmd_vel -v
ros2 service call /m3pro_control/status std_srvs/srv/Trigger '{}'
```

需要记住：

- `node info`：一个节点的服务、话题和 Action 边界。
- `action info`：动作客户端和服务端分别是谁。
- `topic info -v`：数据由谁发布，被谁订阅。
- `service call`：直接查询或改变某个 ROS 服务状态，具体取决于服务实现。

## 8. FinalShell 与 Windows 远程桌面的分工

FinalShell 更适合观察系统内部：服务、日志、节点、话题、设备枚举和构建结果。

Windows 远程桌面（MSTSC）和现场观察更适合确认现实世界：有没有声音、相机画面是否正常、车体是否真的移动、周围是否清空、机械结构有没有异常。

因此，一次完整验收不能只停留在终端，也不能只盯着车。软件状态和物理结果都要一致。

## 9. 这次形成的排错模板

以后遇到任意机器人问题，都可以按下面的格式记录：

```text
### 问题名称

#### 现象
用户看到了什么，设备做了什么或没有做什么。

#### 系统边界
这个问题涉及硬件、Linux、ROS、服务、模型还是执行器。

#### 证据
日志、设备枚举、话题、服务状态、文件时间戳分别说明了什么。

#### 根因判断
哪些是已确认事实，哪些只是推测，哪些仍需验证。

#### 处理决定
为什么要修改、为什么暂缓、为什么必须保留安全限制。

#### 验证结果
修改后是否完成启动、真实输入、真实输出、停止和关机验证。
```

## 10. 今天最容易犯的误区

### 误区一：`active` 就代表功能正常

服务活着，只说明进程没有退出。它不证明麦克风、话题、模型、Action 或底盘一定可用。

### 误区二：看到内存高，就立刻认定是泄漏

必须确认是模型常驻、重复加载、缓存增长还是异常重启。不同根因对应完全不同的处理方式。

### 误区三：动作没有执行，就把安全网关删掉

网关拒绝动作时，先检查拒绝条件。今天的 `LOCKED` 正是在阻止未经授权的模型动作直接碰到底盘。

### 误区四：只验证启动，不验证停止和退出

底盘功能尤其要验证撤权、停止词、会话超时、Action 取消和关机。机器人安全不是“能动”，而是异常时仍能可靠地不动或停下。

## 11. 阶段结论

今天最有价值的收获，不是某一条 `systemctl` 或 `ros2` 命令，而是开始用一条完整链路理解机器人：

```text
硬件是否存在
→ 系统是否识别
→ 数据是否进入 ROS
→ 模型是否正确理解
→ 安全层是否允许
→ 执行器是否真实响应
```

这已经不只是“会用小车”，而是在学习如何维护一个包含传感器、语音、模型、ROS 2 和真实执行器的自动化系统。

本次已完成语音链路与安全授权边界的系统化排错，并完成隔离环境中的受限会话验证；低速实车验收仍是下一次上电后的必要步骤。
