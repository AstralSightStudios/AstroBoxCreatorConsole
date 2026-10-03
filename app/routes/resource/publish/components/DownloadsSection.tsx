import {
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  WarningDiamondIcon,
  ListChecksIcon,
  CopyIcon,
  ChecksIcon,
  NotebookIcon,
  TrashIcon,
  LockSimpleIcon,
  PencilSimpleLineIcon,
  DotsSixVerticalIcon,
  ArrowUpIcon,
  ArrowDownIcon,
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
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ScrollArea } from "~/components/scroll-area";
import { pickFiles } from "~/logic/publish/file-picker";
import { createUploadItem } from "./uploadUtils";
import {
  type DeviceOption,
  type DownloadIdentityKind,
  type DownloadInput,
  type DownloadVersionSource,
  type ValidatedPackage,
} from "./types";
import type { PublishFieldKey } from "~/logic/publish/validation";
import { type UploadItem, FieldHelpButton, FieldHelpDialog, SectionCard } from "./shared";
import { EncryptConfigDialog } from "./EncryptConfigDialog";
import { VersionEditorDialog } from "./VersionEditorDialog";
import { toast } from "sonner";
import { log } from "~/logic/logging";
import { logFieldChange } from "~/logic/logging/publish-flow";
import type { UpdateLogEntry } from "./types";
import {
  createUpdateLogDraft,
  duplicateUpdateLogVersions,
  moveToSlot,
  nextUpdateLogVersion,
  reorderById,
  type UpdateLogDraft,
} from "~/logic/publish/update-log-draft";
import {
  computePackageHash,
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
    description:
      "按版本记录本次更新内容，用户更新资源时会看到这些说明。同一包体里版本号不能重复；新添加的一条默认填入当前导入包的版本。可拖动或点上下箭头调整顺序，越靠上越先显示。",
  },
  {
    label: "批量选择设备 / 一键填充",
    description:
      "多设备资源可批量添加设备行，或将第一行的配置快速复制到其他设备行。",
  },
];

/** `1.2.3（65536）`：展示版本 + 由包体派生的 versionCode。 */
function formatVersionWithCode(version?: string, versionCode?: number): string {
  const label = version?.trim() || "-";
  return versionCode !== undefined ? `${label}（${versionCode}）` : label;
}

