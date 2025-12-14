import {
  PlusCircleIcon,
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  XCircleIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { Button, TextField, Table, Select, Callout } from "@radix-ui/themes";
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
                  <span className="text-white/60">还未添加任何设备</span>
                </Table.RowHeaderCell>
                <Table.RowHeaderCell />
                <Table.RowHeaderCell />
              </Table.Row>
            )}
          </Table.Body>
        </Table.Root>
      </div>

      <div className="flex flex-col px-1.5 py-1 w-full">
        <p className="text-xs text-white/60">
          应最少添加一个设备才能发布资源。
        </p>
      </div>
    </SectionCard>
  );
}
