import {
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  WarningDiamondIcon,
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
} from "@radix-ui/themes";
import { useMemo, useRef, useState } from "react";
import { createUploadItem } from "./uploadUtils";
import { type DeviceOption, type DownloadInput } from "./types";
import { type UploadItem, SectionCard } from "./shared";
import { EncryptConfigDialog } from "./EncryptConfigDialog";

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
      className="border-x-0! border-t-0! bg-transparent! rounded-none! shadow-none!"
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
      <div className="flex flex-col gap-3 max-w-full overflow-x-auto">
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
        </div>
        <Table.Root className="table-fixed w-full min-w-lg">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell
                width="40px"
                justify="center"
                p="0"
                className="h-full flex justify-center items-center"
              >
                <button
                  className="text-white/60 transition hover:text-blue-400 flex items-center justify-center h-[30px] w-[30px] disabled:text-white/30 disabled:pointer-events-none"
                  onClick={onAddRow}
                  disabled={sortedDeviceOptions.length === 0 || isDeviceLoading}
                >
                  <PlusIcon size={16} weight="bold" />
                </button>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>设备</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>版本号</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>包体</Table.ColumnHeaderCell>
              {isVip && allowEncryption && (
                <Table.ColumnHeaderCell>加密上传</Table.ColumnHeaderCell>
              )}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {downloads.map((item, index) => (
              <Table.Row key={`links-${index}`}>
                <Table.RowHeaderCell width="40px" justify="center" px="0">
                  {downloads.length > 0 && (
                    <button
                      className="text-white/60 transition hover:text-red-400 flex items-center justify-center h-[30px] w-[30px] m-auto"
                      onClick={() => onRemoveRow(item.uid)}
                    >
                      <MinusIcon size={16} weight="bold" />
                    </button>
                  )}
                </Table.RowHeaderCell>
                <Table.RowHeaderCell>
                  <Select.Root
                    value={item.platformId || undefined}
                    onValueChange={(value) =>
                      onUpdateRow(item.uid, (row) => ({
                        ...row,
                        platformId: value,
                      }))
                    }
                  >
                    <Select.Trigger radius="large" placeholder="请选择设备" />

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
                </Table.RowHeaderCell>
                <Table.RowHeaderCell>
                  <TextField.Root
                    placeholder="版本号"
                    value={item.version}
                    radius="large"
                    onChange={(e) =>
                      onUpdateRow(item.uid, (row) => ({
                        ...row,
                        version: e.target.value,
                      }))
                    }
                  />
                </Table.RowHeaderCell>
                <Table.RowHeaderCell>
                  <div className="flex flex-wrap items-center gap-2 h-full w-fit">
                    <input
                      type="file"
                      className="hidden"
                      ref={(node) => {
                        downloadFileInputs.current[item.uid] = node;
                      }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const uploadItem = createUploadItem(file);
                        onUpdateRow(item.uid, (row) => ({
                          ...row,
                          file: uploadItem,
                          existingFileName: undefined,
                        }));
                        e.target.value = "";
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
                        <span className=" text-white/80">{item.file.name}</span>
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
                        <span className=" text-emerald-100">
                          当前: {item.existingFileName}
                        </span>
                      </>
                    ) : (
                      <>
                        <Button
                          radius="large"
                          onClick={() => pickDownloadFile(item.uid)}
                          className="-mx-1"
                        >
                          <UploadSimpleIcon size={16} weight="bold" />
                          请上传文件
                        </Button>
                      </>
                    )}
                  </div>
                </Table.RowHeaderCell>
                {isVip && allowEncryption && (
                  <Table.RowHeaderCell>
                    <div className="flex items-center gap-2">
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
                          triggerDisabled={!item.encryptOnUpload}
                          allDeviceIds={downloads
                            .map((d) => d.platformId)
                            .filter(Boolean)}
                        />
                      )}
                    </div>
                  </Table.RowHeaderCell>
                )}
              </Table.Row>
            ))}

            {downloads.length === 0 && (
              <Table.Row key={`links-0`}>
                <Table.RowHeaderCell
                  width="40px"
                  justify="center"
                  px="0"
                ></Table.RowHeaderCell>
                <Table.RowHeaderCell>
                  <span className="text-white/60">{emptyMessage}</span>
                </Table.RowHeaderCell>
                <Table.RowHeaderCell />
                <Table.RowHeaderCell />
                {isVip && allowEncryption && <Table.RowHeaderCell />}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Root>
      </div>

      <div className="flex flex-col px-1.5 py-1 w-full">
        <p className="text-xs text-white/60">{helperText}</p>
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
