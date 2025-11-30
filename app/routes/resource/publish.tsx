import { ClockIcon, FileArrowUpIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { Button, Table } from "@radix-ui/themes";
import Page from "~/layout/page";

export default function ResourcePublish() {
    return (
        <Page>
            <div className="flex flex-row px-2 pt-1.5 pb-3 gap-2.5">
                <Button className="styledbtn"><FileArrowUpIcon size={16} weight="fill" /> 发布资源</Button>
            </div>
            <div className="pt-1.5 px-3.5">
                <p className="font-[520] text-size-large">申请列表</p>
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
                            <Table.Row className="hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer">
                                <Table.RowHeaderCell>com.raytek.cytusii</Table.RowHeaderCell>
                                <Table.Cell>Cytus II</Table.Cell>
                                <Table.Cell>快应用</Table.Cell>
                                <Table.Cell className="flex flex-row gap-1 items-center"><ClockIcon /> 等待审核</Table.Cell>
                                <Table.Cell>2025年12月1日</Table.Cell>
                            </Table.Row>

                            <Table.Row className="hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer">
                                <Table.RowHeaderCell>com.universe.earthonline</Table.RowHeaderCell>
                                <Table.Cell>地球Online</Table.Cell>
                                <Table.Cell>快应用</Table.Cell>
                                <Table.Cell className="flex flex-row gap-1 items-center"><ClockIcon /> 等待审核</Table.Cell>
                                <Table.Cell>2025年12月2日</Table.Cell>
                            </Table.Row>

                            <Table.Row className="hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer">
                                <Table.RowHeaderCell>184722849121</Table.RowHeaderCell>
                                <Table.Cell>户晨风动态表盘</Table.Cell>
                                <Table.Cell>表盘</Table.Cell>
                                <Table.Cell className="flex flex-row gap-1 items-center text-yellow-500"><PencilSimpleIcon /> 需要修改</Table.Cell>
                                <Table.Cell>2025年12月2日</Table.Cell>
                            </Table.Row>
                        </Table.Body>
                    </Table.Root>
                </div>
            </div>
        </Page>
    );
}
