import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Spinner,
} from "~/components/ScaleAwareThemes";
import {
  CaretRightIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteSellerResourceFileKey,
  listSellerResourceFileKeys,
  type SellerResourceFileKey,
} from "~/api/astrobox/order";
import {
  loadOwnedCatalogResourcesForCurrentUser,
  type ResourceCatalogContext,
} from "~/logic/publish/resources";
import { SectionCard } from "~/routes/resource/publish/components/shared";

/**
 * 单个资源一次拉取的密钥映射上限。超过上限时页面上会提示
 * "可能还有更早的历史记录"，避免用户误以为列表已是全量。
 */
const FILE_KEY_LIST_LIMIT = 500;

/** 新到旧排序（createdAt 为 ISO 字符串，字典序即时间序）。 */
function newestFirst(a: SellerResourceFileKey, b: SellerResourceFileKey) {
  return a.createdAt < b.createdAt ? 1 : -1;
}

interface DeviceKeyGroup {
  deviceId: string;
  /** 该设备最新的一条映射，默认展示。 */
  latest: SellerResourceFileKey;
  /** 除最新外的历史映射，新到旧，折叠在"历史版本"里。 */
  history: SellerResourceFileKey[];
}

function groupItemsByDevice(items: SellerResourceFileKey[]): DeviceKeyGroup[] {
  const byDevice = new Map<string, SellerResourceFileKey[]>();
  for (const item of items) {
    const list = byDevice.get(item.deviceId);
    if (list) list.push(item);
    else byDevice.set(item.deviceId, [item]);
  }
  return Array.from(byDevice.values())
    .map((list) => {
      const sorted = [...list].sort(newestFirst);
      return {
        deviceId: sorted[0].deviceId,
        latest: sorted[0],
        history: sorted.slice(1),
      };
    })
    .sort((a, b) => newestFirst(a.latest, b.latest));
}

async function fetchEncryptedResources() {
  const ownedResources = await loadOwnedCatalogResourcesForCurrentUser().catch(
    () => [] as ResourceCatalogContext[],
  );
  if (ownedResources.length === 0) return [];

  const results = await Promise.allSettled(
    ownedResources.map(async (resource) => {
      const items = await listSellerResourceFileKeys({
        resourceId: resource.entry.id,
        limit: FILE_KEY_LIST_LIMIT,
      });
      return { resource, items };
    }),
  );

  return results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        resource: ResourceCatalogContext;
        items: SellerResourceFileKey[];
      }> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .filter((group) => group.items.length > 0);
}

type ResourceKeyGroup = {
  resource: ResourceCatalogContext;
  items: SellerResourceFileKey[];
};

interface EncryptedFilesCardProps {
  isVip: boolean;
}

