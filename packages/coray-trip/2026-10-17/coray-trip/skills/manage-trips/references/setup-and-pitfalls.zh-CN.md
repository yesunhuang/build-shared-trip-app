# 安装流程与踩坑记录

整理日期：2026-10-17。供收件人的 dot 使用；不会自动部署、改权限或迁移旅行数据。

## 先确认能否独立连接

当前服务源码的 OAuth 只接受服务器 SHARED_TRIP_OAUTH_USERNAME 指定的一个已批准 Content manager 账号。普通网页账号、Member 身份、行程 creator 身份都不自动获得 MCP OAuth 资格。

因此，“装好 ZIP”不等于“任何账号都能连接”。收件人必须有自己有资格的账号，并亲自在安全登录窗口授权。不要借用发送者的账号、密码、token、OAuth grant 或 App ID。不要为了让另一人登录而直接更换服务器的单一 OAuth 用户配置：这可能使现有账号的授权失效。多独立账号 OAuth 若不受当前服务支持，需要所有者另行批准的服务改造或独立服务；本包没有执行这些改动。

## 安装步骤

1. 在收件人的 dot 中上传完整 ZIP，请它先读根目录 README 和本文件，检查自己的插件创建/导入能力，以及当前是否已有 Coray Trip。已有相同连接时应复用，避免重复注册。
2. 若该 dot 有 Plugin Creator：按它的官方流程，从 ZIP 为收件人创建私有插件。该操作应由收件人提出并在其账户完成。本包采用 Agent Plugins 1.0，不绑定发送者的私有 App。
3. 若没有该工具：检查 ChatGPT 网页当前账号的插件上传入口。官方帮助文档的管理员路径是 Admin console → 目标 workspace → Plugins → Add → Upload plugin；是否可见取决于套餐、工作区及权限。手机可以转交文件，但不能保证手机界面提供上传入口。无入口时，停在“等待安装入口/管理员权限”，不要声称已安装，也不要虚构按钮。
4. 导入后通过该宿主的连接流程选择 OAuth，让宿主进行动态客户端注册（DCR），发现服务端点，申请 trips:manage。不要填写 client secret；不支持 CIMD 模式，不使用浏览器 cookie 充当 MCP 凭据。
5. 收件人亲自检查域名、输入自己的合资格账号并批准授权。若没有资格，保留安装包并向服务所有者说明具体阻塞，不创建或扩大权限来绕过。
6. 先检查六个工具及当前输入字段，再执行只读 list_trips。仅列出该账号有权限的行程；空列表不一定是错误。需要具体行程时，用返回的 ID 做 get_trip。首次验收不得创建、导入或编辑试验行程。

官方安装说明：https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
Agent Plugins 格式：https://agent-plugins.org/

## 连接参数与判断

- 远程传输：Streamable HTTP，非 SSE，非本地 stdio。
- OAuth：动态注册 DCR；scope=trips:manage；PKCE S256；无打包 client secret。
- 服务当前允许的 OAuth 回调为 https://chatgpt.com/connector_platform_oauth_redirect。不同宿主若要求其他回调，应停止并报告不兼容，不能擅自放宽服务白名单。
- MCP 走 POST；浏览器直接 GET /mcp 返回 405 不等于服务坏了。没有授权的请求返回 401 是正常边界；浏览器网站已登录也不等于 MCP 已授权。
- OAuth access token 有短有效期，refresh token 轮换；旧 refresh token 重放会撤销 token family。授权有绝对 90 天寿命，过期需重新明确同意。不要手工复制或重放凭据。

## 这次配置最容易再踩的坑

### 1. 包版本、App 版本、MCP schema 版本不是同一件事
已安装源 wrapper 是 0.2.1。本便携导出保留这一基线版本并另记打包日期；它不是服务器更新。原来的 App-bound 包只有 App 绑定和 skill，不拥有工具参数定义。只改 wrapper 版本不会刷新 App 中已导入的 schema。

