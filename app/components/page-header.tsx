import { useLayoutEffect, type ReactNode } from "react";
import {
  useHeaderLargeTitleProgress,
  useRegisterHeaderLargeTitle,
} from "~/layout/header-actions";

interface PageHeaderProps {
  title: string;
  description: string;
  icon: ReactNode;
  action?: ReactNode;
}

export default function PageHeader({
  title,
  description,
  icon,
  action,
}: PageHeaderProps) {
  const registerLargeTitle = useRegisterHeaderLargeTitle();
  const collapseProgress = useHeaderLargeTitleProgress();

  useLayoutEffect(
    () => registerLargeTitle(title),
    [registerLargeTitle, title],
  );

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div
        style={{
          opacity: 1 - collapseProgress,
          transform: `scale(${1 - collapseProgress * 0.25})`,
          transformOrigin: "left top",
        }}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h1 className="text-2xl font-medium text-white">{title}</h1>
        </div>
        <p className="mt-1 text-sm text-white/50">{description}</p>
      </div>
      {action}
    </div>
  );
}
