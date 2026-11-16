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

## 2. 渠道调研矩阵与执行状态（截至 2026-11-16 实测）

### 第一梯队：MCP 目录与 GitHub Awesome 榜单（长期搜索流量，零风控，立即可推进）

| 渠道 | URL / 入口 | 2026-11-16 实测现状与规则 | 当前状态 |
| --- | --- | --- | --- |
| **awesome-mcp-servers** | `https://github.com/punkpeye/awesome-mcp-servers` | `97.7k` stars；`CONTRIBUTING.md` 欢迎有公开 GitHub 仓库的 MCP Server，Fork 后按格式加入 `Browser Automation` 分类提 PR 即可；`r/mcp` 置顶推荐 | 待提 PR |
| **Glama MCP Registry** | `https://glama.ai/mcp/servers` | 收录 `121,954` 个 Server；右上角支持 `Add Server`，可标注 `Browser Automation`、`Hybrid`、`Local`、`Remote`、`Apache 2.0` | 待提交 |
| **MCP.so** | `https://mcp.so/` | 顶部有 `Submit` 入口，首页已有 Chrome 浏览器自动化类上榜，支持中英文浏览 | 待提交 |
| **PulseMCP** *(暂缓)* | `https://www.pulsemcp.com/servers` | 顶部横幅提示 **`New server submissions and listing changes are still paused`** | 暂停（暂不投入） |
| **Smithery** *(不适用)* | `https://smithery.ai/` | 已并入 Arcade，横幅提示原有 MCP Proxy 与托管身份服务已于 Oct 31 关停 | 已淘汰 |

### 第二梯队：中文开发者社区（当前最适配、可直接引流第一批 Star 与反馈）

| 渠道 | URL / 节点 | 2026-11-16 实测规则与要点 | 当前状态 |
| --- | --- | --- | --- |
| **LINUX DO** | `https://linux.do/`（节点：`开发调优` / `资源荟萃`） | Claude / Gemini / Vibe Coding 极其活跃；**零容忍纯 AI 生成文案**，必须由作者本人手写口语化实战分享并附真实演示 GIF | 待本人撰稿发布 |
| **V2EX 分享创造** | `https://www.v2ex.com/go/create` | 39,049 主题，允许并鼓励 `[开源]` 前缀自荐独立工具；需先登录账号 | 待登录发布 |

### 第三梯队：海外核心开发者社区（先养号/遵守严苛规则后再集中引爆）

| 渠道 | 2026-11-16 实测规模与规则 | 前置门槛与执行动作 | 当前状态 |
| --- | --- | --- | --- |
| **Hacker News `Show HN`** | `https://news.ycombinator.com/show`；1 天内已有同类项目 `Turbo-Browser-MCP`（47 pts）与 `Agweb`（108 pts / 37 comments）获关注 | 只允许作者本人发可运行开源项目；需先登录 HN 账号，标题客观写实、正文讲清技术架构与安全边界 | 待登录排期 |
| **Reddit `r/mcp`** | `48K` 周访客 / `1.6K` 周贡献；Rule 1–4：No waitlists / No AI slop / No astroturfing / **必选 `showcase` tag** | 先积累评论 Karma 防自动 spam filter；发布时坦诚作者身份 + 附 `gemini-web-demo.gif` | 养号评论中 |
| **Reddit `r/ClaudeAI`** | `2.1M` 成员；Rule 7：须由本人用 Claude 构建或专为 Claude 服务、免费可试、极简宣传语、**`Posts on the feed now require OP karma>100`** | 等账号 Karma `> 100` 后再发独立贴；前期可合规参与置顶 `Built with Claude` 讨论串 | Karma 未达标（待养号） |
| **Reddit `r/LocalLLaMA`** | `932K` 成员；Rule 4：自推比例 `<= 10%`、必须披露作者身份、严禁 `"I found this.."`；置顶有 `[Bi-Weekly Megathread] Project Showcase` | 优先攒评论并控制自推比例，可先在双周置顶 `Project Showcase` 合规留言 | 待推进 |
| **Reddit `r/SideProject`** | `347K` 成员；低 Karma 账号直接带外链新帖易被全站过滤器移除 | 仅在账号历史外链风控解除、积累正常互动后再考虑发布 | 暂缓 |

---

## 3. 本轮建议推进顺序

1. **P0（今日可做）**：提交 `punkpeye/awesome-mcp-servers` PR + 提交 `Glama` 与 `MCP.so`。
2. **P0（今日可做）**：在 `LINUX DO`（本人手写）与 `V2EX /go/create` 发布开源首发帖。
3. **P1（未来 2–3 天）**：在 Reddit 技术板块日常参与高质量评论攒够 `comment karma`，随后按 **Show HN → `r/mcp (showcase)` → `r/LocalLLaMA` → `r/ClaudeAI`（karma>100 后）** 节奏依次发布。
