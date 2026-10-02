/**
 * 发布页的弹窗与草稿操作区。
 *
 * 这些区块只负责展示与派发意图，具体状态与副作用留在 new.tsx，
 * 因此这里不持有任何 state。
 */
import {
  AlertDialog,
  Button,
  Dialog,
  Popover,
  Text,
} from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import {
  ArchiveIcon,
  ClockIcon,
  FloppyDiskIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { PublishDraft } from "~/logic/publish/publish-drafts";
import type { DeviceOption, DownloadInput } from "./types";

function deviceLabel(
  sortedDeviceOptions: DeviceOption[],
  platformId: string,
): string {
  return (
    sortedDeviceOptions.find((opt) => opt.id === platformId)?.name ||
    platformId ||
    "未选设备"
  );
}

/** 恢复自动保存草稿的确认框。 */
export function AutoSaveRestoreDialog({
  open,
  savedAtLabel,
  onDismiss,
  onRestore,
}: {
  open: boolean;
  savedAtLabel: string;
  onDismiss: () => void;
  onRestore: () => void;
}) {
  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>发现未保存的草稿</AlertDialog.Title>
        <AlertDialog.Description size="2">
          检测到上次未保存的内容（{savedAtLabel}
          ），是否恢复？
        </AlertDialog.Description>
        <div className="flex justify-end gap-3 mt-4">
          <AlertDialog.Action>
            <Button variant="soft" color="gray" onClick={onDismiss}>
              丢弃
            </Button>
          </AlertDialog.Action>
          <AlertDialog.Action>
            <Button variant="solid" onClick={onRestore}>
              恢复内容
            </Button>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/** 未填写 versionCode 的拦截框。versionCode 为强制项，只能返回填写。 */
export function VersionCodeWarningDialog({
  rows,
  sortedDeviceOptions,
  onLocate,
  onClose,
}: {
  rows: DownloadInput[] | null;
  sortedDeviceOptions: DeviceOption[];
  onLocate: (rows: DownloadInput[]) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={rows !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>未填写 versionCode</Dialog.Title>
        <Dialog.Description size="2">
          以下包体未填写 versionCode。未填写 versionCode
          将导致 AstroBox 无法为用户自动检查更新，填写后方可继续。
        </Dialog.Description>
        <div className="mt-3 flex flex-col gap-1.5">
          {(rows ?? []).map((row, index) => (
            <div
              key={row.uid}
              className="rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            >
              {sortedDeviceOptions.find((opt) => opt.id === row.platformId)
                ?.name ||
                row.platformId ||
                `第 ${index + 1} 行`}
              ：未填写 versionCode
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <Button
            variant="solid"
            onClick={() => {
              if (rows) onLocate(rows);
              onClose();
            }}
          >
            返回填写
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** versionCode 未递增的拦截框。 */
export function VersionIncrementWarningDialog({
  rows,
  sortedDeviceOptions,
  onLocate,
  onClose,
}: {
  rows: DownloadInput[] | null;
  sortedDeviceOptions: DeviceOption[];
  onLocate: (rows: DownloadInput[]) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open={rows !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>versionCode 未递增</Dialog.Title>
        <Dialog.Description size="2">
          以下设备的包体已更新，但 versionCode 未大于上次发布的值，用户将无法检测到更新：
        </Dialog.Description>
        <div className="mt-3 flex flex-col gap-1.5">
          {(rows ?? []).map((row) => (
            <div
              key={row.uid}
              className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            >
              {deviceLabel(sortedDeviceOptions, row.platformId)}
              ：versionCode {row.versionCode} ≤ 上次 {row.previousVersionCode}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <Button
            variant="solid"
            onClick={() => {
              if (rows) onLocate(rows);
              onClose();
            }}
          >
            返回修改版本
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** 保存草稿与草稿箱。仅新建资源时渲染。 */
export function DraftActions({
  draftName,
  draftNamePlaceholder,
  onDraftNameChange,
  saveDraftOpen,
  onSaveDraftOpenChange,
  onSaveDraft,
  popoverOpen,
  onPopoverOpenChange,
  drafts,
  formatDraftTime,
  onRestoreDraft,
  onDeleteDraft,
}: {
  draftName: string;
  draftNamePlaceholder: string;
  onDraftNameChange: (value: string) => void;
  saveDraftOpen: boolean;
  onSaveDraftOpenChange: (open: boolean) => void;
  onSaveDraft: () => void;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  drafts: PublishDraft[];
  formatDraftTime: (savedAt: number) => string;
  onRestoreDraft: (draft: PublishDraft) => void;
  onDeleteDraft: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 w-full">
      <div className="flex gap-1.5">
        <AlertDialog.Root open={saveDraftOpen} onOpenChange={onSaveDraftOpenChange}>
          <AlertDialog.Trigger>
            <Button size="1" variant="soft" color="gray" className="text-xs! flex-1">
              <FloppyDiskIcon size={14} />
              保存草稿
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="380px">
            <AlertDialog.Title>保存草稿</AlertDialog.Title>
            <div className="mt-2">
              <input
                type="text"
                placeholder={draftNamePlaceholder}
                value={draftName}
                onChange={(e) => onDraftNameChange(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  取消
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button variant="solid" onClick={onSaveDraft}>
                  保存
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Root>

        <Popover.Root open={popoverOpen} onOpenChange={onPopoverOpenChange}>
          <Popover.Trigger>
            <Button size="1" variant="soft" color="gray" className="text-xs! flex-1">
              <ArchiveIcon size={14} />
              草稿箱
            </Button>
          </Popover.Trigger>
          <Popover.Content width="300px">
            <ScrollArea className="max-h-[360px]">
              <div className="flex flex-col gap-2">
                <Text size="2" weight="medium">
                  已保存的草稿
                </Text>
                {drafts.length === 0 ? (
                  <Text size="1" color="gray" className="py-4 text-center">
                    暂无草稿
                  </Text>
                ) : (
                  <div className="flex flex-col gap-1">
                    {drafts.map((draft) => (
                      <div
                        key={draft.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 transition group"
                      >
                        <div className="flex-1 min-w-0">
                          <Text size="2" className="truncate block">
                            {draft.name}
                          </Text>
                          <Text size="1" color="gray" className="flex items-center gap-1">
                            <ClockIcon size={10} />
                            {formatDraftTime(draft.savedAt)}
                          </Text>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="1"
                            variant="ghost"
                            onClick={() => onRestoreDraft(draft)}
                            className="mx-0! opacity-0 transition group-hover:opacity-100"
                          >
                            恢复
                          </Button>
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => onDeleteDraft(draft.id)}
                            className="mx-0! opacity-0 transition group-hover:opacity-100"
                          >
                            <TrashIcon size={12} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </Popover.Content>
        </Popover.Root>
      </div>
    </div>
  );
}