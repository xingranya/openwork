import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client";

import type { ComposerAttachment } from "../../../../app/types";
import { joinWorkspaceRelativePath, toFileUrl } from "./prompt-file-parts";

type AttachmentKind = "image" | "file";

type AttachmentFile = Pick<File, "arrayBuffer" | "name" | "type">;

type AttachmentFileMetadata = {
  filename: string;
  mime: string;
  kind: AttachmentKind;
};

const GENERIC_BINARY_MIME = "application/octet-stream";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type InboxUploadResult = {
  ok: boolean;
  path: string;
  bytes: number;
};

type ChatAttachmentUploadClient = {
  uploadInbox: (workspaceId: string, file: File, options?: { path?: string }) => Promise<InboxUploadResult>;
};

export type ChatAttachmentWorkspaceEndpoint = {
  client: ChatAttachmentUploadClient;
  workspaceId: string;
};

type UploadedChatAttachment = {
  filename: string;
  mime: string;
  bytes: number;
  workspacePath: string;
  url: string;
  file: AttachmentFile;
};

const WORKSPACE_INBOX_ROOT = ".opencode/openwork/inbox";

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  docx: DOCX_MIME,
  pptx: PPTX_MIME,
  xlsx: XLSX_MIME,
  txt: "text/plain",
  text: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/json",
  js: "application/javascript",
  jsx: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  css: "text/css",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  svg: "image/svg+xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "text/plain",
  log: "text/plain",
  py: "text/plain",
  rb: "text/plain",
  go: "text/plain",
  rs: "text/plain",
  java: "text/plain",
  c: "text/plain",
  h: "text/plain",
  cpp: "text/plain",
  cs: "text/plain",
  php: "text/plain",
  sh: "text/plain",
  sql: "text/plain",
  ini: "text/plain",
  conf: "text/plain",
};

const MIME_FILENAME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  [DOCX_MIME]: "docx",
  [PPTX_MIME]: "pptx",
  [XLSX_MIME]: "xlsx",
  "application/json": "json",
  "application/javascript": "js",
  "application/xml": "xml",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "text/css": "css",
  "text/html": "html",
  "text/yaml": "yaml",
  "text/plain": "txt",
};

function normalizedMime(mimeType: string) {
  return mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

function isGenericMime(mime: string) {
  return mime === "" || mime === GENERIC_BINARY_MIME;
}

function isOfficeMime(mime: string) {
  return mime === DOCX_MIME || mime === PPTX_MIME || mime === XLSX_MIME;
}

function extensionFromFilename(filename: string) {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const basename = filename.slice(slash + 1);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0 || dot === basename.length - 1) return "";
  return basename.slice(dot + 1).toLowerCase();
}

function mimeFromFilename(filename: string) {
  const extension = extensionFromFilename(filename);
  return extension ? EXTENSION_MIME_TYPES[extension] : undefined;
}

export function resolveAttachmentMime(file: Pick<File, "name" | "type">) {
  const mime = normalizedMime(file.type);
  if (!isGenericMime(mime)) return mime;
  return mimeFromFilename(file.name) ?? GENERIC_BINARY_MIME;
}

function isTextLikeAttachmentMime(mime: string) {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml" || mime === "application/javascript") return true;
  return mime.endsWith("+json") || mime.endsWith("+xml");
}

/**
 * AI SDK provider adapters only accept `image/*`, `application/pdf`, and
 * `text/plain` file parts; anything else throws UnsupportedFunctionalityError
 * server-side and poisons the session history. So model-facing file parts are
 * routed by one rule:
 * - text-like mimes are re-mimed to `text/plain` so opencode inlines their
 *   content via the Read tool (the proven `@file` mention mechanism);
 * - images, PDFs, and Office mimes pass through (Office parts are rewritten
 *   to text by the OpenWorkOfficeAttachments plugin before the provider);
 * - everything else returns `null`: workspace (`file://`) attachments fall
 *   back to a `text/plain` part that opencode mediates through the Read tool,
 *   while data-URL attachments are dropped (inlining binary bytes as text is
 *   garbage); the synthetic workspace-path note gives tools the bytes.
 */
export function modelFacingAttachmentMime(mimeType: string): string | null {
  const mime = normalizedMime(mimeType);
  if (isTextLikeAttachmentMime(mime)) return "text/plain";
  if (mime.startsWith("image/") || mime === "application/pdf" || isOfficeMime(mime)) return mime;
  return null;
}

function normalizeFilenameExtension(filename: string, mime: string) {
  const original = filename.trim() || "attachment";
  const preferredExtension = MIME_FILENAME_EXTENSIONS[mime];
  if (!preferredExtension) return original;

  const extension = extensionFromFilename(original);
  const extensionMime = extension ? EXTENSION_MIME_TYPES[extension] : undefined;
  if (extensionMime === mime) return original;

  const strictMime = mime.startsWith("image/") || mime === "application/pdf" || mime === "application/json" || isOfficeMime(mime);
  if (!strictMime && extensionMime === undefined) return original;

  const stem = extension ? original.slice(0, -(extension.length + 1)) : original;
  return `${stem.trim() || "attachment"}.${preferredExtension}`;
}

export function safeAttachmentFilename(filename: string) {
  const normalized = filename.replace(/\\/g, "/");
  const basename = normalized.split("/").filter(Boolean).pop()?.trim() ?? "";
  const safe = basename.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  return safe && safe !== "." && safe !== ".." ? safe : "attachment";
}

