import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Select,
  Spinner,
  Table,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  ArrowsClockwiseIcon,
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  PlusIcon,
  TicketIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createCdkBatch,
  listSellerCdks,
  type CdkStatus,
} from "~/api/astrobox/order";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";
import { SectionCard } from "~/routes/resource/publish/components/shared";

async function copyToClipboard(text: string, successMessage = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (err) {
    toast.error("复制失败：" + ((err as Error)?.message || "未知错误"));
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const CDK_STATUS_META: Record<CdkStatus, { label: string; color: "green" | "blue" }> =
  {
    available: { label: "未使用", color: "green" },
    redeemed: { label: "已兑换", color: "blue" },
  };

/** CDK 管理：批量生成兑换码并查看使用状态。 */
export function CdkManager() {
const queryClient = useQueryClient();
const [resourceId, setResourceId] = useState("");
const [deviceId, setDeviceId] = useState("");
const [quantity, setQuantity] = useState("10");
const [statusFilter, setStatusFilter] = useState<"all" | CdkStatus>("all");
const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);

const {
  data: ownedResources = [],
  isLoading: resourcesLoading,
  error: resourcesErrorRaw,
} = useQuery({
  queryKey: ["ownedCatalogResources"],
  queryFn: loadOwnedCatalogResourcesForCurrentUser,
});

const resourcesError = resourcesErrorRaw
  ? (resourcesErrorRaw as Error).message || "加载失败"
  : "";

const selectedResource = useMemo(
  () => ownedResources.find((item) => item.entry.id === resourceId),
  [ownedResources, resourceId],
);

const deviceOptions = useMemo(() => {
  if (!selectedResource) return [] as string[];
  return selectedResource.entry.devices
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}, [selectedResource]);

// 切换资源后，把设备选择重置到该资源的第一个可用设备
useEffect(() => {
  setDeviceId((prev) =>
    deviceOptions.includes(prev) ? prev : deviceOptions[0] ?? "",
  );
  setGeneratedCodes([]);
}, [resourceId, deviceOptions]);

const {
  data: cdks = [],
  isLoading: cdksLoading,
  error: cdksErrorRaw,
  refetch: refetchCdks,
  isFetching: cdksFetching,
} = useQuery({
  queryKey: ["sellerCdks", resourceId, statusFilter],
  queryFn: () =>
    listSellerCdks({
      resourceId: resourceId || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 500,
    }),
  enabled: Boolean(resourceId),
});

const cdksError = cdksErrorRaw
  ? (cdksErrorRaw as Error).message || "加载失败"
  : "";

const generateMutation = useMutation({
  mutationFn: (body: {
    resourceId: string;
    deviceId: string;
    quantity: number;
  }) => createCdkBatch(body),
  onSuccess: (res) => {
    setGeneratedCodes(res.codes);
    toast.success(`已生成 ${res.codes.length} 个 CDK`);
    queryClient.invalidateQueries({ queryKey: ["sellerCdks", resourceId] });
  },
  onError: (err) => {
    toast.error((err as Error)?.message || "生成失败");
  },
});

const handleGenerate = () => {
  if (!resourceId) {
    toast.error("请先选择资源");
    return;
  }
  if (!deviceId) {
    toast.error("请选择或填写设备");
    return;
  }
  const qty = Number.parseInt(quantity, 10);
  if (!Number.isFinite(qty) || qty < 1) {
    toast.error("数量需为不小于 1 的整数");
    return;
  }
  if (qty > 200) {
    toast.error("单次最多生成 200 个");
    return;
  }
  generateMutation.mutate({ resourceId, deviceId, quantity: qty });
};

const availableCodes = useMemo(
  () => cdks.filter((item) => item.status === "available").map((item) => item.code),
  [cdks],
);

return (
  <SectionCard
    title="CDK 激活码管理"
    description="为单个资源的指定设备批量生成 CDK，用户可在 AstroBox 客户端兑换解锁"
  >
    <div className="flex flex-col gap-4">
      {resourcesError && (
        <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
          <Callout.Icon>
            <WarningOctagonIcon size={16} weight="fill" />
          </Callout.Icon>
          <Callout.Text className="font-semibold">
            加载资源失败：{resourcesError}
          </Callout.Text>
        </Callout.Root>
      )}

      {resourcesLoading && (
        <div className="flex items-center gap-2 px-1 py-4 text-white/60">
          <Spinner size="2" />
          <span className="text-sm">正在加载资源列表...</span>
        </div>
      )}

      {!resourcesLoading && !resourcesError && ownedResources.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
          没有可管理的已发布资源（需先登录 GitHub 且有归属你的资源）。
        </div>
      )}

      {!resourcesLoading && ownedResources.length > 0 && (
        <>
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto] md:items-end">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">资源</span>
              <Select.Root value={resourceId} onValueChange={setResourceId}>
                <Select.Trigger placeholder="选择资源" className="w-full" />
                <Select.Content position="popper">
                  {ownedResources.map((item) => (
                    <Select.Item key={item.entry.id} value={item.entry.id}>
                      {item.entry.name || item.entry.id}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">设备</span>
              {deviceOptions.length > 0 ? (
                <Select.Root value={deviceId} onValueChange={setDeviceId}>
                  <Select.Trigger placeholder="选择设备" className="w-full" />
                  <Select.Content position="popper">
                    {deviceOptions.map((device) => (
                      <Select.Item key={device} value={device}>
                        {device}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              ) : (
                <TextField.Root
                  size="2"
                  placeholder="设备 ID"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  radius="large"
                />
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">数量（1-200）</span>
              <TextField.Root
                size="2"
                type="number"
                min={1}
                max={200}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                radius="large"
              />
            </label>

            <Button
              size="2"
              onClick={handleGenerate}
              disabled={generateMutation.isPending || !resourceId}
              className="max-md:mt-1"
            >
              {generateMutation.isPending ? (
                <Spinner size="2" />
              ) : (
                <>
                  <TicketIcon size={16} />
                  批量生成
                </>
              )}
            </Button>
          </div>

          {generatedCodes.length > 0 && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white">
                  本次生成 {generatedCodes.length} 个 CDK
                </span>
                <div className="flex gap-2">
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() =>
                      void copyToClipboard(
                        generatedCodes.join("\n"),
                        "已复制全部 CDK",
                      )
                    }
                  >
                    <CopyIcon size={14} />
                    复制全部
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() =>
                      downloadTextFile(
                        `cdk-${resourceId}-${deviceId}-${Date.now()}.txt`,
                        generatedCodes.join("\n"),
                      )
                    }
                  >
                    <DownloadSimpleIcon size={14} />
                    导出
                  </Button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg bg-black/30 p-2 font-mono-sarasa text-xs leading-6 text-white/80">
                {generatedCodes.map((code) => (
                  <div key={code} className="break-all">
                    {code}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white/80">已生成的 CDK</span>
            <Select.Root
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value as "all" | CdkStatus)
              }
            >
              <Select.Trigger />
              <Select.Content position="popper">
                <Select.Item value="all">全部状态</Select.Item>
                <Select.Item value="available">未使用</Select.Item>
                <Select.Item value="redeemed">已兑换</Select.Item>
              </Select.Content>
            </Select.Root>
            <Button
              size="1"
              variant="soft"
              color="gray"
              disabled={!resourceId || cdksFetching}
              onClick={() => void refetchCdks()}
            >
              {cdksFetching ? <Spinner size="1" /> : <ArrowsClockwiseIcon size={14} />}
              刷新
            </Button>
            {availableCodes.length > 0 && (
              <Button
                size="1"
                variant="soft"
                onClick={() =>
                  void copyToClipboard(
                    availableCodes.join("\n"),
                    `已复制 ${availableCodes.length} 个未使用 CDK`,
                  )
                }
              >
                <CopyIcon size={14} />
                复制未使用
              </Button>
            )}
          </div>

          {!resourceId && (
            <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
              选择资源后查看其 CDK。
            </div>
          )}

          {resourceId && cdksError && (
            <Callout.Root
              color="red"
              variant="soft"
              className="bg-transparent! p-3!"
            >
              <Callout.Icon>
                <WarningOctagonIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                加载 CDK 失败：{cdksError}
              </Callout.Text>
            </Callout.Root>
          )}

          {resourceId && cdksLoading && (
            <div className="flex items-center gap-2 px-1 py-4 text-white/60">
              <Spinner size="2" />
              <span className="text-sm">正在加载 CDK...</span>
            </div>
          )}

          {resourceId && !cdksLoading && !cdksError && cdks.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
              该资源还没有 CDK，使用上方表单生成。
            </div>
          )}

          {resourceId && !cdksLoading && !cdksError && cdks.length > 0 && (
            <div className="w-full overflow-x-auto">
              <Table.Root className="w-full min-w-150">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>CDK</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>兑换者</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>创建时间</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell className="w-16">
                      操作
                    </Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {cdks.map((item) => (
                    <Table.Row key={item.code}>
                      <Table.Cell>
                        <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono-sarasa text-xs text-white/85">
                          {item.code}
                        </code>
                      </Table.Cell>
                      <Table.Cell>{item.deviceId}</Table.Cell>
                      <Table.Cell>
                        <Badge color={CDK_STATUS_META[item.status].color} variant="soft">
                          {CDK_STATUS_META[item.status].label}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-xs text-white/60">
                          {item.redeemedByUserId || "--"}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-sm text-white/70">
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString()
                            : "--"}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          size="1"
                          variant="ghost"
                          onClick={() => void copyToClipboard(item.code)}
                        >
                          <CopyIcon size={14} />
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          )}
        </>
      )}
    </div>
  </SectionCard>
);
}
