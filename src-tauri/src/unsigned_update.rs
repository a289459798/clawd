//! Unsigned self-update over HTTPS (no `.sig` / pubkey). Trust is TLS + URL host only.
//! Install automation follows Tauri updater layouts where practical (macOS `.app.tar.gz` or `.zip` wrapping `*.app`, Windows `.exe`/`.msi`).

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    mandatory: Option<bool>,
    platforms: HashMap<String, PlatformEntry>,
}

#[derive(Debug, Deserialize)]
struct PlatformEntry {
    url: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsignedUpdateProbe {
    pub version: String,
    pub mandatory: bool,
    pub url: String,
    /// Tauri package version from `tauri.conf.json` — same basis as the semver compare against the manifest.
    pub current_version: String,
}

fn updater_target_key() -> Result<String, String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err("unsupported platform for auto-update".into());
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "arm") {
        "armv7"
    } else if cfg!(target_arch = "x86") {
        "i686"
    } else {
        return Err("unsupported CPU architecture for auto-update".into());
    };
    Ok(format!("{os}-{arch}"))
}

fn parse_semver(input: &str) -> Result<semver::Version, String> {
    semver::Version::parse(input.trim_start_matches('v')).map_err(|error| error.to_string())
}

fn suffix_from_url(url: &str) -> String {
    let path = url.split('?').next().unwrap_or(url);
    if path.ends_with(".tar.gz") {
        return ".tar.gz".into();
    }
    if path.ends_with(".AppImage") {
        return ".AppImage".into();
    }
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| match extension {
            "exe" => ".exe",
            "msi" => ".msi",
            "deb" => ".deb",
            "rpm" => ".rpm",
            "zip" => ".zip",
            _ => ".bin",
        })
        .unwrap_or(".bin")
        .into()
}

#[tauri::command]
pub async fn clawkit_unsigned_update_probe(app: AppHandle, endpoint: String) -> Result<Option<UnsignedUpdateProbe>, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let manifest: UpdateManifest = response.json().await.map_err(|error| error.to_string())?;

    let key = updater_target_key()?;
    let platform = manifest
        .platforms
        .get(&key)
        .ok_or_else(|| format!("update manifest has no entry for platform `{key}`"))?;

    let remote_version = parse_semver(&manifest.version)?;
    let current_version = app.package_info().version.clone();

    if remote_version <= current_version {
        return Ok(None);
    }

    let mandatory = manifest.mandatory.unwrap_or(false);

    Ok(Some(UnsignedUpdateProbe {
        version: manifest.version,
        mandatory,
        url: platform.url.clone(),
        current_version: current_version.to_string(),
    }))
}

/// Tauri package version from `tauri.conf.json` (same value `getVersion()` returns on the webview).
#[tauri::command]
pub fn clawkit_cargo_pkg_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn clawkit_unsigned_update_download(_app: AppHandle, url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;

    let suffix = suffix_from_url(&url);
    let mut temp = tempfile::Builder::new()
        .prefix("clawkit-update-")
        .suffix(&suffix)
        .tempfile()
        .map_err(|error| error.to_string())?;

    temp.write_all(&bytes).map_err(|error| error.to_string())?;

    let (_, path) = temp.keep().map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn clawkit_unsigned_update_install(app: AppHandle, path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(path);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || install_blocking(handle, path_buf))
        .await
        .map_err(|error| format!("install task failed: {error}"))?
}

fn install_blocking(app: AppHandle, path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        std::process::exit(0);
    }

    #[cfg(target_os = "macos")]
    {
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        install_macos_payload(&bytes)?;
        tauri::process::restart(&app.env());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, path);
        Err("automatic install is not implemented on this platform — open the download URL in a browser".into())
    }
}

#[cfg(target_os = "macos")]
fn payload_format_hint(bytes: &[u8]) -> String {
    let head_len = bytes.len().min(24);
    let head_hex: String = bytes[..head_len]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(" ");
    let sniff = if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        "magic=gzip"
    } else if bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b {
        "magic=zip"
    } else if bytes.starts_with(b"<!DOCTYPE") || bytes.starts_with(b"<!doctype") || bytes.starts_with(b"<html") {
        "magic≈html（多为 CDN 404/鉴权页）"
    } else if bytes.starts_with(b"{") || bytes.starts_with(b"[") {
        "magic≈json（多为接口错误）"
    } else {
        "magic=unknown"
    };
    let ascii_hint = String::from_utf8_lossy(&bytes[..bytes.len().min(160)]);
    format!(" [{sniff}; head_hex={head_hex}; ascii_preview={ascii_hint:?}]")
}