function safePathSegment(value: string, fallback: string) {
  const safe = safeAttachmentFilename(value).replace(/\.+/g, ".");
  return safe && safe !== "." ? safe : fallback;
}

export function resolveAttachmentFileMetadata(file: Pick<File, "name" | "type">): AttachmentFileMetadata {
  const mime = resolveAttachmentMime(file);
  return {
    filename: safeAttachmentFilename(normalizeFilenameExtension(file.name, mime)),
    mime,
    kind: mime.startsWith("image/") ? "image" : "file",
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fileToDataUrl(file: AttachmentFile, mime: string) {
  return `data:${mime};base64,${arrayBufferToBase64(await file.arrayBuffer())}`;
}

function randomAttachmentId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues(bytes);
  if (bytes.some((byte) => byte !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function buildChatAttachmentInboxPath(input: { sessionId: string; filename: string; id: string }) {
  const session = safePathSegment(input.sessionId, "session");
  const id = safePathSegment(input.id, "attachment");
  const filename = safeAttachmentFilename(input.filename);
  return `chat-attachments/${session}/${id}-${filename}`;
}

export function workspaceInboxPath(inboxRelativePath: string) {
  return joinWorkspaceRelativePath(WORKSPACE_INBOX_ROOT, inboxRelativePath);
}

function uploadErrorMessage(filename: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "上传失败");
  return `无法把附件“${filename}”复制到当前工作区：${detail}`;
}

async function uploadedAttachmentFilePart(item: UploadedChatAttachment): Promise<FilePartInput> {
  // 二进制或未知类型使用 text/plain 文件部件，让运行时通过读取工具处理；
  // 即使读取失败，也不会把不可识别的二进制内容直接发给模型供应商。
  const modelMime = modelFacingAttachmentMime(item.mime) ?? "text/plain";

  // 图片必须读取真实字节并转为 data URL。工作区副本路径只进入隐藏运行时
  // 上下文，不能用 file:// 路径代替供应商可识别的图片输入。
  if (modelMime.startsWith("image/")) {
    return {
      type: "file",
      url: await fileToDataUrl(item.file, modelMime),
      filename: item.filename,
      mime: modelMime,
    };
  }

  return {
    type: "file",
    url: item.url,
    filename: item.filename,
    mime: modelMime,
  };
}

function attachmentPathNotePart(uploaded: UploadedChatAttachment[]): TextPartInput {
  return {
    type: "text",
    synthetic: true,
    text: [
      "附件已复制到当前工作区，工具需要读取原文件时可使用以下路径：",
      ...uploaded.map((item) => `- ${item.filename}: ${item.workspacePath} (${item.url})`),
    ].join("\n"),
  };
}

export async function composerAttachmentsToWorkspaceFileParts(input: {
  attachments: ComposerAttachment[];
  endpoint: ChatAttachmentWorkspaceEndpoint;
  sessionId: string;
  workspaceRoot: string;
  createId?: () => string;
}): Promise<Array<TextPartInput | FilePartInput>> {
  if (input.attachments.length === 0) return [];

  const workspaceRoot = input.workspaceRoot.trim();
  if (!workspaceRoot) {
    throw new Error("当前工作区路径不可用，无法复制附件供工具使用。");
  }

  const workspaceId = input.endpoint.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("当前工作区暂时不可用，无法复制附件供工具使用。");
  }

  const uploaded: UploadedChatAttachment[] = [];
  for (const attachment of input.attachments) {
    const metadata = resolveAttachmentFileMetadata(attachment.file);
    const id = input.createId ? input.createId() : randomAttachmentId();
    const inboxPath = buildChatAttachmentInboxPath({
      sessionId: input.sessionId,
      filename: metadata.filename,
      id,
    });

    let result: InboxUploadResult;
    try {
      result = await input.endpoint.client.uploadInbox(workspaceId, attachment.file, { path: inboxPath });
    } catch (error) {
      throw new Error(uploadErrorMessage(metadata.filename, error));
    }

    if (result.ok === false) {
      throw new Error(`无法把附件“${metadata.filename}”复制到当前工作区：服务器拒绝了上传`);
    }
    if (!result.path.trim()) {
      throw new Error(`无法把附件“${metadata.filename}”复制到当前工作区：服务器没有返回文件位置`);
    }
    if (result.bytes !== attachment.file.size) {
      throw new Error(`无法把附件“${metadata.filename}”复制到当前工作区：文件大小校验失败`);
    }

    const workspacePath = workspaceInboxPath(result.path);
    const absolutePath = joinWorkspaceRelativePath(workspaceRoot, workspacePath);
    uploaded.push({
      filename: metadata.filename,
      mime: metadata.mime,
      bytes: result.bytes,
      workspacePath,
      url: toFileUrl(absolutePath),
      file: attachment.file,
    });
  }

  return [
    attachmentPathNotePart(uploaded),
    ...(await Promise.all(uploaded.map(uploadedAttachmentFilePart))),
  ];
}

export async function composerAttachmentToFilePart(attachment: ComposerAttachment): Promise<FilePartInput | null> {
  const metadata = resolveAttachmentFileMetadata(attachment.file);
  const modelMime = modelFacingAttachmentMime(metadata.mime);
  if (!modelMime) return null;
  return {
    type: "file",
    url: await fileToDataUrl(attachment.file, modelMime),
    filename: metadata.filename,
    mime: modelMime,
  };
}
