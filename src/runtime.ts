import type { PluginRuntime } from "openclaw/plugin-sdk";

// 运行时存储
let pluginRuntime: PluginRuntime | null = null;
let pluginConfig: any = null;
let pluginLogger: any = null;

/**
 * 设置企业微信运行时
 */
export function setWeComRuntime(
  runtime: PluginRuntime,
  config: any,
  logger: any
): void {
  pluginRuntime = runtime;
  pluginConfig = config;
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
 * 获取插件配置
 */
export function getWeComConfig(): any {
  return pluginConfig;
}

/**
 * 获取插件日志记录器
 */
export function getWeComLogger(): any {
  return pluginLogger;
}
