import {
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  WarningDiamondIcon,
  ListChecksIcon,
  CopyIcon,
  ChecksIcon,
  NotebookIcon,
  QuestionIcon,
  TrashIcon,
  LockSimpleIcon,
  PencilSimpleLineIcon,
} from "@phosphor-icons/react";
import {
  Button,
  TextField,
  TextArea,
  Table,
  Select,
  Callout,
  Switch,
  Popover,
  Checkbox,
  Text,
  AlertDialog,
  Dialog,
} from "~/components/ScaleAwareThemes";
import { useMemo, useState } from "react";
import { pickFiles } from "~/logic/publish/file-picker";
import { createUploadItem } from "./uploadUtils";
import {
  type DeviceOption,
  type DownloadIdentityKind,
  type DownloadInput,
  type DownloadVersionSource,
} from "./types";
import { type UploadItem, SectionCard } from "./shared";
import { EncryptConfigDialog } from "./EncryptConfigDialog";
import { VersionEditorDialog } from "./VersionEditorDialog";
import { toast } from "sonner";
import { log } from "~/logic/logging";
import { logFieldChange } from "~/logic/logging/publish-flow";
import type { UpdateLogEntry } from "./types";
import {
  computePackageHash,
  formatPackageVersion,
  type PackageVersionInfo,
} from "~/logic/publish/package-version";

