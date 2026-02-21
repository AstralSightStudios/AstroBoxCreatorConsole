import { MapPinIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { HeatmapLayer, LineLayer, PointLayer, PolygonLayer, Scene } from "@antv/l7";
import { Map as L7Map } from "@antv/l7-maps";
import worldMapGeoJson from "geojson-world-map";
import chinaMapGeoJson from "china-map-geojson";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    getCreatorAnalysisHeatmap,
    getCreatorAnalysisOverview,
    type AnalysisHeatmapResponse,
    type AnalysisHeatPoint,
    type AnalysisMapScope,
    type AnalysisOverviewResponse,
    type AnalysisPeriod,
} from "~/api/astrobox/analysis";
import DataCard from "~/components/cards/datacard";
import { PlusIcon } from "~/components/svgs";
import { canAccessAnalysisByPlan } from "~/logic/account/permissions";
import { useDisplayAccount } from "~/logic/account/store";
import Page from "~/layout/page";
import { SectionCard } from "./resource/publish/components/shared";

const HEAT_COLORS = ["#4a67f5", "#3ea8f8", "#2fd67f", "#f5b14a", "#f55d4a"];
const WORLD_VIEW_STATE = {
    longitude: 12,
    latitude: 18,
    zoom: 1.05,
};
const CHINA_VIEW_STATE = {
    longitude: 104.6,
    latitude: 35.4,
    zoom: 2.6,
};
const WORLD_BOUNDS = {
    minLng: -180,
    maxLng: 180,
    minLat: -85,
    maxLat: 85,
};
const CHINA_BOUNDS = {
    minLng: 73.5,
    maxLng: 135,
    minLat: 18,
    maxLat: 53.8,
};
const MAP_INIT_TIMEOUT_MS = 7000;
const ANALYSIS_CARD_CLASS = "!border-0 bg-nav-item";
const LOCAL_BASE_STYLE = {
    version: 8,
    name: "AstroBox Local Basemap",
    sources: {},
    layers: [
        {
            id: "background",
            type: "background",
            paint: {
                "background-color": "#0b0d12",
            },
        },
    ],
} as const;

type FeatureCollection = {
    type: "FeatureCollection";
    features: any[];
};

function asFeatureCollection(input: unknown): FeatureCollection {
    if (
        input &&
        typeof input === "object" &&
        (input as any).type === "FeatureCollection" &&
        Array.isArray((input as any).features)
    ) {
        return input as FeatureCollection;
    }

    return {
        type: "FeatureCollection",
        features: [],
    };
}

const WORLD_GEOJSON = asFeatureCollection(worldMapGeoJson);
const CHINA_GEOJSON = asFeatureCollection((chinaMapGeoJson as any)?.ChinaData);

function formatNumber(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) return "--";
    return value.toString();
}

