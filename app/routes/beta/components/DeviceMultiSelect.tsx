import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button, Checkbox, Popover, Text, TextField } from "~/components/ScaleAwareThemes";
import { ScrollArea } from "~/components/scroll-area";
import type { DeviceOption } from "~/logic/devices/catalog";

/**
 * 测试包的支持设备多选。已被同一版本里其它包体占用的设备不可选
 * （服务端要求一台设备只对应一个包）。
 */
export default function DeviceMultiSelect({
    options,
    value,
    onChange,
    takenBy,
    disabled,
}: {
    options: DeviceOption[];
    value: string[];
    onChange: (next: string[]) => void;
    /** 设备 ID → 占用它的包体名 */
    takenBy: Map<string, string>;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = useMemo(() => new Set(value), [value]);
    const groups = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        const map = new Map<string, DeviceOption[]>();
        for (const option of options) {
            if (
                keyword &&
                !option.name.toLowerCase().includes(keyword) &&
                !option.id.toLowerCase().includes(keyword) &&
                !option.aliases?.some((alias) => alias.toLowerCase().includes(keyword))
            ) {
                continue;
            }
            const vendor = option.vendor || "其他";
            map.set(vendor, [...(map.get(vendor) ?? []), option]);
        }
        return map;
    }, [options, query]);
    const nameOf = useMemo(() => new Map(options.map((option) => [option.id, option.name])), [options]);

    const toggle = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onChange(Array.from(next));
    };

    const summary =
        value.length === 0
            ? "选择支持的设备"
            : value.length <= 2
              ? value.map((id) => nameOf.get(id) ?? id).join("、")
              : `${nameOf.get(value[0]!) ?? value[0]} 等 ${value.length} 台设备`;

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger>
                <Button
                    variant="soft"
                    color={value.length === 0 ? "amber" : "gray"}
                    disabled={disabled}
                    className="w-full justify-between!"
                >
                    <span className="truncate">{summary}</span>
                    <CaretDownIcon size={14} />
                </Button>
            </Popover.Trigger>
            <Popover.Content width="340px" className="p-3!">
                <div className="flex flex-col gap-2.5">
                    <TextField.Root
                        size="2"
                        placeholder="搜索设备名称、ID 或型号"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    >
                        <TextField.Slot>
                            <MagnifyingGlassIcon size={14} />
                        </TextField.Slot>
                    </TextField.Root>
                    <ScrollArea className="max-h-[300px]">
                        <div className="flex flex-col gap-2.5 pr-1">
                            {groups.size === 0 && (
                                <Text size="2" color="gray" className="py-4 text-center">
                                    没有匹配的设备
                                </Text>
                            )}
                            {Array.from(groups.entries()).map(([vendor, devices]) => (
                                <div key={vendor} className="flex flex-col gap-1">
                                    <Text size="1" color="gray" weight="medium" className="px-0.5">
                                        {vendor}
                                    </Text>
                                    {devices.map((device) => {
                                        const owner = takenBy.get(device.id);
                                        return (
                                            <label
                                                key={device.id}
                                                className={`flex items-center gap-2 rounded-md px-1.5 py-1 transition ${
                                                    owner ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-white/5"
                                                }`}
                                            >
                                                <Checkbox
                                                    checked={selected.has(device.id)}
                                                    disabled={Boolean(owner)}
                                                    onCheckedChange={() => toggle(device.id)}
                                                />
                                                <Text size="2" className="min-w-0 flex-1 truncate">
                                                    {device.name}
                                                </Text>
                                                <Text size="1" color="gray" className="shrink-0">
                                                    {owner ? `已用于 ${owner}` : device.id}
                                                </Text>
                                            </label>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2">
                        <Text size="1" color="gray">
                            已选 {value.length} 台
                        </Text>
                        <div className="flex gap-2">
                            {value.length > 0 && (
                                <Button size="1" variant="ghost" color="gray" onClick={() => onChange([])}>
                                    清空
                                </Button>
                            )}
                            <Button size="1" onClick={() => setOpen(false)}>
                                完成
                            </Button>
                        </div>
                    </div>
                </div>
            </Popover.Content>
        </Popover.Root>
    );
}
