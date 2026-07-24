const CHINESE_CHARACTER = /[\u3400-\u9fff]/;

function readMessage(value: unknown): string {
  if (value instanceof Error) return value.message.trim();
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 只向员工展示已经本地化的服务消息；英文或内部错误统一降级为明确的中文提示。
 */
export function toChineseUserMessage(value: unknown, fallback: string): string {
  const message = readMessage(value);
  return CHINESE_CHARACTER.test(message) ? message : fallback;
}
