//! Unsigned self-update over HTTPS (no `.sig` / pubkey). Trust is TLS + URL host only.
//! Install automation follows Tauri updater layouts where practical (macOS `.app.tar.gz`, Windows `.exe`/`.msi`).

use serde::Deserialize;
use std::collections::HashMap;
use std::io::Write;
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
            _ => ".bin",
        })
        .unwrap_or(".bin")
        .into()
}

#[tauri::command]
pub async fn clawkit_unsigned_update_probe(endpoint: String) -> Result<Option<UnsignedUpdateProbe>, String> {
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
    let current_version =
        semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|error| error.to_string())?;

    if remote_version <= current_version {
        return Ok(None);
    }

    Ok(Some(UnsignedUpdateProbe {
        version: manifest.version,
        mandatory: manifest.mandatory.unwrap_or(false),
        url: platform.url.clone(),
    }))
}

#[tauri::command]
pub async fn clawkit_unsigned_update_download(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|error| error.to_string())?;

    let bytes = client
        .get(&url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;

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
        let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
        install_macos_tarball(&bytes)?;
        tauri::process::restart(&app.env());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (app, path);
        Err("automatic install is not implemented on this platform — open the download URL in a browser".into())
    }
}

#[cfg(target_os = "macos")]
fn install_macos_tarball(bytes: &[u8]) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;

    let cursor = Cursor::new(bytes);
    let decoder = GzDecoder::new(cursor);
    let mut archive = tar::Archive::new(decoder);

    let tmp_extract_dir = tempfile::Builder::new()
        .prefix("clawkit_updated_app")
        .tempdir()
        .map_err(|error| error.to_string())?;

    let tmp_backup_dir = tempfile::Builder::new()
        .prefix("clawkit_current_app")
        .tempdir()
        .map_err(|error| error.to_string())?;

    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let collected_path: PathBuf = entry.path().map_err(|error| error.to_string())?.iter().skip(1).collect();
        let extraction_path = tmp_extract_dir.path().join(&collected_path);
        if let Some(parent) = extraction_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        entry.unpack(&extraction_path).map_err(|error| error.to_string())?;
    }

    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let extract_path = extract_macos_app_bundle_path(&exe)?;

    let move_result = std::fs::rename(&extract_path, tmp_backup_dir.path().join("current_app"));

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
            std::fs::remove_dir_all(&extract_path).map_err(|error| error.to_string())?;
        }
        std::fs::rename(tmp_root, &extract_path).map_err(|error| error.to_string())?;
    }

    let _ = std::process::Command::new("touch").arg(&extract_path).status();

    Ok(())
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
