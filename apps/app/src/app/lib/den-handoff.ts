import {
  createDenClient,
  getDenErrorMessage,
  writeDenSettings,
  type DenDesktopHandoffExchange,
} from "./den";
import { dispatchDenSessionUpdated } from "./den-session-events";

type DenClient = ReturnType<typeof createDenClient>;
export const DEN_HANDOFF_AUTO_CONTINUE_KEY = "openwork.den.handoffAutoContinueAt";

export type HandoffActiveOrg = {
  id: string;
  slug?: string | null;
  name?: string | null;
};

export type ExchangeHandoffOptions = {
  /** 用于交换凭据并在成功后保存的 Den 地址。 */
  baseUrl: string;
  /** 可复用的 Den 客户端；未提供时根据 baseUrl 创建。 */
  client?: DenClient;
  /** 登录后要选择的公司，由启动配置预先提供。 */
  activeOrg?: HandoffActiveOrg | null;
  /** 无具体错误信息时使用的中文回退文案。 */
  fallbackErrorMessage?: string;
};

export type ExchangeHandoffResult =
  | { ok: true; exchange: DenDesktopHandoffExchange; baseUrl: string }
  | { ok: false; error: string };

/**
 * 桌面交接登录的统一实现：交换一次性凭据，保存会话和公司信息，
 * 再广播会话更新。深链、手动粘贴和启动配置都复用这一条路径。
 */
export async function exchangeHandoffAndSignIn(
  grant: string,
  options: ExchangeHandoffOptions,
): Promise<ExchangeHandoffResult> {
  const fallback = options.fallbackErrorMessage ?? "登录公司账号失败，请重试。";
  const client = options.client ?? createDenClient({ baseUrl: options.baseUrl });

  try {
    const exchange = await client.exchangeDesktopHandoff(grant);
    if (!exchange.token) {
      throw new Error(fallback);
    }

    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(DEN_HANDOFF_AUTO_CONTINUE_KEY, String(Date.now()));
      } catch {}
    }
    writeDenSettings({
      baseUrl: options.baseUrl,
      authToken: exchange.token,
      activeOrgId: options.activeOrg?.id ?? null,
      activeOrgSlug: options.activeOrg?.slug ?? null,
      activeOrgName: options.activeOrg?.name ?? null,
    });

    dispatchDenSessionUpdated({
      status: "success",
      baseUrl: options.baseUrl,
      token: exchange.token,
      user: exchange.user,
      email: exchange.user?.email ?? null,
    });

    return { ok: true, exchange, baseUrl: options.baseUrl };
  } catch (error) {
    const message = getDenErrorMessage(error instanceof Error ? error.message : error, fallback);
    dispatchDenSessionUpdated({ status: "error", message });
    return { ok: false, error: message };
  }
}
