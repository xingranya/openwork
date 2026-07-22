import { describe, expect, test } from "bun:test";

import { resolveManagedModelsEnvironment, resolveManagedModelsUrl } from "./managed-models.js";

describe("managed OpenCode model catalog", () => {
  test("does not inject a model catalog by default", () => {
    expect(resolveManagedModelsUrl(undefined)).toBeUndefined();
    expect(resolveManagedModelsUrl("")).toBeUndefined();
    expect(resolveManagedModelsEnvironment(undefined)).toEqual({
      OPENCODE_MODELS_URL: undefined,
      OPENCODE_DISABLE_MODELS_FETCH: "1",
    });
  });

  test("accepts only an explicitly configured safe catalog URL", () => {
    expect(resolveManagedModelsUrl("  https://models.example.com/catalog  ")).toBe(
      "https://models.example.com/catalog",
    );
    expect(resolveManagedModelsUrl("http://127.0.0.1:8791/models")).toBe(
      "http://127.0.0.1:8791/models",
    );
    expect(resolveManagedModelsEnvironment("https://models.example.com/catalog")).toEqual({
      OPENCODE_MODELS_URL: "https://models.example.com/catalog",
      OPENCODE_DISABLE_MODELS_FETCH: undefined,
    });
  });

  test("rejects insecure remote, credentialed, and malformed URLs", () => {
    expect(resolveManagedModelsUrl("http://models.example.com/catalog")).toBeUndefined();
    expect(resolveManagedModelsUrl("https://user:secret@models.example.com/catalog")).toBeUndefined();
    expect(resolveManagedModelsUrl("not-a-url")).toBeUndefined();
  });
});
