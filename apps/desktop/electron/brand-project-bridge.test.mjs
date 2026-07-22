import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createBrandProjectBridge,
  proposalReviewConfirmationCopy,
  resolveBrandProjectBridgeConfig,
  validateProposalReview,
} from "./brand-project-bridge.mjs";

describe("业务服务桥接配置", () => {
  it("未配置时保持关闭，不猜测本地资料位置", () => {
    assert.equal(resolveBrandProjectBridgeConfig({}), null);
  });

  it("只接受绝对可执行文件、工作区和数据库路径", () => {
    const root = path.resolve("/tmp/brand-project-test");
    const config = resolveBrandProjectBridgeConfig({
      OPENWORK_BRAND_PROJECT_BRIDGE_EXECUTABLE: "/usr/bin/python3",
      OPENWORK_BRAND_PROJECT_BRIDGE_ARGS_JSON: '["-m","brand_os.desktop_bridge"]',
      OPENWORK_BRAND_PROJECT_WORKSPACE: root,
      OPENWORK_BRAND_PROJECT_DATABASE: path.join(root, "project.db"),
      OPENWORK_BRAND_PROJECT_ID: "hongri",
    });
    assert.equal(config.executable, "/usr/bin/python3");
    assert.deepEqual(config.baseArgs, ["-m", "brand_os.desktop_bridge"]);
    assert.equal(config.projectId, "hongri");
    assert.throws(() => resolveBrandProjectBridgeConfig({
      OPENWORK_BRAND_PROJECT_BRIDGE_EXECUTABLE: "python3",
      OPENWORK_BRAND_PROJECT_WORKSPACE: root,
    }), /绝对路径/);
  });
});

describe("业务读取与人工评审分路", () => {
  it("读取通道只允许固定操作", async () => {
    const calls = [];
    const bridge = createBrandProjectBridge({
      resolveConfig: () => ({ projectId: "hongri" }),
      runRequest: async (_config, request) => {
        calls.push(request);
        return { schema_version: "desktop-project-view.v1" };
      },
    });
    await bridge.read("project_view", {});
    assert.equal(calls[0].operation, "project_view");
    assert.throws(() => bridge.read("proposal_review", {}), /读取操作未开放/);
    assert.throws(() => bridge.read("direct_sql", {}), /读取操作未开放/);
  });

  it("人工评审要求显式版本、理由和修改内容", () => {
    const review = validateProposalReview({
      schema_version: "desktop-proposal-review.v1",
      proposal_id: "proposal-1",
      action: "modify_and_approve",
      reason: "Fox 核对后修改措辞",
      replacement_after: { statement: "确认后的内容" },
      expected_version: 7,
      idempotency_key: "review-1",
    });
    assert.equal(review.action, "modify_and_approve");
    assert.match(proposalReviewConfirmationCopy(review).detail, /正式审计记录/);
    assert.throws(() => validateProposalReview({
      ...review,
      action: "approve",
      replacement_after: { statement: "不能携带" },
    }), /只有修改后批准/);
    assert.throws(() => validateProposalReview({
      ...review,
      action: "approve",
      replacement_after: undefined,
      approved_by_ai: true,
    }), /未声明字段/);
  });

  it("评审通道与读取通道使用不同操作", async () => {
    const calls = [];
    const bridge = createBrandProjectBridge({
      resolveConfig: () => ({ projectId: "hongri" }),
      runRequest: async (_config, request) => {
        calls.push(request);
        return { schema_version: "desktop-proposal-review-result.v1" };
      },
    });
    await bridge.review({
      schema_version: "desktop-proposal-review.v1",
      proposal_id: "proposal-1",
      action: "reject",
      reason: "证据不足",
      expected_version: 4,
      idempotency_key: "review-reject-1",
    });
    assert.equal(calls[0].operation, "proposal_review");
  });
});
