import crypto from "crypto";
import type { IncomingMessage } from "node:http";

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

// Access Token 缓存
interface TokenCache {
  token: string;
  expiry: number;
}

const tokenCache: Map<string, TokenCache> = new Map();

/**
 * 获取 Access Token
 */
export async function getAccessToken(config: WeComAccountConfig): Promise<string> {
  const cacheKey = `${config.corpId}:${config.agentId}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpId}&corpsecret=${config.corpSecret}`;
  const response = await fetch(url);
  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }

  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiry: Date.now() + (data.expires_in - 120) * 1000,
  });

  return data.access_token;
}

/**
 * 清除 Token 缓存
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * 验证签名
 */
export function validateSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string
): boolean {
  const parts = [token, timestamp, nonce, encrypt].sort();
  const str = parts.join("");
  const hash = crypto.createHash("sha1").update(str).digest("hex");
  return signature === hash;
}

/**
 * 解密消息
 */
export function decryptMessage(
  encodingAesKey: string,
  corpId: string,
  cipherText: string
): string {
  const key = Buffer.from(encodingAesKey + "=", "base64");
  const data = Buffer.from(cipherText, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);

  let decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  const padLen = decrypted[decrypted.length - 1];
  if (padLen > 32) {
    throw new Error("padding out of range");
  }

  decrypted = decrypted.subarray(0, decrypted.length - padLen);

  const msgLen = decrypted.readUInt32BE(16);
  const msg = decrypted.subarray(20, 20 + msgLen).toString("utf8");
  const receivedCorpId = decrypted.subarray(20 + msgLen).toString("utf8");

  if (receivedCorpId !== corpId) {
    throw new Error("CorpID 不匹配");
  }

  return msg;
}

/**
 * 解析 XML 消息
 */
export function parseXmlMessage(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /<(\w+)>(?:<!\[CDATA\[(.*?)\]\]>|([^<]*))<\/\1>/g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    result[match[1]] = match[2] ?? match[3] ?? "";
  }

  return result;
}

/**
 * 读取请求体
 */
export async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 解析 URL 查询参数
 */
