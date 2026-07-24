"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { parseBrowserObservabilityEnv } from "../observability/browser-config";

const browserObservability = parseBrowserObservabilityEnv({
  backend: process.env.NEXT_PUBLIC_DEN_OBSERVABILITY_BACKEND,
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sentryTracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
});

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (browserObservability.backend === "sentry") {
      Sentry.captureException(error);
    }
  }, [error]);

  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f8fafc", color: "#0f172a", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "min(100%, 440px)", border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: 24 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>页面暂时无法打开</h1>
            <p style={{ margin: "12px 0 20px", color: "#64748b", lineHeight: 1.7 }}>请重试。如果问题一直存在，请联系公司管理员。</p>
            <button type="button" onClick={reset} style={{ border: 0, borderRadius: 10, background: "#0f172a", color: "white", padding: "10px 16px", cursor: "pointer" }}>
              重新加载
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
