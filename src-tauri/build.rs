use chrono::{FixedOffset, Utc};
use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build();
    generate_build_info();
}

/// 构建期生成 `src/buildinfo.rs`：记录提交短哈希、UTC+8 构建时间与构建用户，
/// 供诊断信息、日志包与资源提交 request.json 的 client 字段读取。
fn generate_build_info() {
    let full_commit_hash = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let git_commit_hash = if full_commit_hash.len() >= 7 {
        full_commit_hash[..7].to_string()
    } else {
        full_commit_hash
    };

    let build_user = env::var("USER")
        .or_else(|_| env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());

    let build_time = Utc::now()
        .with_timezone(&FixedOffset::east_opt(8 * 3600).expect("valid UTC+8 offset"))
        .to_rfc3339();

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let out_path = Path::new(&manifest_dir).join("src").join("buildinfo.rs");
    let content = format!(
        "pub struct BuildInfo;\nimpl BuildInfo {{\n    pub const GIT_COMMIT_HASH: &'static str = \"{}\";\n    pub const BUILD_TIME: &'static str = \"{}\";\n    pub const BUILD_USER: &'static str = \"{}\";\n}}\n",
        git_commit_hash, build_time, build_user
    );
    fs::write(out_path, content).expect("unable to write buildinfo.rs");
}
