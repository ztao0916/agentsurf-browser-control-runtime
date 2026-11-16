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

### 活跃推进渠道（截至 2026-11-16 实测与执行）

| 渠道 | 2026-11-16 实测与执行模式 | 当前进度 |
| --- | --- | --- |
| **GitHub `punkpeye/awesome-mcp-servers`** | `97.7k` stars；按 `CONTRIBUTING.md` 规范加至 `Browser Automation` 分类 | **已提交 Open PR [#19670](https://github.com/punkpeye/awesome-mcp-servers/pull/19670)**（`5682d52`），`2/2` checks 通过、无冲突；Bot 标记 `missing-glama`，需待 Glama 过审并补充 Glama score badge 后合入 |
| **Glama (`glama.ai/mcp/servers`)** | 浏览器实测已有登录态；要求公开仓库 + `Dockerfile` 容器构建通过 MCP introspection（`tools/list`），并推荐配置 `glama.json` 声明维护者 | 已提交 `aab2e94` 新增 `Dockerfile`、`.dockerignore` 与 `glama.json`（本地验证 stdio `tools/list` 返回 29 个工具）；已在浏览器以 `Runs from source` 提交审核（`Your server has been submitted for review`），待审核邮件与评分徽章生成 |
| **`mcpservers.org` (`wong2/awesome-mcp-servers`)** | `wong2/awesome-mcp-servers` 仓库不接收 PR，统一导流至 `https://mcpservers.org/submit`（支持 `$0` 免费提交，最长 2 周审核） | **已免费提交 `AgentSurf`**（`development` 分类），页面确认提交成功待邮件审核通知 |
| **Reddit 养号与发布（`r/mcp` / `r/LocalLLaMA` / `r/ClaudeAI`）** | 暂缓：2026-11-16 用户指令聚焦先完成 MCP 收录渠道，Reddit 当日暂停推进 | 未发出任何草稿评论，待后续用户确认重启时优先选择自然、口语化的社区互动帖 |

### 已排除 / 暂不推进渠道（2026-11-16 实测与用户确认）

| 渠道 | 排除原因 |
| --- | --- |
| **LINUX DO** / **V2EX** | 用户明确不做中文社区（`V2EX`、`LINUX DO` 均不投） |
| **Hacker News `Show HN`** | 账号无法登录 |
| **MCP.so (`mcp.so/submit`)** | 实测仅提供 `$39` 一次性付费提交通道，无免费入口，暂跳过 |
| **PulseMCP / Smithery** | `PulseMCP` 页顶公告暂停提交（建议走 Official MCP Registry）；`Smithery` 账号与代理服务已于 2026-10-31 关停 |

---

## 3. 本轮建议推进顺序

1. **P0（等待 Glama 审核邮件）**：收到 `glama.ai` 通过邮件后（若需在后台补填或自动识别仓库 `Dockerfile`），取得 `https://glama.ai/mcp/servers/ztao0916/agentsurf-browser-control-runtime/badges/score.svg`，更新 PR `#19670` 移除 `missing-glama` 标签。
2. **P1（可选加分项）**：若后续决定发布 npm 包 `@agentsurf/mcp-server`（当前 `npm` 未登录、`E404` 未发包），可同步用 `mcp-publisher` 发布至 **Official MCP Registry**（`registry.modelcontextprotocol.io`），以自动同步至 PulseMCP 与其他聚合站。
3. **P2（按需重启）**：等 MCP 目录流程跑通、用户明确继续时再推进轻量 Reddit 社区互动。
