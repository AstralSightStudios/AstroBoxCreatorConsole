import { describe, expect, test } from "bun:test";
import {
  normalizeWatchfaceIdInput,
  replaceWatchfaceIdInFile,
  validateWatchfaceIdFormat,
} from "../../app/logic/publish/watchface-id";

describe("watchface ID", () => {
  test("validates and normalizes the required format", () => {
    expect(validateWatchfaceIdFormat("979812345678")).toBeNull();
    expect(validateWatchfaceIdFormat("979712345678")).toContain("9798");
    expect(validateWatchfaceIdFormat("97981234")).toContain("12");
    expect(normalizeWatchfaceIdInput("97a98-123456789")).toBe("979812345678");
  });

  test("writes the ID at byte offset 40 without mutating the source", async () => {
    const source = new File([new Uint8Array(64).fill(65)], "face.bin");
    const updated = await replaceWatchfaceIdInFile(source, "979812345678");
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const updatedBytes = new Uint8Array(await updated.arrayBuffer());

    expect(new TextDecoder().decode(updatedBytes.slice(40, 52))).toBe("979812345678");
    expect(sourceBytes[40]).toBe(65);
  });

  test("rejects files too short to contain the ID", async () => {
    await expect(
      replaceWatchfaceIdInFile(new File([new Uint8Array(51)], "short.bin"), "979812345678"),
    ).rejects.toThrow("太小");
  });
});
