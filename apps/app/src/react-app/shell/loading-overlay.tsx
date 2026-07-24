/** @jsxImportSource react */
import { useBootState, useBootOverlayVisible } from "./boot-state";
import { OwDotTicker } from "./dot-ticker";
import { FOXWORK_RELEASE_PAGE_URL } from "../../app/lib/foxwork-brand";

/**
 * Quiet, opaque boot overlay. Solid surface fill so nothing bleeds through.
 * A minimal typographic beat plus a small dot ticker. Fades once both the
 * boot hook and the first route load are ready.
 */
export function LoadingOverlay() {
  const visible = useBootOverlayVisible();
  const { phase, message, error } = useBootState();

  if (!visible) return null;

  const fading = phase === "ready";

  return (
    <div
      className={`pointer-events-auto fixed inset-0 z-[1000] flex items-center justify-center bg-dls-surface transition-opacity duration-[160ms] ${
        fading ? "opacity-0" : "opacity-100"
      }`}
      aria-live="polite"
      aria-busy={!fading}
      role="status"
    >
      <div className="flex w-full max-w-[320px] flex-col items-center gap-4 px-6 text-center">
        <OwDotTicker size="md" />
        <div className="text-[12px] leading-5 text-dls-secondary">
          {message || "正在准备工作区"}
        </div>
        {error ? (
          <div className="flex flex-col gap-2 text-[12px] leading-5 text-red-11">
            <div>{error}</div>
            {FOXWORK_RELEASE_PAGE_URL ? (
              <div className="text-dls-secondary">
                可在此手动下载最新版本：{" "}
                <a
                  href={FOXWORK_RELEASE_PAGE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-dls-primary underline decoration-dls-primary/40 underline-offset-4"
                >
                  打开公司下载页面
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
