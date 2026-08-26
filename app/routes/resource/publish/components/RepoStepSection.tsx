import { Button, Spinner, TextField } from "@radix-ui/themes";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RepoInfo } from "~/logic/publish/submission";
import { Field, SectionCard } from "./shared";

export interface ExistingRepoOption {
  name: string;
  updatedAt: string;
}

interface RepoStepSectionProps {
  repoNameInput: string;
  repoStatus: "idle" | "loading" | "success" | "error";
  repoMessage: string;
  repoInfo: RepoInfo | null;
  uploadLogs: string[];
  existingRepos: ExistingRepoOption[];
  existingReposLoading: boolean;
  onRepoNameChange: (value: string) => void;
  onPickExistingRepo: (name: string) => void;
  onUpload: () => void;
  onPrev: () => void;
  onNext: () => void;
  mode?: "new" | "edit";
}

function formatRepoUpdatedAt(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN");
}

function HighlightMatch({ name, keyword }: { name: string; keyword: string }) {
  const query = keyword.trim().toLowerCase();
  const index = query ? name.toLowerCase().indexOf(query) : -1;
  if (index < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, index)}
      <span className="font-medium text-sky-300">
        {name.slice(index, index + query.length)}
      </span>
      {name.slice(index + query.length)}
    </>
  );
}

export function RepoStepSection({
  repoNameInput,
  repoStatus,
  repoMessage,
  repoInfo,
  uploadLogs,
  existingRepos,
  existingReposLoading,
  onRepoNameChange,
  onPickExistingRepo,
  onUpload,
  onPrev,
  onNext,
  mode = "new",
}: RepoStepSectionProps) {
  const isEdit = mode === "edit";
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filteredRepos = useMemo(() => {
    const keyword = repoNameInput.trim().toLowerCase();
    if (!keyword) return existingRepos;
    return existingRepos.filter((repo) =>
      repo.name.toLowerCase().includes(keyword),
    );
  }, [existingRepos, repoNameInput]);

  const selectedExistingRepo =
    Boolean(repoNameInput.trim()) &&
    existingRepos.some(
      (repo) =>
        repo.name.toLowerCase() === repoNameInput.trim().toLowerCase(),
    );

  useEffect(() => {
    setActiveIndex(0);
  }, [repoNameInput, suggestOpen]);

  const selectRepo = (name: string) => {
    onPickExistingRepo(name);
    setSuggestOpen(false);
  };

  return (
    <SectionCard
      title={isEdit ? "更新发布仓库" : "创建发布仓库并上传"}
      description={
        isEdit
          ? "更新已有仓库中的 manifest_v2.json 与资源文件。"
          : "自动在你的 GitHub 账号下创建仓库并上传 manifest_v2.json 与所有资源文件；输入名称时可从已有仓库中选择。"
      }
      className="p-0!"
      padding={false}
    >
      <div className="flex flex-col gap-2 p-2">
        {!isEdit && (
          <Field label="仓库名称">
            <div
              ref={containerRef}
              className="relative"
              onBlur={(e) => {
                if (
                  e.relatedTarget &&
                  containerRef.current?.contains(e.relatedTarget as Node)
                ) {
                  return;
                }
                setSuggestOpen(false);
              }}
            >
              <TextField.Root
                placeholder="留空时根据 ID 自动生成，输入可筛选已有仓库"
                value={repoNameInput}
                onChange={(e) => {
                  onRepoNameChange(e.target.value);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                onKeyDown={(e) => {
                  if (!suggestOpen || filteredRepos.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((prev) =>
                      Math.min(prev + 1, filteredRepos.length - 1),
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((prev) => Math.max(prev - 1, 0));
                  } else if (e.key === "Enter") {
                    const repo = filteredRepos[activeIndex];
                    if (repo) {
                      e.preventDefault();
                      selectRepo(repo.name);
                    }
                  } else if (e.key === "Escape") {
                    setSuggestOpen(false);
                  }
                }}
                radius="large"
              />
              {suggestOpen && (
                <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-white/10 bg-[#151517] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
                  <div className="max-h-64 min-h-20 overflow-y-auto">
                    {existingReposLoading && (
                      <div className="flex h-16 flex-col items-center justify-center gap-1.5 text-xs text-white/50">
                        <Spinner size="2" />
                        正在加载仓库列表…
                      </div>
                    )}
                    {!existingReposLoading &&
                      (existingRepos.length === 0 ? (
                        <p className="py-6 text-center text-xs text-white/40">
                          暂无已有仓库，将自动创建新仓库
                        </p>
                      ) : filteredRepos.length === 0 ? (
                        <p className="py-6 text-center text-xs text-white/40">
                          没有匹配的仓库，将创建新仓库
                        </p>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {filteredRepos.slice(0, 60).map((repo, index) => (
                            <button
                              key={repo.name}
                              type="button"
                              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition ${
                                index === activeIndex
                                  ? "bg-white/15"
                                  : "hover:bg-white/10"
                              }`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectRepo(repo.name)}
                              onMouseEnter={() => setActiveIndex(index)}
                            >
                              <span className="min-w-0 truncate text-sm text-white">
                                <HighlightMatch
                                  name={repo.name}
                                  keyword={repoNameInput}
                                />
                              </span>
                              <span className="shrink-0 text-[11px] text-white/35">
                                {formatRepoUpdatedAt(repo.updatedAt)}
                              </span>
                            </button>
                          ))}
                          {filteredRepos.length > 60 && (
                            <p className="py-1.5 text-center text-[11px] text-white/35">
                              仅显示前 60 个，继续输入可精确筛选
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
            radius="large"
            size="2"
            variant="soft"
            onClick={onUpload}
            disabled={repoStatus === "loading"}
          >
            {repoStatus === "loading"
              ? "处理中..."
              : isEdit
                ? "更新并上传"
                : selectedExistingRepo
                  ? "上传至选中仓库"
                  : "创建并上传"}
          </Button>
          {repoStatus === "success" && repoInfo?.htmlUrl && (
            <a
              className="rt-reset rt-BaseButton rt-r-size-2 rt-variant-soft rt-Button text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full! rounded-md!"
              href={repoInfo.htmlUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看仓库
            </a>
          )}
          {repoMessage && (
            <p
              className={`text-sm ${repoStatus === "error" ? "text-amber-400" : "text-white/70"}`}
            >
              {repoMessage}
            </p>
          )}
        </div>
      </div>
      <div>
        <div className="max-h-48 overflow-auto bg-black/25 border-t border-white/10 p-2.5 text-xs text-white/70">
          {uploadLogs.length === 0 ? (
            <p className="text-white/50">等待执行...</p>
          ) : (
            uploadLogs.map((log, idx) => <p key={idx}>{log}</p>)
          )}
        </div>
        <div className="flex flex-row max-lg:flex-col justify-between gap-2 p-2 bg-black/25 border-t border-white/10 rounded-b-[14px]">
          <Button
            className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
            radius="large"
            size="2"
            variant="soft"
            color="gray"
            onClick={onPrev}
          >
            上一步
          </Button>
          <Button
            className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
            radius="large"
            size="2"
            variant="soft"
            onClick={onNext}
          >
            下一步
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
