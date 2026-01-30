import type { PluginRuntime } from "openclaw/plugin-sdk";

// 运行时存储
let pluginRuntime: PluginRuntime | null = null;
let openclawConfig: any = null;  // OpenClaw 全局配置
let wecomPluginConfig: any = null;  // 插件专属配置 (plugins.entries.wecom.config)
let pluginLogger: any = null;

/**
 * 设置企业微信运行时
 */
export function setWeComRuntime(
  runtime: PluginRuntime,
  config: any,
  logger: any,
  pluginSpecificConfig?: any
): void {
  pluginRuntime = runtime;
  openclawConfig = config;
  wecomPluginConfig = pluginSpecificConfig;
  pluginLogger = logger;
}

/**
 * 获取企业微信运行时
 */
export function getWeComRuntime(): PluginRuntime {
  if (!pluginRuntime) {
    throw new Error("WeCom runtime not initialized");
  }
  return pluginRuntime;
}

/**
 * 获取 OpenClaw 全局配置
 */
export function getWeComConfig(): any {
  return openclawConfig;
}

/**
 * 获取插件专属配置 (plugins.entries.wecom.config)
 */
export function getWeComPluginConfig(): any {
  return wecomPluginConfig;
}

/**
 * 获取插件日志记录器
 */
export function getWeComLogger(): any {
  return pluginLogger;
}
