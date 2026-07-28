import os from "node:os";
import path from "node:path";

/**
 * 在桌面进程启动时固定真实用户目录，避免开发运行时改写 HOME 后把本机
 * Skills、终端默认目录和桌面 IPC 错误指向隔离目录。
 */
export function createDesktopUserHome(homeDir) {
  const resolvedHome = path.resolve(String(homeDir ?? "").trim() || os.homedir());

  return Object.freeze({
    homeDir: resolvedHome,
    globalSkillRoots(opencodeRoot) {
      return [
        path.join(opencodeRoot, "skills"),
        path.join(resolvedHome, ".claude", "skills"),
        path.join(resolvedHome, ".agents", "skills"),
        path.join(resolvedHome, ".agent", "skills"),
      ];
    },
  });
}

export const desktopUserHome = createDesktopUserHome(os.homedir());
