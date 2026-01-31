# OpenClaw 企业微信插件

企业微信 (WeCom) 消息渠道插件，让你可以通过企业微信与 OpenClaw AI 助手对话。

## 致谢

本插件基于 [dee-lii/clawdbot-plugin-wecom](https://github.com/dee-lii/clawdbot-plugin-wecom) 重构，感谢原作者 **dee-lii** 提供的优秀实现。

## 功能

- 接收企业微信消息并转发给 AI 处理
- 支持 AES-256-CBC 加密消息解密
- 支持应用菜单快捷命令

## 安装

### 方式一：与 OpenClaw 对话安装

在 OpenClaw 中直接发送插件仓库链接，bot 会自动安装：

```
https://github.com/zhiluop/openclaw-wxchat-plugin
```

### 方式二：手动克隆安装

```bash
# 克隆到插件目录
cd your-openclaw-root/plugins
git clone https://github.com/zhiluop/openclaw-wxchat-plugin.git wecom
cd wecom
npm install
```

## 配置

在 OpenClaw 配置文件中添加企业微信配置：

```yaml
plugins:
  entries:
    wecom:
      config:
        corpId: "你的企业ID"
        corpSecret: "应用Secret"
        agentId: "应用AgentId"
        token: "回调Token"
        encodingAesKey: "回调EncodingAESKey"
```

## 企业微信配置

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/)
2. 创建自建应用
3. 在应用设置中配置：
   - **接收消息 URL**：`https://你的域名/webhooks/wecom`
   - **Token**：自定义，填入配置
   - **EncodingAESKey**：随机生成，填入配置
   - **加密方式**：安全模式

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
