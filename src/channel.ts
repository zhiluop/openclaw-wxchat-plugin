import {
  type ChannelPlugin,
  type ResolvedAccount,
  getChatChannelMeta,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { getWeComRuntime, getWeComConfig, getWeComLogger, getWeComPluginConfig } from "./runtime.js";
import * as WeComAPI from "./wecom-api.js";
import * as path from "node:path";
import * as os from "node:os";

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

// 消息去重缓存（防止企业微信重试导致重复处理）
const processedMsgIds = new Map<string, number>();
const MSG_ID_CACHE_TTL = 60 * 1000; // 60 秒过期
const MSG_ID_CACHE_MAX_SIZE = 1000; // 最多缓存 1000 条

/**
 * 检查消息是否已处理（去重）
 */
function isMessageProcessed(msgId: string): boolean {
  const now = Date.now();
  
  // 清理过期的缓存
  if (processedMsgIds.size > MSG_ID_CACHE_MAX_SIZE / 2) {
    for (const [id, timestamp] of processedMsgIds) {
      if (now - timestamp > MSG_ID_CACHE_TTL) {
        processedMsgIds.delete(id);
      }
    }
  }
  
  // 检查是否已存在
  if (processedMsgIds.has(msgId)) {
    return true;
  }
  
  // 记录新消息
  processedMsgIds.set(msgId, now);
  return false;
}

// 媒体文件保存目录
function getMediaSaveDir(): string {
  // 使用临时目录下的 wecom-media 子目录
  const tempDir = os.tmpdir();
  return path.join(tempDir, "wecom-media");
}

// 支持的媒体消息类型
type MediaMsgType = "image" | "voice" | "video" | "file";

/**
 * 处理媒体消息（图片、语音、视频、文件）
 * 下载媒体文件并返回处理后的文本描述
 */
async function processMediaMessage(
  msg: Record<string, string>,
  msgType: MediaMsgType,
  accountConfig: WeComAccountConfig
): Promise<{ text: string; filePath?: string }> {
  const logger = getWeComLogger();
  const mediaId = msg.MediaId;
  
  if (!mediaId) {
    logger.warn("媒体消息缺少 MediaId", { msgType });
    return { text: `[${msgType}] (无法获取媒体文件)` };
  }

  try {
    const saveDir = getMediaSaveDir();
    let filePath: string;
    let description: string;

    switch (msgType) {
      case "image": {
        // 图片消息：有 PicUrl（图片链接）和 MediaId
        const picUrl = msg.PicUrl;
        filePath = await WeComAPI.downloadMedia(accountConfig, mediaId, saveDir);
        description = `[图片] ${filePath}`;
        if (picUrl) {
          description += `\n图片链接: ${picUrl}`;
        }
        break;
      }
      case "voice": {
        // 语音消息：有 Format（语音格式，如 amr）
        const format = msg.Format || "amr";
        filePath = await WeComAPI.downloadMedia(accountConfig, mediaId, saveDir, `${mediaId}.${format}`);
        description = `[语音] ${filePath} (格式: ${format})`;
        break;
      }
      case "video": {
        // 视频消息：有 ThumbMediaId（缩略图媒体ID）
        filePath = await WeComAPI.downloadMedia(accountConfig, mediaId, saveDir, `${mediaId}.mp4`);
        description = `[视频] ${filePath}`;
        // 可选：下载缩略图
        if (msg.ThumbMediaId) {
          try {
            const thumbPath = await WeComAPI.downloadMedia(accountConfig, msg.ThumbMediaId, saveDir, `${mediaId}_thumb.jpg`);
            description += `\n缩略图: ${thumbPath}`;
          } catch (e) {
            // 缩略图下载失败不影响主流程
          }
        }
        break;
      }
      case "file": {
        // 文件消息：有 FileName（文件名）
        const fileName = msg.FileName || `${mediaId}.bin`;
        filePath = await WeComAPI.downloadMedia(accountConfig, mediaId, saveDir, fileName);
        description = `[文件] ${filePath}`;
        break;
      }
      default:
        return { text: `[${msgType}] (不支持的媒体类型)` };
    }

    logger.info("媒体文件已下载", { msgType, mediaId, filePath });
    return { text: description, filePath };
  } catch (error) {
    logger.error("下载媒体文件失败", {
      msgType,
      mediaId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { text: `[${msgType}] (下载失败: ${error instanceof Error ? error.message : "未知错误"})` };
  }
}

/**
 * 处理位置消息
 */
function processLocationMessage(msg: Record<string, string>): string {
  const latitude = msg.Location_X || msg.Latitude;
  const longitude = msg.Location_Y || msg.Longitude;
  const scale = msg.Scale;
  const label = msg.Label;
  
  let text = `[位置]`;
  if (label) {
    text += ` ${label}`;
  }
  text += `\n坐标: ${latitude}, ${longitude}`;
  if (scale) {
    text += ` (缩放级别: ${scale})`;
  }
  return text;
}

/**
 * 处理链接消息
 */
function processLinkMessage(msg: Record<string, string>): string {
  const title = msg.Title || "无标题";
  const description = msg.Description || "";
  const url = msg.Url || "";
  const picUrl = msg.PicUrl || "";
  
  let text = `[链接] ${title}`;
  if (description) {
    text += `\n${description}`;
  }
  if (url) {
    text += `\n链接: ${url}`;
  }
  return text;
}

/**
 * 解析账户配置
 * 优先级：
 * 1. plugins.entries.wecom.config（插件专属配置）
 * 2. channels.wecom（渠道配置）
 * 3. channels.wecom.accounts[id]（多账户模式）
 */
function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId?: string
): WeComAccountConfig {
  const id = accountId ?? DEFAULT_ACCOUNT;

  // 优先从插件配置读取 (plugins.entries.wecom.config)
  const pluginConfig = getWeComPluginConfig();
  if (pluginConfig && pluginConfig.corpId) {
    return {
      accountId: id,
      enabled: pluginConfig.enabled ?? true,
      corpId: pluginConfig.corpId,
      corpSecret: pluginConfig.corpSecret,
      agentId: pluginConfig.agentId,
      token: pluginConfig.token,
      encodingAesKey: pluginConfig.encodingAesKey,
    };
  }

  // 从 channels.wecom 读取（渠道配置格式）
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
  accountConfig: WeComAccountConfig,
  mediaFilePath?: string
): Promise<void> {
  const runtime = getWeComRuntime();
  const config = getWeComConfig();
  const logger = getWeComLogger();

  const senderId = msg.FromUserName;
  const messageId = msg.MsgId || `${Date.now()}`;
  const timestamp = parseInt(msg.CreateTime || "0", 10) * 1000;

  logger.info("处理企业微信消息", { senderId, text, messageId, mediaFilePath });

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

  // 如果有媒体文件，在消息体中添加附件信息
  let bodyText = text;
  if (mediaFilePath) {
    // 附件信息会被 AI 识别处理
    bodyText = text;
  }

  const body = runtime.channel.reply.formatAgentEnvelope({
    channel: "WeCom",
    from: senderId,
    timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: bodyText,
  });

  // 构建上下文，包含媒体附件信息
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
    // 添加媒体附件信息（如果有）
    ...(mediaFilePath ? { MediaAttachment: mediaFilePath } : {}),
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
          let mediaSent = false;

          // 辅助函数：根据文件扩展名判断媒体类型
          const getMediaType = (filePath: string): "image" | "voice" | "video" | "file" => {
            const ext = filePath.toLowerCase().split(".").pop() || "";
            if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
              return "image";
            }
            if (["amr", "mp3", "wav", "ogg", "m4a"].includes(ext)) {
              return "voice";
            }
            if (["mp4", "mov", "avi", "wmv", "mkv", "flv"].includes(ext)) {
              return "video";
            }
            return "file";
          };

          // 辅助函数：发送媒体文件
          const sendMediaFile = async (filePath: string): Promise<boolean> => {
            if (!fs.existsSync(filePath)) {
              logger.warn("媒体文件不存在", { path: filePath });
              return false;
            }

            const mediaType = getMediaType(filePath);
            try {
              // 语音只支持 AMR 格式上传，其他格式作为文件发送
              const uploadType = mediaType === "voice" && !filePath.toLowerCase().endsWith(".amr")
                ? "file"
                : mediaType;

              const mediaId = await WeComAPI.uploadMedia(accountConfig, filePath, uploadType);

              switch (uploadType) {
                case "image":
                  await WeComAPI.sendWeComImage(accountConfig, senderId, mediaId);
                  logger.info("已发送图片到企业微信", { to: senderId, path: filePath });
                  break;
                case "voice":
                  await WeComAPI.sendWeComVoice(accountConfig, senderId, mediaId);
                  logger.info("已发送语音到企业微信", { to: senderId, path: filePath });
                  break;
                case "video":
                  await WeComAPI.sendWeComVideo(accountConfig, senderId, mediaId);
                  logger.info("已发送视频到企业微信", { to: senderId, path: filePath });
                  break;
                case "file":
                default:
                  await WeComAPI.sendWeComFile(accountConfig, senderId, mediaId);
                  logger.info("已发送文件到企业微信", { to: senderId, path: filePath });
                  break;
              }
              return true;
            } catch (err) {
              console.error(`[WECOM ERROR] Failed to send ${mediaType}:`, err);
              logger.error(`发送${mediaType}失败`, { path: filePath, error: String(err) });
              return false;
            }
          };

          // 处理单个媒体文件 - mediaUrl
          if (payload.mediaUrl) {
            mediaSent = await sendMediaFile(payload.mediaUrl);
          }

          // 处理多个媒体文件 - mediaUrls 数组
          if (payload.mediaUrls && Array.isArray(payload.mediaUrls) && payload.mediaUrls.length > 0) {
            for (const filePath of payload.mediaUrls) {
              const sent = await sendMediaFile(filePath);
              if (sent) mediaSent = true;
            }
          }

          // 处理旧格式的图片
          if (!mediaSent && payload.image) {
            const imagePath = payload.image.path || payload.image.url;
            if (imagePath) {
              mediaSent = await sendMediaFile(imagePath);
            }
          }

          // 处理文件 payload
          if (payload.file) {
            const filePath = payload.file.path || payload.file.url;
            if (filePath) {
              const sent = await sendMediaFile(filePath);
              if (sent) mediaSent = true;
            }
          }

          // 处理视频 payload
          if (payload.video) {
            const videoPath = payload.video.path || payload.video.url;
            if (videoPath) {
              const sent = await sendMediaFile(videoPath);
              if (sent) mediaSent = true;
            }
          }

          // 处理语音 payload
          if (payload.voice || payload.audio) {
            const voicePath = (payload.voice || payload.audio).path || (payload.voice || payload.audio).url;
            if (voicePath) {
              const sent = await sendMediaFile(voicePath);
              if (sent) mediaSent = true;
            }
          }

          // 检查文本中是否包含媒体文件路径（临时方案）
          const replyText = payload.text || payload.body || "";
          if (!mediaSent) {
            // 匹配常见媒体文件路径
            const mediaPathMatch = replyText.match(/[\/\\][^\s]+\.(png|jpg|jpeg|gif|webp|bmp|mp4|mov|avi|amr|mp3|wav|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)/i);
            if (mediaPathMatch) {
              const mediaPath = mediaPathMatch[0];
              if (fs.existsSync(mediaPath)) {
                const sent = await sendMediaFile(mediaPath);
                if (sent) {
                  mediaSent = true;
                  // 发送剩余文本（去掉文件路径）
                  const textWithoutPath = replyText.replace(mediaPathMatch[0], "").trim();
                  if (textWithoutPath && !textWithoutPath.match(/无法|失败|错误|缺失|Bug/)) {
                    await WeComAPI.sendWeComMessage(accountConfig, senderId, textWithoutPath);
                  }
                  return;
                }
              }
            }
          }

          // 处理文本 - 智能过滤错误提示
          if (replyText) {
            // 如果媒体已发送，检查文本是否是错误提示
            if (mediaSent) {
              const isErrorMessage = /^(抱歉|很抱歉|非常抱歉|无法|失败|错误)/.test(replyText.trim());
              const isConfigError = /corpId|配置.*缺失|配置.*不完整|Bug/.test(replyText);
              if (isErrorMessage || isConfigError) {
                console.log("[WECOM DEBUG] Media sent successfully, skipping error message text");
                logger.info("媒体已发送，跳过错误提示文本");
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
    
    // 生成消息唯一标识（MsgId 或 事件类型+时间戳+用户）
    const messageId = msg.MsgId || `${msg.MsgType}_${msg.Event || ''}_${msg.CreateTime}_${msg.FromUserName}`;

    logger.info("收到企业微信消息", {
      type: msg.MsgType,
      from: msg.FromUserName,
      event: msg.Event,
      eventKey: msg.EventKey,
      msgId: messageId,
    });

    // 消息去重检查（企业微信可能因超时重试）
    if (isMessageProcessed(messageId)) {
      logger.info("忽略重复消息", { msgId: messageId });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("success");
      return true;
    }

    let text = "";
    let mediaFilePath: string | undefined;
    const msgType = msg.MsgType;

    // 根据消息类型处理
    switch (msgType) {
      case "text":
        // 文本消息
        text = msg.Content || "";
        break;

      case "image":
      case "voice":
      case "video":
      case "file": {
        // 媒体消息：下载并转换为文本描述
        const mediaResult = await processMediaMessage(msg, msgType as MediaMsgType, accountConfig);
        text = mediaResult.text;
        mediaFilePath = mediaResult.filePath;
        break;
      }

      case "location":
        // 位置消息
        text = processLocationMessage(msg);
        break;

      case "link":
        // 链接消息
        text = processLinkMessage(msg);
        break;

      case "event":
        // 事件消息
        if (msg.Event === "click") {
          // 菜单点击事件
          text = msg.EventKey || "";
        } else if (msg.Event === "subscribe") {
          // 关注事件
          text = "/help";
          logger.info("用户关注", { user: msg.FromUserName });
        } else if (msg.Event === "unsubscribe") {
          // 取消关注事件
          logger.info("用户取消关注", { user: msg.FromUserName });
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain");
          res.end("success");
          return true;
        } else if (msg.Event === "location") {
          // 上报地理位置事件
          text = `[位置上报] 纬度: ${msg.Latitude}, 经度: ${msg.Longitude}, 精度: ${msg.Precision}`;
        } else {
          // 其他事件，忽略
          logger.info("忽略事件", { event: msg.Event });
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain");
          res.end("success");
          return true;
        }
        break;

      default:
        // 未知消息类型
        logger.warn("未知消息类型", { msgType });
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end("success");
        return true;
    }

    // 忽略空消息
    if (!text) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("success");
      return true;
    }

    // 立即响应企业微信，避免超时重试
    // 企业微信要求 5 秒内响应，否则会重试最多 3 次
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("success");

    // 异步处理消息（传递媒体文件路径）
    processInboundMessage(msg, text, accountConfig, mediaFilePath).catch((err) => {
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
