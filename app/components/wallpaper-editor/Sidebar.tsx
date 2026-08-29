import { useMemo, useRef, useState } from "react";
import {
    ArrowLeftIcon,
    CircleHalfIcon,
    DotsSixVerticalIcon,
    DownloadSimpleIcon,
    DropIcon,
    FileCodeIcon,
    ImageIcon,
    ImagesIcon,
    TextTIcon,
    TrashIcon,
    UploadIcon,
} from "@phosphor-icons/react";
import type { WallpaperLayerConfig, WallpaperLayerKind } from "~/logic/wallpaper/types";
import {
    EditorActionButton,
    EditorIconButton,
} from "./controls";

export interface SidebarProps {
    title: string;
    onBack: () => void;
    onOpenJson: () => void;
    onSelectCanvas: () => void;
    hasConfig: boolean;
    onUploadTestImage: (file: File) => void;
    onExport: () => void;
    layers: WallpaperLayerConfig[];
    selectedLayerId: string | null;
    onSelectLayer: (id: string) => void;
    onAddLayer: (kind: WallpaperLayerKind) => void;
    onRemoveLayer: (id: string) => void;
    /** 拖拽排序：把 layerId 移动到结果数组的 toIndex 位置。 */
    onMoveLayerTo: (layerId: string, toIndex: number) => void;
}

const LAYER_ADD_ITEMS: Array<{ kind: WallpaperLayerKind; label: string; icon: React.ReactNode }> = [
    { kind: "text", label: "文字", icon: <TextTIcon size={17} weight="regular" /> },
    { kind: "asset", label: "图片素材", icon: <ImageIcon size={17} weight="regular" /> },
    { kind: "glass", label: "玻璃", icon: <DropIcon size={17} weight="regular" /> },
    { kind: "wallpaper", label: "壁纸层", icon: <ImagesIcon size={17} weight="regular" /> },
    { kind: "tint", label: "明暗层", icon: <CircleHalfIcon size={17} weight="regular" /> },
];

const LAYER_TYPE_ICONS: Record<WallpaperLayerKind, React.ReactNode> = {
    wallpaper: <ImagesIcon size={16} weight="regular" />,
    asset: <ImageIcon size={16} weight="regular" />,
    text: <TextTIcon size={16} weight="regular" />,
    tint: <CircleHalfIcon size={16} weight="regular" />,
    glass: <DropIcon size={16} weight="regular" />,
};

function layerTypeIcon(type: WallpaperLayerKind | undefined): React.ReactNode {
    if (type) {
        return LAYER_TYPE_ICONS[type];
    }
    return <ImagesIcon size={16} weight="regular" />;
}

