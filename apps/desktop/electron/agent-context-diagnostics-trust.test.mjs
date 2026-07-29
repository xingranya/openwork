import assert from "node:assert/strict";
import test from "node:test";

import { mergeCompanyOriginIntoDiagnosticsTrust } from "./agent-context-diagnostics-trust.mjs";

test("公司服务地址会加入诊断白名单，并保留管理员额外配置", () => {
  assert.equal(
    mergeCompanyOriginIntoDiagnosticsTrust(
      "https://diagnostics.example.test",
      "https://work.seeway.co/api/den",
    ),
    "https://diagnostics.example.test,https://work.seeway.co",
  );
});

test("相同公司地址不会在每次重连后重复写入白名单", () => {
  assert.equal(
    mergeCompanyOriginIntoDiagnosticsTrust(
      "https://work.seeway.co",
      "https://work.seeway.co/",
    ),
    "https://work.seeway.co",
  );
});

test("仅允许 HTTPS 公司地址和本机开发地址进入诊断白名单", () => {
  assert.equal(mergeCompanyOriginIntoDiagnosticsTrust("", "http://den.example.test"), "");
  assert.equal(
    mergeCompanyOriginIntoDiagnosticsTrust("", "http://127.0.0.1:3005/api/den"),
    "http://127.0.0.1:3005",
  );
  assert.equal(mergeCompanyOriginIntoDiagnosticsTrust("", "https://user:pass@work.seeway.co"), "");
});
