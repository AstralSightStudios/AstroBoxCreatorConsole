import type { CreateCdkBatchBody, CreateCdkBatchResponse } from "~/api/astrobox/order";

export interface ActivationCodeDraft {
  resourceId: string;
  resourceName: string;
  deviceId: string;
  deviceName?: string;
  code: string;
  content: string;
}

export function buildActivationCodeMessage(input: {
  resourceName: string;
  deviceId: string;
  deviceName?: string;
  code: string;
}) {
  return [
    `你好，以下是《${input.resourceName}》的激活码：`,
    `适用设备：${input.deviceName?.trim() || input.deviceId}`,
    `激活码：${input.code}`,
    "请在 AstroBox 客户端兑换解锁。",
  ].join("\n");
}

export async function generateActivationCodeDraft(
  input: { resourceId: string; resourceName: string; deviceId: string; deviceName?: string },
  createBatch: (body: CreateCdkBatchBody) => Promise<CreateCdkBatchResponse>,
): Promise<ActivationCodeDraft> {
  if (!input.resourceId.trim()) throw new Error("请先选择资源");
  if (!input.deviceId.trim()) throw new Error("请选择或填写设备");

  const result = await createBatch({
    resourceId: input.resourceId,
    deviceId: input.deviceId.trim(),
    quantity: 1,
  });
  const code = result.codes[0];
  if (result.codes.length !== 1 || !code?.trim()) {
    throw new Error("未能获取单个激活码，请在激活码管理中确认生成结果");
  }

  const draft = {
    ...input,
    deviceId: input.deviceId.trim(),
    deviceName: input.deviceName?.trim() || input.deviceId.trim(),
    code,
  };
  return { ...draft, content: buildActivationCodeMessage(draft) };
}

export async function sendActivationCodeMessage(
  input: { userId: string; code: string; content: string },
  sendMessage: (userId: string, content: string) => Promise<void>,
) {
  if (!input.userId.trim()) throw new Error("缺少收件人");
  const content = input.content.trim();
  if (!input.code.trim() || !content.includes(input.code)) {
    throw new Error("消息中需保留完整激活码");
  }
  await sendMessage(input.userId, content);
}
