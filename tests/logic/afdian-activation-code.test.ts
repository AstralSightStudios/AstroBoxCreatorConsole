import { describe, expect, test } from "bun:test";
import {
  buildActivationCodeMessage,
  generateActivationCodeDraft,
  sendActivationCodeMessage,
} from "../../app/logic/afdian/activation-code";
import type { CreateCdkBatchBody } from "../../app/api/astrobox/order";

const resource = { resourceId: "resource-1", resourceName: "测试资源", deviceId: "device-1" };

function batch(codes = ["CDK-ONE"]) {
  return { resourceId: resource.resourceId, deviceId: resource.deviceId, batchId: "batch-1", codes };
}

describe("爱发电激活码私信", () => {
  test("默认文案包含资源、设备、实际激活码与兑换提示", () => {
    expect(buildActivationCodeMessage({ ...resource, code: "CDK-ONE" })).toBe([
      "你好，以下是《测试资源》的激活码：",
      "适用设备：device-1",
      "激活码：CDK-ONE",
      "请在 AstroBox 客户端兑换解锁。",
    ].join("\n"));
  });

  test("仅申请一个激活码，生成阶段不会发送私信", async () => {
    const requests: CreateCdkBatchBody[] = [];
    const draft = await generateActivationCodeDraft({ ...resource, deviceId: " device-1 " }, async (body) => {
      requests.push(body);
      return batch();
    });
    expect(requests).toEqual([{ resourceId: "resource-1", deviceId: "device-1", quantity: 1 }]);
    expect(draft.code).toBe("CDK-ONE");
    expect(draft.content).toContain("激活码：CDK-ONE");
  });

  test("文案优先使用设备显示名称，缺少名称时回退到设备代号", () => {
    expect(buildActivationCodeMessage({ ...resource, deviceName: " 小米手环 9 ", code: "CDK-ONE" }))
      .toContain("适用设备：小米手环 9");
    expect(buildActivationCodeMessage({ ...resource, deviceName: " ", code: "CDK-ONE" }))
      .toContain("适用设备：device-1");
  });

  test("生成草稿保留显示名称，生成接口仍提交原始设备 ID", async () => {
    const requests: CreateCdkBatchBody[] = [];
    const draft = await generateActivationCodeDraft(
      { ...resource, deviceName: " 小米手环 9 " },
      async (body) => { requests.push(body); return batch(); },
    );
    expect(requests).toEqual([{ resourceId: "resource-1", deviceId: "device-1", quantity: 1 }]);
    expect(draft.deviceId).toBe("device-1");
    expect(draft.deviceName).toBe("小米手环 9");
    expect(draft.content).toContain("适用设备：小米手环 9");
    expect(draft.content).not.toContain("device-1");
  });

  test("缺少资源或设备时不调用生成接口", async () => {
    let calls = 0;
    const create = async () => { calls += 1; return batch(); };
    await expect(generateActivationCodeDraft({ ...resource, resourceId: " " }, create)).rejects.toThrow("请先选择资源");
    await expect(generateActivationCodeDraft({ ...resource, deviceId: " " }, create)).rejects.toThrow("请选择或填写设备");
    expect(calls).toBe(0);
  });

  test("生成失败或未返回单个有效激活码时不产生可发送草稿", async () => {
    await expect(generateActivationCodeDraft(resource, async () => { throw new Error("生成失败"); })).rejects.toThrow("生成失败");
    for (const codes of [[], [""], [" "], ["CDK-ONE", "CDK-TWO"]]) {
      await expect(generateActivationCodeDraft(resource, async () => batch(codes))).rejects.toThrow("未能获取单个激活码");
    }
  });

  test("发送失败后沿用同一个码和编辑文案，始终发送给固定收件人", async () => {
    let generateCalls = 0;
    const draft = await generateActivationCodeDraft(resource, async () => {
      generateCalls += 1;
      return batch();
    });
    const request = { userId: "original-user", code: draft.code, content: ` 已为你准备好：${draft.code} ` };
    const sent: { userId: string; content: string }[] = [];
    const send = async (userId: string, content: string) => {
      sent.push({ userId, content });
      if (sent.length === 1) throw new Error("网络不可用");
    };
    await expect(sendActivationCodeMessage(request, send)).rejects.toThrow("网络不可用");
    await sendActivationCodeMessage(request, send);
    expect(generateCalls).toBe(1);
    expect(request.content).toBe(" 已为你准备好：CDK-ONE ");
    expect(sent).toEqual([
      { userId: "original-user", content: "已为你准备好：CDK-ONE" },
      { userId: "original-user", content: "已为你准备好：CDK-ONE" },
    ]);
  });

  test("缺少收件人、空文案或删除实际激活码时禁止发送", async () => {
    let calls = 0;
    const send = async () => { calls += 1; };
    await expect(sendActivationCodeMessage({ userId: "", code: "CDK-ONE", content: "CDK-ONE" }, send)).rejects.toThrow("缺少收件人");
    for (const content of ["", " ", "激活码：CDK-TWO", "激活码：CDK-ON"]) {
      await expect(sendActivationCodeMessage({ userId: "user", code: "CDK-ONE", content }, send)).rejects.toThrow("消息中需保留完整激活码");
    }
    await expect(sendActivationCodeMessage({ userId: "user", code: "", content: "你好" }, send)).rejects.toThrow("消息中需保留完整激活码");
    expect(calls).toBe(0);
  });
});
