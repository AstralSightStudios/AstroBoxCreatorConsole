import { describe, expect, test } from "bun:test";
import { rawGithubUrlToApiUrl } from "../../app/logic/github-raw";

describe("rawGithubUrlToApiUrl", () => {
  test("单段 ref（提交 SHA / 分支名）", () => {
    expect(
      rawGithubUrlToApiUrl(
        "https://raw.githubusercontent.com/owner/repo/abc1234/icon.png",
      ),
    ).toBe(
      "https://api.github.com/repos/owner/repo/contents/icon.png?ref=abc1234",
    );
    expect(
      rawGithubUrlToApiUrl(
        "https://raw.githubusercontent.com/owner/repo/main/dist/icon.png",
      ),
    ).toBe(
      "https://api.github.com/repos/owner/repo/contents/dist/icon.png?ref=main",
    );
  });

  test("插件市场的 refs/heads/{branch} 形式", () => {
    expect(
      rawGithubUrlToApiUrl(
        "https://raw.githubusercontent.com/AstralSightStudios/AstroBox-NG-Plugin-MiFitnessLogReader/refs/heads/main/dist/icon.png",
      ),
    ).toBe(
      "https://api.github.com/repos/AstralSightStudios/AstroBox-NG-Plugin-MiFitnessLogReader/contents/dist/icon.png?ref=refs%2Fheads%2Fmain",
    );
  });

  test("插件市场的 refs/heads/{branch} + 多级 folder", () => {
    expect(
      rawGithubUrlToApiUrl(
        "https://raw.githubusercontent.com/zaona/class-loop/refs/heads/master/plugins/astrobox-loop-import/dist/icon.png",
      ),
    ).toBe(
      "https://api.github.com/repos/zaona/class-loop/contents/plugins/astrobox-loop-import/dist/icon.png?ref=refs%2Fheads%2Fmaster",
    );
  });

  test("非 raw 域名与片段不足时返回 null", () => {
    expect(rawGithubUrlToApiUrl("https://example.com/a/b/c/d")).toBeNull();
    expect(
      rawGithubUrlToApiUrl("https://raw.githubusercontent.com/owner/repo/main"),
    ).toBeNull();
  });
});