#[cfg(target_os = "macos")]
fn install_macos_unpack_tar_from_reader<R: Read>(reader: R, dest: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let collected_path: PathBuf = entry.path().map_err(|error| error.to_string())?.iter().skip(1).collect();
        let extraction_path = dest.join(&collected_path);
        if let Some(parent) = extraction_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        entry.unpack(&extraction_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_macos_unpack_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    use std::io::Cursor;
    use zip::read::{root_dir_common_filter, ZipArchive};

    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(|error| error.to_string())?;

    // `ClawKit.app/Contents/...` → unwrap strips the `.app` folder.
    // `Contents/...` at zip root → full extract (no unwrap).
    let unwrap_app_bundle = match archive.root_dir(root_dir_common_filter) {
        Ok(Some(ref root)) => {
            let name = root.file_name().and_then(|n| n.to_str()).unwrap_or("");
            root.extension().and_then(|e| e.to_str()) == Some("app") || name.ends_with(".app")
        }
        _ => false,
    };

    if unwrap_app_bundle {
        archive
            .extract_unwrapped_root_dir(dest, root_dir_common_filter)
            .map_err(|e| e.to_string())
    } else {
        archive.extract(dest).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "macos")]
fn install_macos_swap_bundle(tmp_extract_dir: tempfile::TempDir) -> Result<(), String> {
    let tmp_backup_dir = tempfile::Builder::new()
        .prefix("clawkit_current_app")
        .tempdir()
        .map_err(|error| error.to_string())?;

    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let extract_path = extract_macos_app_bundle_path(&exe)?;

    let move_result = fs::rename(&extract_path, tmp_backup_dir.path().join("current_app"));

    let need_authorization = match move_result {
        Ok(()) => false,
        Err(error) => {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                true
            } else {
                return Err(error.to_string());
            }
        }
    };

    let tmp_root = tmp_extract_dir.keep();

    if need_authorization {
        let src = apple_escape_path(&extract_path);
        let new_root = apple_escape_path(&tmp_root);
        let script = format!(
            "do shell script \"rm -rf '{src}' && mv -f '{new_root}' '{src}'\" with administrator privileges"
        );

        let status = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status()
            .map_err(|error| error.to_string())?;

        if !status.success() {
            return Err("failed to install update (administrator permission denied or script failed)".into());
        }
    } else {
        if extract_path.exists() {
            fs::remove_dir_all(&extract_path).map_err(|error| error.to_string())?;
        }
        fs::rename(&tmp_root, &extract_path).map_err(|error| error.to_string())?;
    }

    let _ = std::process::Command::new("touch").arg(&extract_path).status();

    Ok(())
}

#[cfg(target_os = "macos")]
fn install_macos_payload(bytes: &[u8]) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;

    if bytes.len() < 64 {
        return Err(format!(
            "更新包过小（{} bytes），可能下载失败。{}",
            bytes.len(),
            payload_format_hint(bytes)
        ));
    }

    let tmp_extract_dir = tempfile::Builder::new()
        .prefix("clawkit_updated_app")
        .tempdir()
        .map_err(|error| error.to_string())?;

    let dir = tmp_extract_dir.path();

    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let decoder = GzDecoder::new(Cursor::new(bytes));
        install_macos_unpack_tar_from_reader(decoder, dir).map_err(|e| {
            format!(
                "gzip + tar 解压失败: {e}（invalid gzip header 表示文件并非 gzip，常为 HTML/直链错误）{}",
                payload_format_hint(bytes)
            )
        })?;
    } else if bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b {
        install_macos_unpack_zip(bytes, dir).map_err(|e| format!("zip 解压失败: {e}{}", payload_format_hint(bytes)))?;
    } else {
        install_macos_unpack_tar_from_reader(Cursor::new(bytes), dir).map_err(|e| {
            format!(
                "按纯 tar 解压失败（若实际是 gzip，请保证下载 URL 或 CDN 返回原始 .tar.gz 字节）: {e}{}",
                payload_format_hint(bytes)
            )
        })?;
    }

    if !dir.join("Contents").is_dir() {
        return Err(format!(
            "解压后根目录缺少 Contents/。manifest 的 darwin URL 应为 ClawKit 打的 ***.app.tar.gz**（或内容等价 zip）。{}",
            payload_format_hint(bytes)
        ));
    }

    install_macos_swap_bundle(tmp_extract_dir)
}

#[cfg(target_os = "macos")]
fn apple_escape_path(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "'\\''")
}

#[cfg(target_os = "macos")]
fn extract_macos_app_bundle_path(exe: &Path) -> Result<PathBuf, String> {
    let mut extract_path = exe
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "failed to resolve executable directory".to_string())?;

    let display = extract_path.display().to_string();
    if display.contains("Contents/MacOS") {
        extract_path = extract_path
            .parent()
            .and_then(|path| path.parent())
            .map(PathBuf::from)
            .ok_or_else(|| "failed to resolve macOS .app bundle path".to_string())?;
    }

    Ok(extract_path)
}
