import {
    CheckCircleIcon,
    ClockIcon,
    FileArrowUpIcon,
    PencilSimpleIcon,
} from "@phosphor-icons/react";
import { Button, Table } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import Page from "~/layout/page";
import {
    loadInProgressResourcesForCurrentUser,
    type PublishingResource,
    type ResourceEditContext,
} from "~/logic/publish/resources";

function formatRestype(restype: string) {
    if (restype === "quick_app") return "快应用";
    if (restype === "watchface") return "表盘";
    return restype || "未知";
}

function useInProgressResources() {
    const [data, setData] = useState<PublishingResource[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        const run = async () => {
            setLoading(true);
            setError("");
            try {
                const result = await loadInProgressResourcesForCurrentUser();
                if (active) setData(result);
            } catch (err) {
                if (active) {
                    setError((err as Error).message || "加载失败");
                }
            } finally {
                if (active) setLoading(false);
            }
        };
        run();
        return () => {
            active = false;
        };
    }, []);

    return { data, loading, error };
}

export default function ResourcePublish() {
    const navigate = useNavigate();
    const { data, loading, error } = useInProgressResources();

    const statusRender = (resource: PublishingResource) => {
        if (resource.status === "changes_requested") {
            return (
                <span className="flex items-center gap-1 text-amber-300">
                    <PencilSimpleIcon /> 需要修改
                </span>
            );
        }
        if (resource.status === "fixed_waiting") {
            return (
                <span className="flex items-center gap-1 text-emerald-300">
                    <CheckCircleIcon /> 已修复，等待审核
                </span>
            );
        }
        return (
            <span className="flex items-center gap-1">
                <ClockIcon /> 等待审核
            </span>
        );
    };

    const handleSelect = (resource: PublishingResource) => {
        const editContext: ResourceEditContext = {
            mode: "in_progress",
            catalog: resource.catalog,
            prNumber: resource.prNumber,
            prHead: resource.prHead,
        };
        navigate("/publish/edit", { state: { editContext } });
    };

    const content = useMemo(() => {
        if (loading) {
            return <p className="text-sm text-white/70">正在加载申请列表...</p>;
        }
        if (error) {
            return <p className="text-sm text-amber-400">加载失败：{error}</p>;
        }
        if (data.length === 0) {
            return (
                <p className="text-sm text-white/70">
                    暂无进行中的发布申请，点击左上角按钮开始新的提交。
                </p>
            );
        }
        return (
            <div className="w-full overflow-x-scroll scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
                <Table.Root className="pt-1.5 min-w-max">
                    <Table.Header>
                        <Table.Row>
                            <Table.ColumnHeaderCell>唯一标识</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell>提交日期</Table.ColumnHeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {data.map((item) => (
                            <Table.Row
                                key={`${item.prNumber}-${item.id}`}
                                className="hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer"
                                onClick={() => handleSelect(item)}
                            >
                                <Table.RowHeaderCell>{item.id}</Table.RowHeaderCell>
                                <Table.Cell>{item.name}</Table.Cell>
                                <Table.Cell>{formatRestype(item.restype)}</Table.Cell>
                                <Table.Cell className="flex flex-row gap-1 items-center">
                                    {statusRender(item)}
                                </Table.Cell>
                                <Table.Cell>
                                    {item.createdAt
                                        ? new Date(item.createdAt).toLocaleDateString("zh-CN")
                                        : "--"}
                                </Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table.Root>
            </div>
        );
    }, [data, error, handleSelect, loading]);

    return (
        <Page>
            <div className="flex flex-row px-2 pt-1.5 pb-3 gap-2.5">
                <Button className="styledbtn" onClick={() => navigate("/publish/new")}>
                    <FileArrowUpIcon size={16} weight="fill" /> 发布资源
                </Button>
            </div>
            <div className="pt-1.5 px-3.5">
                <p className="font-[520] text-size-large">申请列表</p>
                {content}
            </div>
        </Page>
    );
}
