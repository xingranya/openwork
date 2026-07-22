import { spawn } from "node:child_process";
import path from "node:path";

const REQUEST_SCHEMA_VERSION = "desktop-bridge-request.v1";
const REVIEW_SCHEMA_VERSION = "desktop-proposal-review.v1";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const READ_OPERATIONS = new Set([
  "project_view",
  "evidence_get",
  "task_packet_get",
  "proposal_get",
]);
const REVIEW_ACTIONS = new Set(["approve", "modify_and_approve", "reject"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} 不能为空`);
  }
  return value.trim();
}

function requireAbsolutePath(value, field) {
  const selected = requireText(value, field);
  if (!path.isAbsolute(selected)) throw new Error(`${field} 必须是绝对路径`);
  return path.normalize(selected);
}

function parseBridgeArguments(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("OPENWORK_BRAND_PROJECT_BRIDGE_ARGS_JSON 必须是 JSON 数组");
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("OPENWORK_BRAND_PROJECT_BRIDGE_ARGS_JSON 只能包含字符串参数");
  }
  return value;
}

export function resolveBrandProjectBridgeConfig(env = process.env) {
  const executable = env.OPENWORK_BRAND_PROJECT_BRIDGE_EXECUTABLE?.trim() ?? "";
  const workspace = env.OPENWORK_BRAND_PROJECT_WORKSPACE?.trim() ?? "";
  if (!executable && !workspace) return null;
  if (!executable || !workspace) {
    throw new Error("业务服务桥接需要同时配置可执行文件和工作区");
  }
  const database = env.OPENWORK_BRAND_PROJECT_DATABASE?.trim() ?? "";
  const projectId = env.OPENWORK_BRAND_PROJECT_ID?.trim() || "hongri";
  return {
    executable: requireAbsolutePath(executable, "业务服务桥接可执行文件"),
    baseArgs: parseBridgeArguments(env.OPENWORK_BRAND_PROJECT_BRIDGE_ARGS_JSON),
    workspace: requireAbsolutePath(workspace, "业务服务工作区"),
    database: database ? requireAbsolutePath(database, "业务数据库") : null,
    projectId: requireText(projectId, "project_id"),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function childEnvironment(env) {
  const selected = {};
  for (const name of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "USER", "UV_CACHE_DIR", "VIRTUAL_ENV"]) {
    const value = env[name];
    if (typeof value === "string" && value.length > 0) selected[name] = value;
  }
  selected.NO_COLOR = "1";
  return selected;
}

function bridgeArguments(config) {
  const args = [
    ...config.baseArgs,
    "--workspace",
    config.workspace,
    "--project",
    config.projectId,
  ];
  if (config.database) args.push("--database", config.database);
  return args;
}

function bridgeError(stderr, fallback) {
  try {
    const value = JSON.parse(stderr);
    if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
  } catch {
    // 非 JSON 错误不向界面泄露子进程输出。
  }
  return fallback;
}

export function runBrandProjectBridgeRequest(config, request, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const env = options.env ?? process.env;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(config.executable, bridgeArguments(config), {
      cwd: config.workspace,
      env: childEnvironment(env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const abortForSize = () => {
      child.kill();
      finish(() => reject(new Error("业务服务响应超过 2 MiB")));
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) return abortForSize();
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) return abortForSize();
      stderr.push(chunk);
    });
    child.on("error", (error) => finish(() => reject(new Error("无法启动业务服务桥接", { cause: error }))));
    child.on("close", (code) => finish(() => {
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(bridgeError(errorOutput, "业务服务请求失败")));
        return;
      }
      try {
        const value = JSON.parse(output);
        if (!isRecord(value) || typeof value.schema_version !== "string") {
          throw new Error("业务服务返回了无效响应");
        }
        resolve(value);
      } catch (error) {
        reject(new Error("业务服务返回了无效 JSON", { cause: error }));
      }
    }));
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("业务服务请求超时，请重试")));
    }, config.timeoutMs);
    child.stdin.end(JSON.stringify(request));
  });
}

export function validateProposalReview(input) {
  if (!isRecord(input)) throw new Error("人工评审请求必须是对象");
  const allowed = new Set([
    "schema_version",
    "proposal_id",
    "action",
    "reason",
    "replacement_after",
    "expected_version",
    "idempotency_key",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`人工评审包含未声明字段：${key}`);
  }
  if (input.schema_version !== REVIEW_SCHEMA_VERSION) {
    throw new Error("人工评审 Schema 版本不受支持");
  }
  const action = requireText(input.action, "action");
  if (!REVIEW_ACTIONS.has(action)) throw new Error("人工评审动作无效");
  if (!Number.isInteger(input.expected_version) || input.expected_version < 0) {
    throw new Error("expected_version 必须是非负整数");
  }
  if (action === "modify_and_approve" && !isRecord(input.replacement_after)) {
    throw new Error("修改后批准必须提供修改后的内容");
  }
  if (action !== "modify_and_approve" && input.replacement_after !== undefined) {
    throw new Error("只有修改后批准可以提交修改后的内容");
  }
  return {
    schema_version: REVIEW_SCHEMA_VERSION,
    proposal_id: requireText(input.proposal_id, "proposal_id"),
    action,
    reason: requireText(input.reason, "reason"),
    ...(action === "modify_and_approve" ? { replacement_after: input.replacement_after } : {}),
    expected_version: input.expected_version,
    idempotency_key: requireText(input.idempotency_key, "idempotency_key"),
  };
}

export function proposalReviewConfirmationCopy(review) {
  const labels = {
    approve: { title: "确认批准这项变更？", button: "确认批准" },
    modify_and_approve: { title: "确认修改并批准？", button: "确认修改并批准" },
    reject: { title: "确认驳回这项变更？", button: "确认驳回" },
  };
  const selected = labels[review.action];
  return {
    title: selected.title,
    button: selected.button,
    detail: `提案 ${review.proposal_id}\n\n评审说明：${review.reason}\n\n此操作会写入正式审计记录。`,
  };
}

export function createBrandProjectBridge(options = {}) {
  const resolveConfig = options.resolveConfig ?? (() => resolveBrandProjectBridgeConfig());
  const runRequest = options.runRequest ?? runBrandProjectBridgeRequest;
  const configured = () => {
    const config = resolveConfig();
    if (!config) throw new Error("尚未连接业务服务");
    return config;
  };
  return {
    status() {
      try {
        const config = resolveConfig();
        return config
          ? { schema_version: "desktop-bridge-status.v1", configured: true, project_id: config.projectId }
          : { schema_version: "desktop-bridge-status.v1", configured: false, project_id: null };
      } catch (error) {
        return {
          schema_version: "desktop-bridge-status.v1",
          configured: false,
          project_id: null,
          message: error instanceof Error ? error.message : "业务服务配置无效",
        };
      }
    },
    read(operation, payload = {}) {
      if (!READ_OPERATIONS.has(operation)) throw new Error(`桌面读取操作未开放：${operation}`);
      return runRequest(configured(), {
        schema_version: REQUEST_SCHEMA_VERSION,
        operation,
        payload,
      });
    },
    review(input) {
      const review = validateProposalReview(input);
      return runRequest(configured(), {
        schema_version: REQUEST_SCHEMA_VERSION,
        operation: "proposal_review",
        payload: review,
      });
    },
  };
}
