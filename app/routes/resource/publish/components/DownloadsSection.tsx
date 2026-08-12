import {
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  WarningDiamondIcon,
  InfoIcon,
  ListChecksIcon,
  CopyIcon,
  ChecksIcon,
} from "@phosphor-icons/react";
import {
  Button,
  TextField,
  Table,
  Select,
  Callout,
  Switch,
  Popover,
  Checkbox,
  Text,
  AlertDialog,
  Dialog,
} from "@radix-ui/themes";
import { useMemo, useRef, useState } from "react";
import { createUploadItem } from "./uploadUtils";
import { type DeviceOption, type DownloadInput } from "./types";
import { type UploadItem, SectionCard } from "./shared";
import { EncryptConfigDialog } from "./EncryptConfigDialog";
import { toast } from "sonner";

interface DownloadsSectionProps {
  title?: string;
  description?: string;
  emptyMessage?: string;
  helperText?: string;
  downloads: DownloadInput[];
  sortedDeviceOptions: DeviceOption[];
  isDeviceLoading: boolean;
  deviceError: string;
  isVip: boolean;
  resourceId?: string;
  allowEncryption?: boolean;
  validateFile?: (
    file: File,
  ) => Promise<
    | {
        versionName?: string;
        warning?: { packageName: string; resourceId: string };
      }
    | void
  >;
  onAddRow: () => void;
  onRemoveRow: (uid: string) => void;
  onUpdateRow: (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => void;
  onBatchSetDevices?: (selectedIds: string[]) => void;
  onFillAll?: (template: { version: string; file: UploadItem | null; encryptOnUpload?: boolean }) => void;
}

export function DownloadsSection({
  title = "资源下载配置",
  description = "为不同设备提供不同的资源包体",
  emptyMessage = "还未添加任何设备",
  helperText = "应最少添加一个设备才能发布资源。",
  downloads,
  sortedDeviceOptions,
  isDeviceLoading,
  deviceError,
  isVip,
  resourceId,
  allowEncryption = true,
  validateFile,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onBatchSetDevices,
  onFillAll,
}: DownloadsSectionProps) {
  const downloadFileInputs = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );
  const [batchSelectOpen, setBatchSelectOpen] = useState(false);
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [fileWarnings, setFileWarnings] = useState<
    Record<string, { packageName: string; resourceId: string }>
  >({});
  const [warningDialog, setWarningDialog] = useState<{
    packageName: string;
    resourceId: string;
  } | null>(null);

  const selectedDeviceIds = useMemo(
    () => new Set(downloads.map((d) => d.platformId).filter(Boolean)),
    [downloads],
  );

  const vendorGroups = useMemo(() => {
    const groups = new Map<string, DeviceOption[]>();
    for (const opt of sortedDeviceOptions) {
      const vendor = opt.vendor || "其他";
      if (!groups.has(vendor)) groups.set(vendor, []);
      groups.get(vendor)!.push(opt);
    }
    return groups;
  }, [sortedDeviceOptions]);

  const hasTemplate = useMemo(
    () => downloads.some((d) => d.version.trim() !== "" || d.file !== null),
    [downloads],
  );

  const handleBatchApply = (ids: string[]) => {
    onBatchSetDevices?.(ids);
    setBatchSelectOpen(false);
  };

  const handleFillAll = () => {
    const template = downloads.find(
      (d) => d.version.trim() !== "" || d.file !== null,
    );
    if (template) {
      onFillAll?.({
        version: template.version,
        file: template.file,
        encryptOnUpload: template.encryptOnUpload,
      });
    }
    setFillAllOpen(false);
  };

  const pickDownloadFile = (uid: string) => {
    const node = downloadFileInputs.current[uid];
    node?.click();
  };

