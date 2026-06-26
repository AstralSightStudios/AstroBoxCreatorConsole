import { Badge, Button, Code, Spinner, Switch } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  HOTUPDATE_PLATFORMS,
  HotUpdateApi,
  parseReleaseJson,
  type HotUpdatePatch,
  type HotUpdatePlatform,
  type HotUpdateRelease,
  type KeyStatus,
  type ManifestPreview,
  type ParsedReleaseJson,
} from "~/api/astrobox/hotupdate";
import {
  AdminPage,
  Field,
  Panel,
  formatDateTime,
  inputClass,
  textareaClass,
} from "~/components/admin/AdminPage";

function getErrorMessage(error: unknown): string {
  const anyErr = error as any;
  const data = anyErr?.response?.data;
  if (data) {
    if (typeof data === "string") return data;
    if (typeof data.message === "string") return data.message;
    if (typeof data.error === "string") return data.error;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const PlatformSelect = ({
  value,
  onChange,
}: {
  value: HotUpdatePlatform;
  onChange: (v: HotUpdatePlatform) => void;
}) => (
  <select
    className={inputClass}
    value={value}
    onChange={(e) => onChange(e.target.value as HotUpdatePlatform)}
  >
    {HOTUPDATE_PLATFORMS.map((p) => (
      <option key={p} value={p}>
        {p}
      </option>
    ))}
  </select>
);

export default function AdminHotUpdatePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filterChannel, setFilterChannel] = useState("stable");
  const [filterPlatform, setFilterPlatform] = useState<"" | HotUpdatePlatform>(
    "",
  );

  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [releases, setReleases] = useState<HotUpdateRelease[]>([]);
  const [patches, setPatches] = useState<HotUpdatePatch[]>([]);

  // create-release form：粘贴 hotupdate-pack.ts 产出的 release.json
  const [releaseJsonText, setReleaseJsonText] = useState("");
  const [rChannel, setRChannel] = useState("stable");
  const [rPlatform, setRPlatform] = useState<HotUpdatePlatform>("all");
  const [rBaseUrl, setRBaseUrl] = useState("");
  const [rRollout, setRRollout] = useState("1");
  const [rNotes, setRNotes] = useState("");
  const [creatingRelease, setCreatingRelease] = useState(false);

  const parsedRelease = useMemo<ParsedReleaseJson | null>(() => {
    if (!releaseJsonText.trim()) return null;
    try {
      return parseReleaseJson(releaseJsonText);
    } catch {
      return null;
    }
  }, [releaseJsonText]);

  const parseError = useMemo(() => {
    if (!releaseJsonText.trim()) return "";
    try {
      parseReleaseJson(releaseJsonText);
      return "";
    } catch (err) {
      return getErrorMessage(err);
    }
  }, [releaseJsonText]);

  // 解析成功后用 release.json 里的值回填渠道/平台/baseUrl（仅当用户未手动改时不强求）
  useEffect(() => {
    if (!parsedRelease) return;
    if (parsedRelease.channel) setRChannel(parsedRelease.channel);
    if (parsedRelease.platform) setRPlatform(parsedRelease.platform);
    if (parsedRelease.filesBaseUrl) setRBaseUrl(parsedRelease.filesBaseUrl);
  }, [parsedRelease]);

  // create-patch form
  const [pChannel, setPChannel] = useState("stable");
  const [pPlatform, setPPlatform] = useState<HotUpdatePlatform>("all");
  const [pId, setPId] = useState("");
  const [pMinNative, setPMinNative] = useState("");
  const [pScript, setPScript] = useState("");
  const [creatingPatch, setCreatingPatch] = useState(false);

  // edit-release inline state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    filesBaseUrl: string;
    semver: string;
    minNativeVersion: string;
    rollout: string;
    notes: string;
  } | null>(null);

  // preview
  const [previewChannel, setPreviewChannel] = useState("stable");
  const [previewPlatform, setPreviewPlatform] = useState<HotUpdatePlatform>(
    "all",
  );
  const [preview, setPreview] = useState<ManifestPreview | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const query = {
        channel: filterChannel || undefined,
        platform: filterPlatform || undefined,
      };
      const [key, rel, pat] = await Promise.all([
        HotUpdateApi.key().catch(() => null),
        HotUpdateApi.releases.list(query),
        HotUpdateApi.patches.list(query),
      ]);
      setKeyStatus(key);
      setReleases(rel.items);
      setPatches(pat.items);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRelease = async () => {
    if (!parsedRelease) return toast.error("请先粘贴有效的 release.json");
    if (!rChannel.trim()) return toast.error("请填写渠道");
    if (!rBaseUrl.trim()) return toast.error("请填写 filesBaseUrl（CDN 内容寻址根）");
    const rollout = Number(rRollout);
    if (Number.isNaN(rollout) || rollout < 0 || rollout > 1)
      return toast.error("灰度比例需在 0~1 之间");
    setCreatingRelease(true);
    try {
      await HotUpdateApi.releases.create({
        channel: rChannel.trim(),
        platform: rPlatform,
        version: parsedRelease.version,
        semver: parsedRelease.semver || undefined,
        minNativeVersion: parsedRelease.minNativeVersion || undefined,
        filesBaseUrl: rBaseUrl.trim(),
        files: parsedRelease.files,
        rollout,
        notes: rNotes.trim() || undefined,
      });
      toast.success(
        `已发布 v${parsedRelease.version}（${parsedRelease.files.length} 个文件）`,
      );
      setReleaseJsonText("");
      setRNotes("");
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setCreatingRelease(false);
    }
  };

  const patchRelease = async (
    id: string,
    body: Parameters<typeof HotUpdateApi.releases.update>[1],
    okMsg: string,
  ) => {
    try {
      await HotUpdateApi.releases.update(id, body);
      toast.success(okMsg);
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deleteRelease = async (id: string, version: number) => {
    if (!confirm(`确认删除版本 ${version}？该操作不可撤销。`)) return;
    try {
      await HotUpdateApi.releases.remove(id);
      toast.success("已删除");
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const startEdit = (r: HotUpdateRelease) => {
    setEditingId(r.id);
    setEditDraft({
      filesBaseUrl: r.filesBaseUrl,
      semver: r.semver,
      minNativeVersion: r.minNativeVersion,
      rollout: String(r.rollout),
      notes: r.notes,
    });
  };

  const saveEdit = async (id: string) => {
    if (!editDraft) return;
    const rollout = Number(editDraft.rollout);
    if (Number.isNaN(rollout) || rollout < 0 || rollout > 1)
      return toast.error("灰度比例需在 0~1 之间");
    try {
      await HotUpdateApi.releases.update(id, {
        filesBaseUrl: editDraft.filesBaseUrl.trim(),
        semver: editDraft.semver.trim(),
        minNativeVersion: editDraft.minNativeVersion.trim(),
        rollout,
        notes: editDraft.notes.trim(),
      });
      toast.success("已保存");
      setEditingId(null);
      setEditDraft(null);
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const createPatch = async () => {
    if (!pChannel.trim()) return toast.error("请填写渠道");
    if (!pId.trim()) return toast.error("请填写补丁 ID");
    if (!pScript.trim()) return toast.error("请填写补丁脚本");
    setCreatingPatch(true);
    try {
      await HotUpdateApi.patches.create({
        channel: pChannel.trim(),
        platform: pPlatform,
        patchId: pId.trim(),
        script: pScript,
        minNativeVersion: pMinNative.trim() || undefined,
      });
      toast.success("已创建补丁");
      setPId("");
      setPScript("");
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setCreatingPatch(false);
    }
  };

  const togglePatch = async (id: string, enabled: boolean) => {
    try {
      await HotUpdateApi.patches.update(id, { enabled });
      toast.success(enabled ? "已启用补丁" : "已停用补丁");
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const deletePatch = async (id: string, patchId: string) => {
    if (!confirm(`确认删除补丁 ${patchId}？`)) return;
    try {
      await HotUpdateApi.patches.remove(id);
      toast.success("已删除");
      await loadAll();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const runPreview = async () => {
    try {
      const res = await HotUpdateApi.preview(previewChannel, previewPlatform);
      setPreview(res);
      if (!res.manifest) toast.info("该渠道/平台当前无可下发的 manifest");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <AdminPage
      title="热更新管理"
      description="前端按文件内容寻址增量更新：用 hotupdate-pack.ts 打包产出 release.json + files/，把 files/ 传到 CDN，这里粘贴 release.json 发布即可。客户端只下变更文件，字体/wasm 复用。"
      requiredRoles={["admin"]}
      loading={loading && releases.length === 0 && patches.length === 0}
      error={error}
      onRetry={loadAll}
    >
      <div className="flex flex-col gap-4">
        {/* 签名密钥状态 */}
        <Panel title="签名密钥">
          {keyStatus === null ? (
            <p className="text-sm text-white/55">无法读取密钥状态。</p>
          ) : keyStatus.configured ? (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge color="green">已配置</Badge>
                <span className="text-white/55">
                  服务端已就绪，manifest / patch 会被自动签名。
                </span>
              </div>
              <div className="text-white/70">
                公钥（须与客户端 keys.rs 的 UPDATE_VERIFY_KEY 一致）：
              </div>
              <Code className="break-all">{keyStatus.publicKeyHex}</Code>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              尚未配置签名私钥（config.json 的 hotupdate.signingKey）。当前所有下发接口会返回
              503。请先在服务端运行 <Code>bun run scripts/hotupdate-keygen.ts</Code> 生成密钥。
            </div>
          )}
        </Panel>

        {/* 过滤器 */}
        <Panel title="筛选">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
            <Field label="渠道">
              <input
                className={inputClass}
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
                placeholder="stable / beta / canary"
              />
            </Field>
            <Field label="平台">
              <select
                className={inputClass}
                value={filterPlatform}
                onChange={(e) =>
                  setFilterPlatform(e.target.value as "" | HotUpdatePlatform)
                }
              >
                <option value="">全部平台</option>
                {HOTUPDATE_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <Button className="w-full" onClick={loadAll}>
                查询
              </Button>
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 2xl:grid-cols-[minmax(420px,0.9fr)_minmax(560px,1.1fr)]">
          {/* 发布新版本 */}
          <Panel title="发布新版本">
            <div className="grid gap-3">
              <Field label="粘贴 release.json（hotupdate-pack.ts 产出）">
                <textarea
                  className={`${textareaClass} min-h-32 font-mono-sarasa text-xs`}
                  value={releaseJsonText}
                  onChange={(e) => setReleaseJsonText(e.target.value)}
                  placeholder='{"version":145,"semver":"1.4.5","files":[...]}'
                />
              </Field>
              {parseError && (
                <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                  解析失败：{parseError}
                </div>
              )}
              {parsedRelease && (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                  解析成功：v{parsedRelease.version}
                  {parsedRelease.semver ? ` (${parsedRelease.semver})` : ""} ·{" "}
                  {parsedRelease.files.length} 个文件 ·{" "}
                  {formatBytes(
                    parsedRelease.files.reduce((s, f) => s + f.size, 0),
                  )}
                  {parsedRelease.minNativeVersion
                    ? ` · 最低原生 ${parsedRelease.minNativeVersion}`
                    : ""}
                </div>
              )}
              <Field label="filesBaseUrl（CDN 内容寻址根，文件地址 = base + sha256）">
                <input
                  className={inputClass}
                  value={rBaseUrl}
                  onChange={(e) => setRBaseUrl(e.target.value)}
                  placeholder="https://cdn.../hotupdate/files/"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="渠道">
                  <input
                    className={inputClass}
                    value={rChannel}
                    onChange={(e) => setRChannel(e.target.value)}
                  />
                </Field>
                <Field label="平台">
                  <PlatformSelect value={rPlatform} onChange={setRPlatform} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="灰度比例 0~1">
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rRollout}
                    onChange={(e) => setRRollout(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="更新说明（可选）">
                <textarea
                  className={textareaClass}
                  value={rNotes}
                  onChange={(e) => setRNotes(e.target.value)}
                />
              </Field>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/45">
                  确保 files/ 已传到 filesBaseUrl 路径下。
                </span>
                <Button
                  onClick={createRelease}
                  disabled={creatingRelease || !parsedRelease}
                >
                  {creatingRelease ? <Spinner /> : "发布"}
                </Button>
              </div>
            </div>
          </Panel>

          {/* 版本列表 */}
          <Panel title={`版本列表（${releases.length}）`}>
            <div className="flex flex-col gap-2">
              {releases.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge color="blue">{r.channel}</Badge>
                    <Badge color="gray">{r.platform}</Badge>
                    <span className="font-semibold text-white">
                      v{r.version}
                      {r.semver ? ` · ${r.semver}` : ""}
                    </span>
                    {r.revoked && <Badge color="red">已吊销</Badge>}
                    {!r.enabled && <Badge color="amber">已停用</Badge>}
                    {r.enabled && !r.revoked && (
                      <Badge color="green">下发中</Badge>
                    )}
                    <span className="ml-auto text-xs text-white/40">
                      {formatDateTime(r.updatedAt)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/55">
                    <span>灰度：{Math.round(r.rollout * 100)}%</span>
                    <span>
                      {r.fileCount} 个文件 · {formatBytes(r.totalSize)}
                    </span>
                    {r.minNativeVersion && (
                      <span>最低原生：{r.minNativeVersion}</span>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono-sarasa text-xs text-white/40">
                    {r.filesBaseUrl}
                  </p>
                  {r.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-white/60">
                      {r.notes}
                    </p>
                  )}

                  {editingId === r.id && editDraft ? (
                    <div className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-black/30 p-3">
                      <Field label="filesBaseUrl">
                        <input
                          className={inputClass}
                          value={editDraft.filesBaseUrl}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              filesBaseUrl: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="语义版本">
                          <input
                            className={inputClass}
                            value={editDraft.semver}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                semver: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="最低原生">
                          <input
                            className={inputClass}
                            value={editDraft.minNativeVersion}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                minNativeVersion: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="灰度 0~1">
                          <input
                            className={inputClass}
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={editDraft.rollout}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                rollout: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                      <Field label="更新说明">
                        <textarea
                          className={textareaClass}
                          value={editDraft.notes}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              notes: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <p className="text-xs text-white/40">
                        要换文件清单请发新版本（编辑只改元数据）。
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="1"
                          variant="soft"
                          color="gray"
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft(null);
                          }}
                        >
                          取消
                        </Button>
                        <Button size="1" onClick={() => saveEdit(r.id)}>
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => startEdit(r)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        color={r.enabled ? "amber" : "green"}
                        onClick={() =>
                          patchRelease(
                            r.id,
                            { enabled: !r.enabled },
                            r.enabled ? "已停用" : "已启用",
                          )
                        }
                      >
                        {r.enabled ? "停用" : "启用"}
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        color={r.revoked ? "green" : "red"}
                        onClick={() =>
                          patchRelease(
                            r.id,
                            { revoked: !r.revoked },
                            r.revoked
                              ? "已恢复"
                              : "已吊销（客户端将回滚此版本）",
                          )
                        }
                      >
                        {r.revoked ? "恢复" : "吊销"}
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        color="red"
                        onClick={() => deleteRelease(r.id, r.version)}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {releases.length === 0 && (
                <div className="rounded-xl border border-white/10 px-4 py-10 text-center text-sm text-white/50">
                  暂无版本
                </div>
              )}
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 2xl:grid-cols-[minmax(400px,0.8fr)_minmax(560px,1.2fr)]">
          {/* 创建补丁 */}
          <Panel title="新增全局补丁（eval 热补丁）">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="渠道">
                  <input
                    className={inputClass}
                    value={pChannel}
                    onChange={(e) => setPChannel(e.target.value)}
                  />
                </Field>
                <Field label="平台">
                  <PlatformSelect value={pPlatform} onChange={setPPlatform} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="补丁 ID">
                  <input
                    className={inputClass}
                    value={pId}
                    onChange={(e) => setPId(e.target.value)}
                    placeholder="如 fix-login-2026-06"
                  />
                </Field>
                <Field label="最低原生壳版本（可选）">
                  <input
                    className={inputClass}
                    value={pMinNative}
                    onChange={(e) => setPMinNative(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="脚本（前端 global eval 执行，已验签）">
                <textarea
                  className={`${textareaClass} min-h-44 font-mono-sarasa`}
                  value={pScript}
                  onChange={(e) => setPScript(e.target.value)}
                  placeholder="// 谨慎：拥有完整 webview 权限"
                />
              </Field>
              <div className="flex justify-end">
                <Button onClick={createPatch} disabled={creatingPatch}>
                  {creatingPatch ? <Spinner /> : "新增补丁"}
                </Button>
              </div>
            </div>
          </Panel>

          {/* 补丁列表 */}
          <Panel title={`补丁列表（${patches.length}）`}>
            <div className="flex flex-col gap-2">
              {patches.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge color="blue">{p.channel}</Badge>
                    <Badge color="gray">{p.platform}</Badge>
                    <span className="font-semibold text-white">{p.patchId}</span>
                    {p.enabled ? (
                      <Badge color="green">启用</Badge>
                    ) : (
                      <Badge color="amber">停用</Badge>
                    )}
                    {p.minNativeVersion && (
                      <span className="text-xs text-white/40">
                        ≥{p.minNativeVersion}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-white/40">
                      {formatDateTime(p.updatedAt)}
                    </span>
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-black/40 p-2 font-mono-sarasa text-[11px] text-white/70">
                    {p.script}
                  </pre>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-white/55">
                      <Switch
                        size="1"
                        checked={p.enabled}
                        onCheckedChange={(v) => togglePatch(p.id, v)}
                      />
                      启用
                    </label>
                    <Button
                      size="1"
                      variant="soft"
                      color="red"
                      onClick={() => deletePatch(p.id, p.patchId)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
              {patches.length === 0 && (
                <div className="rounded-xl border border-white/10 px-4 py-10 text-center text-sm text-white/50">
                  暂无补丁
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* 预览 */}
        <Panel title="下发预览">
          <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
            <Field label="渠道">
              <input
                className={inputClass}
                value={previewChannel}
                onChange={(e) => setPreviewChannel(e.target.value)}
              />
            </Field>
            <Field label="平台">
              <PlatformSelect
                value={previewPlatform}
                onChange={setPreviewPlatform}
              />
            </Field>
            <div className="flex items-end">
              <Button className="w-full" onClick={runPreview}>
                预览 manifest
              </Button>
            </div>
          </div>
          {preview && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs">
                {preview.signed ? (
                  <Badge color="green">已签名</Badge>
                ) : (
                  <Badge color="amber">未签名（密钥未配置）</Badge>
                )}
                {preview.manifest && (
                  <span className="text-white/50">
                    v{preview.manifest.version} · {preview.manifest.files.length}{" "}
                    个文件
                  </span>
                )}
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono-sarasa text-[11px] text-white/75">
                {preview.manifest
                  ? JSON.stringify(preview.manifest, null, 2)
                  : "// 当前渠道/平台无可下发的 manifest（客户端会收到 204）"}
              </pre>
            </div>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
