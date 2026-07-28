/** @jsxImportSource react */
import { MonitorSmartphone } from "lucide-react";

import { surfaceCardClass } from "../workspace/modal-styles";
import { registerExtensionConfig } from "./extension-registry";

const foxWorkBrowserConfigFactory = () => <FoxWorkBrowserConfig />;

registerExtensionConfig("openwork.browser.settings", foxWorkBrowserConfigFactory);
registerExtensionConfig("openwork-browser", foxWorkBrowserConfigFactory);

function FoxWorkBrowserConfig() {
  return (
    <div className={`${surfaceCardClass} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-blue-11" />
        <div className="space-y-1 text-[13px] leading-relaxed text-dls-secondary">
          <div className="font-medium text-dls-text">无需额外配置</div>
          <div>SeeWayWork 内置浏览器会在执行网页任务时打开可见窗口，是本应用支持的浏览器自动操作方式。</div>
        </div>
      </div>
    </div>
  );
}
