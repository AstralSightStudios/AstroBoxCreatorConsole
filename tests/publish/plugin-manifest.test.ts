import { describe, expect, test } from "bun:test";
import { validatePluginManifest } from "../../app/logic/publish/plugin-manifest";

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "Example Plugin",
    icon: "icon.png",
    version: "1.0.0",
    description: "An example",
    author: "Example",
    website: "https://example.com",
    entry: "plugin.wasm",
    wasi_version: 2,
    api_level: 3,
    permissions: ["network"],
    additional_files: [],
    ...overrides,
  };
}

function hasError(result: ReturnType<typeof validatePluginManifest>) {
  return result.issues.some((issue) => issue.level === "error");
}

describe("plugin manifest validation", () => {
  test("accepts a complete manifest", () => {
    const result = validatePluginManifest(validManifest());
    expect(hasError(result)).toBe(false);
    expect(result.manifest?.name).toBe("Example Plugin");
  });

  test("accepts api_level 4 with wasi_version 2", () => {
    const result = validatePluginManifest(
      validManifest({ api_level: 4, wasi_version: 2 }),
    );
    expect(hasError(result)).toBe(false);
  });

  test("rejects unsupported api_level", () => {
    expect(hasError(validatePluginManifest(validManifest({ api_level: 5 })))).toBe(true);
  });

  test("warns but does not reject unusual wasi_version", () => {
    const result = validatePluginManifest(validManifest({ wasi_version: 1 }));
    expect(hasError(result)).toBe(false);
    expect(result.issues.some((issue) => issue.level === "warn")).toBe(true);
  });

  test("rejects missing required fields", () => {
    for (const key of [
      "name",
      "icon",
      "version",
      "description",
      "author",
      "website",
      "entry",
      "permissions",
    ]) {
      expect(hasError(validatePluginManifest(validManifest({ [key]: "" })))).toBe(true);
    }
  });

  test("rejects author object", () => {
    expect(
      hasError(validatePluginManifest(validManifest({ author: { name: "x" } }))),
    ).toBe(true);
  });

  test("rejects invalid website and non-wasm entry", () => {
    expect(hasError(validatePluginManifest(validManifest({ website: "example" })))).toBe(true);
    expect(hasError(validatePluginManifest(validManifest({ entry: "plugin.js" })))).toBe(true);
  });

  test("rejects unsafe file paths", () => {
    expect(hasError(validatePluginManifest(validManifest({ icon: "../icon.png" })))).toBe(true);
    expect(
      hasError(
        validatePluginManifest(
          validManifest({ additional_files: ["../secret.bin"] }),
        ),
      ),
    ).toBe(true);
  });

  test("does not compare version values", () => {
    const result = validatePluginManifest(validManifest({ version: "anything" }));
    expect(hasError(result)).toBe(false);
  });
});
