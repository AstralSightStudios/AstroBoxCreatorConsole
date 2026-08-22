/**
 * 统一日志门面。业务代码从这里导入 `log` 使用：
 *
 *   import { log } from "~/logic/logging";
 *   log.info("publish/upload", "上传完成", { data: { sha, size } });
 *
 * 级别：trace < debug < info < warn < error；默认 release=info、dev=debug，
 * 可通过设置页调整（持久化于 localStorage）。
 */
export { log, getLogLevel, setLogLevel, type LogLevel, type Logger } from "./core";
export { installFrontendLogBridge } from "./bridge";
