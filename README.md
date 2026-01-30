# OpenClaw 企业微信插件

> **本插件基于原有的企业微信插件重构，完整适配 OpenClaw 新的 Plugin SDK 接口**

**原插件仓库**: https://github.com/dee-lii/clawdbot-plugin-wecom

> 感谢原作者 **dee-lii** 提供的优秀企业微信插件实现，本插件在其基础上进行了适配和扩展。

本插件为 OpenClaw 提供企业微信消息渠道支持，支持文本、图片、视频、语音、文件等多种消息类型。

## 重构说明

本插件从原有企业微信插件迁移而来，主要变更：

| 方面 | 原插件 | 新插件（OpenClaw） |
|------|---------|-------------------|
| 插件注册 | 原有方式 | 使用 `api.registerChannel()` |
| HTTP Handler | 原有方式 | 使用 `api.registerHttpHandler()` |
| 配置读取 | 自定义配置 | `configSchema` + `resolveAccount` API |
| 消息处理 | 原有实现 | `runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher` |
| 会话管理 | 自定义实现 | `runtime.channel.session` APIs |
| 路由系统 | 原有实现 | `runtime.channel.routing.resolveAgentRoute` |
| CLI 命令 | 原有方式 | `api.registerCli()` |

## 功能特性

- ✅ 支持文本消息发送和接收
- ✅ 支持图片消息（自动上传临时素材）
- ✅ 支持自定义应用菜单
- ✅ 会话上下文管理
- ✅ Webhook 回调验证
- ✅ 消息加密解密
- ✅ Access Token 自动缓存
- ✅ CLI 命令工具（菜单管理、状态检查）

## 安装方法

### 方式一：通过 Git 仓库安装

1. **克隆仓库**
   ```bash
   cd your-openclaw-root/plugins
   git clone git@github.com:zhiluop/wxchat.git wecom
   ```

2. **安装依赖**
   ```bash
   cd wecom
   npm install
   ```

3. **配置 OpenClaw**
   在 OpenClaw 的配置文件（通常是 `openclaw.yaml` 或 `config.yaml`）中添加企业微信配置：

   ```yaml
   channels:
     wecom:
       enabled: true
       corpId: "你的企业ID"
       corpSecret: "你的应用密钥"
       agentId: "你的应用ID"
       token: "回调Token"
       encodingAesKey: "43位消息加密密钥"
   ```

### 方式二：直接复制文件安装

1. **下载插件文件**
   ```bash
   cd your-openclaw-root/plugins
   mkdir wecom
   cd wecom
   ```

2. **将以下文件复制到 `wecom` 目录**：
   - `index.ts`
   - `src/channel.ts`
   - `src/runtime.ts`
   - `src/wecom-api.ts`
   - `openclaw.plugin.json`
   - `package.json`
   - `.gitignore`

3. **安装依赖**
   ```bash
   npm install openclaw/plugin-sdk
   ```

## 配置步骤

### 1. 在企业微信管理后台创建应用

