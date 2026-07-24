"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getErrorMessage, requestJson } from "../_lib/den-flow";

function getResetLinkError(error: string | null) {
  if (!error) {
    return "重置链接缺少必要信息，请回到登录页重新申请。";
  }

  if (error === "INVALID_TOKEN") {
    return "重置链接无效或已经过期，请回到登录页重新申请。";
  }

  return "无法验证这个重置链接，请回到登录页重新申请。";
}

export function ResetPasswordScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const callbackError = searchParams.get("error")?.trim() ?? null;
  const linkError = token ? null : getResetLinkError(callbackError);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(linkError);

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError(getResetLinkError(callbackError));
      return;
    }
    if (password.length < 8) {
      setError("新密码至少需要 8 个字符。");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          newPassword: password,
          token,
        }),
      });

      if (!response.ok) {
        setError(getErrorMessage(payload, `密码重置失败（${response.status}）。`));
        return;
      }

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "密码重置失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="den-page flex min-h-[calc(100vh-2.5rem)] w-full items-center justify-center py-6">
      <div className="den-frame grid w-full max-w-[520px] gap-6 p-6 md:p-8">
        <div className="grid gap-3">
          <p className="den-eyebrow">公司账号</p>
          <div className="grid gap-2">
            <h1 className="den-title-lg">设置新密码</h1>
            <p className="den-copy">请为公司账号设置一个新密码。</p>
          </div>
        </div>

        {success ? (
          <div className="den-frame-inset grid gap-3 rounded-[1.5rem] px-4 py-4 text-center text-[13px] text-[var(--dls-text-secondary)]" aria-live="polite">
            <div className="inline-flex items-center justify-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="font-medium">密码已经重置。</span>
            </div>
            <p className="m-0">请使用新密码重新登录。</p>
            <a href="/?mode=sign-in" className="den-button-primary mt-1 w-full">
              返回登录
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submitReset}>
            <label className="grid gap-2">
              <span className="den-label">新密码</span>
              <input
                className="den-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                disabled={!token || busy}
                required
              />
            </label>

            <label className="grid gap-2">
              <span className="den-label">再次输入新密码</span>
              <input
                className="den-input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={!token || busy}
                required
              />
            </label>

            <button type="submit" className="den-button-primary w-full" disabled={!token || busy}>
              {busy ? "正在重置..." : "重置密码"}
              {!busy ? <ArrowRight className="h-4 w-4" /> : null}
            </button>
          </form>
        )}

        {error ? (
          <div className="den-frame-inset rounded-[1.5rem] px-4 py-3 text-center text-[13px] font-medium text-rose-600" aria-live="polite">
            {error}
          </div>
        ) : null}

        {!success ? (
          <div className="border-t border-[var(--dls-border)] pt-4 text-center text-sm text-[var(--dls-text-secondary)]">
            <a href="/?mode=sign-in" className="font-medium text-[var(--dls-text-primary)] transition hover:opacity-70">
              返回登录
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
