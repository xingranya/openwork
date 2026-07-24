"use client";

import { useMemo, useState } from "react";
import { getErrorMessage } from "../../(den)/_lib/den-flow";

async function submitConsent(accept: boolean, oauthQuery: string, scope: string) {
  const response = await fetch("/api/auth/oauth2/consent", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept, scope, oauth_query: oauthQuery }),
  });
  const payload = await response.json().catch(() => null) as unknown;
  return { response, payload };
}

export default function McpConsentPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const oauthQuery = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.search.replace(/^\?/, "");
  }, []);
  const clientId = params.get("client_id") ?? "MCP 客户端";
  const scope = params.get("scope") ?? "openid profile email mcp:read";

  async function decide(accept: boolean) {
    setBusy(true);
    setStatus(accept ? "正在授权 MCP 客户端..." : "正在拒绝授权...");
    const result = await submitConsent(accept, oauthQuery, scope);
    if (!result.response.ok) {
      setBusy(false);
      setStatus(getErrorMessage(result.payload, "授权操作失败，请重试。"));
      return;
    }
    if (result.payload && typeof result.payload === "object" && "url" in result.payload && typeof result.payload.url === "string") {
      window.location.href = result.payload.url;
      return;
    }
    window.location.reload();
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <section className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.3em] text-cyan-200">FoxWork MCP</p>
        <h1 className="mt-3 text-3xl font-semibold">授权 MCP 访问</h1>
        <p className="mt-3 text-sm text-slate-300">“{clientId}”正在申请通过 MCP 使用公司能力。</p>
        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <p className="text-sm font-medium text-slate-200">申请的权限范围</p>
          <p className="mt-2 break-words font-mono text-xs text-cyan-100">{scope}</p>
        </div>
        {status ? <p className="mt-4 text-sm text-slate-300">{status}</p> : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button className="rounded-2xl border border-white/15 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void decide(false)}>
            拒绝
          </button>
          <button className="rounded-2xl bg-cyan-300 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50" disabled={busy} onClick={() => void decide(true)}>
            授权
          </button>
        </div>
      </section>
    </main>
  );
}
