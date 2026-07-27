import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const editorSource = readFileSync(
  fileURLToPath(new URL("../app/(den)/dashboard/_components/llm-provider-editor-screen.tsx", import.meta.url)),
  "utf8",
);
const dataSource = readFileSync(
  fileURLToPath(new URL("../app/(den)/dashboard/_components/llm-provider-data.tsx", import.meta.url)),
  "utf8",
);

describe("模型默认全员启用策略", () => {
  test("新建模型默认开启，并把策略提交给 Den API", () => {
    expect(editorSource).toContain("const [defaultEnabled, setDefaultEnabled] = useState(true)");
    expect(editorSource).toContain("defaultEnabled,");
    expect(editorSource).toContain("默认对所有成员启用");
  });

  test("编辑时读取服务端策略，并说明关闭不会删除明确授权", () => {
    expect(editorSource).toContain("setDefaultEnabled(provider.defaultEnabled)");
    expect(editorSource).toContain("关闭时不会删除下方已明确授权的成员或团队");
    expect(dataSource).toContain("defaultEnabled: value.defaultEnabled === true");
  });
});
