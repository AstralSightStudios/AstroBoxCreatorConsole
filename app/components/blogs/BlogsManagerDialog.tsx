import {
  CaretRightIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { Button, Dialog, IconButton, Spinner, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BLOGS_ROOT,
  fetchBlogsTree,
  type BlogsTreeNode,
} from "~/api/github/blogs-tree";
import type { MediaUpload } from "~/api/github/explore-pr";
import { useRepoEnv } from "~/config/repoEnv";

export interface BlogsManagerState {
  uploads: MediaUpload[];
  deletes: string[];
  newFolders: string[];
}

interface BlogsManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: BlogsManagerState;
  onChange: (next: BlogsManagerState) => void;
}

export default function BlogsManagerDialog({
  open,
  onOpenChange,
  state,
  onChange,
}: BlogsManagerDialogProps) {
  const env = useRepoEnv();
  const [tree, setTree] = useState<BlogsTreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([BLOGS_ROOT]));
  const [selected, setSelected] = useState<string>(BLOGS_ROOT);
  const [newFolderName, setNewFolderName] = useState("");

  const reload = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const root = await fetchBlogsTree();
      setTree(root);
      setExpanded((current) => {
        const next = new Set(current);
        next.add(BLOGS_ROOT);
        return next;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !tree) {
      void reload();
    }
  }, [open]);

  const virtualDirs = useMemo(() => {
    const out = new Set<string>();
    state.newFolders.forEach((path) => out.add(path));
    return out;
  }, [state.newFolders]);

  const decoratedTree = useMemo(() => {
    if (!tree) return null;
    return decorateWithPendingFolders(tree, state.newFolders);
  }, [tree, state.newFolders]);

  const selectedNode = useMemo(() => {
    if (!decoratedTree) return null;
    return findNode(decoratedTree, selected);
  }, [decoratedTree, selected]);

  const selectableFolder =
    selectedNode && selectedNode.type === "dir"
      ? selectedNode.path
      : getParentDirectory(selectedNode?.path || selected);

  const toggleExpand = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const queueUploads = (files: File[]) => {
    if (files.length === 0) return;
    const folder = selectableFolder.replace(/\/+$/, "");
    const nextUploads = [...state.uploads];
    for (const file of files) {
      const path = `${folder}/${sanitizeName(file.name)}`;
      const duplicate = nextUploads.findIndex((entry) => entry.path === path);
      if (duplicate >= 0) {
        nextUploads[duplicate] = { file, path };
      } else {
        nextUploads.push({ file, path });
      }
    }
    onChange({ ...state, uploads: nextUploads });
    toast.success(`已暂存 ${files.length} 个文件到 ${folder}`);
  };

  const removeUpload = (path: string) => {
    onChange({
      ...state,
      uploads: state.uploads.filter((entry) => entry.path !== path),
    });
  };

  const queueDelete = (path: string) => {
    if (state.deletes.includes(path)) return;
    onChange({ ...state, deletes: [...state.deletes, path] });
    toast.success(`已标记删除 ${path}`);
  };

  const cancelDelete = (path: string) => {
    onChange({ ...state, deletes: state.deletes.filter((entry) => entry !== path) });
  };

  const queueNewFolder = () => {
    const name = sanitizeName(newFolderName.trim());
    if (!name) {
      toast.error("文件夹名称不能为空");
      return;
    }
    const folder = `${selectableFolder.replace(/\/+$/, "")}/${name}`;
    if (state.newFolders.includes(folder) || virtualDirs.has(folder)) {
      toast.error("该文件夹已在待创建列表");
      return;
    }
    onChange({ ...state, newFolders: [...state.newFolders, folder] });
    setExpanded((current) => new Set(current).add(folder).add(selectableFolder));
    setSelected(folder);
    setNewFolderName("");
  };

  const cancelNewFolder = (folder: string) => {
    onChange({
      ...state,
      newFolders: state.newFolders.filter((entry) => entry !== folder),
      uploads: state.uploads.filter((entry) => !entry.path.startsWith(`${folder}/`)),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        maxWidth="100vw"
        className="!w-[min(96vw,1100px)] !max-w-none"
      >
        <Dialog.Title>素材管理</Dialog.Title>
        <Dialog.Description size="2" className="mb-3 text-white/55">
          管理{" "}
          <span className="font-mono-sarasa text-white/80">
            {env.owner}/{env.repoName}
          </span>
          @{BLOGS_ROOT}/ 下的素材，所有改动随探索页 PR 一起提交。
        </Dialog.Description>

        <div className="grid gap-3 md:grid-cols-[320px_1fr]">
          <section className="flex max-h-[64vh] min-h-[320px] flex-col rounded-xl border border-white/10 bg-black/25">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs text-white/55">
              <span>blogs 目录</span>
              <Button size="1" variant="soft" onClick={reload} disabled={loading}>
                刷新
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
              {loading && (
                <div className="grid place-items-center py-12">
                  <Spinner />
                </div>
              )}
              {loadError && (
                <p className="px-3 py-6 text-center text-xs text-red-200">{loadError}</p>
              )}
              {decoratedTree && (
                <TreeView
                  node={decoratedTree}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  selected={selected}
                  onSelect={setSelected}
                  pendingDeletes={state.deletes}
                  pendingFolders={virtualDirs}
                  onQueueDelete={queueDelete}
                  onCancelDelete={cancelDelete}
                  onCancelNewFolder={cancelNewFolder}
                />
              )}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <div className="mb-1 text-xs text-white/50">当前选中目录</div>
              <p className="break-all font-mono-sarasa text-sm text-white">
                {selectableFolder}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <div className="mb-2 flex items-center gap-2">
                <UploadSimpleIcon size={16} className="text-white/65" />
                <h3 className="text-sm font-semibold text-white">上传到当前目录</h3>
              </div>
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  queueUploads(files);
                  event.target.value = "";
                }}
                className="block w-full text-xs text-white"
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <div className="mb-2 flex items-center gap-2">
                <FolderPlusIcon size={16} className="text-white/65" />
                <h3 className="text-sm font-semibold text-white">新建子文件夹</h3>
              </div>
              <div className="flex gap-2">
                <TextField.Root
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="子文件夹名"
                  className="flex-1"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") queueNewFolder();
                  }}
                />
                <Button size="2" onClick={queueNewFolder}>创建</Button>
              </div>
              <p className="mt-1 text-[11px] text-white/45">
                通过提交一个 .gitkeep 占位文件实现。
              </p>
            </div>

            <PendingList title="待上传" emptyText="还没有待上传文件">
              {state.uploads.map((upload) => (
                <PendingRow
                  key={upload.path}
                  label={upload.path}
                  meta={`${(upload.file.size / 1024).toFixed(1)} KB`}
                  onCancel={() => removeUpload(upload.path)}
                />
              ))}
            </PendingList>

            <PendingList title="待删除" emptyText="还没有待删除文件">
              {state.deletes.map((path) => (
                <PendingRow
                  key={path}
                  label={path}
                  onCancel={() => cancelDelete(path)}
                  tone="danger"
                />
              ))}
            </PendingList>

            <PendingList title="待创建文件夹" emptyText="还没有待创建文件夹">
              {state.newFolders.map((path) => (
                <PendingRow
                  key={path}
                  label={path}
                  onCancel={() => cancelNewFolder(path)}
                />
              ))}
            </PendingList>
          </section>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Dialog.Close>
            <Button variant="soft">完成</Button>
          </Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function TreeView({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  onSelect,
  pendingDeletes,
  pendingFolders,
  onQueueDelete,
  onCancelDelete,
  onCancelNewFolder,
}: {
  node: BlogsTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selected: string;
  onSelect: (path: string) => void;
  pendingDeletes: string[];
  pendingFolders: Set<string>;
  onQueueDelete: (path: string) => void;
  onCancelDelete: (path: string) => void;
  onCancelNewFolder: (path: string) => void;
}) {
  const isFolder = node.type === "dir";
  const isExpanded = expanded.has(node.path);
  const isSelected = selected === node.path;
  const isPendingDelete = pendingDeletes.includes(node.path);
  const isPendingFolder = pendingFolders.has(node.path);

  return (
    <div>
      <div
        role="button"
        onClick={() => onSelect(node.path)}
        className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm transition ${
          isSelected ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/5"
        } ${isPendingDelete ? "line-through opacity-60" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {isFolder ? (
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.path);
            }}
          >
            <CaretRightIcon
              size={12}
              weight="bold"
              style={{
                transform: isExpanded ? "rotate(90deg)" : "rotate(0)",
                transition: "transform 0.15s",
              }}
            />
          </IconButton>
        ) : (
          <span className="inline-block w-5" />
        )}
        {isFolder ? (
          <FolderIcon size={14} className="text-amber-200" />
        ) : (
          <FileIcon size={14} className="text-white/55" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono-sarasa text-xs">
          {node.name}
        </span>
        {isPendingFolder && (
          <span className="rounded bg-emerald-500/20 px-1 text-[10px] text-emerald-100">
            新建
          </span>
        )}
        {isPendingDelete ? (
          <button
            type="button"
            className="text-[10px] text-blue-200 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onCancelDelete(node.path);
            }}
          >
            取消
          </button>
        ) : (
          !isFolder && (
            <IconButton
              size="1"
              variant="ghost"
              color="red"
              onClick={(event) => {
                event.stopPropagation();
                onQueueDelete(node.path);
              }}
            >
              <TrashIcon size={12} />
            </IconButton>
          )
        )}
        {isPendingFolder && (
          <button
            type="button"
            className="text-[10px] text-red-200 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onCancelNewFolder(node.path);
            }}
          >
            撤销
          </button>
        )}
      </div>
      {isFolder && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selected={selected}
              onSelect={onSelect}
              pendingDeletes={pendingDeletes}
              pendingFolders={pendingFolders}
              onQueueDelete={onQueueDelete}
              onCancelDelete={onCancelDelete}
              onCancelNewFolder={onCancelNewFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingList({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-white/55">{title}</h3>
      {hasChildren ? (
        <div className="flex flex-col gap-1">{children}</div>
      ) : (
        <p className="text-xs text-white/40">{emptyText}</p>
      )}
    </div>
  );
}

function PendingRow({
  label,
  meta,
  onCancel,
  tone,
}: {
  label: string;
  meta?: string;
  onCancel: () => void;
  tone?: "danger";
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
        tone === "danger"
          ? "border-red-400/30 bg-red-500/5 text-red-100"
          : "border-white/10 bg-white/[0.04] text-white/70"
      }`}
    >
      <span className="min-w-0 flex-1 truncate font-mono-sarasa">{label}</span>
      {meta && <span className="text-white/40">{meta}</span>}
      <button
        type="button"
        className="text-blue-200 hover:underline"
        onClick={onCancel}
      >
        取消
      </button>
    </div>
  );
}

function decorateWithPendingFolders(
  root: BlogsTreeNode,
  pendingFolders: string[],
): BlogsTreeNode {
  if (pendingFolders.length === 0) return root;
  const cloned = cloneNode(root);
  const lookup = new Map<string, BlogsTreeNode>();
  registerLookup(cloned, lookup);

  for (const folder of pendingFolders) {
    const segments = folder.split("/");
    let cursorPath = segments[0];
    let cursor = lookup.get(cursorPath);
    if (!cursor) continue;
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i];
      cursorPath = `${cursorPath}/${segment}`;
      let next = lookup.get(cursorPath);
      if (!next) {
        next = {
          name: segment,
          path: cursorPath,
          type: "dir",
          children: [],
        };
        cursor.children.push(next);
        lookup.set(cursorPath, next);
      }
      cursor = next;
    }
  }
  return cloned;
}

function cloneNode(node: BlogsTreeNode): BlogsTreeNode {
  return {
    ...node,
    children: node.children.map(cloneNode),
  };
}

function registerLookup(node: BlogsTreeNode, lookup: Map<string, BlogsTreeNode>) {
  lookup.set(node.path, node);
  node.children.forEach((child) => registerLookup(child, lookup));
}

function findNode(node: BlogsTreeNode, path: string): BlogsTreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const found = findNode(child, path);
    if (found) return found;
  }
  return null;
}

function sanitizeName(name: string) {
  return name.replace(/[\\/]/g, "_").trim();
}

function getParentDirectory(path: string) {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === BLOGS_ROOT) return BLOGS_ROOT;
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return BLOGS_ROOT;
  return normalized.slice(0, index);
}
