# OpenClaw 企业微信插件

企业微信 (WeCom) 消息渠道插件，让你可以通过企业微信与 OpenClaw AI 助手对话。

## 致谢

本插件基于 [dee-lii/clawdbot-plugin-wecom](https://github.com/dee-lii/clawdbot-plugin-wecom) 重构，感谢原作者 **dee-lii** 提供的优秀实现。

## 功能

- 接收企业微信消息并转发给 AI 处理
- 支持 AES-256-CBC 加密消息解密
- 支持应用菜单快捷命令

## 安装

### 快速安装

复制下面这段话发送给 OpenClaw：

```
Read https://github.com/zhiluop/openclaw-wecom-plugin/blob/master/README.md and follow instructions to install and configure WeCom plugin for OpenClaw.
```

### AI 模型安装指引（供 OpenClaw AI 执行）

#### 1. 安装插件

克隆插件到正确的目录：
```bash
git clone https://github.com/zhiluop/openclaw-wecom-plugin.git ~/.openclaw/extensions/wecom
```

**重要说明**：
- 插件必须安装在 `~/.openclaw/extensions/wecom` 目录
- 目录名称 `wecom` 必须与 `openclaw.plugin.json` 中的 `id` 字段一致

#### 2. 安装依赖

```bash
cd ~/.openclaw/extensions/wecom
npm install
```

#### 3. 配置插件

我需要以下配置参数来设置企业微信插件，请提供：

1. **企业ID (corpId)** - 在企业微信管理后台 -> 我的企业 中获取
2. **应用密钥 (corpSecret)** - 在应用管理 -> 自建应用详情页获取
3. **应用ID (agentId)** - 在应用管理 -> 自建应用中获取
4. **回调Token (token)** - 在应用 -> 接收消息 -> API接收中设置
5. **消息加密密钥 (encodingAesKey)** - 在应用 -> 接收消息 -> API接收中设置（43位字符）

收到配置参数后，我会在 `~/.openclaw/openclaw.json` 中添加以下配置：

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["wecom"],
    "entries": {
      "wecom": {
        "enabled": true,
        "config": {
          "corpId": "YOUR_CORP_ID",
          "corpSecret": "YOUR_CORP_SECRET",
          "agentId": "YOUR_AGENT_ID",
          "token": "YOUR_TOKEN",
          "encodingAesKey": "YOUR_ENCODING_AES_KEY"
        }
      }
    }
  }
}
```

配置完成后，我会自动执行以下命令重启 OpenClaw Gateway 使配置生效：

```bash
openclaw gateway restart
```

#### 4. 配置企业微信回调

在企业微信管理后台配置接收消息 URL：
- **URL**: `https://你的域名/webhooks/wecom`
- **Token**: 使用上面配置的 token 值
- **EncodingAESKey**: 使用上面配置的 encodingAesKey 值
- **加密方式**: 安全模式

## 应用菜单

插件会自动创建以下菜单：

| 菜单 | 功能 |
| --- | --- |
| 新对话 | 重置会话 |
| 压缩上下文 | 压缩对话历史 |
| 切换模型 | 切换 AI 模型 |
| 帮助 | 查看帮助 |

## CLI 命令

```bash
openclaw wecom menu    # 重新创建菜单
openclaw wecom status  # 查看状态
```

## 许可证

MIT License
