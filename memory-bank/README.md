# Memory Bank 使用指南

## 概述

参考 `projectcalcs` 分层记忆架构，AgentSurf 的项目记忆按用途分为三层：

1. `state/` — 当前项目事实、活跃上下文、下一步与唯一来源索引
2. `strategy/` — 长期有效的架构/安全/产品决策，以及开源推广与渠道规则唯一追踪源
3. `operations/` — 版本发布、网关改造与对外推广执行流水

## 目录结构

```text
memory-bank/
├── README.md
├── state/
│   ├── brief.md
│   ├── context.md
│   └── source-of-truth.md
├── strategy/
│   ├── decisions.md
│   └── promotion-outreach.md
└── operations/
    └── releases.md
```

## 读写规则

### 默认先读

1. `memory-bank/state/brief.md`
2. `memory-bank/state/context.md`
3. `memory-bank/state/source-of-truth.md`

### 按需再读

- 架构/协议/客户端兼容决策：`memory-bank/strategy/decisions.md`
- 开源推广、目录提交与社区防踩坑：`memory-bank/strategy/promotion-outreach.md`
- 历史发布与推广流水：`memory-bank/operations/releases.md`

### 写入边界

- `state/` 只保留当前有效状态与待办摘要，不堆叠长篇流水账。
- `strategy/promotion-outreach.md` 是外部社区规则、目录状态与投稿计划的唯一主来源；公开仓库严禁写入任何个人账号 ID、服务器 IP、口令或密钥。
- 完成阶段性交付或推广动作后，同步更新 `state/context.md` 与 `operations/releases.md`。
