import { describe, expect, test } from "bun:test";

import { resolveManagedModelsUrl } from "./embedded.js";

describe("managed OpenCode model catalog", () => {
  test("does not inject a model catalog by default", () => {
    expect(resolveManagedModelsUrl(undefined)).toBeUndefined();
    expect(resolveManagedModelsUrl("")).toBeUndefined();
  });

  test("accepts only an explicitly configured safe catalog URL", () => {
    expect(resolveManagedModelsUrl("  https://models.example.com/catalog  ")).toBe(
      "https://models.example.com/catalog",
    );
    expect(resolveManagedModelsUrl("http://127.0.0.1:8791/models")).toBe(
      "http://127.0.0.1:8791/models",
    );
  });

  test("rejects insecure remote, credentialed, and malformed URLs", () => {
    expect(resolveManagedModelsUrl("http://models.example.com/catalog")).toBeUndefined();
    expect(resolveManagedModelsUrl("https://user:secret@models.example.com/catalog")).toBeUndefined();
    expect(resolveManagedModelsUrl("not-a-url")).toBeUndefined();
  });
});
