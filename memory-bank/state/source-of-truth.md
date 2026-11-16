# Source of Truth

| 信息类别 | 唯一主来源 |
| --- | --- |
| 项目简介、定位与技术栈 | `memory-bank/state/brief.md` |
| 当前进展、下一步与当前风险 | `memory-bank/state/context.md` |
| 架构、安全、UX 与协议兼容决策 | `memory-bank/strategy/decisions.md` |
| 推广渠道、社区规则、目录状态与发帖队列 | `memory-bank/strategy/promotion-outreach.md` |
| 发布、部署与推广执行记录 | `memory-bank/operations/releases.md` |
| MCP 工具 Schema 与注解定义 | `src/mcp/tool-definitions.ts` |
| 远程只读/交互访问策略 | `src/core/remote-policy.ts` |
| 中英文公开文档与部署指南 | `README.md`、`README.zh-CN.md`、`docs/remote-gateway.en.md`、`docs/remote-gateway.md` |

## 使用规则

1. 读取项目现状优先看 `memory-bank/state/`，不从 `operations/` 反推当前状态。
2. 推广口径、平台限制与目录提交状态只写、只读 `memory-bank/strategy/promotion-outreach.md`。
3. 所有代码事实（工具名、参数、数量）以 `src/` 源码与测试结果为准；所有外部平台规则与状态须注明实测日期。
