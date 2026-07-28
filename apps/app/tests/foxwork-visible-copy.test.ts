import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const SOURCE_ROOT = fileURLToPath(new URL("../src", import.meta.url));
const viteConfigSource = readFileSync(
  fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  "utf8",
);
const desktopPoliciesSource = readFileSync(
  fileURLToPath(new URL("../../../packages/types/src/den/desktop-policies.ts", import.meta.url)),
  "utf8",
);
const VISIBLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "title",
  "tooltip",
]);
const VISIBLE_CALLS = new Set([
  "alert",
  "confirm",
  "prompt",
  "setError",
  "setMessage",
  "setNotice",
  "setStatus",
  "setWarning",
]);
const VISIBLE_OBJECT_FIELDS = new Set([
  "actionLabel",
  "body",
  "message",
  "recommendedAction",
  "title",
]);
const EXTENSION_MANIFEST_FIELDS = new Set([
  "description",
  "instructions",
  "label",
  "name",
  "primaryCta",
  "prompt",
  "secondaryCta",
]);
const TECHNICAL_LABELS = new Set([
  "API",
  "API key",
  "Bash",
  "ChatGPT",
  "Claude Desktop, Codex, Cursor",
  "Context7",
  "Ctrl+Shift+F",
  "CSV",
  "Excel",
  "FoxWork",
  "FoxWork.app.migrate-bak",
  "GitHub",
  "Google Chat",
  "Linear",
  "MCP",
  "Notion",
  "ock_...",
  "openwork-ui-mcp",
  "OPENWORK_UI_CONTROL_DISCOVERY=/path/to/openwork-ui-control.json",
  "OAuth",
  "OpenCode",
  "Sentry",
  "search_capabilities",
  "execute_capability",
  "sk-...",
  "Stripe",
  "URL",
]);

type Violation = {
  file: string;
  line: number;
  kind: string;
  text: string;
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "i18n") return [];
      return sourceFiles(absolutePath);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)
      ? [absolutePath]
      : [];
  });
}

function isVisibleEnglish(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (/\bOpen(?:Work|Code)\b|Big Pickle/.test(normalized)) return true;
  if (!/[A-Za-z]{2}/.test(normalized) || /[\u3400-\u9fff]/.test(normalized)) return false;
  if (TECHNICAL_LABELS.has(normalized)) return false;
  if (/^(?:https?:\/\/|\.?\.?\/|~\/|[A-Za-z]:\\|\.)/.test(normalized)) return false;
  if (/^[\w@./:+-]+\.(?:jsonc?|tsx?|jsx?|md|css|html|csv|xlsx?|ya?ml|log)$/i.test(normalized)) return false;
  if (/^[A-Z0-9_./:@{}=+-]+$/.test(normalized)) return false;
  return true;
}

function callName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function propertyName(node: ts.PropertyName) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function isVisibleObjectField(file: string, name: string) {
  const isExtensionCopy = file.endsWith("/app/extensions.ts")
    || file.endsWith("/app/enablement.ts");
  const isPanelTabCopy = file.endsWith("/domains/session/panel/panel-tab-store.ts");
  return VISIBLE_OBJECT_FIELDS.has(name)
    || (isExtensionCopy && EXTENSION_MANIFEST_FIELDS.has(name))
    || (isPanelTabCopy && name === "label")
    || /(?:Error|Message|Notice|Status|Warning)$/.test(name);
}

type RenderedText = {
  node: ts.Node;
  text: string;
};

function renderedTexts(node: ts.Expression): RenderedText[] {
  const values: RenderedText[] = [];
  function visit(expression: ts.Expression) {
    if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      values.push({ node: expression, text: expression.text });
    } else if (ts.isTemplateExpression(expression)) {
      values.push({ node: expression.head, text: expression.head.text });
      for (const span of expression.templateSpans) {
        values.push({ node: span.literal, text: span.literal.text });
      }
    } else if (ts.isConditionalExpression(expression)) {
      visit(expression.whenTrue);
      visit(expression.whenFalse);
    } else if (ts.isParenthesizedExpression(expression)) {
      visit(expression.expression);
    } else if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
      visit(expression.expression);
    } else if (ts.isBinaryExpression(expression)) {
      const visibleOperators = new Set([
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ]);
      if (visibleOperators.has(expression.operatorToken.kind)) {
        visit(expression.left);
        visit(expression.right);
      }
    }
  }
  visit(node);
  return values;
}

