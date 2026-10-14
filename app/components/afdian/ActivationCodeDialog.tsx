import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  Select,
  Spinner,
  Text,
  TextArea,
  TextField,
} from "~/components/ScaleAwareThemes";
import type { AfdianDialogUser } from "~/api/afdian-messages";
import { getAfdianErrorMessage } from "~/api/afdian-account";
import { createCdkBatch } from "~/api/astrobox/order";
import { useDisplayAccount } from "~/logic/account/store";
import { hasCreatorPlusOrAbove } from "~/logic/account/permissions";
import { loadDeviceNameMap } from "~/logic/devices/catalog";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";
import {
  generateActivationCodeDraft,
  sendActivationCodeMessage,
  type ActivationCodeDraft,
} from "~/logic/afdian/activation-code";

function getDeviceOptions(devices: string) {
  return Array.from(
    new Set(devices.split(";").map((item) => item.trim()).filter(Boolean)),
  );
}

export function ActivationCodeDialog({
  recipient,
  draft,
  sending,
  connected,
  onDraftChange,
  onClose,
  onSend,
}: {
  recipient: AfdianDialogUser;
  draft: ActivationCodeDraft | null;
  sending: boolean;
  connected: boolean;
  onDraftChange: (draft: ActivationCodeDraft) => void;
  onClose: () => void;
  onSend: (userId: string, content: string) => Promise<void>;
}) {
  const account = useDisplayAccount();
  const allowed = hasCreatorPlusOrAbove(account.plan);
  const queryClient = useQueryClient();
  const [resourceId, setResourceId] = useState(draft?.resourceId ?? "");
  const [deviceId, setDeviceId] = useState(draft?.deviceId ?? "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  // 下拉浮层挂载在对话框内，避免被缩放容器中的遮罩覆盖。
  const [selectContainer, setSelectContainer] = useState<HTMLDivElement | null>(null);
  const operationRef = useRef(false);
  const busy = generating || sending;
  const resourcesQuery = useQuery({
    queryKey: ["ownedCatalogResources"],
    queryFn: loadOwnedCatalogResourcesForCurrentUser,
    enabled: allowed && !draft,
  });
  const deviceNamesQuery = useQuery({
    queryKey: ["deviceNameMap"],
    queryFn: loadDeviceNameMap,
    enabled: allowed && !draft,
    staleTime: Infinity,
    retry: false,
  });
  const resources = resourcesQuery.data ?? [];
  const selectedResource = resources.find((item) => item.entry.id === resourceId);
  const deviceOptions = getDeviceOptions(selectedResource?.entry.devices ?? "");

  const selectResource = (id: string) => {
    setResourceId(id);
    const devices = getDeviceOptions(
      resources.find((item) => item.entry.id === id)?.entry.devices ?? "",
    );
    setDeviceId(devices[0] ?? "");
    setError("");
  };

  const generate = async () => {
    if (
      operationRef.current || busy || !allowed || !connected || draft || !selectedResource
    ) return;
    operationRef.current = true;
    setGenerating(true);
    setError("");
    try {
      const generated = await generateActivationCodeDraft(
        {
          resourceId,
          resourceName: selectedResource.entry.name || resourceId,
          deviceId,
          deviceName: deviceNamesQuery.data?.get(deviceId),
        },
        createCdkBatch,
      );
      onDraftChange(generated);
      void queryClient.invalidateQueries({ queryKey: ["sellerCdks", resourceId] });
    } catch (error) {
      setError(getAfdianErrorMessage(error, "激活码生成失败"));
    } finally {
      operationRef.current = false;
      setGenerating(false);
    }
  };

  const send = async () => {
    if (operationRef.current || busy || !allowed || !connected || !draft) return;
    operationRef.current = true;
    setError("");
    try {
      await sendActivationCodeMessage(
        { userId: recipient.userId, code: draft.code, content: draft.content },
        onSend,
      );
      onClose();
    } catch (error) {
      setError(getAfdianErrorMessage(error, "消息发送失败，请重试"));
    } finally {
      operationRef.current = false;
    }
  };

  const missingCode = Boolean(draft && !draft.content.includes(draft.code));

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy && !operationRef.current) onClose();
      }}
    >
      <Dialog.Content ref={setSelectContainer}>
        <Dialog.Title>发送激活码</Dialog.Title>
        <Dialog.Description size="2">
          收件人：{recipient.name}（{recipient.userId}）
        </Dialog.Description>
        <Flex direction="column" gap="4" mt="4">
          {!allowed && (
            <Callout.Root color="amber">
              <Callout.Text>CreatorPlus 或更高档位可生成并发送激活码。</Callout.Text>
            </Callout.Root>
          )}
          {!connected && (
            <Callout.Root color="amber">
              <Callout.Text>请重新登录爱发电后发送。</Callout.Text>
            </Callout.Root>
          )}
          {allowed && !draft && (
            <>
              {resourcesQuery.isLoading && (
                <Flex align="center" gap="2">
                  <Spinner />
                  <Text size="2">正在加载资源…</Text>
                </Flex>
              )}
              {resourcesQuery.isError && (
                <Callout.Root color="red">
                  <Callout.Text>
                    {getAfdianErrorMessage(resourcesQuery.error, "资源加载失败")}
                  </Callout.Text>
                  <Button
                    variant="soft"
                    size="1"
                    disabled={resourcesQuery.isFetching}
                    onClick={() => void resourcesQuery.refetch()}
                  >
                    重试
                  </Button>
                </Callout.Root>
              )}
              {resourcesQuery.isSuccess && resources.length === 0 && (
                <Text size="2" color="gray">
                  暂无可管理的已发布资源。
                </Text>
              )}
              <Flex direction="column" gap="2">
                <Text as="label" size="2" htmlFor="afdian-cdk-resource">
                  资源
                </Text>
                <Select.Root
                  value={resourceId}
                  onValueChange={selectResource}
                  disabled={busy || resourcesQuery.isError || !resources.length}
                >
                  <Select.Trigger id="afdian-cdk-resource" placeholder="选择资源" />
                  <Select.Content position="popper" container={selectContainer}>
                    {resources.map(({ entry }) => (
                      <Select.Item key={entry.id} value={entry.id}>
                        {entry.name || entry.id}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Flex direction="column" gap="2">
                <Text as="label" size="2" htmlFor="afdian-cdk-device">
                  设备
                </Text>
                {deviceOptions.length ? (
                  <Select.Root value={deviceId} onValueChange={setDeviceId} disabled={busy}>
                    <Select.Trigger id="afdian-cdk-device" placeholder="选择设备" />
                    <Select.Content position="popper" container={selectContainer}>
                      {deviceOptions.map((device) => (
                        <Select.Item key={device} value={device}>
                          {deviceNamesQuery.data?.get(device) || device}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                ) : (
                  <TextField.Root
                    id="afdian-cdk-device"
                    placeholder="设备 ID"
                    value={deviceId}
                    disabled={busy || !resourceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                  />
                )}
              </Flex>
            </>
          )}
          {draft && (
            <>
              <Text size="2">
                资源：{draft.resourceName}<br />设备：{draft.deviceName || draft.deviceId}
              </Text>
              <Flex direction="column" gap="2">
                <Text as="label" size="2" htmlFor="afdian-cdk-code">
                  激活码
                </Text>
                <TextField.Root id="afdian-cdk-code" value={draft.code} readOnly />
              </Flex>
              <Flex direction="column" gap="2">
                <Text as="label" size="2" htmlFor="afdian-cdk-content">
                  消息内容
                </Text>
                <TextArea
                  id="afdian-cdk-content"
                  rows={6}
                  value={draft.content}
                  disabled={busy}
                  onChange={(event) => {
                    onDraftChange({ ...draft, content: event.target.value });
                    setError("");
                  }}
                />
                {missingCode && (
                  <Text size="2" color="red">消息中需保留完整激活码。</Text>
                )}
              </Flex>
              <Text size="2" color="gray">
                关闭后，已生成的激活码仍可在激活码管理中查看。
              </Text>
            </>
          )}
          {error && (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Flex justify="end" gap="3" wrap="wrap">
            <Button
              variant="soft"
              color="gray"
              disabled={busy}
              onClick={() => {
                if (!operationRef.current) onClose();
              }}
            >
              关闭
            </Button>
            {draft ? (
              <Button
                disabled={busy || !allowed || !connected || missingCode}
                onClick={() => void send()}
              >
                {sending && <Spinner size="1" />}
                发送
              </Button>
            ) : (
              <Button
                disabled={busy || !allowed || !connected || !selectedResource || !deviceId.trim() || resourcesQuery.isError}
                onClick={() => void generate()}
              >
                {generating && <Spinner size="1" />}
                生成激活码
              </Button>
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
