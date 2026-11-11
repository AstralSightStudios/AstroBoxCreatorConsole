import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ENCRYPT_TAB,
  ENCRYPT_TABS,
  availableEncryptTabs,
  resolveEncryptTab,
} from "../../app/logic/encrypt-tabs";

describe("availableEncryptTabs", () => {
  test("非会员只看到付费平台与加密文件", () => {
    expect(availableEncryptTabs(false).map((tab) => tab.key)).toEqual(["platform", "files"]);
  });

  test("会员看到全部页签，且顺序与定义一致", () => {
    expect(availableEncryptTabs(true)).toEqual([...ENCRYPT_TABS]);
  });

  test("页签 key 与标题都不重复", () => {
    expect(new Set(ENCRYPT_TABS.map((tab) => tab.key)).size).toBe(ENCRYPT_TABS.length);
    expect(new Set(ENCRYPT_TABS.map((tab) => tab.label)).size).toBe(ENCRYPT_TABS.length);
  });

  test("默认页签对所有人可见", () => {
    expect(availableEncryptTabs(false).map((tab) => tab.key)).toContain(DEFAULT_ENCRYPT_TAB);
  });
});

describe("resolveEncryptTab", () => {
  test("合法页签原样返回", () => {
    expect(resolveEncryptTab("cdk", true)).toBe("cdk");
    expect(resolveEncryptTab("files", false)).toBe("files");
  });

  test("缺省或未知值回到默认页签", () => {
    expect(resolveEncryptTab(null, true)).toBe(DEFAULT_ENCRYPT_TAB);
    expect(resolveEncryptTab(undefined, true)).toBe(DEFAULT_ENCRYPT_TAB);
    expect(resolveEncryptTab("", true)).toBe(DEFAULT_ENCRYPT_TAB);
    expect(resolveEncryptTab("nope", true)).toBe(DEFAULT_ENCRYPT_TAB);
  });

  test("非会员打开会员页签的链接（分享 / 会员过期）不会停在看不见的页签上", () => {
    for (const tab of ENCRYPT_TABS.filter((item) => item.vipOnly)) {
      expect(resolveEncryptTab(tab.key, false)).toBe(DEFAULT_ENCRYPT_TAB);
    }
  });
});