const DOWNLOAD_FIELD_HELP: { label: string; description: string }[] = [
  {
    label: "设备",
    description: "选择该包体对应的设备型号，同一设备只能配置一个包体。",
  },
  {
    label: "版本号",
    description:
      "展示用版本名称，导入包体后自动读取并锁定；如需修改请点「修改版本」改写包体。",
  },
  {
    label: "versionCode",
    description:
      "数字版本号，AstroBox 用它和用户已装包比较来判断是否有更新，发布新版本时必须大于旧版本；导入包体后自动读取并锁定。",
  },
  {
    label: "包体文件",
    description: "上传该设备的资源包体（RPK 等），编辑已有资源时可沿用仓库中的旧包。",
  },
  {
    label: "加密上传",
    description: "会员功能，开启后包体加密上传，用户需要激活才能使用。",
  },
  {
    label: "更新日志",
    description: "按版本记录本次更新内容，用户更新资源时会看到这些说明。",
  },
  {
    label: "批量选择设备 / 一键填充",
    description:
      "多设备资源可批量添加设备行，或将第一行的配置快速复制到其他设备行。",
  },
];

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
  validateFile?: (file: File) => Promise<PackageVersionInfo>;
  onAddRow: () => void;
  onRemoveRow: (uid: string) => void;
  onUpdateRow: (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => void;
  onBatchSetDevices?: (selectedIds: string[]) => void;
  onFillAll?: (template: {
    version: string;
    file: UploadItem | null;
    encryptOnUpload?: boolean;
    versionCode?: number;
    updatelogs?: UpdateLogEntry[];
    versionLocked?: boolean;
    versionSource?: DownloadVersionSource;
    packageHash?: string;
    packageIdentity?: string;
    packageIdentityKind?: DownloadIdentityKind;
    packageWritable?: boolean;
  }) => void;
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
  const [batchSelectOpen, setBatchSelectOpen] = useState(false);
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [versionEditor, setVersionEditor] = useState<{
    uid: string;
    file: File;
    previousVersion?: string;
    previousVersionCode?: number;
    mismatch: boolean;
  } | null>(null);
  const [updateLogEditor, setUpdateLogEditor] = useState<{
    uid: string;
    entries: UpdateLogEntry[];
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const isIdentityMismatch = (item: DownloadInput) =>
    item.packageIdentityKind === "package" &&
    Boolean(item.packageIdentity) &&
    Boolean(resourceId?.trim()) &&
    item.packageIdentity !== resourceId?.trim();

  const isNonIncrementRow = (item: DownloadInput) =>
    item.versionSource === "package" &&
    item.versionCode !== undefined &&
    item.previousVersionCode !== undefined &&
    item.versionCode <= item.previousVersionCode;

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
    () =>
      downloads.some(
        (d) =>
          d.version.trim() !== "" ||
          d.file !== null ||
          (d.updatelogs?.length ?? 0) > 0,
      ),
    [downloads],
  );

  const handleBatchApply = (ids: string[]) => {
    onBatchSetDevices?.(ids);
    setBatchSelectOpen(false);
  };

  const handleFillAll = () => {
    const template = downloads.find(
      (d) =>
        d.version.trim() !== "" ||
        d.file !== null ||
        (d.updatelogs?.length ?? 0) > 0,
    );
    if (template) {
      onFillAll?.({
        version: template.version,
        file: template.file,
        encryptOnUpload: template.encryptOnUpload,
        versionCode: template.versionCode,
        updatelogs: template.updatelogs,
        versionLocked: template.versionLocked,
        versionSource: template.versionSource,
        packageHash: template.packageHash,
        packageIdentity: template.packageIdentity,
        packageIdentityKind: template.packageIdentityKind,
        packageWritable: template.packageWritable,
      });
    }
    setFillAllOpen(false);
  };

  const addUpdateLogEntry = () => {
    if (!updateLogEditor) return;
    const row = downloads.find((d) => d.uid === updateLogEditor.uid);
    setUpdateLogEditor({
      ...updateLogEditor,
      entries: [
        ...updateLogEditor.entries,
        { version: row?.version ?? "", content: "" },
      ],
    });
  };

  const updateUpdateLogEntry = (
    index: number,
    patch: Partial<UpdateLogEntry>,
  ) => {
    if (!updateLogEditor) return;
    setUpdateLogEditor({
      ...updateLogEditor,
      entries: updateLogEditor.entries.map((log, i) =>
        i === index ? { ...log, ...patch } : log,
      ),
    });
  };

  const removeUpdateLogEntry = (index: number) => {
    if (!updateLogEditor) return;
    setUpdateLogEditor({
      ...updateLogEditor,
      entries: updateLogEditor.entries.filter((_, i) => i !== index),
    });
  };

  const saveUpdateLogs = () => {
    if (!updateLogEditor) return;
    const { uid, entries } = updateLogEditor;
    const cleaned = entries
      .map((log) => ({
        version: log.version.trim(),
        content: log.content.trim(),
      }))
      .filter((log) => log.version || log.content);
    const row = downloads.find((d) => d.uid === uid);
    const device = sortedDeviceOptions.find((opt) => opt.id === row?.platformId);
    log.info("download/row", "保存更新日志", {
      data: {
        deviceId: row?.platformId ?? null,
        deviceName: device?.name ?? null,
        count: cleaned.length,
      },
    });
    onUpdateRow(uid, (r) => ({
      ...r,
      updatelogs: cleaned.length > 0 ? cleaned : undefined,
    }));
    setUpdateLogEditor(null);
  };

  const pickDownloadFile = async (uid: string) => {
    const files = await pickFiles({ title: "选择包体文件" });
    const file = files[0];
    if (!file) return;
    log.info("download/file", "选择包体文件", {
      data: { name: file.name, size: file.size },
    });
    try {
      const info = await validateFile?.(file);
      const uploadItem = createUploadItem(file);
      const packageHash = await computePackageHash(file);
      const readable = Boolean(info?.readable);
      onUpdateRow(uid, (row) => ({
        ...row,
        file: uploadItem,
        existingFileName: undefined,
        versionLocked: readable ? true : row.versionLocked,
        versionSource: readable ? "package" : row.versionSource,
        ...(readable && info?.version ? { version: info.version } : {}),
        ...(readable && info?.versionCode !== undefined
          ? { versionCode: info.versionCode }
          : {}),
        packageHash,
        packageIdentity: info?.identity,
        packageIdentityKind: info?.identityKind,
        packageWritable: info?.writable,
      }));
      log.info("download/file", "包体校验完成", {
        data: {
          name: file.name,
          size: file.size,
          source: info?.source ?? null,
          version: info?.version ?? null,
          versionCode: info?.versionCode ?? null,
          identity: info?.identity ?? null,
          readable,
        },
      });
      const current = downloads.find((d) => d.uid === uid);
      const previousVersionCode = current?.previousVersionCode;
      const mismatch =
        info?.identityKind === "package" &&
        Boolean(info?.identity) &&
        Boolean(resourceId?.trim()) &&
        info?.identity !== resourceId?.trim();
      if (
        readable &&
        info?.versionCode !== undefined &&
        previousVersionCode !== undefined &&
        info.versionCode <= previousVersionCode &&
        !mismatch
      ) {
        toast.warning(
          `包体版本未递增（versionCode ${info.versionCode} ≤ 上次 ${previousVersionCode}），请修改版本后再提交。`,
        );
        setVersionEditor({
          uid,
          file,
          previousVersion: current?.previousVersion,
          previousVersionCode,
          mismatch: false,
        });
        return;
      }
      if (readable && info) {
        toast.success(`已从包体读取版本 ${formatPackageVersion(info)}，已锁定`);
      } else {
        toast.warning(
          `无法从该包体解析版本${info?.reason ? `：${info.reason}` : ""}，请手动填写。`,
        );
      }
    } catch (error) {
      log.error("download/file", `包体导入失败: ${file.name}`, {
        data: { name: file.name, error },
      });
      toast.error((error as Error).message);
    }
  };

  const applyVersionEdit = (updated: File, info: PackageVersionInfo) => {
    if (!versionEditor) return;
    const sourceId = downloads.find((d) => d.uid === versionEditor.uid)?.file?.id;
    for (const row of downloads) {
      if (!row.file) continue;
      if (row.uid !== versionEditor.uid && (!sourceId || row.file.id !== sourceId)) {
        continue;
      }
      onUpdateRow(row.uid, (r) => ({
        ...r,
        file: r.file ? { ...r.file, file: updated } : r.file,
        version: info.version ?? r.version,
        versionCode: info.versionCode ?? r.versionCode,
        versionLocked: true,
        versionSource: "package",
        packageWritable: info.writable,
        packageIdentity: info.identity,
        packageIdentityKind: info.identityKind,
      }));
    }
    log.info("download/version", "包体版本已改写", {
      data: {
        sourceId: sourceId ?? null,
        version: info.version ?? null,
        versionCode: info.versionCode ?? null,
      },
    });
  };

  return (
    <SectionCard
      title={title}
      description={description}
      headerExtra={
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="下载配置字段说明"
          title="下载配置字段说明"
        >
          <QuestionIcon size={14} weight="bold" />
        </button>
      }
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
                  将第一行已填写的版本号、包体文件、加密上传设置和更新日志复制到所有其他设备行。此操作会覆盖已有配置，确定继续吗？
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
                className={`rounded-lg border bg-black/20 p-2.5 ${
                  isNonIncrementRow(item)
                    ? "border-red-400/60"
                    : "border-white/10"
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="shrink-0 text-xs font-medium text-white/55">
                    设备 {index + 1}
                  </span>
                  <div
                    className="min-w-[120px] flex-1"
                    style={{
                      minWidth: `${Math.min(
                        260,
                        110 +
                          (
                            sortedDeviceOptions.find(
                              (opt) => opt.id === item.platformId,
                            )?.name || item.platformId || ""
                          ).length *
                            7,
                      )}px`,
                    }}
                  >
                    <Select.Root
                      value={item.platformId || undefined}
                      onValueChange={(value) => {
                        const device = sortedDeviceOptions.find(
                          (opt) => opt.id === value,
                        );
                        log.info("download/row", "选择设备", {
                          data: {
                            deviceId: value,
                            deviceName: device?.name ?? null,
                          },
                        });
                        onUpdateRow(item.uid, (row) => ({
                          ...row,
                          platformId: value,
                        }));
                      }}
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
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setUpdateLogEditor({
                          uid: item.uid,
                          entries: (item.updatelogs ?? []).map((log) => ({
                            ...log,
                          })),
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      <NotebookIcon size={14} weight="bold" />
                      配置更新日志
                      {item.updatelogs && item.updatelogs.length > 0
                        ? `（${item.updatelogs.length} 条）`
                        : ""}
                    </button>
                    <button
                      className="rounded-lg p-1 text-white/60 transition hover:bg-red-500/10 hover:text-red-300"
                      onClick={() => onRemoveRow(item.uid)}
                    >
                      <MinusIcon size={16} weight="bold" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
                  {item.versionLocked ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-sm text-white/85">
                        {item.version ? `版本 ${item.version}` : "版本未知"}
                        {item.versionCode !== undefined && (
                          <span className="text-xs text-white/45">
                            versionCode {item.versionCode}
                          </span>
                        )}
                        <span title="由包体自动读取，请勿手动修改">
                          <LockSimpleIcon
                            size={13}
                            weight="bold"
                            className="text-white/45"
                          />
                        </span>
                      </span>
                      {item.file &&
                        !item.file.skipUpload &&
                        item.packageWritable && (
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            disabled={isIdentityMismatch(item)}
                            title={
                              isIdentityMismatch(item)
                                ? "包体包名与资源 ID 不一致，禁止修改版本"
                                : "修改包体版本"
                            }
                            onClick={() =>
                              setVersionEditor({
                                uid: item.uid,
                                file: item.file!.file,
                                previousVersion: item.previousVersion,
                                previousVersionCode: item.previousVersionCode,
                                mismatch: isIdentityMismatch(item),
                              })
                            }
                          >
                            <PencilSimpleLineIcon size={13} weight="bold" />
                            修改版本
                          </Button>
                        )}
                      {(item.previousVersion !== undefined ||
                        item.previousVersionCode !== undefined) && (
                        <span className="text-xs text-white/40">
                          上次发布 {item.previousVersion ?? "-"}
                          {item.previousVersionCode !== undefined
                            ? ` · ${item.previousVersionCode}`
                            : ""}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="w-28 shrink-0 md:w-36">
                        <TextField.Root
                          placeholder="版本号"
                          value={item.version}
                          radius="large"
                          className="min-w-0 w-full"
                          onChange={(e) => {
                            const device = sortedDeviceOptions.find(
                              (opt) => opt.id === item.platformId,
                            );
                            logFieldChange(
                              `download-version-${item.uid}`,
                              `版本号(${device?.name ?? (item.platformId || "未选设备")})`,
                              e.target.value,
                            );
                            onUpdateRow(item.uid, (row) => ({
                              ...row,
                              version: e.target.value,
                            }));
                          }}
                        />
                      </div>

                      <div
                        className="w-24 shrink-0 md:w-28"
                        title="数字版本号（versionCode），客户端用它检测是否有更新"
                      >
                        <TextField.Root
                          placeholder="versionCode"
                          value={
                            item.versionCode !== undefined
                              ? String(item.versionCode)
                              : ""
                          }
                          radius="large"
                          className="min-w-0 w-full"
                          inputMode="numeric"
                          onChange={(e) => {
                            const device = sortedDeviceOptions.find(
                              (opt) => opt.id === item.platformId,
                            );
                            const raw = e.target.value.trim();
                            const parsed = raw === "" ? NaN : Number(raw);
                            logFieldChange(
                              `download-version-code-${item.uid}`,
                              `versionCode(${device?.name ?? (item.platformId || "未选设备")})`,
                              raw,
                            );
                            onUpdateRow(item.uid, (row) => ({
                              ...row,
                              versionCode:
                                raw !== "" && Number.isFinite(parsed) && parsed >= 0
                                  ? Math.trunc(parsed)
                                  : undefined,
                            }));
                          }}
                        />
                      </div>
                    </>
                  )}

                  {isIdentityMismatch(item) && (
                    <span className="w-full text-xs text-red-300">
                      包体包名（{item.packageIdentity}）与资源 ID（{resourceId}）不一致，将无法自动检查更新，且禁止修改版本。
                    </span>
                  )}

                  {isNonIncrementRow(item) && (
                    <span className="w-full text-xs text-red-300">
                      versionCode 未递增（{item.versionCode} ≤ 上次{" "}
                      {item.previousVersionCode}），请点「修改版本」。
                    </span>
                  )}

                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {item.file ? (
                      <>
                        <Button
                          radius="large"
                          onClick={() => void pickDownloadFile(item.uid)}
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
                          onClick={() => void pickDownloadFile(item.uid)}
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
                        onClick={() => void pickDownloadFile(item.uid)}
                      >
                        <UploadSimpleIcon size={16} weight="bold" />
                        请上传文件
                      </Button>
                    )}
                  </div>

                  {isVip && allowEncryption && (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-white/65">加密上传</span>
                      <Switch
                        checked={Boolean(item.encryptOnUpload)}
                        disabled={Boolean(item.existingFileName)}
                        onCheckedChange={(checked) => {
                          log.info("download/row", "切换加密上传", {
                            data: {
                              deviceId: item.platformId,
                              encryptOnUpload: checked,
                            },
                          });
                          onUpdateRow(item.uid, (row) => ({
                            ...row,
                            encryptOnUpload: checked,
                          }));
                        }}
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

      {versionEditor && (
        <VersionEditorDialog
          open={versionEditor !== null}
          onOpenChange={(open) => {
            if (!open) setVersionEditor(null);
          }}
          file={versionEditor.file}
          previousVersion={versionEditor.previousVersion}
          previousVersionCode={versionEditor.previousVersionCode}
          identityMismatch={versionEditor.mismatch}
          onApply={applyVersionEdit}
        />
      )}

      <Dialog.Root
        open={updateLogEditor !== null}
        onOpenChange={(open) => {
          if (!open) setUpdateLogEditor(null);
        }}
      >
        <Dialog.Content maxWidth="620px">
          <Dialog.Title>配置更新日志</Dialog.Title>
          <Dialog.Description size="2">
            按版本记录资源更新内容，发布后客户端可在资源更新时展示。
          </Dialog.Description>
          <div className="mt-3 flex max-h-[var(--ui-viewport-height-52pct)] flex-col gap-3 overflow-y-auto pr-1">
            {updateLogEditor?.entries.map((log, index) => (
              <div
                key={index}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-white/55">
                    第 {index + 1} 条
                  </span>
                  <Button
                    size="1"
                    variant="ghost"
                    color="red"
                    onClick={() => removeUpdateLogEntry(index)}
                  >
                    <TrashIcon size={14} />
                    删除
                  </Button>
                </div>
                <TextField.Root
                  placeholder="版本号，如 1.2.0"
                  value={log.version}
                  radius="large"
                  className="w-full"
                  onChange={(e) =>
                    updateUpdateLogEntry(index, { version: e.target.value })
                  }
                />
                <TextArea
                  placeholder="本次更新内容，每行一条"
                  value={log.content}
                  radius="large"
                  className="mt-2 w-full"
                  rows={3}
                  onChange={(e) =>
                    updateUpdateLogEntry(index, { content: e.target.value })
                  }
                />
              </div>
            ))}
            {(!updateLogEditor || updateLogEditor.entries.length === 0) && (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
                还没有更新日志。可添加多条，按版本展示更新内容。
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button size="1" variant="soft" color="gray" onClick={addUpdateLogEntry}>
              <PlusIcon size={14} weight="bold" />
              添加一条
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="soft"
                color="gray"
                onClick={() => setUpdateLogEditor(null)}
              >
                取消
              </Button>
              <Button onClick={saveUpdateLogs}>
                <ChecksIcon size={14} weight="bold" />
                保存
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>{title}字段说明</Dialog.Title>
          <div className="mt-3 flex max-h-[var(--ui-viewport-height-56pct)] flex-col gap-3 overflow-y-auto pr-1">
            {DOWNLOAD_FIELD_HELP.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
              >
                <div className="text-sm font-medium text-white/80">
                  {item.label}
                </div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-white/60">
                  {item.description}
                </div>
              </div>
            ))}
          </div>
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
