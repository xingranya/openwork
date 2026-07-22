# brand-os-offline-shell — Brand Project OS 默认离线桌面壳

本演示覆盖 F1.9 第一批补丁。鸿日真实资料在全部离线、安全和产物检查通过前不接入。

1. Brand Project OS 在未配置云服务时直接进入本地工作区，不要求登录。

2. 隐私设置默认关闭遥测，网络记录没有 PostHog 请求。

3. Den/Cloud 没有默认地址、后台探测或自动重试。

4. OpenCode 只接收管理员明确登记的模型目录。

5. 原型不会查询 OpenWork 上游版本或静默更新。

6. 应用名称、Bundle ID、深链和数据目录均属于 Brand Project OS。

7. 外部导航、IPC 和网络权限按允许列表工作，未登记目标被拒绝。

8. 打包产物扫描不含上游 Key 和默认连接地址，此时仍未接入鸿日真实资料。
