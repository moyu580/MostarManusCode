---
title: "MostarBot: 基于 OpenClaw 的具身智能机器人系统"
description: 一台「会思考」的智能机器人 —— 集成 ROS2 导航、6DOF 机械臂、多模态视觉与大语言模型 Agent,实现从自然语言指令到物理动作的端到端闭环执行。
date: 2025-06-15
status: 活跃开发中
tags: [具身智能, OpenClaw, ROS2, 机械臂, LLM Agent, SLAM, YOLOv8]

links:
  demo: ""
---

## 项目概述

MostarBot 是我的核心项目:一台**由大模型驱动的具身智能机器人**,目标是让机器人具备真正的「理解 → 推理 → 执行」能力。

不同于传统的遥控小车或预编程自动化设备,MostarBot 可以:

- 🎯 **听懂自然语言**: 「帮我把桌上的红色易拉罐捡起来扔进垃圾桶」
- 👁️ **看见并理解环境**: 多模态视觉 + 3D 深度感知
- 🧠 **自主规划任务**: LLM Agent 将复杂任务分解为可执行步骤
- ✋ **精确物理操作**: 6 自由度机械臂 + MoveIt2 运动规划
- 🗺️ **自主导航**: SLAM 建图 + Navigation2 路径规划

---

## 系统架构

```architecture
{
  "label": "MostarBot 系统架构",
  "layers": [
    {
      "title": "用户交互层",
      "items": ["语音", "文字", "WebChat", "飞书", "微信"]
    },
    {
      "title": "OpenClaw Agent（大脑）",
      "items": ["多模态 LLM 理解", "任务链分解", "Function Calling"]
    },
    {
      "title": "ROS 2 中间件层",
      "items": ["Navigation2", "MoveIt2", "自定义 Topic"]
    },
    {
      "title": "执行模块",
      "modules": [
        {
          "title": "底盘控制",
          "items": ["双雷达", "SLAM", "导航", "PID 速度环"]
        },
        {
          "title": "机械臂控制",
          "items": ["6DOF", "MoveIt2", "抓取"]
        },
        {
          "title": "感知系统",
          "items": ["深度相机", "YOLOv8 检测", "追踪算法", "Mediapipe"]
        }
      ]
    },
    {
      "title": "硬件执行层",
      "items": ["Jetson Orin Nano", "STM32", "传感器阵列"]
    }
  ]
}
```

---

## 核心模块

### 1. 具身智能 Agent (OpenClaw)

基于大语言模型的智能体,负责:
- **语义理解**: 解析用户的自然语言指令
- **意图识别**: 判断用户想要做什么(导航/抓取/问答)
- **任务链分解**: 将复杂任务拆解为原子操作序列
- **工具调用**: 通过 Function Calling 接口调用机器人 API

### 2. 导航系统

- **SLAM 建图**: Gmapping / Cartographer 双方案
- **路径规划**: Navigation2 全向避障导航
- **路网拓扑**: 支持语义级导航(「去厨房」→ 自动规划路径)
- **定位融合**: 激光雷达 + 视觉重定位

### 3. 视觉感知

| 能力 | 方案 | 用途 |
|------|------|------|
| 目标检测 | YOLOv8 | 物体识别与定位 |
| 3D 感知 | 深度相机 | 空间距离测量 |
| 目标追踪 | Transformer | 连续跟踪运动目标 |
| 手势识别 | Mediapipe | 人机交互输入 |

### 4. 机械臂控制

- **6 自由度机械臂**: 3D 空间内任意位姿到达
- **MoveIt2**: 碰撞检测 + 轨迹平滑
- **多种抓取策略**: ID 分拣、颜色分拣、追踪夹取

---

## 技术栈

```
硬件平台:
  主控: Jetson Orin Nano / 树莓派 5
  底层: STM32 (micro-ROS)
  传感器: 双激光雷达 + RGB-D 深度相机 + IMU

软件栈:
  操作系统: Ubuntu 22.04 + Docker 容器化
  机器人框架: ROS2 Humble
  导航: Navigation2 + Gmapping/Cartographer
  机械臂: MoveIt2
  AI/ML: OpenClaw + YOLOv8 + Transformers
  开发语言: Python / C++ / JavaScript
```

---

## 典型工作流程

以「帮我拿一下桌上的易拉罐」为例:

```
[用户] "帮我拿一下桌上的易拉罐"
    ↓
[Agent] 多模态理解: 分析摄像头画面,检测到红色易拉罐
    ↓
[Agent] 任务分解:
  1. 导航到桌子旁边
  2. 定位易拉罐的 3D 坐标
  3. 规划机械臂抓取轨迹
  4. 执行抓取
  5. 将易拉罐递给用户
    ↓
[执行] 依次调用底盘导航 → 视觉定位 → MoveIt2 规划 → 机械臂执行
    ↓
[反馈] 视觉确认抓取成功 → 向用户报告完成 ✓
```

---

## 当前进展

- ✅ ROS2 底盘控制系统 (PID + 编码器 + micro-ROS)
- ✅ 双雷达 SLAM 建图与导航
- ✅ YOLOv8 目标检测 + 追踪
- ✅ MoveIt2 机械臂基本控制
- ✅ OpenClaw Agent 基础接入
- ✅ 自然语言 → 底盘移动
- 🔄 机械臂视觉伺服抓取 (成功率 ~70%)
- 🔄 多模态场景理解优化
- ⏳ Multi-Agent 协作模式
- ⏳ 主动式交互(机器人主动发起对话)

---

## 未来计划

- [ ] 接入 RAG 知识库,让机器人「记住」环境信息
- [ ] Sim2Real 迁移,提升仿真到现实的泛化能力
- [ ] 边缘部署优化(TensorRT 加速推理)
- [ ] 多机器人协作(Multi-Agent 编队)

---

*这个项目还在持续迭代中。如果你对具身智能感兴趣,欢迎一起交流讨论!*
