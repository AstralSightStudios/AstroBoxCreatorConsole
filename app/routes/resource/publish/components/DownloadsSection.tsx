import {
  PlusCircleIcon,
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Button, TextField, Table } from "@radix-ui/themes";
import { useRef } from "react";
import { createUploadItem } from "./uploadUtils";
import { type DeviceOption, type DownloadInput } from "./types";
import { SectionCard } from "./shared";

interface DownloadsSectionProps {
  downloads: DownloadInput[];
  sortedDeviceOptions: DeviceOption[];
  isDeviceLoading: boolean;
  deviceError: string;
  onAddRow: () => void;
  onRemoveRow: (uid: string) => void;
  onUpdateRow: (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => void;
}

export function DownloadsSection({
  downloads,
  sortedDeviceOptions,
  isDeviceLoading,
  deviceError,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
}: DownloadsSectionProps) {
  const downloadFileInputs = useRef<Record<string, HTMLInputElement | null>>(
    {},
  );

  const pickDownloadFile = (uid: string) => {
    const node = downloadFileInputs.current[uid];
    node?.click();
  };

  return (
    <SectionCard
      title="资源下载配置"
      description="为不同设备提供不同的资源包体"
    >
      <div className="flex flex-wrap items-center gap-2 pb-1">
        {deviceError && <p className="text-xs text-amber-400">{deviceError}</p>}
        {!deviceError && sortedDeviceOptions.length === 0 && (
          <p className="text-xs text-amber-400">设备列表不可用，请稍后重试</p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <Table.Root>
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
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {downloads.map((item, index) => (
              <Table.Row key={`links-${index}`}>
                <Table.RowHeaderCell width="40px" justify="center" px="0">
                  {downloads.length > 1 && (
                    <button
                      className="text-white/60 transition hover:text-red-400 flex items-center justify-center h-[30px] w-[30px] m-auto"
                      onClick={() => onRemoveRow(item.uid)}
                    >
                      <MinusIcon size={16} weight="bold" />
                    </button>
                  )}
                </Table.RowHeaderCell>
                <Table.RowHeaderCell>
                  <select
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition hover:border-white/25 focus:border-white/40"
                    value={item.platformId}
                    onChange={(e) =>
                      onUpdateRow(item.uid, (row) => ({
                        ...row,
                        platformId: e.target.value,
                      }))
                    }
                  >
                    <option value="" disabled>
                      请选择设备
                    </option>
                    {sortedDeviceOptions.map((opt) => {
                      const usedElsewhere = downloads.some(
                        (row, idx) =>
                          idx !== index && row.platformId === opt.id,
                      );
                      return (
                        <option
                          key={opt.id}
                          value={opt.id}
                          disabled={usedElsewhere}
                        >
                          {opt.name}
                          {usedElsewhere ? "（已使用）" : ""}
                        </option>
                      );
                    })}
                  </select>
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
                  <div className="flex flex-wrap items-center gap-2">
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
                    <Button
                      className="styledbtn"
                      radius="large"
                      onClick={() => pickDownloadFile(item.uid)}
                    >
                      <UploadSimpleIcon size={16} /> 选择文件
                    </Button>
                    {item.file ? (
                      <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs text-white/80">
                        {item.file.name}
                      </span>
                    ) : item.existingFileName ? (
                      <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                        当前: {item.existingFileName}
                      </span>
                    ) : (
                      <span className="text-xs text-white/60">未选择文件</span>
                    )}
                  </div>
                </Table.RowHeaderCell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>

        {downloads.length === 0 && (
          <div className="flex flex-col px-1.5 py-1 w-full">
            <p className="text-sm text-white/60">
              目前没有资源配置，添加后才能发布资源
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
