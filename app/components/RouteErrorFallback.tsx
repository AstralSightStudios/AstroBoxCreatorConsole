import { ArrowCounterClockwiseIcon, HouseIcon } from "@phosphor-icons/react";
import { Button } from "@radix-ui/themes";
import { Link, useNavigate, useRouteError } from "react-router";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const status = (error as { status?: number }).status;
    const statusText = (error as { statusText?: string }).statusText;
    if (status != null) {
      return statusText || `HTTP ${status}`;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? "未知错误");
}

/**
 * 路由级错误兜底：页面渲染/加载出错时展示可恢复的界面，
 * 避免整个应用白屏、用户无法返回。
 */
export default function RouteErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = errorMessage(error).slice(0, 300);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
        <p className="text-lg font-semibold text-white">页面出现异常</p>
        <p className="mt-2 text-sm leading-6 text-white/55">
          当前页面渲染出错，已被错误边界拦截。你可以返回上一页或回到首页继续操作。
        </p>
        {message && (
          <p className="mt-3 break-all rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 font-mono text-xs leading-5 text-amber-200/80">
            {message}
          </p>
        )}
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            variant="soft"
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate("/");
              }
            }}
          >
            <ArrowCounterClockwiseIcon size={15} />
            返回上一页
          </Button>
          <Link to="/" replace>
            <Button variant="solid">
              <HouseIcon size={15} />
              回到首页
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
