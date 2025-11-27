import {
    CaretDownIcon,
    ClockCountdownIcon,
    FunnelIcon,
    TrayArrowDownIcon,
} from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import Page from "~/layout/page";

export default function Home() {
    return (
        <Page>
            <div className="flex flex-row px-2 pt-1.5 pb-3 gap-2.5">
                <Button className="styledbtn">
                    <FunnelIcon size={16} weight="fill" /> 筛选{" "}
                    <CaretDownIcon size={16} weight="bold" />
                </Button>
                <Button className="styledbtn">
                    <ClockCountdownIcon size={16} weight="fill" /> 过去3天{" "}
                    <CaretDownIcon size={16} weight="bold" />
                </Button>
                <Button style={{ marginLeft: "auto" }} className="styledbtn">
                    <TrayArrowDownIcon size={16} weight="fill" /> 导出{" "}
                    <CaretDownIcon size={16} weight="bold" />
                </Button>
            </div>
            <div className="pt-1.5 px-3.5">
                <p className="font-[520] text-size-large">下载数据</p>
            </div>
        </Page>
    );
}
