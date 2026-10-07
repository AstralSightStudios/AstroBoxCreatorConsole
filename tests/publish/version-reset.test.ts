import { describe, expect, test } from "bun:test";
import {
  DEFAULT_VERSION_RESET_OPTIONS,
  canOfferVersionReset,
  hasVersionResetSelection,
} from "../../app/logic/publish/version-reset";

const editRequest = {
  schema_version: 1 as const,
  mode: "edit" as const,
  original_id: "res",
  base_entry_digest: null,
  base_catalog_commit: null,
  client: null,
};

describe("version reset options", () => {
  test("offered when editing a listed resource from the catalog", () => {
    expect(canOfferVersionReset({ mode: "catalog" })).toBe(true);
  });

  test("offered when continuing a PR that edits a listed resource", () => {
    expect(
      canOfferVersionReset({
        mode: "in_progress",
        submission: { path: "tmp/a/b", request: editRequest },
      }),
    ).toBe(true);
  });

  test("not offered for new resources", () => {
    expect(canOfferVersionReset(null)).toBe(false);
    expect(
      canOfferVersionReset({
        mode: "in_progress",
        submission: { path: "tmp/a/b", request: { ...editRequest, mode: "create" } },
      }),
    ).toBe(false);
    expect(canOfferVersionReset({ mode: "in_progress" })).toBe(false);
  });

  test("nothing is selected by default", () => {
    expect(hasVersionResetSelection(DEFAULT_VERSION_RESET_OPTIONS)).toBe(false);
    expect(hasVersionResetSelection({ resetRatings: false, foldComments: true })).toBe(true);
  });
});