function scanFile(file: string): Violation[] {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  function record(node: ts.Node, kind: string, text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!isVisibleEnglish(normalized)) return;
    const location = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({
      file: path.relative(SOURCE_ROOT, file),
      line: location.line + 1,
      kind,
      text: normalized,
    });
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      record(node, "JSX 文本", node.text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (VISIBLE_ATTRIBUTES.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          record(node.initializer, `属性 ${name}`, node.initializer.text);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          for (const rendered of renderedTexts(node.initializer.expression)) {
            record(rendered.node, `属性 ${name}`, rendered.text);
          }
        }
      }
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      for (const rendered of renderedTexts(node.expression)) {
        record(rendered.node, "JSX 表达式", rendered.text);
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && isVisibleObjectField(file, name)) {
        for (const rendered of renderedTexts(node.initializer)) {
          if (name.endsWith("Status") && /^[a-z][a-z0-9_-]*$/.test(rendered.text.trim())) continue;
          if (name === "message" && /^[a-z][a-z0-9_.:-]*$/.test(rendered.text.trim())) continue;
          record(rendered.node, `字段 ${name}`, rendered.text);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const isToast = ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "toast";
      const isVisibleAttributeWrite = ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "setAttribute"
        && ts.isStringLiteralLike(node.arguments[0])
        && VISIBLE_ATTRIBUTES.has(node.arguments[0].text);
      if ((name && VISIBLE_CALLS.has(name)) || isToast) {
        const firstArgument = node.arguments[0];
        if (firstArgument) {
          for (const rendered of renderedTexts(firstArgument)) {
            record(rendered.node, `调用 ${name ?? "toast"}`, rendered.text);
          }
        }
      } else if (isVisibleAttributeWrite) {
        const value = node.arguments[1];
        if (value) {
          for (const rendered of renderedTexts(value)) {
            record(rendered.node, `动态属性 ${node.arguments[0].getText(source)}`, rendered.text);
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left)
      && (node.left.name.text === "textContent" || node.left.name.text === "innerText")
    ) {
      for (const rendered of renderedTexts(node.right)) {
        record(rendered.node, `动态文本 ${node.left.name.text}`, rendered.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

describe("FoxWork 源码可见文案", () => {
  test("界面源码不直接显示英文句子", () => {
    const violations = sourceFiles(SOURCE_ROOT).flatMap(scanFile);
    const sample = violations.slice(0, 250).map(
      (item) => `${item.file}:${item.line} [${item.kind}] ${item.text}`,
    );
    expect(sample, `发现 ${violations.length} 处英文界面文案`).toEqual([]);
  });

  test("动态生成的图片预览按钮使用中文", () => {
    const markdownSource = readFileSync(path.join(SOURCE_ROOT, "components/markdown/markdown.tsx"), "utf8");
    const markdownPrimitiveSource = readFileSync(path.join(SOURCE_ROOT, "components/markdown/markdown-primitive.ts"), "utf8");
    expect(markdownSource).not.toContain("Show full image");
    expect(markdownSource).not.toContain("Show less");
    expect(markdownSource).not.toContain('?? "Image"');
    expect(markdownPrimitiveSource).toContain("查看完整图片");
  });

  test("内置能力说明和配置入口不显示上游品牌或英文目录", () => {
    const controlSource = readFileSync(path.join(SOURCE_ROOT, "react-app/shell/control/control-provider.tsx"), "utf8");
    const mcpViewSource = readFileSync(path.join(SOURCE_ROOT, "react-app/domains/settings/pages/mcp-view.tsx"), "utf8");
    const skillCreatorSource = readFileSync(path.join(SOURCE_ROOT, "app/data/skill-creator.md"), "utf8");
    const paperConsumers = [
      "react-app/domains/session/voice/voice-panel.tsx",
      "react-app/domains/onboarding/welcome-page.tsx",
      "react-app/domains/cloud/den-signin-surface.tsx",
    ].map((file) => readFileSync(path.join(SOURCE_ROOT, file), "utf8"));
    const generatedConfigSources = [
      "react-app/domains/connections/store.ts",
      "react-app/domains/connections/provider-auth/store.ts",
      "react-app/domains/connections/provider-auth/cloud-provider-config.ts",
      "react-app/domains/settings/state/extensions-store.ts",
    ].map((file) => readFileSync(path.join(SOURCE_ROOT, file), "utf8"));

    expect(controlSource).not.toMatch(/OpenWork Cloud|Share sessions|AI model providers/);
    expect(controlSource).toContain('label: "模型"');
    expect(mcpViewSource).not.toContain("https://opencode.ai/docs");
    expect(skillCreatorSource).not.toMatch(/OpenWork behavior|extends OpenCode|# Skill Creator/);
    expect(skillCreatorSource).toContain("# 技能创建指南");
    expect(viteConfigSource).not.toMatch(/loadMigrationReleaseEnv|different-ai\/openwork/);
    expect(viteConfigSource).toContain("foxwork-sdk-user-messages");
    expect(desktopPoliciesSource).not.toContain("OpenCode");
    for (const source of generatedConfigSources) {
      expect(source).not.toContain("https://opencode.ai/config.json");
    }
    for (const source of paperConsumers) {
      expect(source).toContain('@openwork/ui/react/paper-grain-gradient');
      expect(source).not.toContain('from "@openwork/ui/react"');
    }
  });
});
