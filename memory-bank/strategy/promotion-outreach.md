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

### 活跃推进渠道（用户确认保留）

| 渠道 | 2026-11-16 实测与执行模式 | 当前进度 |
| --- | --- | --- |
| **GitHub `punkpeye/awesome-mcp-servers`** | `97.7k` stars；按 `CONTRIBUTING.md` 规范加至 `Browser Automation` 分类；**节奏 A（先填好 PR 截图确认，不擅自点最终提交）** | 已 Fork 至 `ztao0916/awesome-mcp-servers` 并推送分支 `add-agentsurf`（`5682d52`），PR 表单已预填待确认提交 |
| **Reddit 养号期（`r/mcp` / `r/LocalLLaMA` / `r/ClaudeAI`）** | 仅对真实技术讨论与求助发干货评论（严禁放自推链接、严禁 `"I found this.."` / astroturfing），先跨过全站外链过滤及 `r/ClaudeAI` `karma > 100` 门槛 | 已锁定首轮 2 条高匹配技术求助帖（`r/mcp` 远程写权限设计 + `r/LocalLLaMA` 本地推理硬件配置）待评论 |
| **Reddit 正式发布期（`r/mcp` `showcase` / `r/LocalLLaMA` / `r/ClaudeAI`）** | 必须如实披露作者身份（`showcase` tag），附 [docs/assets/gemini-web-demo.gif](../../docs/assets/gemini-web-demo.gif)；**节奏 A（先确认文案后提交）** | 等待养号评论 Karma 积累达标后开启 |

### 已排除 / 暂不推进渠道（2026-11-16 用户确认）

| 渠道 | 排除原因 |
| --- | --- |
| **LINUX DO** / **V2EX** | 用户明确不做中文社区（`V2EX`、`LINUX DO` 均不投） |
| **Glama / MCP.so / Hacker News `Show HN`** | 账号无法登录（若后续用户手动完成登录可按节奏 A 补交） |
| **PulseMCP / Smithery** | `PulseMCP` 页顶公告暂停提交；`Smithery` 原 MCP Proxy 服务已关停并入 Arcade |

---

## 3. 本轮建议推进顺序

1. **P0（待确认即可完成）**：确认提交已预填好的 `punkpeye/awesome-mcp-servers` PR。
2. **P0（养号进行中）**：在 `r/mcp` 与 `r/LocalLLaMA` 等真实技术求助帖持续发布高价值、无广告评论，积累 `comment karma`。
3. **P1（Karma 达标后）**：按 **节奏 A** 发布 `r/mcp`（`showcase` tag）及 `r/LocalLLaMA`（`<= 10%` 自推比例），Karma `> 100` 后再发 `r/ClaudeAI`。
