import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Dialog,
  Spinner,
} from "~/components/ScaleAwareThemes";
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  CopyIcon,
  GithubLogoIcon,
  InfoIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Collapsible } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteSellerResourceFileKey,
  listSellerResourceFileKeys,
  type SellerResourceFileKey,
} from "~/api/astrobox/order";
import { loadAccountState } from "~/logic/account/store";
import {
  fetchManifestForCatalogEntry,
  type ManifestV2,
} from "~/logic/publish/manifest-loader";
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

/** 复制文本到剪贴板，成功/失败均有 toast 反馈。 */
async function copyText(text: string, successMessage = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (err) {
    toast.error("复制失败：" + ((err as Error)?.message || "未知错误"));
  }
}

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

/**
 * 从资源仓库根目录的 manifest_v2.json 解析每台设备的包体文件名，
 * 用于在 GitHub 上直达具体的加密文件。读取失败一律返回空表，
 * 不阻塞密钥列表本身的加载。
 */
async function fetchDeviceFileNames(
  resource: ResourceCatalogContext,
): Promise<{ downloadFileNames: Record<string, string>; manifest?: ManifestV2 }> {
  const token = loadAccountState().github?.token;
  if (!token) return { downloadFileNames: {} };
  try {
    const { manifest } = await fetchManifestForCatalogEntry({
      entry: resource.entry,
      token,
    });
    const downloadFileNames: Record<string, string> = {};
    for (const [deviceId, info] of Object.entries(manifest.downloads ?? {})) {
      const name = info?.file_name?.trim();
      if (name) downloadFileNames[deviceId] = name;
    }
    return { downloadFileNames, manifest };
  } catch {
    return { downloadFileNames: {} };
  }
}

async function fetchEncryptedResources() {
  const ownedResources = await loadOwnedCatalogResourcesForCurrentUser().catch(
    () => [] as ResourceCatalogContext[],
  );
  if (ownedResources.length === 0) return [];

  const results = await Promise.allSettled(
    ownedResources.map(async (resource) => {
      const [items, fileNames] = await Promise.all([
        listSellerResourceFileKeys({
          resourceId: resource.entry.id,
          limit: FILE_KEY_LIST_LIMIT,
        }),
        fetchDeviceFileNames(resource),
      ]);
      return { resource, items, ...fileNames };
    }),
  );

  return results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<{
        resource: ResourceCatalogContext;
        items: SellerResourceFileKey[];
        downloadFileNames: Record<string, string>;
        manifest?: ManifestV2;
      }> => r.status === "fulfilled",
    )
    .map((r) => r.value)
    .filter((group) => group.items.length > 0);
}

export type ResourceKeyGroup = {
  resource: ResourceCatalogContext;
  items: SellerResourceFileKey[];
  /** 设备 → manifest 中的包体文件名，用于 GitHub 直达文件（可能缺失）。 */
  downloadFileNames?: Record<string, string>;
  manifest?: ManifestV2;
};

interface EncryptedFilesCardProps {
  isVip: boolean;
}

/** 加密包体在资源仓库 `downloads/` 目录下的 GitHub 目录链接。 */
function buildGithubDownloadsUrl(entry: ResourceCatalogContext["entry"]) {
  const owner = entry.repo_owner.trim();
  const repo = entry.repo_name.trim();
  if (!owner || !repo) return null;
  const ref = entry.repo_commit_hash.trim() || "main";
  return `https://github.com/${owner}/${repo}/tree/${ref}/downloads`;
}

