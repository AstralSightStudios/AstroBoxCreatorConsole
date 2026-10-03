import { describe, expect, test } from "bun:test";
import {
  indexItemIconUrl,
  indexItemRepoUrl,
  parseIndexV2,
} from "../../app/logic/catalog/index-v2";

const HEADER =
  "id,name,restype,repo_owner,repo_name,repo_commit_hash,icon,cover,tags,device_vendors,devices,paid_type\n";

describe("index_v2.csv 解析", () => {
  test("跳过未知资源类型，保留合法行", () => {
    const good = "a,A,watchface,o,r,abc1234,i.png,c.png,t,xiaomi,xmb10,\n";
    const bad = "b,B,unknown_type,o,r,abc1234,i.png,c.png,t,xiaomi,xmb10,\n";
    const entries = parseIndexV2(`${HEADER}${bad}${good}`);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "a",
      name: "A",
      restype: "watchface",
      repo_owner: "o",
      repo_name: "r",
      repo_commit_hash: "abc1234",
      icon: "i.png",
      cover: "c.png",
      tags: ["t"],
      device_vendors: ["xiaomi"],
      devices: ["xmb10"],
      paid_type: "free",
    });
  });

  test("缺少必要列或没有任何合法资源时失败", () => {
    expect(() => parseIndexV2("<html>error</html>")).toThrow(/缺少列/);
    expect(() => parseIndexV2("id,name\na,b")).toThrow(/缺少列/);
    expect(() =>
      parseIndexV2(
        `${HEADER}b,B,unknown_type,o,r,abc1234,i.png,c.png,t,xiaomi,xmb10,\n`,
      ),
    ).toThrow(/没有解析出任何资源/);
  });

  test("去掉零宽字符，并按表头而不是列顺序读取", () => {
    const csv = [
      "paid_type,devices,device_vendors,tags,cover,icon,repo_commit_hash,repo_name,repo_owner,restype,name,id",
      "paid,xmb10,xiaomi,标签,c.png,i.png,abc1234,repo,owner,firmware,名字,id\u200b1",
    ].join("\n");
    const [entry] = parseIndexV2(`\uFEFF${csv}`);

    expect(entry).toMatchObject({
      id: "id1",
      name: "名字",
      restype: "firmware",
      paid_type: "paid",
      repo_owner: "owner",
      repo_name: "repo",
    });
  });

  test("占位 id、强制付费和分号列表按 NG 规则处理", () => {
    const row =
      '"<placeholder>","名称, 带逗号",res_pack,owner,repo,abc,icon.png,cover.png,a; b;,xiaomi;vivo,d1;d2,force_paid';
    const [entry] = parseIndexV2(`${HEADER}${row}\n`);

    expect(entry.id).toBe("placeholder_0");
    expect(entry.name).toBe("名称, 带逗号");
    expect(entry.restype).toBe("res_pack");
    expect(entry.paid_type).toBe("force_paid");
    expect(entry.tags).toEqual(["a", "b", ""]);
    expect(entry.device_vendors).toEqual(["xiaomi", "vivo"]);
    expect(entry.devices).toEqual(["d1", "d2"]);
  });

  test("缺少仓库身份的行被跳过", () => {
    const bad = "a,A,canopus,,,abc1234,i.png,c.png,,,,\n";
    const good = "b,B,canopus,owner,repo,abc1234,i.png,c.png,,,,paid\n";
    const entries = parseIndexV2(`${HEADER}${bad}${good}`);

    expect(entries.map((entry) => entry.id)).toEqual(["b"]);
    expect(entries[0]?.paid_type).toBe("paid");
  });

  test("图标和仓库地址", () => {
    const [entry] = parseIndexV2(
      `${HEADER}a,A,watchface,Owner,Repo,abc,icon.png,c.png,,,,\n`,
    );

    expect(indexItemRepoUrl(entry!)).toBe("https://github.com/Owner/Repo");
    expect(indexItemIconUrl(entry!)).toBe(
      "https://raw.githubusercontent.com/Owner/Repo/abc/icon.png",
    );
    expect(
      indexItemIconUrl({ ...entry!, icon: "https://cdn.example/icon.png" }),
    ).toBe("https://cdn.example/icon.png");
  });
});