export function Sidebar({
    title,
    onBack,
    onOpenJson,
    onSelectCanvas,
    hasConfig,
    onUploadTestImage,
    onExport,
    layers,
    selectedLayerId,
    onSelectLayer,
    onAddLayer,
    onRemoveLayer,
    onMoveLayerTo,
}: SidebarProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const rowElsRef = useRef<Map<string, HTMLElement | null>>(new Map());
    const suppressClickRef = useRef(false);
    const dragRef = useRef<{
        layerId: string;
        startX: number;
        startY: number;
        active: boolean;
        insertPosition: number;
        lineTop: number;
    } | null>(null);
    const [dragInfo, setDragInfo] = useState<{
        layerId: string;
        active: boolean;
        insertPosition: number;
        lineTop: number;
    } | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        layerId: string;
    } | null>(null);

    // 图层列表按绘制顺序反转展示：最顶层在最上。
    const displayLayers = useMemo(() => [...layers].reverse(), [layers]);

    // 计算插入线位置（展示序 0..L，0=最顶，L=最底）。
    const findInsertPosition = (clientY: number): number => {
        for (let i = 0; i < displayLayers.length; i++) {
            const el = rowElsRef.current.get(displayLayers[i].id);
            const rect = el?.getBoundingClientRect();
            if (!rect) continue;
            if (clientY < rect.top + rect.height / 2) return i;
        }
        return displayLayers.length;
    };

    const computeLineTop = (insertPosition: number): number => {
        const containerTop = scrollRef.current?.getBoundingClientRect().top ?? 0;
        if (displayLayers.length === 0) return 0;
        const rectAt = (i: number) =>
            rowElsRef.current.get(displayLayers[i].id)?.getBoundingClientRect();
        if (insertPosition <= 0) {
            return (rectAt(0)?.top ?? containerTop) - containerTop - 2;
        }
        if (insertPosition >= displayLayers.length) {
            return (
                (rectAt(displayLayers.length - 1)?.bottom ?? containerTop) - containerTop + 2
            );
        }
        const prev = rectAt(insertPosition - 1)?.bottom ?? containerTop;
        const next = rectAt(insertPosition)?.top ?? containerTop;
        return (prev + next) / 2 - containerTop;
    };

    const startDrag = (e: React.PointerEvent, layerId: string) => {
        if (contextMenu) setContextMenu(null);
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = {
            layerId,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            insertPosition: findInsertPosition(e.clientY),
            lineTop: 0,
        };
    };

    const moveDrag = (e: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (!drag.active && moved < 5) return;
        drag.active = true;
        // 靠近容器上下边缘时自动滚动，方便拖到视口外的行。
        const container = scrollRef.current;
        if (container) {
            const rect = container.getBoundingClientRect();
            const threshold = 28;
            if (e.clientY < rect.top + threshold) container.scrollTop -= 8;
            else if (e.clientY > rect.bottom - threshold) container.scrollTop += 8;
        }
        drag.insertPosition = findInsertPosition(e.clientY);
        drag.lineTop = computeLineTop(drag.insertPosition);
        setDragInfo({
            layerId: drag.layerId,
            active: true,
            insertPosition: drag.insertPosition,
            lineTop: drag.lineTop,
        });
    };

    const endDrag = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag?.active) {
            suppressClickRef.current = true;
            const toIndex = layers.length - 1 - Math.min(drag.insertPosition, layers.length - 1);
            onMoveLayerTo(drag.layerId, toIndex);
        }
        setDragInfo(null);
    };

    const openContextMenu = (e: React.MouseEvent, layerId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: Math.min(e.clientX, window.innerWidth - 140),
            y: Math.min(e.clientY, window.innerHeight - 90),
            layerId,
        });
    };

    return (
        <aside
            className="flex h-full w-[var(--editor-sidebar-width)] shrink-0 flex-col"
            style={{ background: "var(--color-editor-bg)" }}
        >
            <div className="flex h-[60px] shrink-0 items-center gap-1.5 p-2">
                <button
                    type="button"
                    onClick={onBack}
                    aria-label="返回发布页"
                    className="grid shrink-0 place-items-center rounded text-white/70 transition hover:bg-white/10 hover:text-white"
                    style={{ width: 34, height: 34 }}
                >
                    <ArrowLeftIcon size={18} weight="regular" />
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[13px] font-medium leading-[18px] text-white">
                        壁纸编辑器
                    </span>
                    <span className="truncate text-[13px] leading-[18px] text-white/75">
                        {title || "未命名壁纸"}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onOpenJson}
                    title="编辑 JSON"
                    aria-label="编辑壁纸配置 JSON"
                    className="grid shrink-0 place-items-center rounded text-white/45 transition hover:bg-white/10 hover:text-white"
                    style={{ width: 34, height: 34 }}
                >
                    <FileCodeIcon size={17} weight="regular" />
                </button>
            </div>
            <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />

            {/* Top actions */}
            <div className="flex w-full shrink-0 flex-col px-[9px] pt-[9px] pb-[9px]" style={{ gap: 6 }}>
                <EditorActionButton
                    icon={<UploadIcon size={15} weight="regular" />}
                    selected
                    onClick={() => fileInputRef.current?.click()}
                >
                    上传测试壁纸
                </EditorActionButton>
                <EditorActionButton
                    icon={<DownloadSimpleIcon size={15} weight="regular" />}
                    disabled={!hasConfig}
                    onClick={onExport}
                >
                    导出全部设备壁纸
                </EditorActionButton>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onUploadTestImage(file);
                        e.target.value = "";
                    }}
                />
            </div>

            {hasConfig && (
                <div className="flex w-full shrink-0 flex-col px-4 py-2">
                    <button
                        type="button"
                        onClick={onSelectCanvas}
                        className="text-left text-[13px] font-medium leading-[18px] text-white/40 transition hover:text-white/75"
                    >
                        壁纸属性编辑区域
                    </button>
                </div>
            )}

            {/* 新建图层 */}
            {hasConfig && (
                <div className="flex w-full shrink-0 flex-col">
                    <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                    <div className="flex w-full flex-col">
                        <h3
                            className="pt-[9px] text-[13px] font-medium leading-[18px] text-white/40"
                            style={{ paddingLeft: 16 }}
                        >
                            新建图层
                        </h3>
                        <div
                            className="grid w-full px-[9px] py-2"
                            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}
                        >
                            {LAYER_ADD_ITEMS.map((item) => (
                                <EditorIconButton
                                    key={item.kind}
                                    title={item.label}
                                    onClick={() => onAddLayer(item.kind)}
                                    style={{ height: 48, borderRadius: 8, flexDirection: "column", gap: 3 }}
                                >
                                    {item.icon}
                                    <span className="text-[11px] leading-[14px]">{item.label}</span>
                                </EditorIconButton>
                            ))}
                        </div>
                    </div>
                    <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
                </div>
            )}

            {/* 图层列表 */}
            {hasConfig && (
                <div className="flex min-h-0 w-full flex-1 flex-col">
                    <h3
                        className="pt-[9px] text-[13px] font-medium leading-[18px] text-white/40"
                        style={{ paddingLeft: 16 }}
                    >
                        图层
                    </h3>
                    <div
                        ref={scrollRef}
                        className="wallpaper-layer-scroll relative min-h-0 flex-1 overflow-y-auto px-[9px] pt-[9px] pb-2"
                    >
                        <div className="flex w-full flex-col" style={{ gap: "var(--editor-layer-row-gap)" }}>
                            {displayLayers.map((layer) => {
                                const isSelected = layer.id === selectedLayerId;
                                const isDragging = dragInfo?.layerId === layer.id;
                                return (
                                    <div
                                        key={layer.id}
                                        ref={(el) => {
                                            rowElsRef.current.set(layer.id, el);
                                        }}
                                        onClick={() => {
                                            if (suppressClickRef.current) {
                                                suppressClickRef.current = false;
                                                return;
                                            }
                                            onSelectLayer(layer.id);
                                        }}
                                        onContextMenu={(e) => openContextMenu(e, layer.id)}
                                        onPointerDown={(e) => startDrag(e, layer.id)}
                                        onPointerMove={moveDrag}
                                        onPointerUp={endDrag}
                                        onPointerCancel={endDrag}
                                        className={`flex cursor-pointer items-center select-none ${
                                            isDragging ? "opacity-50" : ""
                                        }`}
                                        style={{
                                            height: "var(--editor-layer-row-height)",
                                            borderRadius: "var(--editor-layer-row-radius)",
                                            background: isSelected
                                                ? "var(--color-nav-item-selected)"
                                                : "transparent",
                                            paddingLeft: 8,
                                        }}
                                    >
                                        <span
                                            className="grid shrink-0 place-items-center text-white/35"
                                            title="拖拽调整层级"
                                            aria-label="拖拽调整层级"
                                        >
                                            <DotsSixVerticalIcon size={14} weight="regular" />
                                        </span>
                                        <span className="shrink-0 text-white/70">
                                            {layerTypeIcon(layer.type)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate pl-2 text-[13px] text-white/85">
                                            {layer.name || layer.id}
                                        </span>
                                        {layer.syncAcrossDevices === true && (
                                            <span
                                                className="mr-1 shrink-0 rounded-full px-1.5 text-[10px] leading-4 text-[var(--color-editor-blue-fg)]"
                                                style={{ background: "var(--color-editor-blue-bg)" }}
                                                title="该图层多设备同步已开启"
                                            >
                                                同步
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            title="删除图层"
                                            aria-label={`删除图层 ${layer.name || layer.id}`}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onRemoveLayer(layer.id);
                                            }}
                                            className="grid shrink-0 place-items-center rounded text-white/35 transition hover:bg-red-400/20 hover:text-red-300"
                                            style={{ width: 24, height: 24, marginRight: 2 }}
                                        >
                                            <TrashIcon size={14} weight="regular" />
                                        </button>
                                    </div>
                                );
                            })}
                            {layers.length === 0 && (
                                <p className="px-2 py-2 text-xs text-white/40">
                                    暂无图层，点击上方按钮新建。
                                </p>
                            )}
                        </div>

                        {/* 拖拽插入线 */}
                        {dragInfo?.active && (
                            <div
                                className="pointer-events-none absolute left-[9px] right-[9px]"
                                style={{
                                    top: dragInfo.lineTop,
                                    height: 2,
                                    borderRadius: 1,
                                    background: "var(--color-editor-blue-fg)",
                                    boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                                }}
                            />
                        )}
                    </div>

                    {/* 右键菜单 */}
                    {contextMenu && (
                        <div
                            className="fixed inset-0 z-50"
                            onClick={() => setContextMenu(null)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu(null);
                            }}
                        />
                    )}
                    {contextMenu && (
                        <div
                            className="fixed z-50 flex min-w-[132px] flex-col overflow-hidden rounded-md border border-white/10 bg-[#141414] py-1 shadow-lg"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    onRemoveLayer(contextMenu.layerId);
                                    setContextMenu(null);
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-300 transition hover:bg-white/10"
                            >
                                <TrashIcon size={14} weight="regular" />
                                删除图层
                            </button>
                        </div>
                    )}
                </div>
            )}

            {!hasConfig && (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-white/40">
                    从预设或导入配置开始
                </div>
            )}
        </aside>
    );
}
