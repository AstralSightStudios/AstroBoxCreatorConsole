/**
 * AstroBox-NG 官方插件源仓库。
 *
 * 与资源目录不同，插件源不区分 testenv / official，始终是这一个仓库。
 * 根目录 index.txt 的每一行是一个作者插件仓库的 raw 基地址，Action 会按
 * index.txt -> 作者仓库 index.txt -> manifest.json 的顺序生成 index.json。
 */
export const NG_PLUGIN_REPO_CONFIG = {
  owner: "AstralSightStudios",
  name: "AstroBox-NG-Plugin-Repo",
  defaultBranch: "main",
  indexFilePath: "index.txt",
  indexJsonPath: "index.json",
} as const;

export const NG_PLUGIN_REPO_LABEL = `${NG_PLUGIN_REPO_CONFIG.owner}/${NG_PLUGIN_REPO_CONFIG.name}`;

export function ngPluginIndexJsonUrl(): string {
  return `https://raw.githubusercontent.com/${NG_PLUGIN_REPO_CONFIG.owner}/${NG_PLUGIN_REPO_CONFIG.name}/${NG_PLUGIN_REPO_CONFIG.defaultBranch}/${NG_PLUGIN_REPO_CONFIG.indexJsonPath}`;
}
