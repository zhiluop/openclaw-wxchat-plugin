# OpenClaw 企业微信插件

OpenClaw 企业微信消息渠道插件，支持文本、图片等多种消息类型。

## 致谢

本插件基于 [dee-lii/clawdbot-plugin-wecom](https://github.com/dee-lii/clawdbot-plugin-wecom) 重构，感谢原作者 **dee-lii** 提供的优秀实现。

## 安装方法

### 通过 Git 仓库安装

```bash
cd your-openclaw-root/plugins
git clone https://github.com/zhiluop/openclaw-wxchat-plugin.git wecom
cd wecom
npm install
```

### 直接复制文件安装

将以下文件复制到 `plugins/wecom/` 目录：
- `index.ts`
- `src/` 目录
- `openclaw.plugin.json`
- `package.json`

然后运行：
```bash
cd plugins/wecom
npm install
```

## 配置参数

### 企业微信后台配置

登录 [企业微信管理后台](https://work.weixin.qq.com/)：

1. **获取企业 ID**：进入"我的企业"页面复制
2. **创建自建应用**：进入"应用管理" → "自建" → "创建应用"
3. **获取应用凭证**：
   - **AgentID**：应用 ID
   - **Secret**：应用密钥
4. **配置接收消息**：
   - 回调 URL：`https://你的域名/webhooks/wecom`
   - Token：自定义字符串
   - EncodingAESKey：随机生成的 43 位字符串
   - 加密方式：安全模式

### OpenClaw 配置

在 OpenClaw 配置文件中添加（任选其一）：

**方式一：插件配置**
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

**方式二：渠道配置**
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

### 多账户配置

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
```

## CLI 命令

```bash
openclaw wecom status        # 检查连接状态
openclaw wecom menu          # 创建/更新应用菜单
openclaw wecom menu -a xxx   # 指定账户操作
```

## 许可证

MIT License
