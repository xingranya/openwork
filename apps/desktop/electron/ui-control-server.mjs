// 本机界面控制 HTTP 桥接：通过回环地址提供旧版 /snapshot、/actions、/execute
// 路由，以及语义化的 /context、/query、/command 路由。请求会转发到渲染进程的
// window.__openworkControl。状态和生命周期集中保存在此工厂中。
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

export function createUiControlServer({ appName, appIdentifier, getWindow }) {
  let uiControlServer = null;
  let uiControlDiscoveryPath = null;
  const uiControlToken = randomBytes(32).toString("hex");

  function sendJsonResponse(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }

  function readJsonRequestBody(request) {
    return new Promise((resolve, reject) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 128_000) {
          reject(new Error("请求内容过大。"));
          request.destroy();
        }
      });
      request.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("请求内容必须是 JSON。"));
        }
      });
      request.on("error", reject);
    });
  }

  function authorizedUiControlRequest(request) {
    const auth = request.headers.authorization ?? "";
    return auth === `Bearer ${uiControlToken}`;
  }

  function jsonForJavaScript(value) {
    return JSON.stringify(JSON.stringify(value ?? {}));
  }

  async function evaluateOpenworkControl(expression) {
    const win = await getWindow();
    // 命令直接修改渲染进程状态，不需要激活桌面窗口。前台激活必须由明确操作触发，
    // 不能成为远程控制的隐式副作用。
    return win.webContents.executeJavaScript(expression, true);
  }

  async function runOpenworkControlCommand(command, args = {}) {
    const argsJsonLiteral = jsonForJavaScript(args);
    if (command === "snapshot") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        if (!control) return { ok: false, error: "FoxWork 控制界面尚未就绪。" };
        control.setEnabled?.(true);
        return { ok: true, ...control.snapshot() };
      })()`);
    }
    if (command === "actions") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        if (!control) return { ok: false, error: "FoxWork 控制界面尚未就绪。" };
        control.setEnabled?.(true);
        return { ok: true, actions: control.listActions() };
      })()`);
    }
    if (command === "context") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        if (!control) return { ok: false, error: "FoxWork 控制界面尚未就绪。" };
        return { ok: true, context: control.context() };
      })()`);
    }
    if (command === "query" || command === "command") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        const input = JSON.parse(${argsJsonLiteral});
        if (!control) return { ok: false, error: "FoxWork 控制界面尚未就绪。" };
        if (!input || typeof input.id !== "string" || !input.id.trim()) {
          return { ok: false, error: "缺少 FoxWork 界面操作标识。" };
        }
        return control[${JSON.stringify(command)}](input);
      })()`);
    }
    if (command === "execute") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        const input = JSON.parse(${argsJsonLiteral});
        if (!control) return { ok: false, error: "FoxWork 控制界面尚未就绪。" };
        if (!input || typeof input.actionId !== "string" || !input.actionId.trim()) {
          return { ok: false, error: "缺少 FoxWork 操作标识。" };
        }
        control.setEnabled?.(true);
        return control.execute(input.actionId, input.args ?? {});
      })()`);
    }
    return { ok: false, error: `无法识别 FoxWork 控制命令：${command}` };
  }

  async function start() {
    if (uiControlServer) return;
    uiControlServer = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/health") {
          sendJsonResponse(response, 200, { ok: true, app: appName, version: 2 });
          return;
        }
        if (!authorizedUiControlRequest(request)) {
          sendJsonResponse(response, 401, { ok: false, error: "未授权" });
          return;
        }
        if (request.method === "GET" && url.pathname === "/snapshot") {
          sendJsonResponse(response, 200, await runOpenworkControlCommand("snapshot"));
          return;
        }
        if (request.method === "GET" && url.pathname === "/actions") {
          sendJsonResponse(response, 200, await runOpenworkControlCommand("actions"));
          return;
        }
        if (request.method === "GET" && url.pathname === "/context") {
          sendJsonResponse(response, 200, await runOpenworkControlCommand("context"));
          return;
        }
        if (request.method === "POST" && url.pathname === "/query") {
          sendJsonResponse(response, 200, await runOpenworkControlCommand("query", await readJsonRequestBody(request)));
          return;
        }
        if (request.method === "POST" && url.pathname === "/command") {
          sendJsonResponse(response, 200, await runOpenworkControlCommand("command", await readJsonRequestBody(request)));
          return;
        }
        if (request.method === "POST" && url.pathname === "/execute") {
          sendJsonResponse(response, 200, await runOpenworkControlCommand("execute", await readJsonRequestBody(request)));
          return;
        }
        sendJsonResponse(response, 404, { ok: false, error: "请求地址不存在" });
      } catch (error) {
        sendJsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    await new Promise((resolve, reject) => {
      uiControlServer.once("error", reject);
      uiControlServer.listen(0, "127.0.0.1", () => resolve(undefined));
    });
    const address = uiControlServer.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) throw new Error("无法启动 FoxWork 界面控制桥接服务。");
    uiControlDiscoveryPath = path.join(app.getPath("userData"), "openwork-ui-control.json");
    await writeFile(
      uiControlDiscoveryPath,
      `${JSON.stringify({ version: 2, app: appName, identifier: appIdentifier, platform: process.platform, baseUrl: `http://127.0.0.1:${port}`, token: uiControlToken }, null, 2)}\n`,
      "utf8",
    );
    // 将发现文件路径提供给子进程（服务端、托管运行引擎和插件）。
    process.env.OPENWORK_UI_CONTROL_DISCOVERY = uiControlDiscoveryPath;
  }

  async function stop() {
    if (uiControlDiscoveryPath) {
      await rm(uiControlDiscoveryPath, { force: true }).catch(() => undefined);
      uiControlDiscoveryPath = null;
    }
    if (!uiControlServer) return;
    await new Promise((resolve) => uiControlServer.close(() => resolve(undefined)));
    uiControlServer = null;
  }

  return { start, stop };
}
