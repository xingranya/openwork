import { createHash } from "node:crypto"
import { env } from "./env.js"

export const EMAIL_PASSWORD_SIGN_UP_PATH = "/api/auth/sign-up/email"
export const CHANGE_PASSWORD_PATH = "/api/auth/change-password"
export const RESET_PASSWORD_PATH = "/api/auth/reset-password"
export const MIN_PASSWORD_LENGTH = 8

type PwnedPasswordsFetch = (input: string, init?: RequestInit) => Promise<Response>

function normalizedPath(request: Request) {
  const path = new URL(request.url).pathname
  return path !== "/" ? path.replace(/\/+$/, "") : path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readJsonObject(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""
  if (!contentType.includes("application/json")) {
    return null
  }

  try {
    const parsed: unknown = await request.clone().json()
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function jsonError(status: number, body: { error: string; message: string }, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("content-type", "application/json")
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  })
}

function hashPasswordForRangeLookup(password: string) {
  return createHash("sha1").update(password).digest("hex").toUpperCase()
}

export async function readPasswordForBreachCheck(request: Request) {
  if (request.method !== "POST") {
    return null
  }

  const path = normalizedPath(request)
  const body = await readJsonObject(request)
  if (!body) {
    return null
  }

  const password = path === EMAIL_PASSWORD_SIGN_UP_PATH
    ? body.password
    : path === CHANGE_PASSWORD_PATH || path === RESET_PASSWORD_PATH
      ? body.newPassword
      : null

  return typeof password === "string" && password ? password : null
}

export async function isPasswordCompromised(password: string, fetchPasswordRange: PwnedPasswordsFetch = fetch) {
  const hash = hashPasswordForRangeLookup(password)
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)
  const response = await fetchPasswordRange(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: {
      "add-padding": "true",
      "user-agent": "OpenWork den-api password screening",
    },
  })

  if (!response.ok) {
    throw new Error("password_screening_unavailable")
  }

  const body = await response.text()
  return body
    .split(/\r?\n/g)
    .some((line) => {
      const [entry] = line.trim().split(":")
      return entry === suffix
    })
}

export async function getBreachedPasswordResponse(
  request: Request,
  fetchPasswordRange?: PwnedPasswordsFetch,
  screeningEnabled = env.passwordBreachScreeningEnabled,
) {
  if (!screeningEnabled) {
    return null
  }

  const password = await readPasswordForBreachCheck(request)
  if (!password) {
    return null
  }

  let compromised: boolean
  try {
    compromised = await isPasswordCompromised(password, fetchPasswordRange)
  } catch {
    return jsonError(503, {
      error: "password_screening_unavailable",
      message: "暂时无法检查密码安全性，请稍后重试。",
    })
  }

  if (!compromised) {
    return null
  }

  return jsonError(400, {
    error: "password_compromised",
    message: "此密码曾出现在数据泄露记录中，请更换密码。",
  })
}

export async function getShortPasswordResponse(request: Request) {
  const password = await readPasswordForBreachCheck(request)
  if (password === null || password.length >= MIN_PASSWORD_LENGTH) {
    return null
  }

  return jsonError(400, {
    error: "password_too_short",
    message: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`,
  })
}
