export type AccessibilityNode = {
  nodeId: string;
  parentId?: string;
  childIds?: string[];
  ignored?: boolean;
  backendDOMNodeId?: number;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
};

export type BrowserSnapshotNode = {
  uid: number;
  role: string;
  name: string;
  value?: string;
  backendNodeId: number;
  children?: BrowserSnapshotNode[];
};

export type BrowserAccessibilitySnapshot = {
  nodes: BrowserSnapshotNode[];
  byUid: Map<number, BrowserSnapshotNode>;
  text: string;
};

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function uniqueIds(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []).filter(Boolean))];
}

export function buildAccessibilitySnapshot(axNodes: AccessibilityNode[]): BrowserAccessibilitySnapshot {
  if (axNodes.length === 0) {
    return { nodes: [], byUid: new Map(), text: "（页面为空）" };
  }

  const nodesById = new Map(axNodes.map((node) => [node.nodeId, node]));
  const childrenByParent = new Map<string, string[]>();
  for (const node of axNodes) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.nodeId);
    childrenByParent.set(node.parentId, children);
  }

  let nextUid = 1;
  const byUid = new Map<number, BrowserSnapshotNode>();
  const visited = new Set<string>();

  function walk(nodeId: string): BrowserSnapshotNode[] {
    if (visited.has(nodeId)) return [];
    const node = nodesById.get(nodeId);
    if (!node) return [];
    visited.add(nodeId);

    const children = uniqueIds(node.childIds, childrenByParent.get(nodeId)).flatMap(walk);
    const role = textValue(node.role?.value);
    const name = textValue(node.name?.value);
    const value = textValue(node.value?.value);
    const hasValue = node.value?.value !== undefined && value.length > 0;
    const shouldFlatten = (node.ignored && !name && !hasValue)
      || ((!role || role === "generic" || role === "none") && !name && !hasValue);
    if (shouldFlatten) return children;

    const snapshotNode: BrowserSnapshotNode = {
      uid: nextUid,
      role: role || "unknown",
      name,
      ...(hasValue ? { value } : {}),
      backendNodeId: node.backendDOMNodeId ?? 0,
      ...(children.length > 0 ? { children } : {}),
    };
    nextUid += 1;
    byUid.set(snapshotNode.uid, snapshotNode);
    return [snapshotNode];
  }

  const rootIds = uniqueIds(
    axNodes.filter((node) => textValue(node.role?.value) === "RootWebArea").map((node) => node.nodeId),
    axNodes.filter((node) => !node.parentId || !nodesById.has(node.parentId)).map((node) => node.nodeId),
  );
  const roots = rootIds.flatMap(walk);
  for (const node of axNodes) {
    if (!visited.has(node.nodeId)) roots.push(...walk(node.nodeId));
  }

  return {
    nodes: roots,
    byUid,
    text: roots.length > 0 ? renderAccessibilityTree(roots) : "（页面为空）",
  };
}

export function renderAccessibilityTree(nodes: BrowserSnapshotNode[], indent = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const parts = [`[${node.uid}]`, node.role];
    if (node.name) parts.push(JSON.stringify(node.name));
    if (node.value) parts.push(`value=${JSON.stringify(node.value)}`);
    lines.push(`${"  ".repeat(indent)}${parts.join(" ")}`);
    if (node.children) lines.push(renderAccessibilityTree(node.children, indent + 1));
  }
  return lines.filter(Boolean).join("\n");
}

export function serializeBrowserEvaluationValue(this: unknown): unknown {
  const seen = new WeakSet<object>();

  function visit(value: unknown, depth: number): unknown {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "undefined") return "（未定义）";
    if (typeof value === "bigint") return `${value.toString()}n`;
    if (typeof value === "symbol" || typeof value === "function") return String(value);
    if (depth > 6) return "（内容过深，已截断）";
    if (seen.has(value)) return "（循环引用）";
    seen.add(value);

    const nodeType = Reflect.get(value, "nodeType");
    const nodeName = Reflect.get(value, "nodeName");
    if (typeof nodeType === "number" && typeof nodeName === "string") {
      const attributesValue = Reflect.get(value, "attributes");
      const attributes: Record<string, string> = {};
      if (attributesValue && typeof attributesValue === "object") {
        const iterable = attributesValue as Iterable<unknown>;
        for (const attribute of Array.from(iterable).slice(0, 50)) {
          if (!attribute || typeof attribute !== "object") continue;
          const name = Reflect.get(attribute, "name");
          const attributeValue = Reflect.get(attribute, "value");
          if (typeof name === "string" && typeof attributeValue === "string") attributes[name] = attributeValue;
        }
      }
      const textContent = Reflect.get(value, "textContent");
      const result: Record<string, unknown> = {
        type: nodeType === 1 ? "element" : "node",
        nodeName,
        text: typeof textContent === "string" ? textContent.replace(/\s+/g, " ").trim().slice(0, 3000) : "",
      };
      if (Object.keys(attributes).length > 0) result.attributes = attributes;
      for (const key of ["value", "href", "checked", "disabled"]) {
        const property = Reflect.get(value, key);
        if (typeof property === "string" || typeof property === "number" || typeof property === "boolean") {
          result[key] = property;
        }
      }
      return result;
    }

    if (Array.isArray(value)) return value.slice(0, 100).map((item) => visit(item, depth + 1));

    const length = Reflect.get(value, "length");
    const item = Reflect.get(value, "item");
    if (typeof length === "number" && Number.isInteger(length) && length >= 0 && typeof item === "function") {
      return Array.from({ length: Math.min(length, 100) }, (_, index) => visit(Reflect.apply(item, value, [index]), depth + 1));
    }

    const entries: Record<string, unknown> = {};
    for (const key of Object.keys(value).slice(0, 100)) {
      try {
        entries[key] = visit(Reflect.get(value, key), depth + 1);
      } catch {
        entries[key] = "（无法读取）";
      }
    }
    return entries;
  }

  return visit(this, 0);
}

export function formatBrowserEvaluationResult(value: unknown): string {
  if (value === undefined) return "（未定义）";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
