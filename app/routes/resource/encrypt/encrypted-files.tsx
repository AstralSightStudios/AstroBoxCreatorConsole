import {
  AlertDialog,
  Button,
  Callout,
  Spinner,
  Table,
} from "~/components/ScaleAwareThemes";
import { TrashIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

async function fetchEncryptedResources() {
  const ownedResources = await loadOwnedCatalogResourcesForCurrentUser().catch(
    () => [] as ResourceCatalogContext[],
  );
  if (ownedResources.length === 0) return [];

  const results = await Promise.allSettled(
    ownedResources.map(async (resource) => {
      const items = await listSellerResourceFileKeys({
        resourceId: resource.entry.id,
        limit: 200,
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

/** 加密了的资源：查看已保存密钥映射的资源，并可删除映射。 */
export function EncryptedFilesCard({ isVip }: { isVip: boolean }) {
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
      (
        old:
          | {
              resource: ResourceCatalogContext;
              items: SellerResourceFileKey[];
            }[]
          | undefined,
      ) => {
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

const handleDeleteFileKey = (
  resourceId: string,
  deviceId: string,
  encryptedFileHash: string,
) => {
  deleteMutation.mutate({ resourceId, deviceId, encryptedFileHash });
};

  return (
<SectionCard
  title="加密了的资源"
  description="查看已启用加密上传并已保存密钥映射的资源"
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
      <div className="w-full overflow-x-auto">
        <Table.Root className="w-full min-w-150">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>资源名称</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>文件哈希</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>创建时间</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell className="w-22.5">
                操作
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {encryptedResources.flatMap((group) =>
              group.items.map((item) => (
                <Table.Row
                  key={`${item.resourceId}-${item.deviceId}-${item.encryptedFileHash}`}
                >
                  <Table.Cell>
                    <span className="text-sm font-medium text-white">
                      {group.resource.entry.name}
                    </span>
                    <span className="ml-2 text-xs text-white/50">
                      {group.resource.entry.id}
                    </span>
                  </Table.Cell>
                  <Table.Cell>{item.deviceId}</Table.Cell>
                  <Table.Cell>
                    <code className="text-xs text-white/80 bg-white/10 px-1.5 py-0.5 rounded">
                      {item.encryptedFileHash.slice(0, 16)}…
                    </code>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="text-sm text-white/70">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <AlertDialog.Root>
                      <AlertDialog.Trigger>
                        <Button
                          size="2"
                          variant="soft"
                          color="red"
                          disabled={
                            deleteMutation.isPending &&
                            deleteMutation.variables?.resourceId ===
                              item.resourceId &&
                            deleteMutation.variables?.deviceId ===
                              item.deviceId &&
                            deleteMutation.variables
                              ?.encryptedFileHash ===
                              item.encryptedFileHash
                          }
                        >
                          {deleteMutation.isPending &&
                          deleteMutation.variables?.resourceId ===
                            item.resourceId &&
                          deleteMutation.variables?.deviceId ===
                            item.deviceId &&
                          deleteMutation.variables
                            ?.encryptedFileHash ===
                            item.encryptedFileHash ? (
                            <Spinner size="2" />
                          ) : (
                            <TrashIcon size={16} />
                          )}
                        </Button>
                      </AlertDialog.Trigger>
                      <AlertDialog.Content maxWidth="420px">
                        <AlertDialog.Title>
                          删除密钥映射
                        </AlertDialog.Title>
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
                            <Button
                              color="red"
                              onClick={() =>
                                void handleDeleteFileKey(
                                  item.resourceId,
                                  item.deviceId,
                                  item.encryptedFileHash,
                                )
                              }
                            >
                              确认删除
                            </Button>
                          </AlertDialog.Action>
                        </div>
                      </AlertDialog.Content>
                    </AlertDialog.Root>
                  </Table.Cell>
                </Table.Row>
              )),
            )}
          </Table.Body>
        </Table.Root>
      </div>
    )}
</SectionCard>
  );
}
