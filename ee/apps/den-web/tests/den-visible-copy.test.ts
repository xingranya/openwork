import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const APP_ROOT = fileURLToPath(new URL("../app", import.meta.url));
const VISIBLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "title",
  "tooltip",
]);
const TECHNICAL_LABELS = new Set([
  "API",
  "API Key",
  "API keys",
  "FoxWork",
  "FoxWork MCP",
  "GitHub",
  "Google Workspace",
  "MCP",
  "Microsoft 365",
  "OAuth",
  "SCIM",
  "Skills",
  "SSO",
  "SAML",
  "OIDC",
  "Polar",
  "Stripe",
  "Telegram",
  "URL",
  "@BotFather",
  "name@company.com",
  "123456789:AA…",
  "1234567890-abc.apps.googleusercontent.com",
  "GOCSPX-…",
  "notion",
  "records.read records.write",
  "sk-...",
  "example.com",
  "-----BEGIN CERTIFICATE-----",
  "openid email profile",
  "client_secret_basic",
  "client_secret_post",
  "azure-foundry",
  "gpt-5.2 my-deployment-name",
  "company.com partner.org",
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
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

function isVisibleEnglish(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2}/.test(normalized) || /[\u3400-\u9fff]/.test(normalized)) return false;
  if (TECHNICAL_LABELS.has(normalized)) return false;
  if (/^(?:https?:\/\/|\.?\.?\/|~\/|[A-Za-z]:\\|\.)/.test(normalized)) return false;
  if (/^[\w@./:+-]+\.(?:jsonc?|tsx?|jsx?|md|css|html|csv|xlsx?|ya?ml|log)$/i.test(normalized)) return false;
  if (/^[A-Z0-9_./:@{}=+*-]+$/.test(normalized)) return false;
  return true;
}

function renderedStringLiterals(node: ts.Expression): ts.StringLiteralLike[] {
  const values: ts.StringLiteralLike[] = [];
  function visit(expression: ts.Expression) {
    if (ts.isStringLiteralLike(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      values.push(expression);
    } else if (ts.isConditionalExpression(expression)) {
      visit(expression.whenTrue);
      visit(expression.whenFalse);
    } else if (ts.isParenthesizedExpression(expression)) {
      visit(expression.expression);
    } else if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
      visit(expression.expression);
    } else if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      visit(expression.left);
      visit(expression.right);
    }
  }
  visit(node);
  return values;
}

function propertyName(node: ts.PropertyName) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function callName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
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
      file: path.relative(APP_ROOT, file),
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
          for (const literal of renderedStringLiterals(node.initializer.expression)) {
            record(literal, `属性 ${name}`, literal.text);
          }
        }
      }
    } else if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) {
      for (const literal of renderedStringLiterals(node.expression)) {
        record(literal, "JSX 表达式", literal.text);
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && VISIBLE_ATTRIBUTES.has(name)) {
        for (const literal of renderedStringLiterals(node.initializer)) {
          record(literal, `字段 ${name}`, literal.text);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const isVisibleCall = name && (
        /^(?:alert|confirm|prompt)$/.test(name)
        || /^set[A-Za-z]*(?:Error|Message|Notice|Status|Warning)$/.test(name)
      );
      if (isVisibleCall) {
        const firstArgument = node.arguments[0];
        if (firstArgument) {
          for (const literal of renderedStringLiterals(firstArgument)) {
            record(literal, `调用 ${name}`, literal.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

describe("Den 简体中文界面契约", () => {
  test("员工页面和管理员后台不直接显示英文句子", () => {
    const violations = sourceFiles(APP_ROOT).flatMap(scanFile);
    const sample = violations.slice(0, 60).map(
      (item) => `${item.file}:${item.line} [${item.kind}] ${item.text}`,
    );
    expect(sample, `发现 ${violations.length} 处英文界面文案`).toEqual([]);
  });
});
