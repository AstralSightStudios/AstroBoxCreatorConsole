import { PlusIcon } from "../svgs";

export interface DataCardProps {
    label: string;
    secondaryLabel?: string;
    children: React.ReactNode;
    isPlus?: boolean;
}

export default function DataCard({
    label,
    secondaryLabel,
    children,
    isPlus,
}: DataCardProps) {
    return (
        <div
            //@ts-ignore
            style={{ cornerShape: "superellipse(1.75)" }}
            className="px-3.5 py-3 flex flex-col gap-2 bg-nav-item rounded-2xl corner-rounded"
        >
            <div className="flex flex-row">
                <div className="flex flex-row w-full">
                    <p className="opacity-60 text-size-medium">{label}</p>
                    <p className="opacity-60 text-size-medium ml-auto">
                        {secondaryLabel}
                    </p>
                </div>
                {isPlus && <PlusIcon className="ml-auto" />}
            </div>
            {children}
        </div>
    );
}
