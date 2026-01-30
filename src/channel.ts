import {
  type ChannelPlugin,
  type ResolvedAccount,
  getChatChannelMeta,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { getWeComRuntime, getWeComConfig, getWeComLogger } from "./runtime.js";
import * as WeComAPI from "./wecom-api.js";

// 企业微信账户配置
export interface WeComAccountConfig {
  accountId: string;
  enabled: boolean;
  corpId: string;
  corpSecret: string;
  agentId: string;
  token: string;
  encodingAesKey: string;
}

const meta = getChatChannelMeta("wecom");
const DEFAULT_ACCOUNT = DEFAULT_ACCOUNT_ID;

/**
 * 解析账户配置
 */
function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId?: string
): WeComAccountConfig {
  const id = accountId ?? DEFAULT_ACCOUNT;

  // 从 channels.wecom 读取（新配置格式）
  const channelConfig = cfg.channels?.wecom;
  if (channelConfig && channelConfig.corpId) {
    return {
      accountId: id,
      enabled: channelConfig.enabled ?? true,
      corpId: channelConfig.corpId,
      corpSecret: channelConfig.corpSecret,
      agentId: channelConfig.agentId,
      token: channelConfig.token,
      encodingAesKey: channelConfig.encodingAesKey,
    };
  }

  // 从 channels.wecom.accounts 读取（多账户模式）
  const channelAccounts = cfg.channels?.wecom?.accounts ?? {};
  const channelAccount = channelAccounts[id];
  if (channelAccount) {
    return { ...channelAccount, accountId: id };
  }

  // 返回禁用的默认配置
  return {
    accountId: id,
    enabled: false,
    corpId: "",
    corpSecret: "",
    agentId: "",
    token: "",
    encodingAesKey: "",
  };
}

/**
 * 创建应用菜单
 */
async function createMenu(config: WeComAccountConfig): Promise<void> {
  const logger = getWeComLogger();
  try {
    const accessToken = await WeComAPI.getAccessToken(config);
    const url = `https://qyapi.weixin.qq.com/cgi-bin/menu/create?access_token=${accessToken}&agentid=${config.agentId}`;

    const buttons = [
      {
        name: "会话",
        sub_button: [
          { type: "click", name: "新对话", key: "/reset" },
          { type: "click", name: "压缩上下文", key: "/compact" },
          { type: "click", name: "查看上下文", key: "/context" },
          { type: "click", name: "停止生成", key: "/stop" },
        ],
      },
      {
        name: "模型",
        sub_button: [
          { type: "click", name: "切换模型", key: "/model" },
          { type: "click", name: "GPT-5.2", key: "/model gpt-5.2" },
          { type: "click", name: "Claude Opus", key: "/model claude-opus-4-5" },
          { type: "click", name: "DeepSeek", key: "/model deepseek-chat" },
        ],
      },
      {
        name: "更多",
        sub_button: [
          { type: "click", name: "帮助", key: "/help" },
          { type: "click", name: "状态", key: "/status" },
          { type: "click", name: "命令列表", key: "/commands" },
          { type: "click", name: "我是谁", key: "/whoami" },
        ],
      },
    ];

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ button: buttons }),
    });

    const result = (await response.json()) as { errcode: number; errmsg: string };

    if (result.errcode !== 0) {
      logger.error("创建菜单失败", { error: `${result.errcode} ${result.errmsg}` });
    } else {
      logger.info("企业微信菜单创建成功");
    }
  } catch (error) {
    logger.error("创建菜单异常", {
      error: error instanceof Error ? error.message : "Unknown",
    });
  }
}

/**
 * 处理入站消息
 */
