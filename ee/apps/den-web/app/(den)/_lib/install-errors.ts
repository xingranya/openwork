import { getErrorMessage } from "./den-flow";

const EXPIRED_INSTALL_LINK_MESSAGE = "安装链接已过期或失效，请联系公司管理员获取新链接。";

export function getInstallConfigErrorMessage(payload: unknown, status: number) {
  if (status === 404) {
    return EXPIRED_INSTALL_LINK_MESSAGE;
  }

  return getErrorMessage(payload, `无法加载安装链接（${status}）。`);
}