interface DownloadsSectionProps {
  title?: string;
  description?: string;
  /** 校验失败时滚动闪烁的锚点，取值见 PublishFieldKey。 */
  fieldKey?: PublishFieldKey;
  emptyMessage?: string;
  helperText?: string;
  downloads: DownloadInput[];
  sortedDeviceOptions: DeviceOption[];
  isDeviceLoading: boolean;
  deviceError: string;
  isVip: boolean;
  resourceId?: string;
  allowEncryption?: boolean;
  /** 包体选择器接受的扩展名（逗号分隔）。仅作提示，真实识别靠包体格式。 */
  fileAccept?: string;
  validateFile?: (file: File) => Promise<ValidatedPackage>;
  onAddRow: () => void;
  onRemoveRow: (uid: string) => void;
  onUpdateRow: (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => void;
  onBatchSetDevices?: (selectedIds: string[]) => void;
  /** 转发下载行里付费平台映射弹窗的状态回报，供发布校验使用。 */
  onPaidMappingStateChange?: (hasMapping: boolean) => void;
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
  fieldKey = "downloads",
  emptyMessage = "还未添加任何设备",
  helperText = "应最少添加一个设备才能发布资源。",
  downloads,
  sortedDeviceOptions,
  isDeviceLoading,
  deviceError,
  isVip,
  resourceId,
  allowEncryption = true,
  fileAccept,
  validateFile,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onBatchSetDevices,
  onFillAll,
  onPaidMappingStateChange,
}: DownloadsSectionProps) {
  const [batchSelectOpen, setBatchSelectOpen] = useState(false);
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [versionEditor, setVersionEditor] = useState<{
    uid: string;
    file: File;
    previousVersionCode?: number;
    mismatch: boolean;
  } | null>(null);
  const [updateLogEditor, setUpdateLogEditor] = useState<{
    uid: string;
    packageVersion: string;
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

  const saveUpdateLogs = (entries: UpdateLogEntry[]) => {
    if (!updateLogEditor) return;
    const { uid } = updateLogEditor;
    const row = downloads.find((d) => d.uid === uid);
    const device = sortedDeviceOptions.find((opt) => opt.id === row?.platformId);
    log.info("download/row", "保存更新日志", {
      data: {
        deviceId: row?.platformId ?? null,
        deviceName: device?.name ?? null,
        count: entries.length,
      },
    });
    onUpdateRow(uid, (r) => ({
      ...r,
      updatelogs: entries.length > 0 ? entries : undefined,
    }));
    setUpdateLogEditor(null);
  };

  const pickDownloadFile = async (uid: string) => {
    const files = await pickFiles({ accept: fileAccept, title: "选择包体文件" });
    const file = files[0];
    if (!file) return;
    log.info("download/file", "选择包体文件", {
      data: { name: file.name, size: file.size },
    });
    try {
      // validateFile 可能就地改写过包内 ID，必须用它返回的那份，
      // 否则行里存的是改写前的包体，发布时又会被改一次。
      const validated = await validateFile?.(file);
      const info = validated?.info;
      const resolved = validated?.file ?? file;
      const uploadItem = createUploadItem(resolved);
      const packageHash = await computePackageHash(resolved);
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
          previousVersionCode,
          mismatch: false,
        });
        return;
      }
      // 版本读取成功不提示：包内 ID 改写提示已由 validateFile 在导入时给出，
      // 而「已锁定」是静默状态，行内版本列已经能看到读到的值。
      if (!readable) {
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
      fieldKey={fieldKey}
      headerExtra={
        <FieldHelpButton
          onClick={() => setHelpOpen(true)}
          title="下载配置字段说明"
        />
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
              <Popover.Content width="320px">
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
                data-download-row-uid={item.uid}
                className={`flex flex-col gap-2.5 rounded-lg border bg-black/20 p-2.5 ${
                  isNonIncrementRow(item)
                    ? "border-red-400/60"
                    : "border-white/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 md:max-w-md">
                    <span className="shrink-0 text-xs font-medium text-white/55">
                      设备 {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
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
                  </div>
                  <button
                    type="button"
                    aria-label="删除该设备行"
                    title="删除"
                    className="ml-auto shrink-0 rounded-lg p-1 text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => onRemoveRow(item.uid)}
                  >
                    <MinusIcon size={16} weight="bold" />
                  </button>
                </div>

                <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2">
                  {(item.file || item.existingFileName) && (
                    <div className="min-w-0 md:grow md:shrink md:basis-[300px]">
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
                                    previousVersionCode: item.previousVersionCode,
                                    mismatch: isIdentityMismatch(item),
                                  })
                                }
                              >
                                <PencilSimpleLineIcon size={13} weight="bold" />
                                修改版本
                              </Button>
                            )}
                          {item.previousVersion !== undefined ||
                          item.previousVersionCode !== undefined ? (
                            <span className="text-xs text-white/40">
                              {item.versionSource === "package"
                                ? "版本更新："
                                : "上次发布 "}
                              {item.versionSource === "package" ? (
                                <>
                                  {formatVersionWithCode(
                                    item.previousVersion,
                                    item.previousVersionCode,
                                  )}
                                  {" → "}
                                  {formatVersionWithCode(
                                    item.version,
                                    item.versionCode,
                                  )}
                                </>
                              ) : (
                                formatVersionWithCode(
                                  item.previousVersion,
                                  item.previousVersionCode,
                                )
                              )}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 md:w-36 md:flex-none">
                            <TextField.Root
                              placeholder="版本号"
                              value={item.version}
                              radius="large"
                              disabled={!item.file}
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
                            className="min-w-0 flex-1 md:w-28 md:flex-none"
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
                              disabled={!item.file}
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
                        </div>
                      )}
                    </div>
                  )}

                  {(item.file || item.existingFileName) && (
                    <div className="flex min-w-0 items-center gap-2 md:grow md:shrink md:basis-[200px]">
                      {item.file ? (
                        <span className="min-w-0 truncate text-white/80">
                          {item.file.name}
                        </span>
                      ) : (
                        <span className="min-w-0 truncate text-emerald-100">
                          当前: {item.existingFileName}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {isIdentityMismatch(item) && (
                  <p className="text-xs text-red-300">
                    包体包名（{item.packageIdentity}）与资源 ID（{resourceId}）不一致，将无法自动检查更新，且禁止修改版本。
                  </p>
                )}
                {isNonIncrementRow(item) && (
                  <p className="text-xs text-red-300">
                    versionCode 未递增（{item.versionCode} ≤ 上次{" "}
                    {item.previousVersionCode}），请点「修改版本」。
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isVip && allowEncryption && (
                    <div className="flex shrink-0 items-center gap-2 max-lg:ml-auto">
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
                      {/*
                        付费映射与自有网站授权的入口不再挂在「加密上传」开关之下。
                        付费与加密是两项独立功能：「付费但不加密」（走自有支付路径校验）
                        与「仅加密不售卖」都是合法配置，若继续以 encryptOnUpload 作为
                        渲染前提，这两种作者在发布页将无从配置。
                      */}
                      <EncryptConfigDialog
                        resourceId={resourceId || ""}
                        deviceId={item.platformId}
                        deviceName={
                          sortedDeviceOptions.find(
                            (opt) => opt.id === item.platformId,
                          )?.name || item.platformId
                        }
                        triggerDisabled={false}
                        onMappingStateChange={onPaidMappingStateChange}
                        allDeviceIds={downloads
                          .map((d) => d.platformId)
                          .filter(Boolean)}
                      />
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
                    <Button
                      radius="large"
                      variant="soft"
                      color="gray"
                      onClick={() =>
                        setUpdateLogEditor({
                          uid: item.uid,
                          packageVersion: item.version ?? "",
                          entries: (item.updatelogs ?? []).map((log) => ({
                            version: log.version,
                            content: log.content,
                          })),
                        })
                      }
                    >
                      <NotebookIcon size={16} weight="bold" />
                      配置更新日志
                      {item.updatelogs && item.updatelogs.length > 0
                        ? `（${item.updatelogs.length} 条）`
                        : ""}
                    </Button>
                    <Button
                      radius="large"
                      variant={
                        item.file || item.existingFileName ? "outline" : "solid"
                      }
                      onClick={() => void pickDownloadFile(item.uid)}
                    >
                      <UploadSimpleIcon size={16} weight="bold" />
                      {item.previousVersion !== undefined ||
                      item.previousVersionCode !== undefined
                        ? "更新包体"
                        : item.file || item.existingFileName
                          ? "更换包体"
                          : "导入包体"}
                    </Button>
                  </div>
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
          previousVersionCode={versionEditor.previousVersionCode}
          identityMismatch={versionEditor.mismatch}
          onApply={applyVersionEdit}
        />
      )}

      {updateLogEditor && (
        <UpdateLogEditorDialog
          packageVersion={updateLogEditor.packageVersion}
          initialEntries={updateLogEditor.entries}
          onClose={() => setUpdateLogEditor(null)}
          onSave={saveUpdateLogs}
        />
      )}

      <FieldHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title={`${title}字段说明`}
        items={DOWNLOAD_FIELD_HELP}
      />

      <div className="flex flex-col px-1.5 py-1 w-full">
        {helperText && <p className="text-xs text-white/60">{helperText}</p>}
      </div>
    </SectionCard>
  );
}

function UpdateLogCard({
  log,
  index,
  entryCount,
  duplicated,
  onDragHandlePointerDown,
  onMove,
  onRemove,
  onVersionChange,
  onContentChange,
}: {
  log: UpdateLogDraft;
  index: number;
  entryCount: number;
  duplicated: boolean;
  onDragHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onVersionChange: (version: string) => void;
  onContentChange: (content: string) => void;
}) {
  return (
    <div
      data-log-slot=""
      data-log-id={log.id}
      className={`rounded-lg border bg-white/[0.03] p-3 ${
        duplicated ? "border-red-400/45" : "border-white/10"
      }`}
    >
      <div className="mb-2 flex items-center gap-1">
        <div
          role="button"
          tabIndex={0}
          aria-label="拖动排序"
          className="cursor-grab touch-none rounded p-1.5 text-white/40 active:cursor-grabbing"
          onPointerDown={onDragHandlePointerDown}
        >
          <DotsSixVerticalIcon size={15} weight="bold" />
        </div>
        <span className="min-w-0 flex-1 text-xs font-medium text-white/55">
          第 {index + 1} 条
        </span>
        <button
          type="button"
          disabled={index === 0}
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
          onClick={() => onMove(-1)}
          aria-label="上移"
        >
          <ArrowUpIcon size={14} />
        </button>
        <button
          type="button"
          disabled={index === entryCount - 1}
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
          onClick={() => onMove(1)}
          aria-label="下移"
        >
          <ArrowDownIcon size={14} />
        </button>
        <Button size="1" variant="ghost" color="red" onClick={onRemove}>
          <TrashIcon size={14} />
          删除
        </Button>
      </div>
      <TextField.Root
        placeholder="版本号，如 1.2.0"
        value={log.version}
        radius="large"
        color={duplicated ? "red" : undefined}
        className="w-full"
        onChange={(event) => onVersionChange(event.target.value)}
      />
      {duplicated && (
        <p className="mt-1 text-xs text-red-300">版本号与其他日志重复</p>
      )}
      <TextArea
        placeholder="本次更新内容，每行一条"
        value={log.content}
        radius="large"
        className="mt-2 w-full"
        rows={3}
        onChange={(event) => onContentChange(event.target.value)}
      />
    </div>
  );
}

/** 高次幂的缓入缓出，两端很平、中间很陡。 */
function easeInOutPow(t: number, power: number) {
  const clamped = Math.min(1, Math.max(0, t));
  const scale = 2 ** (power - 1);
  if (clamped < 0.5) return scale * clamped ** power;
  return 1 - (-2 * clamped + 2) ** power / 2;
}

function easeInOutPowInverse(amount: number, power: number) {
  const clamped = Math.min(1, Math.max(0, amount));
  const scale = 2 ** (power - 1);
  if (clamped < 0.5) return (clamped / scale) ** (1 / power);
  return 1 - ((1 - clamped) / scale) ** (1 / power);
}

function UpdateLogEditorDialog({
  packageVersion,
  initialEntries,
  onClose,
  onSave,
}: {
  packageVersion: string;
  initialEntries: UpdateLogEntry[];
  onClose: () => void;
  onSave: (entries: UpdateLogEntry[]) => void;
}) {
  const [entries, setEntries] = useState<UpdateLogDraft[]>(() =>
    initialEntries.map((log) => createUpdateLogDraft(log.version, log.content)),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef(entries);
  const dragSessionRef = useRef<{
    pointerId: number;
    id: string;
    fromIndex: number;
    slot: number;
    scroll: number;
    visual: number;
    animFrom: number;
    animTo: number;
    animStart: number;
    cardCenterY: number;
    lastTick: number;
    ready: boolean;
    dropping: boolean;
  } | null>(null);
  const pointerListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  const dropTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [edgePad, setEdgePad] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [lifted, setLifted] = useState<{
    id: string;
    version: string;
    content: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  entriesRef.current = entries;
  const duplicates = useMemo(() => {
    const persisted = entries.filter(
      (entry) => entry.version.trim() || entry.content.trim(),
    );
    return duplicateUpdateLogVersions(persisted);
  }, [entries]);
  const detachPointerListeners = () => {
    const listeners = pointerListenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.up);
    pointerListenersRef.current = null;
  };

  /** 界面缩放后，把屏幕坐标换回布局像素，避免拖起的卡片被放大撑出横向滚动。 */
  const localScale = (node: HTMLElement) => {
    const layoutWidth = node.offsetWidth;
    if (layoutWidth <= 0) return 1;
    const scale = node.getBoundingClientRect().width / layoutWidth;
    return scale > 0.01 ? scale : 1;
  };

  const getScroller = () => {
    const list = listRef.current;
    if (!list) return null;
    return (
      list.closest<HTMLElement>("[data-overlayscrollbars-viewport]") ??
      list.parentElement
    );
  };

  const slotCards = () => {
    const list = listRef.current;
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLElement>("[data-log-slot]"));
  };

  /** 每个缝对齐到固定线时，滚动容器应处的 scrollTop。 */
  const measureSlotScrollTops = (scroller: HTMLElement, cards: HTMLElement[]) => {
    const scrollerRect = scroller.getBoundingClientRect();
    const lineY = scrollerRect.top + scrollerRect.height / 2;
  const transform = getComputedStyle(scroller).transform;
  const scale =
    !transform || transform === "none" ? 1 : new DOMMatrix(transform).a || 1;
  const toScrollTop = (anchorY: number) =>
    scroller.scrollTop + (anchorY - lineY) / (scale > 0.01 ? scale : 1);
    if (cards.length === 0) return [scroller.scrollTop];
    const first = cards[0].getBoundingClientRect();
    const targets = [toScrollTop(first.top)];
    for (let index = 0; index < cards.length - 1; index++) {
      const above = cards[index].getBoundingClientRect();
      const below = cards[index + 1].getBoundingClientRect();
      targets.push(toScrollTop((above.bottom + below.top) / 2));
    }
    const last = cards[cards.length - 1].getBoundingClientRect();
    targets.push(toScrollTop(last.bottom));
    return targets;
  };

  const endDrag = () => {
    if (dropTimerRef.current != null) {
      window.clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    const scroller = getScroller();
    if (scroller) {
      scroller.style.height = "";
      scroller.style.maxHeight = "";
      scroller.style.transform = "";
      const node = scroller;
      window.setTimeout(() => {
        node.style.transition = "";
        node.style.transformOrigin = "";
      }, 170);
    }
    detachPointerListeners();
    dragSessionRef.current = null;
    setDraggingId(null);
    setLifted(null);
    setDropping(false);
    setEdgePad(0);
  };

  useEffect(() => {
    if (!draggingId) return;
    const scroller = getScroller();
    const session = dragSessionRef.current;
    if (!scroller || !session) return;
    scroller.style.transition = "transform 150ms ease";
    scroller.style.transformOrigin = "center center";
    scroller.style.transform = "scale(0.9)";
    const align = (markReady: boolean) => {
      const current = dragSessionRef.current;
      if (!current || current.dropping || current.ready) return;
      const targets = measureSlotScrollTops(scroller, slotCards());
      if (targets.length === 0) return;
      const slot = Math.min(current.fromIndex, targets.length - 1);
      scroller.scrollTop = Math.max(0, targets[slot]);
      current.slot = slot;
      current.scroll = scroller.scrollTop;
      current.visual = scroller.scrollTop;
      current.animFrom = scroller.scrollTop;
      current.animTo = scroller.scrollTop;
      current.animStart = 0;
      if (markReady) current.ready = true;
    };
    const frame = requestAnimationFrame(() => align(false));
    const timer = window.setTimeout(() => align(true), 160);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [draggingId, edgePad]);

  useEffect(() => {
    return () => {
      if (dropTimerRef.current != null) {
        window.clearTimeout(dropTimerRef.current);
      }
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      const listeners = pointerListenersRef.current;
      if (!listeners) return;
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.up);
    };
  }, []);

  const moveEntry = (fromId: string, toId: string) => {
    setEntries((current) => reorderById(current, fromId, toId));
  };

  const startHandleDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    index: number,
  ) => {
    if (entriesRef.current.length < 2 || dragSessionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.closest("[data-log-id]");
    const frame = viewportRef.current;
    const scroller = getScroller();
    if (!(card instanceof HTMLElement) || !frame || !scroller) return;
    const cardRect = card.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const uiScale = localScale(frame);
    const entry = entriesRef.current.find((item) => item.id === id);
    const lockedHeight = scroller.clientHeight;
    scroller.style.height = `${lockedHeight}px`;
    scroller.style.maxHeight = `${lockedHeight}px`;
    dragSessionRef.current = {
      pointerId: event.pointerId,
      id,
      fromIndex: index,
      slot: index,
      scroll: scroller.scrollTop,
      visual: scroller.scrollTop,
      animFrom: scroller.scrollTop,
      animTo: scroller.scrollTop,
      animStart: 0,
      cardCenterY: cardRect.top + cardRect.height / 2,
      lastTick: 0,
      ready: false,
      dropping: false,
    };
    setEdgePad(lockedHeight / 2);
    setDropping(false);
    setLifted({
      id,
      version: entry?.version ?? "",
      content: entry?.content ?? "",
      left: (cardRect.left - frameRect.left) / uiScale,
      top: (cardRect.top - frameRect.top) / uiScale,
      width: cardRect.width / uiScale,
      height: cardRect.height / uiScale,
    });
    setDraggingId(id);

    const move = (ev: PointerEvent) => {
      const session = dragSessionRef.current;
      const frameNode = viewportRef.current;
      if (!session || session.dropping || ev.pointerId !== session.pointerId) return;
      if (!frameNode) return;
      ev.preventDefault();
      const frameRectNow = frameNode.getBoundingClientRect();
      const uiScale = localScale(frameNode);
      session.cardCenterY =
        ev.clientY - (event.clientY - cardRect.top) + cardRect.height / 2;
      setLifted((current) =>
        current
          ? {
              ...current,
              top:
                (ev.clientY - frameRectNow.top - (event.clientY - cardRect.top)) /
                uiScale,
            }
          : current,
      );
    };
    const tick = (now: number) => {
      scrollRafRef.current = window.requestAnimationFrame(tick);
      const session = dragSessionRef.current;
      const scrollNode = getScroller();
      if (!session || !scrollNode || session.dropping || !session.ready) {
        if (session) session.lastTick = now;
        return;
      }
      const dt = session.lastTick
        ? Math.min(0.05, (now - session.lastTick) / 1000)
        : 0;
      session.lastTick = now;
      if (dt <= 0) return;
      const targets = measureSlotScrollTops(scrollNode, slotCards());
      if (targets.length === 0) return;
      const scrollRect = scrollNode.getBoundingClientRect();
      const lineY = scrollRect.top + scrollRect.height / 2;
      const offset = session.cardCenterY - lineY;
      const distance = Math.abs(offset) - 12;
      if (distance > 0) {
        const direction = offset > 0 ? 1 : -1;
        const speed = Math.min(distance / 120, 1) * 460;
        session.scroll += direction * speed * dt;
        const lo = Math.min(...targets);
        const hi = Math.max(...targets);
        session.scroll = Math.min(hi, Math.max(lo, session.scroll));
      }
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let slot = 0; slot < targets.length; slot++) {
        const gap = Math.abs(session.scroll - targets[slot]);
        if (gap < best) {
          best = gap;
          nearest = slot;
        }
      }
      session.slot = nearest;
      const target = Math.max(0, targets[nearest]);
      const easePower = 6;
      const easeMs = 240;
      if (Math.abs(target - session.animTo) > 0.5) {
        const previousSpan = session.animTo - session.animFrom;
        const traveled =
          previousSpan === 0
            ? 0
            : (session.visual - session.animFrom) / previousSpan;
        const sameWay =
          Math.abs(previousSpan) > 0.5 &&
          Math.sign(target - session.visual) === Math.sign(previousSpan) &&
          traveled > 0 &&
          traveled < 1;
        if (sameWay) {
          const nextSpan = target - session.animFrom;
          const nextAmount =
            nextSpan === 0 ? 1 : (session.visual - session.animFrom) / nextSpan;
          const progress = easeInOutPowInverse(nextAmount, easePower);
          session.animTo = target;
          session.animStart = now - progress * easeMs;
        } else {
          session.animFrom = session.visual;
          session.animTo = target;
          session.animStart = now;
        }
      }
      const progress = Math.min(1, Math.max(0, (now - session.animStart) / easeMs));
      session.visual =
        session.animFrom +
        (session.animTo - session.animFrom) * easeInOutPow(progress, easePower);
      if (Math.abs(target - session.visual) < 0.4) {
        session.visual = target;
        session.animFrom = target;
        session.animTo = target;
      }
      scrollNode.scrollTop = Math.max(0, session.visual);
    };
    const up = (ev: PointerEvent) => {
      const session = dragSessionRef.current;
      const frameNode = viewportRef.current;
      const scrollNode = getScroller();
      if (!session || ev.pointerId !== session.pointerId || session.dropping) return;
      session.dropping = true;
      detachPointerListeners();
      if (!frameNode || !scrollNode) {
        endDrag();
        return;
      }
      setDropping(true);
      requestAnimationFrame(() => {
        const frameRectNow = frameNode.getBoundingClientRect();
        const scrollRect = scrollNode.getBoundingClientRect();
        const lineY = scrollRect.top + scrollRect.height / 2;
        const uiScale = localScale(frameNode);
        setLifted((current) =>
          current
            ? {
                ...current,
                top: (lineY - frameRectNow.top) / uiScale - current.height / 2,
              }
            : current,
        );
        dropTimerRef.current = window.setTimeout(() => {
          dropTimerRef.current = null;
          const latest = dragSessionRef.current;
          if (latest) {
            setEntries((current) =>
              moveToSlot(current, latest.fromIndex, latest.slot),
            );
          }
          endDrag();
        }, 160);
      });
    };
    detachPointerListeners();
    pointerListenersRef.current = { move, up };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    scrollRafRef.current = window.requestAnimationFrame(tick);
  };

  const addEntry = () => {
    const version = nextUpdateLogVersion(entries, packageVersion);
    setEntries((current) => [createUpdateLogDraft(version), ...current]);
  };

  const save = () => {
    const cleaned = entries
      .map((log) => ({
        version: log.version.trim(),
        content: log.content.trim(),
      }))
      .filter((log) => log.version || log.content);
    const duplicated = duplicateUpdateLogVersions(cleaned);
    if (duplicated.size > 0) {
      const label = [...duplicated]
        .map((version) => (version ? version : "（空版本号）"))
        .join("、");
      toast.error(`更新日志的版本号不能重复：${label}`);
      return;
    }
    onSave(cleaned);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="620px">
        <Dialog.Title>配置更新日志</Dialog.Title>
        <Dialog.Description size="2">
          越靠上的日志越先显示。新添加的一条默认使用当前导入包的版本号；该版本已有日志时版本号留空。拖动左侧手柄或点上下箭头可调整顺序。
        </Dialog.Description>
        <div ref={viewportRef} className="relative mt-3 overflow-x-clip">
        <ScrollArea
          className={`max-h-[var(--ui-viewport-height-52pct)] ${
            draggingId ? "log-drag-scroll" : ""
          }`}
        >
          <div
            ref={listRef}
            className={`flex flex-col gap-3 pr-1 ${draggingId ? "touch-none select-none" : ""}`}
            style={
              edgePad > 0
                ? { paddingTop: edgePad, paddingBottom: edgePad }
                : undefined
            }
          >
            {entries.map((log, index) => {
              if (log.id === draggingId) return null;
              const versionKey = log.version.trim();
              const duplicated =
                duplicates.has(versionKey) &&
                (versionKey !== "" || log.content.trim() !== "");
              return (
                <UpdateLogCard
                  key={log.id}
                  log={log}
                  index={index}
                  entryCount={entries.length}
                  duplicated={duplicated}
                  onDragHandlePointerDown={(event) =>
                    startHandleDrag(event, log.id, index)
                  }
                  onMove={(direction) => {
                    const target = entries[index + direction];
                    if (target) moveEntry(log.id, target.id);
                  }}
                  onRemove={() =>
                    setEntries((current) =>
                      current.filter((entry) => entry.id !== log.id),
                    )
                  }
                  onVersionChange={(version) =>
                    setEntries((current) =>
                      current.map((entry) =>
                        entry.id === log.id ? { ...entry, version } : entry,
                      ),
                    )
                  }
                  onContentChange={(content) =>
                    setEntries((current) =>
                      current.map((entry) =>
                        entry.id === log.id ? { ...entry, content } : entry,
                      ),
                    )
                  }
                />
              );
            })}
            {entries.length === 0 && (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
                还没有更新日志。可添加多条，按版本展示更新内容。
              </p>
            )}
          </div>
        </ScrollArea>
        {draggingId && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-400"
          />
        )}
        {lifted && (
          <div
            className={`pointer-events-none absolute z-20 ${
              dropping ? "transition-[top,left] duration-150 ease-out" : ""
            }`}
            style={{
              left: lifted.left,
              top: lifted.top,
              width: lifted.width,
            }}
          >
            {entries
              .filter((entry) => entry.id === lifted.id)
              .map((entry) => {
                const liftedIndex = entries.findIndex((item) => item.id === entry.id);
                const versionKey = entry.version.trim();
                const duplicated =
                  duplicates.has(versionKey) &&
                  (versionKey !== "" || entry.content.trim() !== "");
                return (
                  <UpdateLogCard
                    key={entry.id}
                    log={entry}
                    index={liftedIndex}
                    entryCount={entries.length}
                    duplicated={duplicated}
                    onDragHandlePointerDown={() => {}}
                    onMove={() => {}}
                    onRemove={() => {}}
                    onVersionChange={() => {}}
                    onContentChange={() => {}}
                  />
                );
              })}
          </div>
        )}
        </div>
        {duplicates.size > 0 && (
          <p className="mt-2 text-xs text-red-300">
            存在重复的版本号，请修改后再保存。
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button size="1" variant="soft" color="gray" onClick={addEntry}>
            <PlusIcon size={14} weight="bold" />
            添加一条
          </Button>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="soft" color="gray" onClick={onClose}>
              取消
            </Button>
            <Button onClick={save}>
              <ChecksIcon size={14} weight="bold" />
              保存
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
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
      <ScrollArea className="max-h-[280px]">
        <div className="flex flex-col gap-2.5">
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
      </ScrollArea>
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