### 2. “服务器已有字段”不等于“这段对话能传字段”
SDK tools/list、App discovery、目标对话的实际工具参数是三层验收。六个工具名能看见或 list_trips 成功，都不能证明 branding/cover/cardCategory 写入参数已更新。
在同一个已安装 App 的 Manage 页面使用 Reload tools，或该宿主等价的 Refresh。保留连接身份、账号、scope 和 grant。随后在宿主要求的刷新会话/新会话中核对实际类型，并执行只读调用。既有长期会话可能保留旧目录；不要不断在旧目录里重试，也不要断开重建连接、重新要授权或用 replace_content 绕过类型缺失。重新授权仅用于真实过期/撤销等认证问题。

### 3. 字段更新要窄，重试要有身份
先读版本，保留日/计划 ID，做最小 patch。未知结果先读回；若重试则 requestId 和 payload 必须完全相同。version_conflict 后重新读取、合并并使用新 requestId。不要在超时后随手换 ID，那会把一次请求变成第二次操作。

### 4. 地图点、Google 关联、照片是三件事
地址或 Google 关联不会自动补齐地图经纬度。用已核实的 OSM snapshot/经纬度，别猜地点 ID。旧 mapsUrl 与规范 googleMapsUrl 的派生行为不同。Google UI Kit 的整块组件和 attribution 保留，不能抽取照片 URL 当自有封面。详见 content-contract.md。

### 5. PNG 限制和整对象替换
logo ≤256 像素/边、≤64 KiB；cover ≤1024 像素/边、≤256 KiB。均须非交错 8-bit RGB/RGBA PNG，base64 不带 data: 前缀，建议压到上限以下。服务器会净化重编码，不能只按原始字节哈希判错。branding 整对象替换，换主题而保留 logo 时要带上现有 logo；cover 独立更新。

### 6. 成员、creator、行程分组不是同一权限
Content manager 也只能访问已加入的行程。已分配旧行程不代表自动加入之后别人新建的行程。participantGroups 只是出行分组。members/access 只读；没有 MCP 成员管理工具。行程邀请码不等于账号邀请码。导出再导入不会复制成员或权限。

### 7. 手机缓存不要用“清空一切”当万能修复
曾发生 CSS 版本查询串/Service Worker 缓存键处理不一致，使旧 CSS 和新 JS 混用。先核对当前部署的版本化资源、缓存策略和实际页面，再按宿主支持流程刷新。不要默认清空全部站点数据、强制退出或销毁授权；界面看起来旧也不代表 MCP 认证坏了。手机宽度模拟通过不代表真实 iPhone/Android PWA 已验收。

### 8. Google 配额与权限不可顺手改
已有 Google 月度用量账本不能重置或重新初始化来解决 UI 问题。包里不需要浏览器 API key。打开行程级 Google 开关也不会自动启用服务器功能、创建 key 或提供额度。

## 故障时最小定位

- 找不到插件：检查本账号的上传/私有插件能力与准确名称，不复制发送者 App ID。
- OAuth 拒绝：先核对账号批准、Content manager 角色和单一 OAuth 资格；不分享发送者凭据。
- list_trips 为空：核对成员分配；不要猜 ID 越权读取。
- get_trip 404：可能是不存在或无权限；向所有者核对，别绕过。
- 401：使用宿主的正常连接/续期流程；不要把 token 贴到聊天里。
- 403/边缘访问拒绝：记录原始限制，不能绕过安全控制；独立 HTTP 探测受限不证明官方连接失败。
- 409：重新读取版本并协调改动；不覆盖新内容。
- validation_failed：检查当前 schema、PNG 格式/大小、字段类型，不以全文替换规避。

## 安装完成的标准

插件导入成功；六工具实际可见；自己的 OAuth 授权成功；只读调用成功；预期行程可见或明确没有已分配行程；brand/cover/category 的实际类型已检查。未执行的步骤应逐项标为未验收。安装本包本身不需要部署、付款、创建账号/授权、成员变更或公开发布；这些均另走必要批准流程。
