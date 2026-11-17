# Promotion & Outreach Playbook

> 创建：2026-11-16；所有渠道状态与规则均为 2026-11-16 通过 AgentSurf 在真实浏览器中核验后的结果。
> 本文件是开源推广渠道、社区合规红线与投稿进度的唯一主来源。

## 1. 核心传播原则（合规与防删铁律）

1. **禁止「假装路人 / 我发现了一个 MCP」伪装话术（关键纠偏）**：
   - `r/mcp` Rule 3 明确规定 **`No astroturfing`**，Rule 4 要求作者使用 **`showcase`** 标签直接展示作品。
   - `r/LocalLLaMA` Rule 4 明确规定 **`Affiliation must be disclosed: No engagement farming, No “I found this..”, etc.`**（点名禁止 `"I found this.."`）。
   - **正确话术**：坦诚以 **开源作者 / 开发者本人** 身份介绍，聚焦工程痛点、技术对比（vs Playwright MCP / 本地 CLI Browser Skill）与真实边界（如透明说明 Gemini Web 会对写操作再次确认），绝不用营销腔、不买量刷赞、不留 Waitlist。
2. **禁止纯 AI 生成灌水文案**：
   - `LINUX DO` 对纯 AI 生成投稿/回复实行零容忍封号政策；作者本人须根据真实开发经历自行撰写口语化正文。
3. **先养 Karma 再发海外带链主帖（Reddit 风控防吞）**：
   - 新号或极低 `comment karma` 账号直接发外链极易被 `Reddit's filters` 自动拦截移除；`r/ClaudeAI` 规则明确限制 **`OP karma > 100`**。
   - 海外社区发主帖前，先通过高质量技术评论积累 `comment karma`，且自荐贴比例严格控制。
4. **复用统一开源资产**：
   - 主图 / 演示 GIF：[docs/assets/gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)（`880×545`、`16.9s`、`2.27 MB`，真实 Gemini Web + Chrome 蓝色 Tab Group + `AI` 光标操控 Wikipedia 多步流程）与 [docs/assets/agentsurf-demo-live.gif](../../docs/assets/agentsurf-demo-live.gif)。
   - 开源协议：`Apache-2.0`，全程免费开源自托管，无商业化付费墙。

---

## 2. 渠道调研矩阵与执行状态（截至 2026-11-16 实测与范围确认）

### 已推进并保留的收录渠道（仅跟踪自动合入结果）

| 渠道 | 当前进度 | 后续动作 |
| --- | --- | --- |
| **GitHub `punkpeye/awesome-mcp-servers`** | **PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670) 已补充 Glama 评分徽章（`abbe8d2`）**：`check-submission` 通过，标签已从 `missing-glama` 更新为 **`has-glama`**（`has-emoji, valid-name, has-glama`） | 等待维护者审核合并 |
| **Glama (`glama.ai/mcp/servers`)** | **已过审认领并发布 `0.1.0` 容器构建版本**：配置 `["npm ci", "npm run build"]` + `["node", "dist/mcp/cli.js"]` 通过 Docker build + MCP `initialize`/`tools/list` 探测（`Status: success`，`/schema` 已解锁 `Deploy`） | 等待 Glama 异步完成 `quality` 评级索引 |
| **`mcpservers.org`（`wong2/awesome-mcp-servers` 入口）** | **已免费提交 `AgentSurf`**（`$0`，`development` 分类），最长 2 周审核 | 等待审核结果邮件即可 |

### 已放弃渠道（不再投入时间）

- **全部未申请渠道已正式放弃**：Reddit（`r/mcp` / `r/LocalLLaMA` / `r/ClaudeAI` 养号及发帖全部取消）、V2EX、LINUX DO、Hacker News `Show HN`、`MCP.so`（仅 `$39` 付费）、`PulseMCP`（暂停提交）、`Smithery`（旧代理已于 2026-10-31 关停）。

---

## 3. 收尾状态

- **已全部收尾上线/待审**：`npm`（`agentsurf-mcp@0.7.0` 已上线）、`Glama`（已认领并通过 Docker 构建与 MCP 探测）、`punkpeye/awesome-mcp-servers`（PR `#19670` 已挂 `has-glama` 待合入）、`mcpservers.org`（待邮件通知），不再新增推广动作。
