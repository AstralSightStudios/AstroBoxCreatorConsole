import { useEffect, useSyncExternalStore } from "react";
import {
  getCurrentGithubPermission,
  hasCommunityRepoManagePermission,
} from "~/api/github/pr-review";
import { useRepoEnv } from "~/config/repoEnv";
import { useAccountState } from "./store";

export interface CommunityRepoManageAccess {
  loggedIn: boolean;
  checking: boolean;
  allowed: boolean;
  error: string;
  repoLabel: string;
}

interface AccessSnapshot {
  key: string;
  loggedIn: boolean;
  checking: boolean;
  allowed: boolean;
  error: string;
  repoLabel: string;
}

const EMPTY_SNAPSHOT: AccessSnapshot = {
  key: "",
  loggedIn: false,
  checking: false,
  allowed: false,
  error: "",
  repoLabel: "",
};

let snapshot: AccessSnapshot = EMPTY_SNAPSHOT;
let requestId = 0;
const listeners = new Set<() => void>();

function sameSnapshot(left: AccessSnapshot, right: AccessSnapshot) {
  return (
    left.key === right.key &&
    left.loggedIn === right.loggedIn &&
    left.checking === right.checking &&
    left.allowed === right.allowed &&
    left.error === right.error &&
    left.repoLabel === right.repoLabel
  );
}

function emit(next: AccessSnapshot) {
  if (sameSnapshot(snapshot, next)) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensureLoaded(key: string, repoLabel: string) {
  if (!key) {
    requestId += 1;
    emit({ ...EMPTY_SNAPSHOT, repoLabel });
    return;
  }

  if (snapshot.key === key) {
    if (snapshot.repoLabel !== repoLabel) {
      emit({ ...snapshot, repoLabel });
    }
    return;
  }

  const id = ++requestId;
  emit({
    key,
    loggedIn: true,
    checking: true,
    allowed: false,
    error: "",
    repoLabel,
  });

  getCurrentGithubPermission()
    .then((res) => {
      if (id !== requestId) return;
      emit({
        key,
        loggedIn: true,
        checking: false,
        allowed: hasCommunityRepoManagePermission(res.permission),
        error: "",
        repoLabel,
      });
    })
    .catch((err) => {
      if (id !== requestId) return;
      emit({
        key,
        loggedIn: true,
        checking: false,
        allowed: false,
        error: err instanceof Error ? err.message : String(err),
        repoLabel,
      });
    });
}

/**
 * 与 PR 审核同一套仓库权限：已登录 GitHub，且对当前社区仓库为 admin / maintain / write。
 * 侧边栏与页面共用一次查询结果。
 */
export function useCommunityRepoManageAccess(): CommunityRepoManageAccess {
  const accountState = useAccountState();
  const env = useRepoEnv();
  const token = accountState.github?.token ?? "";
  const username = accountState.github?.username ?? "";
  const repoLabel = `${env.owner}/${env.repoName}`;
  const key = token ? `${repoLabel}:${username}` : "";

  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    ensureLoaded(key, repoLabel);
  }, [key, repoLabel]);

  if (!key) {
    return {
      loggedIn: false,
      checking: false,
      allowed: false,
      error: "",
      repoLabel,
    };
  }

  if (current.key !== key) {
    return {
      loggedIn: true,
      checking: true,
      allowed: false,
      error: "",
      repoLabel,
    };
  }

  return {
    loggedIn: current.loggedIn,
    checking: current.checking,
    allowed: current.allowed,
    error: current.error,
    repoLabel: current.repoLabel || repoLabel,
  };
}