/** 指向具体加密文件的 GitHub 链接（仓库路径为 downloads/{fileName}）。 */
function buildGithubFileUrl(
  entry: ResourceCatalogContext["entry"],
  fileName: string,
) {
  const owner = entry.repo_owner.trim();
  const repo = entry.repo_name.trim();
  if (!owner || !repo) return null;
  const ref = entry.repo_commit_hash.trim() || "main";
  const encoded = fileName.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${owner}/${repo}/blob/${ref}/downloads/${encoded}`;
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
        <Button
          size="2"
          variant="soft"
          color="red"
          disabled={isDeleting}
          title="删除密钥映射"
        >
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

/** 详情行：字段名 + 值。 */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-sm text-white/50">{label}</span>
      <span className="min-w-0 break-all text-right text-sm text-white/90">
        {children}
      </span>
    </div>
  );
}

/** 包体详情弹窗：完整哈希（可复制）、设备、时间与 GitHub 文件链接。 */
function KeyEntryDetailsDialog({
  entry,
  resource,
  downloadFileNames,
}: {
  entry: SellerResourceFileKey;
  resource: ResourceCatalogContext;
  downloadFileNames?: Record<string, string>;
}) {
  const fileName = downloadFileNames?.[entry.deviceId]?.trim();
  const fileUrl = fileName
    ? buildGithubFileUrl(resource.entry, fileName)
    : null;
  const dirUrl = buildGithubDownloadsUrl(resource.entry);
  const hash = entry.encryptedFileHash;

  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <Button size="2" variant="soft" color="gray" title="包体详情">
          <InfoIcon size={16} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>包体详情</Dialog.Title>
        <Dialog.Description size="2" className="text-white/60">
          服务端保存的密钥映射。哈希是密文文件的 sha256，用于识别"哪个加密包
          配哪条密钥"；密钥本身不下发到控制台。
        </Dialog.Description>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 text-sm text-white/50">哈希</span>
            <div className="flex min-w-0 items-start justify-end gap-1.5">
              <code className="min-w-0 break-all text-right text-xs text-white/80 bg-white/10 px-1.5 py-0.5 rounded">
                {hash}
              </code>
              <Button
                size="1"
                variant="soft"
                color="gray"
                title="复制完整哈希"
                onClick={() => void copyText(hash, "哈希已复制")}
              >
                <CopyIcon size={14} />
              </Button>
            </div>
          </div>

          <DetailRow label="设备">{entry.deviceId}</DetailRow>
          <DetailRow label="创建时间">
            {new Date(entry.createdAt).toLocaleString()}
          </DetailRow>
          {entry.updatedAt.trim() && entry.updatedAt !== entry.createdAt && (
            <DetailRow label="更新时间">
              {new Date(entry.updatedAt).toLocaleString()}
            </DetailRow>
          )}
          {fileName && <DetailRow label="包体文件">{fileName}</DetailRow>}

          {(fileUrl || dirUrl) && (
            <div className="flex justify-end">
              {fileUrl ? (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline"
                >
                  在 GitHub 打开该文件
                  <ArrowSquareOutIcon size={14} />
                </a>
              ) : (
                <a
                  href={dirUrl!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline"
                >
                  在 GitHub 打开 downloads 目录
                  <ArrowSquareOutIcon size={14} />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              关闭
            </Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** 单条密钥映射行：时间 + 详情 + 删除（哈希收进详情弹窗）。 */
function KeyEntryRow({
  entry,
  badge,
  resource,
  downloadFileNames,
  isDeleting,
  onDelete,
}: {
  entry: SellerResourceFileKey;
  badge?: string;
  resource: ResourceCatalogContext;
  downloadFileNames?: Record<string, string>;
  isDeleting: boolean;
  onDelete: (entry: SellerResourceFileKey) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {badge && (
          <Badge size="1" variant="soft" color="green">
            {badge}
          </Badge>
        )}
        <span className="text-xs text-white/50">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <KeyEntryDetailsDialog
          entry={entry}
          resource={resource}
          downloadFileNames={downloadFileNames}
        />
        <KeyEntryDeleteButton
          entry={entry}
          isDeleting={isDeleting}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/** 单个设备的密钥映射区：默认只显示最新一条，更早的历史折叠。 */
function DeviceKeySection({
  group,
  resource,
  downloadFileNames,
  isDeleting,
  onDelete,
}: {
  group: DeviceKeyGroup;
  resource: ResourceCatalogContext;
  downloadFileNames?: Record<string, string>;
  isDeleting: (entry: SellerResourceFileKey) => boolean;
  onDelete: (entry: SellerResourceFileKey) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileName = downloadFileNames?.[group.deviceId]?.trim();
  const fileUrl = fileName
    ? buildGithubFileUrl(resource.entry, fileName)
    : null;

  return (
    <div className="border-t border-white/5 px-3 py-2.5 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-white/80">
          {group.deviceId}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              title={`在 GitHub 打开加密文件 ${fileName}`}
              className="text-white/50 transition-colors hover:text-white"
            >
              <GithubLogoIcon size={15} />
            </a>
          )}
          <span className="text-xs text-white/45">
            {group.history.length + 1} 条映射
          </span>
        </div>
      </div>
      <KeyEntryRow
        entry={group.latest}
        badge="最新"
        resource={resource}
        downloadFileNames={downloadFileNames}
        isDeleting={isDeleting(group.latest)}
        onDelete={onDelete}
      />
      {group.history.length > 0 && (
        <Collapsible.Root
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          className="mt-0.5"
        >
          <Collapsible.Trigger asChild>
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
          </Collapsible.Trigger>
          <Collapsible.Content className="abcc-collapsible-content">
            <div className="pl-2">
              {group.history.map((entry) => (
                <KeyEntryRow
                  key={`${entry.resourceId}-${entry.deviceId}-${entry.encryptedFileHash}`}
                  entry={entry}
                  resource={resource}
                  downloadFileNames={downloadFileNames}
                  isDeleting={isDeleting(entry)}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
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
  const githubDownloadsUrl = buildGithubDownloadsUrl(group.resource.entry);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      {/* 头部行平铺三段：折叠触发区 | GitHub 链接 | 摘要徽章。
          链接必须放在触发按钮外，HTML 不允许 button 内嵌套 a。 */}
      <div className="flex w-full items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <Collapsible.Trigger asChild className="min-w-0 flex-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <CaretRightIcon
              size={14}
              className="shrink-0 text-white/60"
              style={{
                transform: open ? "rotate(90deg)" : undefined,
                transition: "transform 0.15s ease",
              }}
            />
            {/* 窄屏：id 换行到资源名下方，保证资源名始终可见 */}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">
                {group.resource.entry.name}
              </span>
              <span className="block truncate text-xs text-white/50 sm:hidden">
                {group.resource.entry.id}
              </span>
            </span>
            {/* 宽屏：id 与资源名同行 */}
            <span className="hidden shrink-0 text-xs text-white/50 sm:block">
              {group.resource.entry.id}
            </span>
          </button>
        </Collapsible.Trigger>
        {githubDownloadsUrl && (
          <a
            href={githubDownloadsUrl}
            target="_blank"
            rel="noreferrer"
            title="在 GitHub 打开加密文件所在目录"
            className="shrink-0 text-white/50 transition-colors hover:text-white"
          >
            <GithubLogoIcon size={18} />
          </a>
        )}
        <Badge size="1" variant="soft" color="gray" className="shrink-0">
          {deviceGroups.length} 设备 / {group.items.length} 条映射
        </Badge>
      </div>
      <Collapsible.Content className="abcc-collapsible-content">
        <div>
          {deviceGroups.map((deviceGroup) => (
            <DeviceKeySection
              key={deviceGroup.deviceId}
              group={deviceGroup}
              resource={group.resource}
              downloadFileNames={group.downloadFileNames}
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
      </Collapsible.Content>
    </Collapsible.Root>
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
