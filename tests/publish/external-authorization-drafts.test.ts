import { describe, expect, test } from "bun:test";
import {
  clearExternalAuthorizationDraft,
  getExternalAuthorizationDraft,
  listExternalAuthorizationDrafts,
  setExternalAuthorizationDraft,
  subscribeExternalAuthorizationDrafts,
} from "../../app/logic/publish/external-authorization-drafts";

const base = {
  authorizationUrl: "https://shop.example.com/astrobox/authorize",
  issuer: "https://shop.example.com",
  publicKey: "-----BEGIN PUBLIC KEY-----\nX\n-----END PUBLIC KEY-----",
};

describe("external authorization drafts", () => {
  test("stores drafts per resource/device and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeExternalAuthorizationDrafts(() => {
      notified += 1;
    });

    setExternalAuthorizationDraft({ ...base, resourceId: "res", deviceId: "a" });
    setExternalAuthorizationDraft({ ...base, resourceId: "res", deviceId: "b" });
    setExternalAuthorizationDraft({ ...base, resourceId: "other", deviceId: "a" });

    expect(getExternalAuthorizationDraft("res", "a")?.deviceId).toBe("a");
    expect(listExternalAuthorizationDrafts("res").map((d) => d.deviceId).sort()).toEqual(["a", "b"]);

    clearExternalAuthorizationDraft("res", "a");
    expect(getExternalAuthorizationDraft("res", "a")).toBeNull();
    expect(listExternalAuthorizationDrafts("res")).toHaveLength(1);
    expect(notified).toBe(4);

    unsubscribe();
    clearExternalAuthorizationDraft("res", "b");
    expect(notified).toBe(4);
  });
});