async function processInboundMessage(
  msg: Record<string, string>,
  text: string,
  accountConfig: WeComAccountConfig
): Promise<void> {
  const runtime = getWeComRuntime();
  const config = getWeComConfig();
  const logger = getWeComLogger();

  const senderId = msg.FromUserName;
  const messageId = msg.MsgId || `${Date.now()}`;
  const timestamp = parseInt(msg.CreateTime || "0", 10) * 1000;

  logger.info("处理企业微信消息", { senderId, text, messageId });

  // 解析路由
  const route = runtime.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "wecom",
    accountId: accountConfig.accountId,
    peer: {
      kind: "dm",
      id: `wecom:${senderId}`,
    },
  });

  // 格式化消息
  const storePath = runtime.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });

  const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const body = runtime.channel.reply.formatAgentEnvelope({
    channel: "WeCom",
    from: senderId,
    timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: text,
  });

  // 构建上下文
  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: text,
    CommandBody: text,
    From: `wecom:${senderId}`,
    To: `wecom:${accountConfig.agentId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: senderId,
    SenderName: senderId,
    SenderId: senderId,
    CommandAuthorized: true,
    Provider: "wecom",
    Surface: "wecom",
    MessageSid: messageId,
    OriginatingChannel: "wecom",
    OriginatingTo: `wecom:${senderId}`,
  });

  // 记录会话
  await runtime.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err: any) => {
      logger?.error(`wecom: 更新会话失败: ${String(err)}`);
    },
  });

  // 获取表格模式
  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "wecom",
    accountId: accountConfig.accountId,
  });

  // 动态导入 fs
  const fs = await import("node:fs");

  // 分发回复
  await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload: any) => {
        try {
          let imageSent = false;

          // 处理图片 - 优先使用 mediaUrl
          if (payload.mediaUrl) {
            const imagePath = payload.mediaUrl;
            if (fs.existsSync(imagePath)) {
              try {
                const mediaId = await WeComAPI.uploadMedia(accountConfig, imagePath, "image");
                await WeComAPI.sendWeComImage(accountConfig, senderId, mediaId);
                logger.info("已发送图片到企业微信", { to: senderId, path: imagePath });
                imageSent = true;
              } catch (err) {
                console.error("[WECOM ERROR] Failed to send mediaUrl image:", err);
              }
            }
          }

          // 处理多个图片 - mediaUrls 数组
          if (payload.mediaUrls && Array.isArray(payload.mediaUrls) && payload.mediaUrls.length > 0) {
            for (const imagePath of payload.mediaUrls) {
              if (fs.existsSync(imagePath)) {
                try {
                  const mediaId = await WeComAPI.uploadMedia(accountConfig, imagePath, "image");
                  await WeComAPI.sendWeComImage(accountConfig, senderId, mediaId);
                  logger.info("已发送图片到企业微信", { to: senderId, path: imagePath });
                  imageSent = true;
                } catch (err) {
                  console.error("[WECOM ERROR] Failed to send mediaUrls image:", err);
                }
              }
            }
          }

          // 处理旧格式的图片
          if (!imageSent && payload.image) {
            const imagePath = payload.image.path || payload.image.url;
            if (imagePath && fs.existsSync(imagePath)) {
              try {
                const mediaId = await WeComAPI.uploadMedia(accountConfig, imagePath, "image");
                await WeComAPI.sendWeComImage(accountConfig, senderId, mediaId);
                logger.info("已发送图片到企业微信", { to: senderId, path: imagePath });
                imageSent = true;
              } catch (err) {
                console.error("[WECOM ERROR] Failed to send image:", err);
              }
            }
          }

          // 检查文本中是否包含图片路径（临时方案）
          const replyText = payload.text || payload.body || "";
          if (!imageSent) {
            const imagePathMatch = replyText.match(/\/[^\s]+\.(png|jpg|jpeg|gif|webp)/i);
            if (imagePathMatch) {
              const imagePath = imagePathMatch[0];
              if (fs.existsSync(imagePath)) {
                try {
                  const mediaId = await WeComAPI.uploadMedia(accountConfig, imagePath, "image");
                  await WeComAPI.sendWeComImage(accountConfig, senderId, mediaId);
                  logger.info("已发送图片到企业微信", { to: senderId, path: imagePath });
                  imageSent = true;
                  // 发送剩余文本（去掉图片路径）
                  const textWithoutPath = replyText.replace(imagePathMatch[0], "").trim();
                  if (textWithoutPath && !textWithoutPath.match(/无法|失败|错误|缺失|Bug/)) {
                    await WeComAPI.sendWeComMessage(accountConfig, senderId, textWithoutPath);
                  }
                  return;
                } catch (err) {
                  console.error("[WECOM ERROR] Failed to send image from text:", err);
                }
              }
            }
          }

          // 处理文本 - 智能过滤错误提示
          if (replyText) {
            // 如果图片已发送，检查文本是否是错误提示
            if (imageSent) {
              const isErrorMessage = /^(抱歉|很抱歉|非常抱歉|无法|失败|错误)/.test(replyText.trim());
              const isConfigError = /corpId|配置.*缺失|配置.*不完整|Bug/.test(replyText);
              if (isErrorMessage || isConfigError) {
                console.log("[WECOM DEBUG] Image sent successfully, skipping error message text");
                logger.info("图片已发送，跳过错误提示文本");
                return;
              }
            }
            await WeComAPI.sendWeComMessage(accountConfig, senderId, replyText);
            logger.info("已发送回复到企业微信", { to: senderId });
          }
        } catch (err) {
          console.error("[WECOM ERROR]", err);
          logger.error(`发送消息失败: ${String(err)}`);
          throw err;
        }
      },
      onError: (err: any, info: any) => {
        logger.error(`wecom 回复失败: ${String(err)}`, { info });
      },
    },
    tableMode,
  });
}

/**
 * HTTP Webhook 处理器
 */
export async function handleWeComWebhook(
  req: any,
  res: any
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (!pathname.startsWith("/webhooks/wecom")) {
    return false;
  }

  const query = WeComAPI.parseQuery(req.url ?? "");
  const signature = query.msg_signature;
  const timestamp = query.timestamp;
  const nonce = query.nonce;
  const accountId = query.account ?? DEFAULT_ACCOUNT;

  const accountConfig = resolveAccountConfig(getWeComConfig(), accountId);

  if (!accountConfig.enabled || !accountConfig.corpId) {
    res.statusCode = 404;
    res.end("Account not found");
    return true;
  }

  const logger = getWeComLogger();

  // GET 请求 - URL 验证
  if (req.method === "GET") {
    const echostr = query.echostr;
    if (!signature || !timestamp || !nonce || !echostr) {
      res.statusCode = 400;
      res.end("Missing parameters");
      return true;
    }

    if (!WeComAPI.validateSignature(accountConfig.token, timestamp, nonce, echostr, signature)) {
      logger.warn("URL 验证签名失败");
      res.statusCode = 401;
      res.end("Invalid signature");
      return true;
    }

    try {
      const decrypted = WeComAPI.decryptMessage(
        accountConfig.encodingAesKey,
        accountConfig.corpId,
        echostr
      );
      res.statusCode = 200;
      res.end(decrypted);
    } catch (error) {
      logger.error("解密 echostr 失败", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      res.statusCode = 500;
      res.end("Decrypt failed");
    }
    return true;
  }

  // POST 请求 - 消息处理
  if (req.method === "POST") {
    if (!signature || !timestamp || !nonce) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing required parameters" }));
      return true;
    }

    const body = await WeComAPI.readRequestBody(req);
    const encryptMatch = /<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/s.exec(body);

    if (!encryptMatch) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid encrypted message format" }));
      return true;
    }

    const encryptedContent = encryptMatch[1];

    if (!WeComAPI.validateSignature(accountConfig.token, timestamp, nonce, encryptedContent, signature)) {
      logger.warn("签名验证失败");
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid signature" }));
      return true;
    }

    let decryptedXml: string;
    try {
      decryptedXml = WeComAPI.decryptMessage(
        accountConfig.encodingAesKey,
        accountConfig.corpId,
        encryptedContent
      );
    } catch (error) {
      logger.error("解密消息失败", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Decrypt failed" }));
      return true;
    }

    const msg = WeComAPI.parseXmlMessage(decryptedXml);

    logger.info("收到企业微信消息", {
      type: msg.MsgType,
      from: msg.FromUserName,
      event: msg.Event,
      eventKey: msg.EventKey,
    });

    let text = msg.Content || "";

    // 处理菜单点击事件
    if (msg.MsgType === "event" && msg.Event === "click") {
      text = msg.EventKey || "";
    }

    // 忽略空消息和其他事件
    if (!text && msg.MsgType !== "text") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    // 立即响应企业微信，避免超时
    res.statusCode = 200;
    res.end("success");

    // 异步处理消息
    processInboundMessage(msg, text, accountConfig).catch((err) => {
      logger.error("处理消息失败", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return true;
  }

  res.statusCode = 405;
  res.setHeader("Allow", "GET, POST");
  res.end("Method Not Allowed");
  return true;
}

/**
 * 企业微信渠道插件
 */
export const wecomPlugin: ChannelPlugin<WeComAccountConfig> = {
  id: "wecom",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },

  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: true,
    blockStreaming: false,
  },

  reload: {
    configPrefixes: ["channels.wecom"],
  },

  configSchema: {
    schema: {
      type: "object",
      properties: {
        corpId: { type: "string", title: "企业ID (CorpID)" },
        corpSecret: { type: "string", title: "应用密钥 (Secret)" },
        agentId: { type: "string", title: "应用ID (AgentID)" },
        token: { type: "string", title: "回调Token" },
        encodingAesKey: { type: "string", title: "消息加密密钥" },
      },
      required: ["corpId", "corpSecret", "agentId", "token", "encodingAesKey"],
    },
  },

  config: {
    listAccountIds: (cfg) => {
      const accounts = cfg.channels?.wecom?.accounts ?? {};
      const ids = Object.keys(accounts);
      // 如果有顶层配置，也返回 default
      if (cfg.channels?.wecom?.corpId && !ids.includes(DEFAULT_ACCOUNT)) {
        ids.push(DEFAULT_ACCOUNT);
      }
      return ids.length > 0 ? ids : [DEFAULT_ACCOUNT];
    },

    resolveAccount: (cfg, accountId) => {
      const id = accountId ?? DEFAULT_ACCOUNT;

      // 从 channels.wecom.accounts 读取
      const accounts = cfg.channels?.wecom?.accounts ?? {};
      const account = accounts[id];
      if (account) {
        return { ...account, accountId: id };
      }

      // 从 channels.wecom 顶层读取
      const channelConfig = cfg.channels?.wecom;
      if (channelConfig && channelConfig.corpId) {
        return {
          accountId: id,
          enabled: channelConfig.enabled ?? true,
          corpId: channelConfig.corpId,
          corpSecret: channelConfig.corpSecret,
          agentId: channelConfig.agentId,
          token: channelConfig.token,
          encodingAesKey: channelConfig.encodingAesKey,
        };
      }

      return {
        accountId: id,
        enabled: false,
        corpId: "",
        corpSecret: "",
        agentId: "",
        token: "",
        encodingAesKey: "",
      };
    },

    defaultAccountId: () => DEFAULT_ACCOUNT,

    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const id = accountId ?? DEFAULT_ACCOUNT;
      const nextCfg = { ...cfg };
      nextCfg.channels = { ...nextCfg.channels };
      nextCfg.channels.wecom = { ...nextCfg.channels.wecom };

      if (id === DEFAULT_ACCOUNT) {
        nextCfg.channels.wecom.enabled = enabled;
      } else {
        nextCfg.channels.wecom.accounts = { ...nextCfg.channels.wecom.accounts };
        nextCfg.channels.wecom.accounts[id] = {
          ...(nextCfg.channels.wecom.accounts[id] || {}),
          enabled,
        };
      }

      return nextCfg;
    },

    isConfigured: (account) => {
      return Boolean(
        account.enabled &&
        account.corpId?.trim() &&
        account.corpSecret?.trim() &&
        account.agentId?.trim()
      );
    },

    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: Boolean(account.corpId?.trim()),
      corpId: account.corpId,
    }),
  },

  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId }) => {
      const config = getWeComConfig();
      const resolved = resolveAccountConfig(config, accountId);
      try {
        await WeComAPI.sendWeComMessage(resolved, to, text);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const config = getWeComConfig();
      const resolved = resolveAccountConfig(config, accountId);
      const fs = await import("node:fs");

      try {
        // 如果有媒体 URL，尝试发送图片
        if (mediaUrl && fs.existsSync(mediaUrl)) {
          const mediaId = await WeComAPI.uploadMedia(resolved, mediaUrl, "image");
          await WeComAPI.sendWeComImage(resolved, to, mediaId);
        }
        // 发送文本
        if (text) {
          await WeComAPI.sendWeComMessage(resolved, to, text);
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  },

  gateway: {
    start: async () => {
      const logger = getWeComLogger();
      const config = getWeComConfig();
      logger.info("企业微信渠道已启动");

      // 启动时创建菜单
      const defaultConfig = resolveAccountConfig(config, DEFAULT_ACCOUNT);
      if (defaultConfig.enabled && defaultConfig.corpId) {
        await createMenu(defaultConfig);
      }
    },
    stop: async () => {
      WeComAPI.clearTokenCache();
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT,
      running: true,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: async () => [],
    buildChannelSummary: ({ snapshot, account }) => ({
      configured: Boolean(account?.corpId?.trim()),
      running: snapshot?.running ?? true,
      mode: "webhook",
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
      probe: snapshot?.probe,
      lastProbeAt: snapshot?.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (!account.corpId || !account.corpSecret) {
        return { ok: false, error: "未配置企业微信凭证" };
      }
      try {
        const token = await WeComAPI.getAccessToken(account);
        return {
          ok: true,
          corpId: account.corpId,
          agentId: account.agentId,
          hasToken: Boolean(token),
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "探测失败",
        };
      }
    },
    getHealth: async () => ({ healthy: true }),
    getDiagnostics: async () => ({ cachedTokens: WeComAPI["tokenCache"]?.size ?? 0 }),
  },
};
