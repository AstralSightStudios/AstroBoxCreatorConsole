import {
  CheckCircleIcon,
  ClockIcon,
  FileArrowUpIcon,
  PencilSimpleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { Button, Table, Callout, Spinner } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import Page from "~/layout/page";
import {
  loadInProgressResourcesForCurrentUser,
  type PublishingResource,
  type ResourceEditContext,
} from "~/logic/publish/resources";

import { SectionCard } from "./publish/components/shared";

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
          <PencilSimpleIcon size={18} weight="fill" /> 需要修改
        </span>
      );
    }
    if (resource.status === "fixed_waiting") {
      return (
        <span className="flex items-center gap-1 text-emerald-300">
          <CheckCircleIcon size={18} weight="fill" /> 已修复，等待审核
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1">
        <ClockIcon size={18} weight="fill" /> 等待审核
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
      return (
        <Callout.Root
          color="gray"
          variant="soft"
          highContrast
          className="-mb-2.5 bg-transparent! p-3!"
        >
          <Callout.Icon>
            <Spinner size="2" />
          </Callout.Icon>
          <Callout.Text className="font-semibold text-white/45">
            <p>正在载入申请列表...</p>
          </Callout.Text>
        </Callout.Root>
      );
    }
    if (error) {
      return (
        <Callout.Root
          color="red"
          variant="soft"
          className="rounded-[14px]! border border-white/10 p-3!"
        >
          <Callout.Icon>
            <WarningOctagonIcon size={16} weight="fill" />
          </Callout.Icon>
          <Callout.Text className="font-semibold text-white/45">
            <p>加载失败：{error}</p>
          </Callout.Text>
        </Callout.Root>
      );
    }
    if (data.length === 0) {
      return (
        <p className="text-sm text-white/70">
          暂无进行中的发布申请，点击左上角按钮开始新的提交。
        </p>
      );
    }
    return (
      <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
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
      <SectionCard
        title="审核列表"
        description="查看你已上传资源的审核状态"
        padding={false}
      >
        <div className="p-0.5">{content}</div>
        <Button
          className="border border-white/10 p-3! min-h-9! flex items-center mx-2! mb-2!"
          onClick={() => navigate("/publish/new")}
          size="2"
          radius="large"
          variant="soft"
        >
          <FileArrowUpIcon size={18} weight="fill" /> 发布资源
        </Button>
      </SectionCard>
    </Page>
  );
}