  return (
    <SectionCard
      title={title}
      description={description}
    >
      {deviceError && (
        <Callout.Root color="amber">
          <Callout.Icon>
            <WarningDiamondIcon size={18} weight="fill" />
          </Callout.Icon>
          <Callout.Text>{deviceError}</Callout.Text>
        </Callout.Root>
      )}
      {!deviceError && sortedDeviceOptions.length === 0 && (
        <Callout.Root color="red">
          <Callout.Icon>
            <WarningDiamondIcon size={18} weight="fill" />
          </Callout.Icon>
          <Callout.Text>设备列表不可用，请稍后重试</Callout.Text>
        </Callout.Root>
      )}
      <div className="flex flex-col gap-3 max-w-full">
        <div className="flex items-center gap-1.5 px-1">
          {onBatchSetDevices && (
            <Popover.Root
              open={batchSelectOpen}
              onOpenChange={setBatchSelectOpen}
            >
              <Popover.Trigger>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  radius="large"
                  className="text-xs!"
                  disabled={sortedDeviceOptions.length === 0 || isDeviceLoading}
                >
                  <ListChecksIcon size={14} />
                  批量选择设备
                </Button>
              </Popover.Trigger>
              <Popover.Content
                width="320px"
                className="max-h-[400px] overflow-y-auto"
              >
                <BatchDeviceSelector
                  vendorGroups={vendorGroups}
                  selectedIds={selectedDeviceIds}
                  onApply={handleBatchApply}
                  onCancel={() => setBatchSelectOpen(false)}
                />
              </Popover.Content>
            </Popover.Root>
          )}
          {onFillAll && (
            <AlertDialog.Root open={fillAllOpen} onOpenChange={setFillAllOpen}>
              <AlertDialog.Trigger>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  radius="large"
                  className="text-xs!"
                  disabled={!hasTemplate}
                >
                  <CopyIcon size={14} />
                  一键填充
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>一键填充配置</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  将第一行已填写的版本号、包体文件和加密上传设置复制到所有其他设备行。此操作会覆盖已有配置，确定继续吗？
                </AlertDialog.Description>
                <div className="flex justify-end gap-3 mt-4">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      取消
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button variant="solid" onClick={handleFillAll}>
                      确认填充
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Root>
          )}
          <Button
            size="1"
            variant="soft"
            radius="large"
            className="text-xs! md:hidden"
            disabled={sortedDeviceOptions.length === 0 || isDeviceLoading}
            onClick={onAddRow}
          >
            <PlusIcon size={14} weight="bold" />
            添加设备
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {downloads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
              {emptyMessage}
            </p>
          ) : (
            downloads.map((item, index) => (
              <div
                key={item.uid || `download-${index}`}
                className="rounded-lg border border-white/10 bg-black/20 p-2.5"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-white/55">
                    设备 {index + 1}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {fileWarnings[item.uid] && (
                      <button
                        type="button"
                        className="grid size-8 place-items-center rounded-lg text-yellow-300 transition hover:bg-yellow-400/10 hover:text-yellow-200"
                        onClick={() =>
                          setWarningDialog(fileWarnings[item.uid] || null)
                        }
                        aria-label="查看 RPK 包名提示"
                      >
                        <InfoIcon size={16} weight="bold" />
                      </button>
                    )}
                    <button
                      className="rounded-lg p-1 text-white/60 transition hover:bg-red-500/10 hover:text-red-300"
                      onClick={() => onRemoveRow(item.uid)}
                    >
                      <MinusIcon size={16} weight="bold" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:grid md:grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-[200px] flex-1 md:min-w-0">
                    <Select.Root
                      value={item.platformId || undefined}
                      onValueChange={(value) =>
                        onUpdateRow(item.uid, (row) => ({
                          ...row,
                          platformId: value,
                        }))
                      }
                    >
                      <Select.Trigger
                        radius="large"
                        placeholder="请选择设备"
                        className="w-full whitespace-normal"
                      />
                      <Select.Content position="popper">
                        {sortedDeviceOptions.map((opt) => {
                          const usedElsewhere = downloads.some(
                            (row, idx) =>
                              idx !== index && row.platformId === opt.id,
                          );
                          return (
                            <Select.Item
                              key={opt.id}
                              value={opt.id}
                              disabled={usedElsewhere}
                            >
                              {opt.name}
                              {usedElsewhere ? "（已使用）" : ""}
                            </Select.Item>
                          );
                        })}
                      </Select.Content>
                    </Select.Root>
                  </div>

                  <div className="min-w-[100px] flex-1 md:min-w-0">
                    <TextField.Root
                      placeholder="版本号"
                      value={item.version}
                      radius="large"
                      className="min-w-0"
                      onChange={(e) =>
                        onUpdateRow(item.uid, (row) => ({
                          ...row,
                          version: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
                    <input
                      type="file"
                      className="hidden"
                      ref={(node) => {
                        downloadFileInputs.current[item.uid] = node;
                      }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          const meta = await validateFile?.(file);
                          const uploadItem = createUploadItem(file);
                          onUpdateRow(item.uid, (row) => ({
                            ...row,
                            file: uploadItem,
                            existingFileName: undefined,
                            ...(meta?.versionName
                              ? { version: meta.versionName }
                              : {}),
                          }));
                          if (meta?.warning) {
                            setFileWarnings((prev) => ({
                              ...prev,
                              [item.uid]: meta.warning!,
                            }));
                          } else {
                            setFileWarnings((prev) => {
                              const next = { ...prev };
                              delete next[item.uid];
                              return next;
                            });
                          }
                        } catch (error) {
                          toast.error((error as Error).message);
                        }
                      }}
                    />
                    {item.file ? (
                      <>
                        <Button
                          radius="large"
                          onClick={() => pickDownloadFile(item.uid)}
                          variant="ghost"
                        >
                          <UploadSimpleIcon size={16} weight="bold" />
                        </Button>
                        <span className="min-w-0 truncate text-white/80">
                          {item.file.name}
                        </span>
                      </>
                    ) : item.existingFileName ? (
                      <>
                        <Button
                          radius="large"
                          onClick={() => pickDownloadFile(item.uid)}
                          variant="outline"
                        >
                          <UploadSimpleIcon size={16} weight="bold" />
                        </Button>
                        <span className="min-w-0 truncate text-emerald-100">
                          当前: {item.existingFileName}
                        </span>
                      </>
                    ) : (
                      <Button
                        radius="large"
                        onClick={() => pickDownloadFile(item.uid)}
                      >
                        <UploadSimpleIcon size={16} weight="bold" />
                        请上传文件
                      </Button>
                    )}
                  </div>

                  {isVip && allowEncryption && (
                    <div className="flex w-full items-center gap-2 md:w-auto">
                      <span className="text-xs text-white/65">加密上传</span>
                      <Switch
                        checked={Boolean(item.encryptOnUpload)}
                        disabled={Boolean(item.existingFileName)}
                        onCheckedChange={(checked) =>
                          onUpdateRow(item.uid, (row) => ({
                            ...row,
                            encryptOnUpload: checked,
                          }))
                        }
                      />
                      {item.encryptOnUpload && (
                        <EncryptConfigDialog
                          resourceId={resourceId || ""}
                          deviceId={item.platformId}
                          deviceName={
                            sortedDeviceOptions.find(
                              (opt) => opt.id === item.platformId,
                            )?.name || item.platformId
                          }
                          triggerDisabled={!item.encryptOnUpload}
                          allDeviceIds={downloads
                            .map((d) => d.platformId)
                            .filter(Boolean)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog.Root
        open={warningDialog !== null}
        onOpenChange={(open) => {
          if (!open) setWarningDialog(null);
        }}
      >
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>RPK 包名提示</Dialog.Title>
          <Dialog.Description size="2">
            RPK包名（{warningDialog?.packageName ?? ""}）和资源ID（
            {warningDialog?.resourceId ?? ""}）不一致，将无法使用自动检查更新功能。
          </Dialog.Description>
          <div className="mt-4 flex justify-end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                关闭
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <div className="flex flex-col px-1.5 py-1 w-full">
        {helperText && <p className="text-xs text-white/60">{helperText}</p>}
      </div>
    </SectionCard>
  );
}

function BatchDeviceSelector({
  vendorGroups,
  selectedIds,
  onApply,
  onCancel,
}: {
  vendorGroups: Map<string, DeviceOption[]>;
  selectedIds: Set<string>;
  onApply: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const allIds = useMemo(
    () => Array.from(vendorGroups.values()).flat().map((d) => d.id),
    [vendorGroups],
  );
  const [pending, setPending] = useState<Set<string>>(
    () => new Set(selectedIds),
  );

  const toggle = (id: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setPending((prev) => {
      if (prev.size === allIds.length) return new Set();
      return new Set(allIds);
    });
  };

  const allSelected = pending.size === allIds.length && allIds.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Text size="2" weight="medium">
          选择支持的设备
        </Text>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={toggleAll}
          className="text-xs!"
        >
          {allSelected ? "取消全选" : "全选"}
        </Button>
      </div>
      <div className="flex flex-col gap-2.5 max-h-[280px] overflow-y-auto pr-1">
        {Array.from(vendorGroups.entries()).map(([vendor, devices]) => (
          <div key={vendor} className="flex flex-col gap-1">
            <Text size="1" color="gray" weight="medium" className="px-0.5">
              {vendor}
            </Text>
            <div className="flex flex-col gap-0.5">
              {devices.map((device) => (
                <label
                  key={device.id}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/5 cursor-pointer transition"
                >
                  <Checkbox
                    checked={pending.has(device.id)}
                    onCheckedChange={() => toggle(device.id)}
                  />
                  <Text size="2" className="flex-1">
                    {device.name}
                  </Text>
                  <Text size="1" color="gray">
                    {device.id}
                  </Text>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between items-center pt-1 border-t border-white/10">
        <Text size="1" color="gray">
          已选 {pending.size} / {allIds.length}
        </Text>
        <div className="flex gap-2">
          <Button size="1" variant="soft" color="gray" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="1"
            variant="solid"
            onClick={() => onApply(Array.from(pending))}
          >
            <ChecksIcon size={14} />
            应用
          </Button>
        </div>
      </div>
    </div>
  );
}
