import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { wecomPlugin, handleWeComWebhook } from "./src/channel.js";
import { setWeComRuntime, getWeComConfig } from "./src/runtime.js";
import * as WeComAPI from "./src/wecom-api.js";
import type { WeComAccountConfig } from "./src/channel.js";

/**
 * 创建应用菜单 (CLI 命令使用)
 */
async function createMenu(config: WeComAccountConfig, logger: any): Promise<void> {
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

const plugin = {
  id: "wecom",
  name: "企业微信 Channel",
  description: "企业微信消息渠道插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const logger = api.logger;

    // 设置运行时
    setWeComRuntime(api.runtime, api.config, logger);

    // 注册渠道插件
    api.registerChannel({ plugin: wecomPlugin });

    // 注册 HTTP Webhook Handler - 这是关键！
    api.registerHttpHandler(handleWeComWebhook);

    // 注册 CLI 命令
    api.registerCli(
      ({ program }) => {
        const cmd = program.command("wecom").description("企业微信渠道管理");

        cmd
          .command("menu")
          .description("重新创建应用菜单")
          .option("-a, --account <id>", "账户ID", "default")
          .action(async (options: { account: string }) => {
            const cfg = getWeComConfig();
            const accountConfig = wecomPlugin.config.resolveAccount(cfg, options.account);
            if (!accountConfig.enabled || !accountConfig.corpId) {
              console.log("账户未启用或未配置");
              return;
            }
            await createMenu(accountConfig, console);
            console.log("菜单创建完成");
          });

        cmd
          .command("status")
          .description("检查连接状态")
          .option("-a, --account <id>", "账户ID", "default")
          .action(async (options: { account: string }) => {
            const cfg = getWeComConfig();
            const accountConfig = wecomPlugin.config.resolveAccount(cfg, options.account);
            console.log("企业微信渠道状态:");
            console.log(`  账户ID: ${accountConfig.accountId}`);
            console.log(`  已启用: ${accountConfig.enabled}`);
            console.log(`  已配置: ${Boolean(accountConfig.corpId)}`);
            if (accountConfig.corpId) {
              try {
                const token = await WeComAPI.getAccessToken(accountConfig);
                console.log(`  连接状态: 正常 (Token已获取)`);
              } catch (error) {
                console.log(`  连接状态: 异常 - ${error instanceof Error ? error.message : "Unknown"}`);
              }
            }
          });
      },
      { commands: ["wecom"] }
    );

    logger.info("企业微信渠道插件已注册");
  },
};

export default plugin;
