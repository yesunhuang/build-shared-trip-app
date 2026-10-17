# 安装流程与踩坑记录

整理日期：2026-10-17。供收件人的 dot 使用；不会自动部署、改权限或迁移旅行数据。

## 先确认能否独立连接

独立账号模式需要服务所有者部署并明确启用 SHARED_TRIP_OAUTH_MULTIUSER=1。现有已批准账号可分别登录和同意：Member/viewer 获得 trips:read 三个只读工具；Content manager 可获 trips:manage 六工具或主动选只读。所有操作仍按当前角色、scope 和行程成员关系限制；不会升级角色或加入别人的行程。管理员凭据不能在此登录。

旧单一用户模式仍兼容；请保留原 SHARED_TRIP_OAUTH_USERNAME，不要改为收件人的用户名。多用户开关不创建账号或同意。每位收件人用自己的连接和安全登录；不共享账号、授权、密码或 token。

## 安装步骤

1. 先在私有安装副本将 mcp.json 的 https://trips.example.org/mcp 换成所有者私下确认的 HTTPS MCP 地址（保留 /mcp）；示例不能直接连接。再在收件人的 dot 中上传完整 ZIP，请它先读根目录 README 和本文件，检查自己的插件创建/导入能力，以及当前是否已有 Coray Trip。已有相同连接时应复用，避免重复注册。
2. 若该 dot 有 Plugin Creator：按它的官方流程，从 ZIP 为收件人创建私有插件。该操作应由收件人提出并在其账户完成。本包采用 Agent Plugins 1.0，不绑定发送者的私有 App。
3. 若没有该工具：检查 ChatGPT 网页当前账号的插件上传入口。官方帮助文档的管理员路径是 Admin console → 目标 workspace → Plugins → Add → Upload plugin；是否可见取决于套餐、工作区及权限。手机可以转交文件，但不能保证手机界面提供上传入口。无入口时，停在“等待安装入口/管理员权限”，不要声称已安装，也不要虚构按钮。
4. 导入后通过该宿主的连接流程选择 OAuth，让宿主进行动态客户端注册（DCR），发现服务端点，申请 trips:manage。不要填写 client secret；不支持 CIMD 模式，不使用浏览器 cookie 充当 MCP 凭据。
5. 收件人亲自检查域名、输入自己的合资格账号并批准授权。若没有资格，保留安装包并向服务所有者说明具体阻塞，不创建或扩大权限来绕过。
6. 先按 scope 检查三个只读或六个管理工具及当前输入字段，再执行只读 list_trips。仅列出该账号有权限的行程；空列表不一定是错误。需要具体行程时，用返回的 ID 做 get_trip。首次验收不得创建、导入或编辑试验行程。

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
原始 wrapper 基线为 0.2.1。本便携包为 0.3.0，增加独立账号工作流及示例服务地址；它不是服务器更新。原来的 App-bound 包只有 App 绑定和 skill，不拥有工具参数定义。只改 wrapper 版本不会刷新 App 中已导入的 schema。

### 2. “服务器已有字段”不等于“这段对话能传字段”
SDK tools/list、App discovery、目标对话的实际工具参数是三层验收。工具名能看见或 list_trips 成功，都不能证明 branding/cover/cardCategory 写入参数已更新。
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
- OAuth 拒绝：先核对账号批准、服务的多用户开关及请求/返回 scope；旧模式再核对单一 OAuth 资格；不分享发送者凭据。
- list_trips 为空：核对成员分配；不要猜 ID 越权读取。
- get_trip 404：可能是不存在或无权限；向所有者核对，别绕过。
- 401：使用宿主的正常连接/续期流程；不要把 token 贴到聊天里。
- 403/边缘访问拒绝：记录原始限制，不能绕过安全控制；独立 HTTP 探测受限不证明官方连接失败。
- 409：重新读取版本并协调改动；不覆盖新内容。
- validation_failed：检查当前 schema、PNG 格式/大小、字段类型，不以全文替换规避。

## 安装完成的标准

插件导入成功；按 scope 实际看到三或六工具；自己的 OAuth 授权成功；只读调用成功；预期行程可见或明确没有已分配行程；brand/cover/category 的实际类型已检查。未执行的步骤应逐项标为未验收。本包不部署服务、不创建账号/成员或授予权限；连接时由收件人本人明确同意建立自己的 OAuth grant。服务器升级与启用另由所有者操作。

## 多用户验收边界

服务器测试涵盖双账号隔离、只读上限、独立撤销、code/refresh 重放、旧授权兼容与 schema-v8 恢复。实际宿主对 scope 缩减的支持须由收件人自己验收；SDK 通过不代表任意宿主都通过。即使 Member 在网页是行程 creator，read-only MCP 也不能创建或编辑。账号角色变化或撤销会结束授权；成员变动立即限制行程。授权的客户端/账号/资源互相绑定，不能用别人的 code 或 refresh token。

原下载附件不会自动更新。更新同一已安装连接时保留其身份、scope 与 grant；由用户使用宿主支持的更新/Reload tools，不创建替代连接。未安装的收件人自行首次导入、注册和同意。