export function parseQuery(url: string): Record<string, string> {
  const query: Record<string, string> = {};
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return query;

  const queryString = url.slice(queryStart + 1);
  for (const pair of queryString.split("&")) {
    const [key, value] = pair.split("=");
    if (key) {
      query[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
    }
  }

  return query;
}

/**
 * 上传临时素材（图片）
 */
export async function uploadMedia(
  config: WeComAccountConfig,
  filePath: string,
  type: "image" | "voice" | "video" | "file" = "image"
): Promise<string> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=${type}`;

  // 动态导入 fs 和 path
  const fs = await import("node:fs");
  const path = await import("node:path");

  // 读取文件
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // 获取文件 MIME 类型
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  // 构建 multipart/form-data
  const boundary = `----WebKitFormBoundary${Date.now()}${Math.random().toString(36)}`;
  const parts: Buffer[] = [];

  // 添加文件字段
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from(`Content-Disposition: form-data; name="media"; filename="${fileName}"\r\n`));
  parts.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  const result = (await response.json()) as {
    errcode?: number;
    errmsg?: string;
    type?: string;
    media_id?: string;
    created_at?: number;
  };

  if (result.errcode && result.errcode !== 0) {
    throw new Error(`上传素材失败: ${result.errcode} ${result.errmsg}`);
  }

  if (!result.media_id) {
    throw new Error("上传素材失败: 未返回 media_id");
  }

  return result.media_id;
}

/**
 * 发送图片消息
 */
export async function sendWeComImage(
  config: WeComAccountConfig,
  toUser: string,
  mediaId: string
): Promise<void> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "image",
      agentid: parseInt(config.agentId, 10),
      image: {
        media_id: mediaId,
      },
    }),
  });

  const result = (await response.json()) as { errcode: number; errmsg: string };

  if (result.errcode !== 0) {
    throw new Error(`发送图片失败: ${result.errcode} ${result.errmsg}`);
  }
}

/**
 * 发送文本消息到企业微信
 */
export async function sendWeComMessage(
  config: WeComAccountConfig,
  toUser: string,
  content: string
): Promise<void> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "text",
      agentid: parseInt(config.agentId, 10),
      text: {
        content,
      },
    }),
  });

  const result = (await response.json()) as { errcode: number; errmsg: string };

  if (result.errcode !== 0) {
    throw new Error(`发送消息失败: ${result.errcode} ${result.errmsg}`);
  }
}

/**
 * 发送文件消息
 */
export async function sendWeComFile(
  config: WeComAccountConfig,
  toUser: string,
  mediaId: string
): Promise<void> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "file",
      agentid: parseInt(config.agentId, 10),
      file: {
        media_id: mediaId,
      },
    }),
  });

  const result = (await response.json()) as { errcode: number; errmsg: string };

  if (result.errcode !== 0) {
    throw new Error(`发送文件失败: ${result.errcode} ${result.errmsg}`);
  }
}

/**
 * 发送语音消息
 */
export async function sendWeComVoice(
  config: WeComAccountConfig,
  toUser: string,
  mediaId: string
): Promise<void> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "voice",
      agentid: parseInt(config.agentId, 10),
      voice: {
        media_id: mediaId,
      },
    }),
  });

  const result = (await response.json()) as { errcode: number; errmsg: string };

  if (result.errcode !== 0) {
    throw new Error(`发送语音失败: ${result.errcode} ${result.errmsg}`);
  }
}

/**
 * 发送视频消息
 */
export async function sendWeComVideo(
  config: WeComAccountConfig,
  toUser: string,
  mediaId: string,
  title?: string,
  description?: string
): Promise<void> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      touser: toUser,
      msgtype: "video",
      agentid: parseInt(config.agentId, 10),
      video: {
        media_id: mediaId,
        title: title || "",
        description: description || "",
      },
    }),
  });

  const result = (await response.json()) as { errcode: number; errmsg: string };

  if (result.errcode !== 0) {
    throw new Error(`发送视频失败: ${result.errcode} ${result.errmsg}`);
  }
}

/**
 * 下载临时素材
 * 返回保存的文件路径
 */
export async function downloadMedia(
  config: WeComAccountConfig,
  mediaId: string,
  saveDir: string,
  filename?: string
): Promise<string> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${accessToken}&media_id=${mediaId}`;

  const response = await fetch(url);

  // 检查是否返回错误 JSON
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const result = (await response.json()) as { errcode: number; errmsg: string };
    throw new Error(`下载素材失败: ${result.errcode} ${result.errmsg}`);
  }

  // 从 Content-Disposition 获取文件名
  const disposition = response.headers.get("content-disposition") || "";
  let finalFilename = filename;
  if (!finalFilename) {
    const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/i);
    if (filenameMatch) {
      finalFilename = filenameMatch[1];
    } else {
      // 根据 Content-Type 猜测扩展名
      const extMap: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "audio/amr": ".amr",
        "video/mp4": ".mp4",
        "application/octet-stream": ".bin",
      };
      const ext = extMap[contentType] || ".bin";
      finalFilename = `${mediaId}${ext}`;
    }
  }

  // 动态导入 fs 和 path
  const fs = await import("node:fs");
  const path = await import("node:path");

  // 确保目录存在
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  const filePath = path.join(saveDir, finalFilename);

  // 获取文件内容并保存
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

/**
 * 获取高清语音素材（将 AMR 转为 MP3，需要开通高级功能）
 */
export async function downloadVoiceHD(
  config: WeComAccountConfig,
  mediaId: string,
  saveDir: string,
  filename?: string
): Promise<string> {
  const accessToken = await getAccessToken(config);
  const url = `https://qyapi.weixin.qq.com/cgi-bin/media/get/jssdk?access_token=${accessToken}&media_id=${mediaId}`;

  const response = await fetch(url);

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const result = (await response.json()) as { errcode: number; errmsg: string };
    throw new Error(`下载高清语音失败: ${result.errcode} ${result.errmsg}`);
  }

  const fs = await import("node:fs");
  const path = await import("node:path");

  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  const finalFilename = filename || `${mediaId}.mp3`;
  const filePath = path.join(saveDir, finalFilename);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}
