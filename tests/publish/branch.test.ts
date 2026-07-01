import { describe, expect, test } from "bun:test";
import { MAIN_RESOURCE_BRANCH, toMainResourceRepo } from "../../app/logic/publish/branch";
import type { RepoInfo } from "../../app/logic/publish/github-actions";

describe("resource publish branch", () => {
  test("uses main for resource uploads while preserving the created repository default branch", () => {
    const repo: RepoInfo = {
      owner: "octocat",
      name: "astrobox-resource-demo",
      branch: "master",
      htmlUrl: "https://github.com/octocat/astrobox-resource-demo",
    };

    expect(toMainResourceRepo(repo)).toEqual({
      owner: "octocat",
      name: "astrobox-resource-demo",
      branch: MAIN_RESOURCE_BRANCH,
      sourceBranch: "master",
      htmlUrl: "https://github.com/octocat/astrobox-resource-demo",
    });
  });

  test("preserves an already known source branch", () => {
    const repo: RepoInfo = {
      owner: "octocat",
      name: "astrobox-resource-demo",
      branch: "main",
      sourceBranch: "master",
    };

    expect(toMainResourceRepo(repo)).toMatchObject({
      branch: MAIN_RESOURCE_BRANCH,
      sourceBranch: "master",
    });
  });

  test("falls back to main when GitHub does not report a default branch", () => {
    const repo = {
      owner: "octocat",
      name: "astrobox-resource-demo",
      branch: "",
    } satisfies RepoInfo;

    expect(toMainResourceRepo(repo)).toMatchObject({
      branch: MAIN_RESOURCE_BRANCH,
      sourceBranch: MAIN_RESOURCE_BRANCH,
    });
  });
});
