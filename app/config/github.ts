const defaultScopes = [
    "repo",
    "delete_repo",
    "workflow",
    "read:user",
    "user:email",
];

// 内容读取账号只需要读取公开数据；绝不请求 repo / delete_repo / workflow。
const readerScopes = ["read:user"];

export const GITHUB_OAUTH_CONFIG = {
    clientId: "Ov23liBMqMb1utzPatgY",
    scopes: defaultScopes,
    readerScopes,
};
