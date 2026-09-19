# 安全策略

**中文** ｜ [English](#security-policy)

## 支持的版本

只有最新发布版本接受安全修复，旧版本请先升级。

## 报告漏洞

请**不要**用公开 Issue 报告安全问题。使用 GitHub 的私有漏洞报告通道：

**→ [Report a vulnerability](https://github.com/ztao0916/agentsurf-browser-control-runtime/security/advisories/new)**

（仓库页 `Security` 标签页 → `Report a vulnerability`）

私有报告不要求你公开邮箱，也能让我们在修复前先与你协作。请在报告里尽量给出：影响版本、复现步骤、影响面，以及你希望的署名方式。

我们会尽力在 **72 小时内**确认收到，并在修复发布后于安全公告里致谢（除非你希望匿名）。

## 在范围内

- **Bridge 认证绕过**：token 校验缺陷，或服务监听到 `127.0.0.1` 之外
- **Native Host 提权 / 任意命令执行**：经扩展或配置文件触发的越权执行
- **会话隔离绕过**：跨对话读取、操作或关闭不属于本会话的页签；关闭用户原有页签
- **凭据泄漏**：token、`config.json` 内容进入日志、错误信息或仓库
- **页面侧注入**：恶意网页经 content script 通道触发越权操作或逃逸出页面上下文

## 不在范围内

- **用户已明确授权的破坏性操作**：AgentSurf 的设计就是让 Agent 操作用户的登录态，这一点已在 [README 安全边界](README.md#9-安全边界) 中声明，运行时**不内置人工审批**
- **需要本机已被攻陷或已具备管理员权限**的攻击
- **[README 当前限制](README.md#10-当前限制) 里已列出的已知行为**（无 OCR、不支持 Shadow DOM、iframe 需显式寻址、受保护页面不可注入等）
- 第三方依赖自身的漏洞（欢迎一并告知，但上游才是修复方）

## 部署建议

AgentSurf 会操作用户登录态下的页面，请勿把 Bridge 暴露到公网，也不要提交本机 `config.json` 或 token。详见 [README 安全边界](README.md#9-安全边界)。

---

# Security Policy

**English** ｜ [中文](#安全策略)

## Supported versions

Only the latest release receives security fixes. Please upgrade before reporting.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private vulnerability reporting:

**→ [Report a vulnerability](https://github.com/ztao0916/agentsurf-browser-control-runtime/security/advisories/new)**

(Repository `Security` tab → `Report a vulnerability`)

Private reporting requires no public email address and lets us collaborate before a fix ships. Please include the affected version, reproduction steps, impact, and how you would like to be credited.

We aim to acknowledge reports within **72 hours**, and will credit you in the advisory once a fix is released (unless you prefer to stay anonymous).

## In scope

- **Bridge authentication bypass**: flawed token checks, or the service listening beyond `127.0.0.1`
- **Native host privilege escalation / arbitrary command execution** triggered through the extension or its config
- **Session isolation bypass**: reading, acting on, or closing tabs that belong to another conversation; closing a tab the user already had open
- **Credential disclosure**: tokens or `config.json` contents leaking into logs, error messages, or the repository
- **Page-side injection**: a malicious page escalating through the content-script channel or escaping the page context

## Out of scope

- **Destructive actions the user explicitly authorized**: AgentSurf exists to let an agent drive the user's logged-in session. The runtime does **not** implement human approval, as stated in the [README security boundaries](README.en.md#9-safety-boundaries)
- Attacks that require the machine to be already compromised or to hold admin rights
- **Known behaviors already listed under [README current limitations](README.en.md#10-current-limitations)** (no OCR, no Shadow DOM support, iframes need explicit addressing, protected pages cannot be injected, etc.)
- Vulnerabilities in third-party dependencies (tell us anyway, but upstream is the fixer)

## Deployment guidance

AgentSurf drives pages under the user's logged-in session. Do not expose the bridge to the public internet, and never commit your local `config.json` or token. See the [README security boundaries](README.en.md#9-safety-boundaries).
