# Coray Trip 安装包

2026-10-17 · 基于已安装 skill/wrapper 0.2.1 的便携导出

## 先读这一段

把 ZIP 发给你的 dot，请它按下面的安装口令操作。它包含 skill、远程 MCP 连接配置和配置踩坑说明，不含旅行数据或任何人的密码、token、App ID、OAuth 授权。

**重要限制：当前服务器 OAuth 只允许一个预先指定的 Content manager 账号。另一人的独立账号不能仅靠导入 ZIP 就获得连接资格。** 如账号不符合条件，请停在连接步骤，找服务所有者确认支持方案。不要借用他人账号，也不要擅自更换服务器 OAuth 用户配置。

## 给 dot 的安装口令

请检查附件中的 Coray Trip 插件包。先读 README.zh-CN.md 和 skills/manage-trips/references/setup-and-pitfalls.zh-CN.md。检查我当前账号有没有已安装的相同插件，以及你有没有官方插件导入/创建工具。有则在我的账号按官方流程安装这个便携包；没有则告诉我当前支持的最短安装步骤，不要声称已安装。连接时让我在安全窗口使用我自己的合资格账号登录并确认 OAuth。不要复制别人的凭据或 App 绑定，不要替我创建账号、改角色、增加成员或更换服务器 OAuth 配置。安装后先核对六个工具，再只读 list_trips，逐项说明哪些步骤成功、哪些仍受账号或宿主能力限制。

## 最少步骤

1. 下载 ZIP，转给收件人的 dot，并附上面的口令。
2. 收件人的 dot 用支持的插件创建/导入流程处理 ZIP。网页上传入口是否可用取决于账号、套餐和工作区权限；并非所有手机或 dot 都能直接导入。
3. 收件人在安全登录窗口检查 Coray Trip 域名，自己登录并同意 OAuth。没有资格时停止；本包不修改服务器权限。
4. 用只读工具验证。看到工具名不代表授权成功；空列表也可能只是没有加入任何行程。

无需重新部署网站。现有网站：https://trip.coray.app
MCP 连接：https://trip.coray.app/mcp
传输：Streamable HTTP；OAuth DCR；scope：trips:manage。

## 里面有什么

- plugin.json：Agent Plugins 1.0 便携插件声明
- mcp.json：现有远程服务与 OAuth 配置，无密钥
- skills/manage-trips/SKILL.md：原有旅行管理规则，增加安装和当前字段说明
- skills/manage-trips/references/setup-and-pitfalls.zh-CN.md：完整安装流程、权限边界、踩坑和排障
- skills/manage-trips/references/content-contract.md：版本控制、地图、logo、封面、卡片分类和成员字段说明
- PACKAGE-STATUS.md：来源与实际验证范围
- SHA256SUMS.txt：包内文件校验值

本包不包含 MCP 服务器程序或数据库；MCP 仍由现有服务提供。需要自行部署整套服务是另一项工作。

## 三个最关键的坑

- 包版本升级不等于工具 schema 刷新。保留原连接，在同一 App 的 Manage → Reload tools/Refresh 后核对目标对话实际参数。不要用断开重建、增加授权或全文替换绕过。
- 编辑前先读版本；超时后不能换一个新 requestId 盲重试。logo/封面必须符合 PNG 大小与格式限制，branding 是整对象替换。
- 网页账号、行程成员、Content manager 和 OAuth 资格不同。导出/导入不会复制权限，MCP 也没有成员管理工具。

## 隐私与验证

包已按公开转发用途去敏，不带发送者账号/邮箱、私有插件/App ID、OAuth grant、client secret、旅行内容或后台配置。每位使用者的登录与授权必须在自己的宿主中完成。

已做：源包读取、格式/JSON/skill 检查、最终 ZIP 内容检查及敏感信息扫描。
未做：替收件人安装、登录或新增授权；收件人客户端实际读写验收。云端独立 HTTP metadata 检查遇到 403，未绕过；这不能据以判断已注册连接是否可用。

详细排障在包内 setup-and-pitfalls.zh-CN.md。
官方插件安装说明：https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