function formatRating(value?: number | null) {
    if (typeof value !== "number" || Number.isNaN(value)) return "--";
    return value.toFixed(2);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function toNumberOrNull(value: unknown): number | null {
    return isFiniteNumber(value) ? value : null;
}

function clamp01(value: number) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function getScopeBounds(scope: AnalysisMapScope) {
    return scope === "china" ? CHINA_BOUNDS : WORLD_BOUNDS;
}

function normalizeToCoordinate(point: AnalysisHeatPoint, scope: AnalysisMapScope) {
    const normalizedX = toNumberOrNull(point.normalizedX);
    const normalizedY = toNumberOrNull(point.normalizedY);
    if (normalizedX === null || normalizedY === null) return null;

    const bounds = getScopeBounds(scope);
    const x = clamp01(normalizedX);
    const y = clamp01(normalizedY);
    const longitude = bounds.minLng + (bounds.maxLng - bounds.minLng) * x;
    const latitude = bounds.maxLat - (bounds.maxLat - bounds.minLat) * y;

    return { longitude, latitude };
}

function resolveHeatPointCoordinate(point: AnalysisHeatPoint, scope: AnalysisMapScope) {
    const longitude = toNumberOrNull(point.longitude);
    const latitude = toNumberOrNull(point.latitude);
    if (longitude !== null && latitude !== null) {
        return { longitude, latitude };
    }
    return normalizeToCoordinate(point, scope);
}

function ScopeSwitch({
    scope,
    onChange,
}: {
    scope: AnalysisMapScope;
    onChange: (next: AnalysisMapScope) => void;
}) {
    return (
        <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
            <button
                className={`rounded-full px-3 py-1.5 text-sm ${scope === "china" ? "bg-nav-item-selected text-white" : "text-white/70 hover:text-white"}`}
                onClick={() => onChange("china")}
                type="button"
            >
                中国地图
            </button>
            <button
                className={`rounded-full px-3 py-1.5 text-sm ${scope === "world" ? "bg-nav-item-selected text-white" : "text-white/70 hover:text-white"}`}
                onClick={() => onChange("world")}
                type="button"
            >
                世界地图
            </button>
        </div>
    );
}

function HeatmapPanel({
    scope,
    data,
    loading,
    error,
}: {
    scope: AnalysisMapScope;
    data: AnalysisHeatmapResponse | null;
    loading: boolean;
    error: string;
}) {
    const points = data?.points || [];
    const [mapError, setMapError] = useState("");
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<Scene | null>(null);

    const resolvedPoints = useMemo(
        () =>
            points
                .map((point) => {
                    const resolved = resolveHeatPointCoordinate(point, scope);
                    if (!resolved) return null;
                    return {
                        ...point,
                        longitude: resolved.longitude,
                        latitude: resolved.latitude,
                    };
                })
                .filter((point): point is AnalysisHeatPoint & { longitude: number; latitude: number } => Boolean(point)),
        [points, scope],
    );
    const mapLayerData = useMemo(
        () =>
            resolvedPoints.map((point) => ({
                id: point.id,
                label: point.label,
                downloads: point.downloads,
                longitude: point.longitude,
                latitude: point.latitude,
            })),
        [resolvedPoints],
    );
    const topPoints = useMemo(
        () =>
            [...resolvedPoints]
                .sort((a, b) => b.downloads - a.downloads)
                .slice(0, 8),
        [resolvedPoints],
    );
    const viewState = scope === "china" ? CHINA_VIEW_STATE : WORLD_VIEW_STATE;

    useEffect(() => {
        setMapError("");
    }, [scope, data?.accessible]);

    useEffect(() => {
        const previousScene = sceneRef.current;
        if (previousScene) {
            previousScene.destroy();
            sceneRef.current = null;
        }

        const mapContainer = mapContainerRef.current;
        if (!mapContainer) return;

        mapContainer.innerHTML = "";

        if (loading || error || data?.accessible === false) {
            return;
        }

        let active = true;

        const setupLayers = (scene: Scene) => {
            const parser = {
                type: "json",
                x: "longitude",
                y: "latitude",
            } as const;

            const basemapData = scope === "china" ? CHINA_GEOJSON : WORLD_GEOJSON;

            const basemapFillLayer = new PolygonLayer({})
                .source(basemapData as any)
                .shape("fill")
                .color("#151b25")
                .style({
                    opacity: 0.6,
                });

            const basemapStrokeLayer = new LineLayer({})
                .source(basemapData as any)
                .shape("line")
                .color("#4f5a70")
                .size(scope === "china" ? 0.8 : 0.55)
                .style({
                    opacity: 0.9,
                });

            const heatmapLayer = new HeatmapLayer({})
                .source(mapLayerData as any, { parser } as any)
                .shape("heatmap")
                .size("downloads", [0, 1])
                .style({
                    intensity: 2,
                    radius: scope === "china" ? 16 : 20,
                    opacity: 0.82,
                    rampColors: {
                        colors: HEAT_COLORS,
                        positions: [0, 0.25, 0.5, 0.75, 1],
                    },
                });

            const pointLayer = new PointLayer({})
                .source(mapLayerData as any, { parser } as any)
                .shape("circle")
                .size("downloads", [2, 7])
                .color("#f6f7fb")
                .style({
                    opacity: 0.9,
                    strokeWidth: 1,
                    stroke: "#1d2333",
                });

            scene.addLayer(basemapFillLayer);
            scene.addLayer(basemapStrokeLayer);
            scene.addLayer(heatmapLayer);
            scene.addLayer(pointLayer);
        };

        let timeoutId: number | null = null;

        try {
            const scene = new Scene({
                id: mapContainer,
                logoVisible: false,
                map: new L7Map({
                    style: LOCAL_BASE_STYLE as any,
                    pitch: 0,
                    center: [viewState.longitude, viewState.latitude] as [number, number],
                    zoom: viewState.zoom,
                    minZoom: scope === "china" ? 2.2 : 0.7,
                    maxZoom: scope === "china" ? 7 : 5.5,
                    dragRotate: false,
                    pitchWithRotate: false,
                    touchZoomRotate: false,
                }),
            });

            sceneRef.current = scene;
            timeoutId = window.setTimeout(() => {
                if (!active) return;
                setMapError("地图初始化超时，请稍后重试");
            }, MAP_INIT_TIMEOUT_MS);

            scene.once("loaded", () => {
                if (!active) return;
                if (timeoutId !== null) {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                }

                try {
                    setupLayers(scene);
                    setMapError("");
                } catch (layerError) {
                    setMapError(
                        layerError instanceof Error
                            ? layerError.message
                            : "热力图层加载失败",
                    );
                }
            });
        } catch (initError) {
            setMapError(
                initError instanceof Error
                    ? initError.message
                    : "地图初始化失败",
            );
        }

        return () => {
            active = false;
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (sceneRef.current) {
                sceneRef.current.destroy();
                sceneRef.current = null;
            }
        };
    }, [
        data?.accessible,
        error,
        loading,
        mapLayerData,
        scope,
        viewState.latitude,
        viewState.longitude,
        viewState.zoom,
    ]);

    return (
        <SectionCard
            title="区域下载热力"
            description="不同区域下载人数分布"
            className={`h-full ${ANALYSIS_CARD_CLASS}`}
        >
            {loading && (
                <p className="px-1.5 pb-3 text-sm text-white/60">正在加载热力数据...</p>
            )}
            {!loading && error && (
                <p className="px-1.5 pb-3 text-sm text-red-300">
                    热力数据加载失败：{error}
                </p>
            )}
            {!loading && !error && data?.accessible === false && (
                <p className="px-1.5 pb-3 text-sm text-amber-200">
                    该数据为 Plus 会员专享。
                </p>
            )}
            {!loading && !error && data?.accessible !== false && (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,80%)_minmax(0,20%)]">
                    <div className="relative min-h-[360px] overflow-hidden rounded-xl bg-[#0b0d12]">
                        <div ref={mapContainerRef} className="absolute inset-0" />
                        {mapError && (
                            <div className="absolute left-3 bottom-3 rounded-md bg-black/45 px-2 py-1 text-xs text-red-200">
                                {mapError}
                            </div>
                        )}
                        {!mapError && resolvedPoints.length === 0 && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/65">
                                当前没有可渲染的地理热力点
                            </div>
                        )}
                    </div>

                    <div className="rounded-xl bg-black/20 p-2.5">
                        <p className="mb-2 text-sm font-semibold text-white/90">
                            热力排行
                        </p>
                        <div className="flex flex-col gap-1.5">
                            {topPoints.map((item, index) => (
                                <div
                                    key={`${item.id}-${index}`}
                                    className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1.5"
                                >
                                    <span className="text-xs text-white/50">
                                        {index + 1}
                                    </span>
                                    <MapPinIcon size={14} className="text-white/65" />
                                    <span className="text-sm text-white/85 truncate">
                                        {item.label}
                                    </span>
                                    <span className="ml-auto text-sm text-white/85">
                                        {item.downloads}
                                    </span>
                                </div>
                            ))}
                            {topPoints.length === 0 && (
                                <p className="text-sm text-white/50">暂无热力数据</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </SectionCard>
    );
}

export default function Analysis() {
    const account = useDisplayAccount();
    const canAccess = canAccessAnalysisByPlan(account.plan);

    const [scope, setScope] = useState<AnalysisMapScope>("china");
    const [period] = useState<AnalysisPeriod>("30d");
    const [overview, setOverview] = useState<AnalysisOverviewResponse | null>(null);
    const [heatmap, setHeatmap] = useState<AnalysisHeatmapResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!canAccess) {
            setOverview(null);
            setHeatmap(null);
            setError("");
            setLoading(false);
            return;
        }

        let active = true;
        const run = async () => {
            setLoading(true);
            setError("");
            try {
                const [overviewData, heatmapData] = await Promise.all([
                    getCreatorAnalysisOverview({ period }),
                    getCreatorAnalysisHeatmap({ scope, period }),
                ]);
                if (!active) return;
                setOverview(overviewData);
                setHeatmap(heatmapData);
            } catch (err) {
                if (!active) return;
                setOverview(null);
                setHeatmap(null);
                setError(err instanceof Error ? err.message : "加载分析数据失败");
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        void run();
        return () => {
            active = false;
        };
    }, [canAccess, period, scope]);

    const ratingRows = useMemo(() => {
        const ratings = overview?.ratings;
        if (!ratings) {
            return [
                { name: "1星", value: 0 },
                { name: "2星", value: 0 },
                { name: "3星", value: 0 },
                { name: "4星", value: 0 },
                { name: "5星", value: 0 },
            ];
        }
        return [
            { name: "1星", value: ratings["1"] || 0 },
            { name: "2星", value: ratings["2"] || 0 },
            { name: "3星", value: ratings["3"] || 0 },
            { name: "4星", value: ratings["4"] || 0 },
            { name: "5星", value: ratings["5"] || 0 },
        ];
    }, [overview]);

    return (
        <Page>
            <div className="flex items-center px-3.5 pt-1.5">
                <p className="text-size-large font-[520]">数据分析</p>
                <PlusIcon className="ml-auto" />
            </div>

            <div className="px-1.5 pt-2.5">
                <ScopeSwitch scope={scope} onChange={setScope} />
            </div>

            {!canAccess && (
                <div className="px-1.5 pt-3">
                    <SectionCard
                        title="数据分析暂不可用"
                        description="仅 CreatorPlus 及以上档位可访问"
                        className={ANALYSIS_CARD_CLASS}
                    >
                        <div className="flex items-center gap-2 text-sm text-amber-200">
                            <WarningOctagonIcon size={16} weight="fill" />
                            当前账号未开通 Plus 及更高会员。
                        </div>
                    </SectionCard>
                </div>
            )}

            {canAccess && (
                <div className="grid gap-3.5 px-1.5 pt-3 pb-6">
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                        <DataCard label="资源数">
                            <p className="card-num">{formatNumber(overview?.summary.resources)}</p>
                        </DataCard>
                        <DataCard label="浏览量">
                            <p className="card-num">{formatNumber(overview?.summary.views)}</p>
                        </DataCard>
                        <DataCard label="下载量">
                            <p className="card-num">
                                {formatNumber(overview?.summary.downloads)}
                            </p>
                        </DataCard>
                        <DataCard label="平均评分">
                            <p className="card-num">
                                {formatRating(overview?.summary.averageRating)}
                            </p>
                        </DataCard>
                    </div>

                    <div className="grid gap-3.5">
                        <HeatmapPanel
                            scope={scope}
                            data={heatmap}
                            loading={loading}
                            error={error}
                        />

                        <SectionCard
                            title="评分分布"
                            description="1-5 星评分计数"
                            className={ANALYSIS_CARD_CLASS}
                        >
                            <div className="h-[360px] w-full">
                                <ResponsiveContainer>
                                    <BarChart data={ratingRows}>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke="rgba(255,255,255,0.14)"
                                        />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fill: "rgba(255,255,255,0.72)" }}
                                            axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                                            tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                                        />
                                        <YAxis
                                            allowDecimals={false}
                                            tick={{ fill: "rgba(255,255,255,0.72)" }}
                                            axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                                            tickLine={{ stroke: "rgba(255,255,255,0.2)" }}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: "#0f1218",
                                                border: "none",
                                                borderRadius: "10px",
                                            }}
                                            labelStyle={{ color: "rgba(255,255,255,0.72)" }}
                                            itemStyle={{ color: "rgba(255,255,255,0.92)" }}
                                        />
                                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                                            {ratingRows.map((row, index) => (
                                                <Cell
                                                    key={`${row.name}-${index}`}
                                                    fill={HEAT_COLORS[index % HEAT_COLORS.length]}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </SectionCard>
                    </div>
                </div>
            )}
        </Page>
    );
}
