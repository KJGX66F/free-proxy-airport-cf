Cloudflare Worker 高可用订阅透传与加速服务

一个轻量、高效的 Cloudflare Worker 订阅代理与透传转换服务。支持 1:1 原汁原味透传 Clash (YAML) 完整配置与通用 Base64 订阅，具备多 CDN 容灾加速、自定义访问后缀（Token）防扒保护以及动态 URL 代理转换功能。机场级体验的 Clash Verge / Mihomo 免费节点订阅系统。 每 30 分钟自动聚合公开免费节点源，执行真实延迟测试，剔除超时和无效节点，并按健康评分生成自动分组。

🌟 核心特性

1:1 原汁透传：完整保留原订阅中的 AUTO-FAST 策略组、国旗 Emoji 图标、自定义分流规则与低延迟优质节点。

多源 CDN 容灾：自动在 GitHub Pages、jsDelivr 和 GitHub Raw 节点间无缝切换，保证国内网络环境下的高可用性与稳定连接。

自定义后缀保护：支持设置专属访问 Token（例如 /kjgx/clash），未授权或未带正确后缀的请求统一返回 404 Not Found，有效防止恶意扫描与订阅爬取。

环境变量解耦：无需频繁修改代码，可通过 Cloudflare Dashboard 后台轻松管理 Token 与默认订阅源。

动态 URL 转发：支持通过 ?url= 参数动态代理和加速任意第三方 Clash 或 Base64 订阅链接。

🚀 快速部署

登录 Cloudflare Dashboard。

进入 Workers & Pages -> 点击 Create Application (创建应用程序) -> Create Worker (创建 Worker)。

输入 Worker 名称（例如 sub-worker），点击 Deploy (部署)。

点击 Edit Code (编辑代码)，将项目脚本代码粘贴替换进去，然后点击 Save and Deploy (保存并部署)。

⚙️ 环境变量配置 (推荐)

为提高安全性与修改灵活性，建议在 Cloudflare 控制台后台配置环境变量：

进入你的 Worker 项目界面，点击 Settings (设置) -> Variables and Secrets (变量和机密)。

点击 Add (添加) 添加以下环境变量：

变量名称

是否必填

默认值

说明

SUB_TOKEN

否

kjgx

自定义访问路径后缀（防扒 Token）

CLASH_URL

否

https://sunmiaoxxx.github.io/free-proxy-airport/clash.yaml

默认 Clash YAML 订阅源地址

BASE64_URL

否

https://sunmiaoxxx.github.io/free-proxy-airport/sub/sub_merge.txt

默认 Base64 订阅源地址

点击 Deploy (部署) 保存生效。

🔗 订阅链接格式与使用

假设你的 Worker 域名为 https://sub-worker.example.workers.dev，设置的 SUB_TOKEN 为 kjgx：

1. 基础订阅导入

Clash / Clash Verge / Sing-box (YAML 格式):

https://sub-worker.example.workers.dev/kjgx/clash


通用 Base64 (v2rayN / Shadowrocket / 小火箭):

https://sub-worker.example.workers.dev/kjgx/sub


说明页面与状态查看:
用浏览器打开：https://sub-worker.example.workers.dev/kjgx

2. 动态代理任意第三方订阅

借助 ?url= 参数，可直接通过该 Worker 加速或透传任意第三方订阅链接：

https://sub-worker.example.workers.dev/kjgx/clash?url=https://example.com/other-subscription.yaml


📜 开源许可

本项目遵循 MIT License 开源许可协议。
