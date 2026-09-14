import "server-only";

/**
 * 外部系统与云服务的配置状态（规格 §13）。
 *
 * 设计约束只有一条，但很硬：**这里的返回值会被渲染进设置页的 HTML，
 * 所以永远不回传密钥本身**——只回答「配没配」和「缺哪几个变量名」。
 * `lib/integrations.test.ts` 里有一条断言专门把这件事锁住：把返回值整个
 * 序列化，断言里面找不到密钥值。
 *
 * 另一条：能力未配置时必须降级为清晰的「尚未配置」，不能让页面整体报错
 * （规格第一性原理第 8 条）。所以这里全部是纯读取，不抛异常。
 */

export type IntegrationKey = "teaching" | "asr" | "minutes" | "maintenance";

export type IntegrationStatus = {
  key: IntegrationKey;
  label: string;
  /** 必需变量全部有值才算配好 */
  configured: boolean;
  /** 缺哪几个。**只列变量名，不列值** */
  missing: string[];
  /** 非敏感的补充信息，目前只有备课系统的域名 */
  detail?: string;
  /** 哪个增量会用到它，界面上说明「现在没配也不影响」 */
  usedBy: string;
  hint: string;
};

type Env = Record<string, string | undefined>;

const ASR_VARS = ["TENCENT_ASR_APP_ID", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY"];
function present(env: Env, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function missingOf(env: Env, names: string[]): string[] {
  return names.filter((name) => !present(env, name));
}

function httpUrlPresent(env: Env, name: string): boolean {
  const raw = env[name]?.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * 备课系统地址。**必须校验协议**——这个值最终进 `<a href>`，
 * 而环境变量是运维手填的：写成 `javascript:...` 就是一个自己给自己开的 XSS。
 * 解析不了或不是 http(s) 一律当作没配置，而不是原样渲染。
 */
export function teachingAppUrl(env: Env = process.env): string | null {
  const raw = env.TEACHING_APP_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 备课系统的域名，用于在界面上显示「连到哪儿」。解析不出来就不显示 */
function teachingHost(env: Env): string | undefined {
  const url = teachingAppUrl(env);
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function integrationStatuses(env: Env = process.env): IntegrationStatus[] {
  const teachingUrlOk = teachingAppUrl(env) != null;
  const fakeMinutes = env.MINUTES_ADAPTER === "fake";
  const minutesUrlOk = httpUrlPresent(env, "MINUTES_API_BASE_URL");
  const missingMinutes = fakeMinutes
    ? []
    : [
        ...(minutesUrlOk ? [] : ["MINUTES_API_BASE_URL"]),
        ...missingOf(env, ["MINUTES_API_KEY", "MINUTES_MODEL"]),
      ];

  return [
    {
      key: "teaching",
      label: "智能备课系统",
      // URL 单独判断：填了但填错（协议不对、解析不了）也算没配好，
      // 只看 present() 会让一个坏地址显示成「已配置」
      configured: teachingUrlOk && present(env, "TEACHING_IMPORT_TOKEN"),
      missing: [
        ...(teachingUrlOk ? [] : ["TEACHING_APP_URL"]),
        ...missingOf(env, ["TEACHING_IMPORT_TOKEN"]),
      ],
      detail: teachingHost(env),
      usedBy: "增量 3.6（教案回流）",
      hint: "备课系统独立部署。填它的公网地址和一个高强度回流令牌，令牌与登录口令分开。",
    },
    {
      key: "asr",
      label: "会议转写（腾讯云）",
      configured: missingOf(env, ASR_VARS).length === 0,
      missing: missingOf(env, ASR_VARS),
      usedBy: "增量 3.3（音频转写）",
      hint: "腾讯云录音文件识别极速版，支持 2 小时 / 100MB 内的音频。没配时会议模块照常用，只是不能转写。",
    },
    {
      key: "minutes",
      label: "纪要生成",
      configured: missingMinutes.length === 0,
      missing: missingMinutes,
      usedBy: "增量 3.4（纪要草稿）",
      hint: "OpenAI-compatible 接口即可。没配时仍会保存转写全文，纪要手工整理。",
    },
    {
      key: "maintenance",
      label: "维护任务令牌",
      configured: present(env, "MAINTENANCE_TOKEN"),
      missing: missingOf(env, ["MAINTENANCE_TOKEN"]),
      usedBy: "增量 3.3 / 3.4（转写恢复与音频清理）",
      hint: "宿主机 cron 每日调用：恢复超时转写、执行第 7 天音频清理，并重试删除失败的音频。",
    },
  ];
}