/** 密钥条目操作列：删除按钮（带确认弹窗与进行中状态）。 */
function KeyEntryDeleteButton({
  entry,
  isDeleting,
  onDelete,
}: {
  entry: SellerResourceFileKey;
  isDeleting: boolean;
  onDelete: (entry: SellerResourceFileKey) => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>
        <Button size="2" variant="soft" color="red" disabled={isDeleting}>
          {isDeleting ? <Spinner size="2" /> : <TrashIcon size={16} />}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>删除密钥映射</AlertDialog.Title>
        <AlertDialog.Description size="2">
          确定要删除该加密文件的密钥映射吗？删除后已购买用户将无法解密该文件。
        </AlertDialog.Description>
        <div className="mt-4 flex justify-end gap-2">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              取消
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" onClick={() => onDelete(entry)}>
              确认删除
            </Button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/** 单条密钥映射行：哈希 + 创建时间 + 删除。 */
function KeyEntryRow({
  entry,
  badge,
  isDeleting,
  onDelete,
}: {
  entry: SellerResourceFileKey;
  badge?: string;
  isDeleting: boolean;
  onDelete: (entry: SellerResourceFileKey) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="text-xs text-white/80 bg-white/10 px-1.5 py-0.5 rounded">
          {entry.encryptedFileHash.slice(0, 16)}…
        </code>
        {badge && (
          <Badge size="1" variant="soft" color="green">
            {badge}
          </Badge>
        )}
        <span className="text-xs text-white/50">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      </div>
      <KeyEntryDeleteButton
        entry={entry}
        isDeleting={isDeleting}
        onDelete={onDelete}
      />
    </div>
  );
}

/** 单个设备的密钥映射区：默认只显示最新一条，更早的历史折叠。 */
function DeviceKeySection({
  group,
  isDeleting,
  onDelete,
}: {
  group: DeviceKeyGroup;
  isDeleting: (entry: SellerResourceFileKey) => boolean;
  onDelete: (entry: SellerResourceFileKey) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="border-t border-white/5 px-4 py-2.5 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-white/80">
          {group.deviceId}
        </span>
        <span className="shrink-0 text-xs text-white/45">
          {group.history.length + 1} 条映射
        </span>
      </div>
      <KeyEntryRow
        entry={group.latest}
        badge="最新"
        isDeleting={isDeleting(group.latest)}
        onDelete={onDelete}
      />
      {group.history.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setHistoryOpen((prev) => !prev)}
            className="my-0.5"
          >
            <Button size="1" variant="ghost" color="gray" highContrast>
              <CaretRightIcon
                size={12}
                style={{
                  transform: historyOpen ? "rotate(90deg)" : undefined,
                  transition: "transform 0.15s ease",
                }}
              />
              历史版本（{group.history.length}）
            </Button>
          </button>
          {historyOpen && (
            <div className="pl-2">
              {group.history.map((entry) => (
                <KeyEntryRow
                  key={`${entry.resourceId}-${entry.deviceId}-${entry.encryptedFileHash}`}
                  entry={entry}
                  isDeleting={isDeleting(entry)}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 单个资源的折叠分组：默认收起，页面高度只随资源数增长。
 * 展开后按设备分组，仅展示各设备最新密钥，历史版本二次折叠。
 */
function ResourceGroupSection({
  group,
  isDeleting,
  onDelete,
}: {
  group: ResourceKeyGroup;
  isDeleting: (entry: SellerResourceFileKey) => boolean;
  onDelete: (entry: SellerResourceFileKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const deviceGroups = groupItemsByDevice(group.items);
  const reachedLimit = group.items.length >= FILE_KEY_LIST_LIMIT;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full text-left"
      >
        <div className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <CaretRightIcon
              size={14}
              className="shrink-0 text-white/60"
              style={{
                transform: open ? "rotate(90deg)" : undefined,
                transition: "transform 0.15s ease",
              }}
            />
            <span className="min-w-0 truncate text-sm font-medium text-white">
              {group.resource.entry.name}
            </span>
            <span className="shrink-0 text-xs text-white/50">
              {group.resource.entry.id}
            </span>
          </div>
          <Badge size="1" variant="soft" color="gray">
            {deviceGroups.length} 设备 / {group.items.length} 条映射
          </Badge>
        </div>
      </button>
      {open && (
        <div>
          {deviceGroups.map((deviceGroup) => (
            <DeviceKeySection
              key={deviceGroup.deviceId}
              group={deviceGroup}
              isDeleting={isDeleting}
              onDelete={onDelete}
            />
          ))}
          {reachedLimit && (
            <div className="border-t border-white/5 px-4 py-2 text-xs text-white/50">
              该资源已返回 {FILE_KEY_LIST_LIMIT} 条映射，可能还有更早的历史记录未显示。
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** 加密了的资源：按资源折叠查看已保存的密钥映射，并可删除。 */
export function EncryptedFilesCard({ isVip }: EncryptedFilesCardProps) {
  const queryClient = useQueryClient();

  const {
    data: encryptedResources = [],
    isLoading: encryptedLoading,
    error: encryptedErrorRaw,
  } = useQuery({
    queryKey: ["encryptedResources"],
    queryFn: fetchEncryptedResources,
    enabled: isVip,
  });

  const encryptedError = encryptedErrorRaw
    ? (encryptedErrorRaw as Error).message || "加载失败"
    : "";

  const deleteMutation = useMutation({
    mutationFn: (variables: {
      resourceId: string;
      deviceId: string;
      encryptedFileHash: string;
    }) => deleteSellerResourceFileKey(variables),
    onSuccess: (_, variables) => {
      queryClient.setQueryData(
        ["encryptedResources"],
        (old: ResourceKeyGroup[] | undefined) => {
          if (!old) return old;
          return old
            .map((group) => ({
              ...group,
              items: group.items.filter(
                (item) =>
                  item.resourceId !== variables.resourceId ||
                  item.deviceId !== variables.deviceId ||
                  item.encryptedFileHash !== variables.encryptedFileHash,
              ),
            }))
            .filter((group) => group.items.length > 0);
        },
      );
      toast.success("密钥映射已删除");
    },
    onError: (err) => {
      toast.error(
        (err as any)?.response?.data?.message ||
          (err as Error)?.message ||
          "删除失败",
      );
    },
  });

  const isDeleting = (entry: SellerResourceFileKey) =>
    deleteMutation.isPending &&
    deleteMutation.variables?.resourceId === entry.resourceId &&
    deleteMutation.variables?.deviceId === entry.deviceId &&
    deleteMutation.variables?.encryptedFileHash === entry.encryptedFileHash;

  const handleDelete = (entry: SellerResourceFileKey) => {
    deleteMutation.mutate({
      resourceId: entry.resourceId,
      deviceId: entry.deviceId,
      encryptedFileHash: entry.encryptedFileHash,
    });
  };

  return (
    <SectionCard
      title="加密了的资源"
      description="查看已启用加密上传并已保存密钥映射的资源，展开资源可查看详情"
    >
      {isVip && encryptedLoading && (
        <div className="flex items-center gap-2 px-1 py-4 text-white/60">
          <Spinner size="2" />
          <span className="text-sm">正在加载加密资源...</span>
        </div>
      )}

      {isVip && encryptedError && (
        <Callout.Root
          color="red"
          variant="soft"
          className="bg-transparent! p-3!"
        >
          <Callout.Icon>
            <WarningOctagonIcon size={16} weight="fill" />
          </Callout.Icon>
          <Callout.Text className="font-semibold">
            加载失败：{encryptedError}
          </Callout.Text>
        </Callout.Root>
      )}

      {isVip &&
        !encryptedLoading &&
        !encryptedError &&
        encryptedResources.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
            还没有已保存密钥映射的加密资源。
          </div>
        )}

      {isVip &&
        !encryptedLoading &&
        !encryptedError &&
        encryptedResources.length > 0 && (
          <div className="flex flex-col gap-2">
            {encryptedResources.map((group) => (
              <div
                key={group.resource.entry.id}
                className="rounded-lg border border-white/10 bg-black/20"
              >
                <ResourceGroupSection
                  group={group}
                  isDeleting={isDeleting}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        )}
    </SectionCard>
  );
}