登录 [企业微信管理后台](https://work.weixin.qq.com/)，完成以下配置：

#### 1.1 获取企业 ID (CorpID)
- 进入"我的企业"页面
- 复制"企业ID"

#### 1.2 创建自建应用
- 进入"应用管理" → "自建"
- 点击"创建应用"
- 填写应用名称，选择可见范围

#### 1.3 获取应用凭证
- 在应用详情页获取：
  - **AgentID**：应用ID
  - **Secret**：应用密钥（需要管理员权限）

#### 1.4 配置接收消息
- 在应用详情页点击"接收消息"
- 启用"API接收"
- 设置回调 URL：`https://你的域名/webhooks/wecom`
- 设置 Token：自定义字符串（用于签名验证）
- 设置 EncodingAESKey：随机生成的 43 位字符串
- 加密方式选择"安全模式"

### 2. 配置 OpenClaw

支持两种配置方式（任选其一）：

#### 方式一：插件配置（推荐）

在 OpenClaw 配置文件中添加：

```yaml
plugins:
  entries:
    wecom:
      config:
        corpId: "ww1234567890abcdef"
        corpSecret: "your-corp-secret-here"
        agentId: "1000002"
        token: "your-webhook-token"
        encodingAesKey: "your-43-char-encoding-aes-key-12345678901234567"
```

#### 方式二：渠道配置

```yaml
channels:
  wecom:
    enabled: true
    corpId: "ww1234567890abcdef"
    corpSecret: "your-corp-secret-here"
    agentId: "1000002"
    token: "your-webhook-token"
    encodingAesKey: "your-43-char-encoding-aes-key-12345678901234567"
```

> **注意**：插件配置（方式一）优先级高于渠道配置（方式二）

### 3. 验证配置

重启 OpenClaw 服务后，使用 CLI 命令检查连接状态：

```bash
openclaw wecom status
```

如果配置正确，会看到：
```
企业微信渠道状态:
  账户ID: default
  已启用: true
  已配置: true
  配置来源: plugins.entries.wecom.config
  连接状态: 正常 (Token已获取)
```

## 使用方法

### 发送消息

1. 在企业微信应用中发送文本消息
2. OpenClaw 会自动路由到配置的 AI Agent
3. AI 回复会通过企业微信 API 发送回来

### 菜单命令

插件会自动创建应用菜单，支持以下快捷命令：

| 命令 | 说明 |
|-------|------|
| /reset | 新对话 |
| /compact | 压缩上下文 |
| /context | 查看上下文 |
| /stop | 停止生成 |
| /model | 切换模型 |
| /help | 帮助 |
| /status | 状态 |
| /commands | 命令列表 |
| /whoami | 我是谁 |

### CLI 命令

#### 创建/更新应用菜单
```bash
openclaw wecom menu
```

#### 检查连接状态
```bash
openclaw wecom status
```

#### 指定账户操作（多账户模式）
```bash
openclaw wecom menu -a account1
openclaw wecom status -a account2
```

## 支持的消息类型

### 文本消息
- 直接输入文本发送
- 自动支持 Markdown 格式
- 支持表格转换（代码块或列表模式）

### 图片消息
- OpenClaw 生成的图片会自动上传到企业微信临时素材库
- 支持多张图片并发
- 自动过滤错误提示文本

### 自定义菜单
- 支持三级菜单结构
- 点击菜单相当于发送文本命令

## 高级配置

### 多账户支持

```yaml
channels:
  wecom:
    accounts:
      default:
        corpId: "..."
        corpSecret: "..."
        agentId: "..."
        token: "..."
        encodingAesKey: "..."
        enabled: true
      account1:
        corpId: "..."
        corpSecret: "..."
        agentId: "..."
        token: "..."
        encodingAesKey: "..."
        enabled: true
```

### Webhook 路径

默认 Webhook 路径：`/webhooks/wecom`

可通过 URL 参数 `account` 指定账户：
```
https://你的域名/webhooks/wecom?account=account1
```

## 故障排查

### 问题：消息发送失败

**检查项：**
1. 企业微信应用是否已启用
2. 配置的 Secret 是否正确
3. AgentID 是否为数字格式
4. 网络是否可以访问 `qyapi.weixin.qq.com`

**解决方法：**
```bash
openclaw wecom status
```

### 问题：Webhook 验证失败

**检查项：**
1. Token 是否一致
2. EncodingAESKey 是否一致
3. 回调 URL 是否可访问
4. 企业微信是否发送验证请求

**解决方法：**
查看 OpenClaw 日志中的签名验证错误信息

### 问题：图片无法发送

**检查项：**
1. 图片文件是否存在
2. 图片格式是否支持（jpg, jpeg, png, gif, webp）
3. 图片大小是否超过限制（企业微信限制 2MB）

**解决方法：**
确保 OpenClaw 生成的图片路径正确，插件会自动处理图片上传。

## 安全建议

1. **不要将配置信息提交到 Git**
   - `.env` 文件已在 `.gitignore` 中
   - 配置文件建议使用环境变量

2. **保护敏感信息**
   - `corpSecret` 应该保密
   - `token` 和 `encodingAesKey` 应该保密
   - 不要在公开仓库中包含真实配置

3. **使用 HTTPS**
   - Webhook 回调 URL 必须使用 HTTPS
   - 企业微信不接受 HTTP 回调

## 开发说明

### 项目结构

```
wecom/
├── index.ts              # 插件入口
├── src/
│   ├── channel.ts        # 渠道插件实现
│   ├── runtime.ts        # 运行时管理
│   └── wecom-api.ts    # 企业微信 API 封装
├── openclaw.plugin.json  # 插件清单
├── package.json          # npm 包配置
└── README.md            # 项目文档
```

### 技术栈

- **TypeScript** - 类型安全
- **OpenClaw Plugin SDK** - 插件接口
- **Node.js fetch API** - HTTP 请求
- **crypto** - 消息加密解密

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

- 仓库地址：https://github.com/zhiluop/wxchat
