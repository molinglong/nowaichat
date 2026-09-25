use serde::{Serialize, Deserialize};
use tauri::{Manager, WebviewWindow, WebviewUrl, PhysicalPosition};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_mica, apply_acrylic, clear_mica, clear_acrylic};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use std::fs;
use std::path::{Path, PathBuf};

/// 当前窗口是否为最大化(全屏)状态,前端用于红绿灯"绿色按钮"图标切换。
#[derive(Serialize)]
struct WindowState {
    maximized: bool,
    fullscreen: bool,
}

#[tauri::command]
fn get_window_state(window: WebviewWindow) -> WindowState {
    WindowState {
        maximized: window.is_maximized().unwrap_or(false),
        fullscreen: window.is_fullscreen().unwrap_or(false),
    }
}

/// macOS 风格:绿色按钮 = 进入/退出全屏(不是 Windows 的"最大化")。
/// 在 Windows 上行为对齐 macOS:点一次进全屏,再点一次退出。
#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<(), String> {
    let is_fs = window.is_fullscreen().unwrap_or(false);
    window
        .set_fullscreen(!is_fs)
        .map_err(|e| e.to_string())
}

/// 最小化窗口(对应 macOS 黄色按钮)。
#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// 关闭窗口(对应 macOS 红色按钮)。
/// 桌面客户端体验:可以配置成"关闭到托盘",但首版先直接退出。
#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// 双击标题栏切换最大化(Windows 习惯,补充 macOS 红绿灯没有的行为)。
#[tauri::command]
fn toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// 给窗口应用系统毛玻璃材质。优先 Mica(Win11,拖动不掉帧),
/// 失败退 Acrylic(Win10);都失败静默跳过(保持不透明现状)。
/// dark: 应用当前深浅色(Some 同步给 Mica/Acrylic 着色),None 跟随系统。
#[cfg(target_os = "windows")]
fn apply_glass(window: &WebviewWindow, dark: Option<bool>) {
    if apply_mica(window, dark).is_ok() {
        return;
    }
    // Acrylic(Win10) 兜底:第二参是染色 RGBA,按应用深浅色给中性灰调
    let tint = if dark.unwrap_or(false) {
        (30, 30, 32, 200)
    } else {
        (245, 245, 247, 200)
    };
    let _ = apply_acrylic(window, Some(tint));
}

/// 运行时开关毛玻璃(设置弹窗「系统毛玻璃」切换)。
/// 仅允许主窗口调用:设置子窗口/搭子窗口保持自己的背景,不受玻璃模式影响。
#[tauri::command]
fn set_glass_effect(window: WebviewWindow, enabled: bool, dark: Option<bool>) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        // 先清掉现有材质,避免 Mica/Acrylic 叠加
        let _ = clear_mica(&window);
        let _ = clear_acrylic(&window);
        if enabled {
            apply_glass(&window, dark);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (enabled, dark);
    }
    Ok(())
}

// ============ 设置子窗口管理 ============

/// 打开设置子窗口:窗口常驻保活,但 WebView 可能被留在别的页面(如服务异常时
/// 的 404 页上点了“返回主页”→ 停在 /)。show 前校验当前 URL,不在设置页则
/// eval 拉回,保证弹出的永远是设置页。JS 侧无法跨 WebView 读 URL/导航(权限
/// 表未提供),故此逻辑收口在 Rust。
#[tauri::command]
fn show_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("settings")
        .ok_or("settings 窗口不存在")?;
    let url = win.url().map(|u| u.to_string()).unwrap_or_default();
    if !url.contains("/settings-window") {
        let _ = win.eval("location.replace('/settings-window/')");
    }
    win.show().map_err(|e| e.to_string())?;
    win.unminimize().ok();
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 搭子窗口管理 ============

/// 显示搭子窗口
#[tauri::command]
fn show_buddy_window(app: tauri::AppHandle) -> Result<(), String> {
    // 如果窗口不存在,先创建
    if app.get_webview_window("buddy").is_none() {
        let _window = tauri::WebviewWindowBuilder::new(
            &app,
            "buddy",
            tauri::WebviewUrl::App("/buddy/".into()),
        )
        .title("搭子")
        .inner_size(120.0, 120.0)
        .position(20.0, 100.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let buddy = app.get_webview_window("buddy").unwrap();
    buddy.show().map_err(|e| e.to_string())?;
    buddy.unminimize().ok();
    Ok(())
}

/// 隐藏搭子窗口
#[tauri::command]
fn hide_buddy_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(buddy) = app.get_webview_window("buddy") {
        buddy.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 切换搭子窗口显示/隐藏
#[tauri::command]
fn toggle_buddy_window(app: tauri::AppHandle) -> Result<bool, String> {
    // 如果窗口不存在,创建并显示
    if app.get_webview_window("buddy").is_none() {
        let _window = tauri::WebviewWindowBuilder::new(
            &app,
            "buddy",
            tauri::WebviewUrl::App("/buddy/".into()),
        )
        .title("搭子")
        .inner_size(120.0, 120.0)
        .position(20.0, 100.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
        return Ok(true);
    }

    let buddy = app.get_webview_window("buddy").unwrap();
    let is_visible = buddy.is_visible().unwrap_or(false);
    if is_visible {
        buddy.hide().map_err(|e| e.to_string())?;
    } else {
        buddy.show().map_err(|e| e.to_string())?;
    }
    Ok(!is_visible)
}

/// 设置搭子窗口位置
#[tauri::command]
fn set_buddy_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    if let Some(buddy) = app.get_webview_window("buddy") {
        buddy
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 获取搭子窗口位置
#[tauri::command]
fn get_buddy_position(app: tauri::AppHandle) -> Result<Option<(i32, i32)>, String> {
    if let Some(buddy) = app.get_webview_window("buddy") {
        let pos = buddy.outer_position().map_err(|e| e.to_string())?;
        Ok(Some((pos.x, pos.y)))
    } else {
        Ok(None)
    }
}

/// 获取屏幕尺寸
#[tauri::command]
fn get_screen_size(app: tauri::AppHandle) -> Result<Option<(u32, u32)>, String> {
    if let Some(buddy) = app.get_webview_window("buddy") {
        if let Some(monitor) = buddy.current_monitor().map_err(|e| e.to_string())? {
            let size = monitor.size();
            Ok(Some((size.width, size.height)))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

/// 创建搭子窗口（如果不存在）
#[tauri::command]
async fn create_buddy_window(app: tauri::AppHandle) -> Result<(), String> {
    // 检查是否已存在
    if app.get_webview_window("buddy").is_some() {
        return Ok(());
    }

    // 创建新窗口
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "buddy",
        WebviewUrl::App("/buddy/".into()),
    )
    .title("搭子")
    .inner_size(120.0, 120.0)
    .position(20.0, 100.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(true)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 移动搭子窗口（相对于当前位置的偏移）
#[tauri::command]
fn move_buddy_window(app: tauri::AppHandle, delta_x: i32, delta_y: i32) -> Result<(), String> {
    if let Some(buddy) = app.get_webview_window("buddy") {
        let pos = buddy.outer_position().map_err(|e| e.to_string())?;
        buddy
            .set_position(PhysicalPosition::new(pos.x + delta_x, pos.y + delta_y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 聚焦主窗口
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.unminimize().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============ AI 本地文件能力(工作区沙箱) ============
//
// 安全模型:用户通过系统对话框选定唯一“授权工作区根目录”,存于 Rust 侧配置
// (app_config_dir/localfiles.json),前端只能传相对路径。所有写/删都经 lf_safe_join
// 二次校验:拒绝绝对路径与 `..` 越界,canonicalize 后必须以 base 为前缀,且不得命中
// 系统目录黑名单。删除一律走系统回收站(trash),可还原,不做物理删除。

/// 本地文件配置:仅存唯一授权工作区根目录(绝对路径)。
#[derive(Serialize, Deserialize, Default)]
struct LocalFilesConfig {
    base: Option<String>,
}

/// 写入结果:回传给前端展示(绝对路径 + 字节数 + 撤销记录 id)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfWriteResult {
    abs_path: String,
    bytes: usize,
    undo_id: Option<String>,
}

/// 删除结果:回传给前端展示(绝对路径 + 已入回收站标记)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfDeleteResult {
    abs_path: String,
    trashed: bool,
}

/// 配置文件路径:app_config_dir/localfiles.json。
fn lf_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {}", e))?;
    Ok(dir.join("localfiles.json"))
}

/// 读取授权根目录(不存在或损坏时返回 None)。
fn lf_read_base(app: &tauri::AppHandle) -> Option<String> {
    let path = lf_config_path(app).ok()?;
    let raw = fs::read_to_string(&path).ok()?;
    let cfg: LocalFilesConfig = serde_json::from_str(&raw).ok()?;
    cfg.base
}

/// 系统目录黑名单(小写、子串包含匹配):命中即拒绝。
/// 即便用户误选,也绝不允许 AI 触碰 Windows 关键目录。
fn lf_denied(abs_lower: &str) -> bool {
    const BLACKLIST: &[&str] = &[
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "\\system32",
        "\\syswow64",
        "\\programdata\\microsoft\\windows",
    ];
    BLACKLIST.iter().any(|bad| abs_lower.contains(bad))
}

/// 安全拼接:base(授权根) + rel(前端相对路径) → 校验后的绝对路径。
/// 拒绝:绝对路径 rel、`..` 越界、解析后不以 base 为前缀、命中系统目录黑名单。
fn lf_safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim();
    if rel.is_empty() {
        return Err("路径为空".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("仅允许相对工作区的路径".into());
    }
    for comp in rel_path.components() {
        if let std::path::Component::ParentDir = comp {
            return Err("路径不得包含 .. 越界".into());
        }
    }

    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("授权工作区无效: {}", e))?;

    // 目标可能尚不存在(create),canonicalize 会失败;改为逐级上溯至已存在的最近祖先,
    // 规范后再把剩余末段拼回,从而对“将被创建的文件”也能做前缀校验。
    let joined = base_canon.join(rel_path);
    let mut existing = joined.as_path();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(c) => {
                let mut resolved = c;
                for part in tail.iter().rev() {
                    resolved = resolved.join(part);
                }
                if !resolved.starts_with(&base_canon) {
                    return Err("路径越出授权工作区".into());
                }
                let lower = resolved.to_string_lossy().to_lowercase();
                if lf_denied(&lower) {
                    return Err("目标命中系统目录黑名单,已拒绝".into());
                }
                return Ok(resolved);
            }
            Err(_) => {
                match existing.file_name() {
                    Some(name) => tail.push(name.to_os_string()),
                    None => return Err("无法解析目标路径".into()),
                }
                match existing.parent() {
                    Some(p) => existing = p,
                    None => return Err("无法解析目标路径".into()),
                }
            }
        }
    }
}

/// 设置授权工作区根目录:校验为可写目录且非系统目录后写入配置。
/// 这是唯一授权根,后续命令忽略前端传入的任何 base。
#[tauri::command]
fn lf_set_base(app: tauri::AppHandle, abs_path: String) -> Result<(), String> {
    let p = Path::new(&abs_path);
    if !p.exists() {
        return Err("目录不存在".into());
    }
    if !p.is_dir() {
        return Err("所选路径不是目录".into());
    }
    let canon = p
        .canonicalize()
        .map_err(|e| format!("无法解析目录: {}", e))?;
    let lower = canon.to_string_lossy().to_lowercase();
    if lf_denied(&lower) {
        return Err("不允许将系统目录设为工作区".into());
    }
    // 可写性探测:建临时文件再删
    let probe = canon.join(".lf_write_probe.tmp");
    fs::write(&probe, b"ok").map_err(|e| format!("目录不可写: {}", e))?;
    let _ = fs::remove_file(&probe);

    let cfg_path = lf_config_path(&app)?;
    if let Some(parent) = cfg_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let cfg = LocalFilesConfig {
        base: Some(canon.to_string_lossy().to_string()),
    };
    let raw = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&cfg_path, raw).map_err(|e| format!("写入配置失败: {}", e))?;
    Ok(())
}

/// 读回授权根(前端展示用)。
#[tauri::command]
fn lf_get_base(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(lf_read_base(&app))
}

/// 写文件:base64 解码后写入 safe_join 校验的目标(自动创建父目录)。
#[tauri::command]
fn lf_write_file(
    app: tauri::AppHandle,
    rel_path: String,
    content_base64: String,
) -> Result<LfWriteResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    let bytes = BASE64
        .decode(content_base64.as_bytes())
        .map_err(|e| format!("内容 base64 解码失败: {}", e))?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    // 撤销快照:覆盖已有文件前备份原内容;新建文件记 create-new(撤销=移入回收站)
    let undo_id = lf_snapshot_before(&app, &target, &rel_path)?;
    fs::write(&target, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(LfWriteResult {
        abs_path: target.to_string_lossy().to_string(),
        bytes: bytes.len(),
        undo_id: Some(undo_id),
    })
}

/// 删文件:safe_join 校验后移入系统回收站(可还原)。
#[tauri::command]
fn lf_delete_file(app: tauri::AppHandle, rel_path: String) -> Result<LfDeleteResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    if !target.exists() {
        return Err("文件不存在".into());
    }
    trash::delete(&target).map_err(|e| format!("移入回收站失败: {}", e))?;
    Ok(LfDeleteResult {
        abs_path: target.to_string_lossy().to_string(),
        trashed: true,
    })
}

/// 读取结果:回传给前端(绝对路径 + 文件字节数 + base64 文本内容 + 截断/续读信息)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfReadResult {
    abs_path: String,
    bytes: usize,
    content_base64: String,
    truncated: bool,
    /// 文件总行数
    total_lines: usize,
    /// 还有后续内容时给出下次 read 的 offset(1-based);已到文件末尾为 null
    next_offset: Option<usize>,
}

/// 目录条目(列表用):名称 + 类型 + 文件大小(目录为 0)。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfListEntry {
    name: String,
    kind: String, // "dir" | "file"
    size: u64,
}

/// 目录列表结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfListResult {
    abs_path: String,
    entries: Vec<LfListEntry>,
    truncated: bool,
}

/// 编辑结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfEditResult {
    abs_path: String,
    bytes: usize,
    undo_id: Option<String>,
}

/// 移动/重命名结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfMoveResult {
    abs_path: String,
}

/// 概览结果:紧凑目录树文本 + 统计。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfOverviewResult {
    abs_path: String,
    text: String,
    truncated: bool,
    total_files: usize,
    total_dirs: usize,
}

/// 搜索结果:逐行命中(path:行号: 内容) + 统计。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfSearchResult {
    abs_path: String,
    text: String,
    truncated: bool,
    hits: usize,
    scanned_files: usize,
}

/// read 内容上限:64KB(超出截断,避免撑爆模型上下文)。
const LF_READ_MAX: usize = 64 * 1024;
/// read 行范围单页行数上限。
const LF_READ_PAGE: usize = 800;
/// outline 骨架行数上限。
const LF_OUTLINE_MAX: usize = 300;
/// edit 源文件上限:1MB(需全量读入内存做查找替换)。
const LF_EDIT_MAX: u64 = 1024 * 1024;
/// list 单层条目上限。
const LF_LIST_MAX: usize = 500;
/// overview 递归深度与条目/输出上限。
const LF_OVERVIEW_DEPTH: usize = 3;
const LF_OVERVIEW_MAX: usize = 400;
/// search 命中/单文件/输出上限。
const LF_SEARCH_MAX_HITS: usize = 100;
const LF_SEARCH_FILE_MAX: u64 = 512 * 1024;

/// 垃圾目录:overview/search 递归时跳过(依赖目录/构建产物不参与分析)。
fn lf_is_junk_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | ".svn"
            | ".next"
            | ".turbo"
            | ".idea"
            | ".vscode"
            | "dist"
            | "build"
            | "target"
            | "coverage"
            | "__pycache__"
            | "vendor"
    )
}

/// 字节数转紧凑显示(如 2.1KB)。
fn lf_fmt_size(len: u64) -> String {
    if len >= 1024 * 1024 {
        format!("{:.1}MB", len as f64 / (1024.0 * 1024.0))
    } else if len >= 1024 {
        format!("{:.1}KB", len as f64 / 1024.0)
    } else {
        format!("{}B", len)
    }
}
/// 撤销快照上限(环形,超出时最旧记录连同备份文件一起清理)。
const LF_UNDO_MAX: usize = 50;

/// 撤销记录:一次破坏性写盘(write 覆盖新建 / edit)的原内容快照元数据。
#[derive(Clone, Serialize, Deserialize, Default)]
struct LfUndoRecord {
    id: String,
    rel_path: String,
    /// "overwrite"=原内容已备份,撤销=写回; "create-new"=操作前不存在,撤销=移入回收站
    kind: String,
    /// overwrite 时备份内容文件的绝对路径
    backup_file: String,
    created_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct LfUndoStore {
    records: Vec<LfUndoRecord>,
}

fn lf_undo_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {}", e))?;
    Ok(dir.join("localfiles-undo.json"))
}

fn lf_backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {}", e))?;
    Ok(dir.join("localfiles-backup"))
}

fn lf_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 读取撤销存储(文件不存在/损坏时返回空,不阻断主流程)。
fn lf_read_undo(app: &tauri::AppHandle) -> LfUndoStore {
    let Ok(path) = lf_undo_path(app) else {
        return LfUndoStore::default();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn lf_write_undo(app: &tauri::AppHandle, store: &LfUndoStore) -> Result<(), String> {
    let path = lf_undo_path(app)?;
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("写入撤销记录失败: {}", e))?;
    Ok(())
}

/// 破坏性写盘前的撤销快照:目标已存在→原内容复制进备份目录(kind=overwrite);
/// 不存在→记 create-new(撤销=把本次新建的文件移入回收站)。返回记录 id 供前端
/// 卡片一键撤销。备份失败则中止主操作——宁可不写,不留无回退的破坏。
fn lf_snapshot_before(
    app: &tauri::AppHandle,
    target: &Path,
    rel_path: &str,
) -> Result<String, String> {
    let mut store = lf_read_undo(app);
    while store.records.len() >= LF_UNDO_MAX {
        let Some(old) = store.records.first().cloned() else {
            break;
        };
        if old.kind == "overwrite" && !old.backup_file.is_empty() {
            let _ = fs::remove_file(&old.backup_file);
        }
        store.records.remove(0);
    }
    let id = format!(
        "u{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let existed = target.exists();
    let backup_file = if existed {
        let dir = lf_backup_dir(app)?;
        fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败: {}", e))?;
        let bf = dir.join(format!("{}.bak", id));
        fs::copy(target, &bf).map_err(|e| format!("备份原内容失败: {}", e))?;
        bf.to_string_lossy().to_string()
    } else {
        String::new()
    };
    store.records.push(LfUndoRecord {
        id: id.clone(),
        rel_path: rel_path.to_string(),
        kind: if existed { "overwrite".into() } else { "create-new".into() },
        backup_file,
        created_at: lf_now_ms(),
    });
    lf_write_undo(app, &store)?;
    Ok(id)
}

/// 把截断后的字节缓冲回退到 UTF-8 字符边界(避免把多字节汉字切成非法序列)。
fn lf_utf8_floor(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && (bytes[end - 1] & 0xC0) == 0x80 {
        end -= 1;
    }
    if end > 0 && (bytes[end - 1] & 0x80) != 0 {
        end -= 1; // 停在多字节序列的起始字节上:序列不完整,一并丢弃
    }
    &bytes[..end]
}

/// 判断一行是否为代码结构行(outline 模式用):宽松覆盖 TS/JS/Python/Rust/Go/Java 的
/// 类型/函数/类声明特征。排除注释与噪音;深层缩进的 const/let 视为函数内局部变量不收。
fn lf_is_structure_line(line: &str) -> bool {
    let t = line.trim_start();
    if t.is_empty() {
        return false;
    }
    if t.starts_with("//") || t.starts_with("/*") || t.starts_with("*") || t.starts_with("#") {
        return false;
    }
    const KWS: &[&str] = &[
        "export ", "export{", "export default", "function ", "async function", "class ",
        "interface ", "type ", "enum ", "namespace ", "struct ", "impl ", "trait ", "fn ",
        "pub fn", "def ", "async def", "func ", "public ", "private ", "protected ",
        "static ", "constructor", "@interface", "extension ",
    ];
    if KWS.iter().any(|k| t.starts_with(k)) {
        return true;
    }
    // 顶层(缩进<=2)的变量声明:常见模块级实例,如 const app = new Hono()
    let indent = line.len() - t.len();
    indent <= 2 && (t.starts_with("const ") || t.starts_with("let ") || t.starts_with("var "))
}

/// 读文件:仅 UTF-8 纯文本(含 NUL 视为二进制拒绝),单次输出上限 64KB;
/// mode="outline" 返回结构骨架(结构行+行号,大文件先看地图再精读);
/// offset/limit 行范围读取(1-based,limit 上限 800)。结果始终带 total_lines,
/// 还有后续内容时带 next_offset(下次 read 的 offset),模型据此自动续读不丢内容。
#[tauri::command]
fn lf_read_file(
    app: tauri::AppHandle,
    rel_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
    mode: Option<String>,
) -> Result<LfReadResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    if target.is_dir() {
        return Err("目标是目录,请用 list 浏览目录内容".into());
    }
    let raw = fs::read(&target).map_err(|e| format!("读取文件失败: {}", e))?;
    if raw.contains(&0) {
        return Err("二进制文件不支持读取".into());
    }
    let full = String::from_utf8_lossy(&raw);
    let total_lines = full.lines().count();
    let (mut text, mut truncated, next_offset) = if mode.as_deref() == Some("outline") {
        // 骨架读取:只返回结构行(export/function/class 等+行号),一次看清全文件结构
        let mut out = String::new();
        let mut n = 0usize;
        for (i, line) in full.lines().enumerate() {
            if lf_is_structure_line(line) {
                let short: String = line.chars().take(120).collect();
                out.push_str(&format!("{}: {}\n", i + 1, short));
                n += 1;
                if n >= LF_OUTLINE_MAX {
                    break;
                }
            }
        }
        let truncated = n >= LF_OUTLINE_MAX;
        (out.trim_end().to_string(), truncated, None)
    } else if offset.is_some() || limit.is_some() {
        // 行范围读取:end < 总行数说明后面还有内容,给 next_offset 供模型续读
        let lines: Vec<&str> = full.lines().collect();
        let start = offset.unwrap_or(1).saturating_sub(1).min(lines.len());
        let end = (start + limit.unwrap_or(200).min(LF_READ_PAGE)).min(lines.len());
        let has_more = end < lines.len();
        let next = if has_more { Some(end + 1) } else { None };
        (lines[start..end].join("\n"), has_more, next)
    } else {
        let t = raw.len() > LF_READ_MAX;
        let view: &[u8] = if t {
            lf_utf8_floor(&raw[..LF_READ_MAX])
        } else {
            &raw[..]
        };
        let text = String::from_utf8(view.to_vec())
            .map_err(|_| "文件不是有效的 UTF-8 文本".to_string())?;
        // 全量读被 64KB 截断时,从已返回文本的行数推算续读起点
        let next = if t { Some(text.lines().count() + 1) } else { None };
        (text, t, next)
    };
    // 范围/骨架读取也可能超长(超长行/800 行大段),统一再限长一次
    if text.len() > LF_READ_MAX {
        text = String::from_utf8_lossy(lf_utf8_floor(&text.as_bytes()[..LF_READ_MAX])).to_string();
        truncated = true;
    }
    Ok(LfReadResult {
        abs_path: target.to_string_lossy().to_string(),
        bytes: raw.len(),
        content_base64: BASE64.encode(text.as_bytes()),
        truncated,
        total_lines,
        next_offset,
    })
}

/// 编辑器整文件读取上限:5MB(供客户端 Monaco 面板加载完整文件,与模型的 64KB read 通道分离)。
const LF_EDITOR_MAX: u64 = 5 * 1024 * 1024;

/// 编辑器整文件读取结果:绝对路径 + 字节数 + base64 内容。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfEditorReadResult {
    abs_path: String,
    bytes: u64,
    content_base64: String,
}

/// 编辑器整文件读取:独立于模型的 lf_read_file(64KB 截断保护模型上下文),
/// 供 Monaco 面板加载完整文本给「人看人改」。仅 UTF-8 纯文本(二进制拒绝);
/// 超 5MB 拒绝并带大小提示;严格 UTF-8 校验,避免糊弄解码后被写回静默损坏内容。
#[tauri::command]
fn lf_read_full_file(app: tauri::AppHandle, rel_path: String) -> Result<LfEditorReadResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    if target.is_dir() {
        return Err("目标是目录,编辑器无法打开".into());
    }
    let meta = fs::metadata(&target).map_err(|e| format!("读取文件失败: {}", e))?;
    if meta.len() > LF_EDITOR_MAX {
        return Err(format!(
            "文件过大({} KB),编辑器仅支持 5MB 内的文本文件",
            meta.len() / 1024
        ));
    }
    let raw = fs::read(&target).map_err(|e| format!("读取文件失败: {}", e))?;
    if raw.contains(&0) {
        return Err("二进制文件不支持编辑".into());
    }
    let text = String::from_utf8(raw).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())?;
    Ok(LfEditorReadResult {
        abs_path: target.to_string_lossy().to_string(),
        bytes: meta.len(),
        content_base64: BASE64.encode(text.as_bytes()),
    })
}

/// 列目录:单层条目(目录在前、名称不区分大小写排序),上限 500 条;rel 为空列工作区根。
#[tauri::command]
fn lf_list_dir(app: tauri::AppHandle, rel_path: String) -> Result<LfListResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = if rel_path.trim().is_empty() {
        Path::new(&base)
            .canonicalize()
            .map_err(|e| format!("授权工作区无效: {}", e))?
    } else {
        lf_safe_join(Path::new(&base), &rel_path)?
    };
    if !target.is_dir() {
        return Err("目标不是目录".into());
    }
    let rd = fs::read_dir(&target).map_err(|e| format!("读取目录失败: {}", e))?;
    let mut entries: Vec<LfListEntry> = Vec::new();
    let mut truncated = false;
    for e in rd {
        let Ok(e) = e else { continue };
        if entries.len() >= LF_LIST_MAX {
            truncated = true;
            break;
        }
        let Ok(ft) = e.file_type() else { continue };
        entries.push(LfListEntry {
            name: e.file_name().to_string_lossy().to_string(),
            kind: if ft.is_dir() { "dir".into() } else { "file".into() },
            size: e.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| {
        (a.kind != "dir")
            .cmp(&(b.kind != "dir"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(LfListResult {
        abs_path: target.to_string_lossy().to_string(),
        entries,
        truncated,
    })
}

/// 概览递归:输出紧凑缩进树(目录在前/名称不区分大小写排序/文件带大小),
/// 跳过垃圾目录;条目超 LF_OVERVIEW_MAX 或文本超 8KB 时标记截断并停止展开。
fn lf_overview_walk(
    dir: &Path,
    prefix: &str,
    depth: usize,
    lines: &mut Vec<String>,
    files: &mut usize,
    dirs: &mut usize,
    truncated: &mut bool,
) {
    if *truncated || depth == 0 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    let mut items: Vec<(bool, String, u64)> = Vec::new();
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
        items.push((ft.is_dir(), name, size));
    }
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    for (is_dir, name, size) in items {
        if *truncated || lines.len() >= LF_OVERVIEW_MAX {
            *truncated = true;
            return;
        }
        if is_dir {
            if lf_is_junk_dir(&name) {
                continue;
            }
            *dirs += 1;
            let child_count = fs::read_dir(dir.join(&name)).map(|d| d.count()).unwrap_or(0);
            lines.push(format!("{}{}/ ({} 项)", prefix, name, child_count));
            lf_overview_walk(
                &dir.join(&name),
                &format!("{}  ", prefix),
                depth - 1,
                lines,
                files,
                dirs,
                truncated,
            );
        } else {
            *files += 1;
            lines.push(format!("{}{} {}", prefix, name, lf_fmt_size(size)));
        }
    }
}

/// 概览:一次调用返回整棵目录树(分析项目用,替代逐层 list)。
#[tauri::command]
fn lf_overview(app: tauri::AppHandle, rel_path: String) -> Result<LfOverviewResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = if rel_path.trim().is_empty() {
        Path::new(&base)
            .canonicalize()
            .map_err(|e| format!("授权工作区无效: {}", e))?
    } else {
        lf_safe_join(Path::new(&base), &rel_path)?
    };
    if !target.is_dir() {
        return Err("目标不是目录".into());
    }
    let mut lines: Vec<String> = Vec::new();
    let mut files = 0usize;
    let mut dirs = 0usize;
    let mut truncated = false;
    lf_overview_walk(&target, "", LF_OVERVIEW_DEPTH, &mut lines, &mut files, &mut dirs, &mut truncated);
    let mut text = lines.join("\n");
    if text.len() > LF_EXEC_MAX {
        text = String::from_utf8_lossy(lf_utf8_floor(&text.as_bytes()[..LF_EXEC_MAX])).to_string();
        truncated = true;
    }
    Ok(LfOverviewResult {
        abs_path: target.to_string_lossy().to_string(),
        text,
        truncated,
        total_files: files,
        total_dirs: dirs,
    })
}

/// 搜索递归:纯文本子串匹配(不区分大小写),输出 rel:行号: 内容;
/// 跳过垃圾目录/二进制(NUL)/超 512KB 文件;命中达上限即停。
fn lf_search_walk(
    dir: &Path,
    rel: &str,
    needle: &str,
    glob_ext: &Option<String>,
    out: &mut Vec<String>,
    hits: &mut usize,
    scanned: &mut usize,
    truncated: &mut bool,
) {
    if *truncated {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        if *truncated {
            return;
        }
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{}/{}", rel, name) };
        if ft.is_dir() {
            if lf_is_junk_dir(&name) {
                continue;
            }
            lf_search_walk(&e.path(), &child_rel, needle, glob_ext, out, hits, scanned, truncated);
        } else {
            if let Some(ext) = glob_ext {
                if !name.to_lowercase().ends_with(ext) {
                    continue;
                }
            }
            let Ok(meta) = e.metadata() else { continue };
            if meta.len() > LF_SEARCH_FILE_MAX {
                continue;
            }
            let Ok(raw) = fs::read(e.path()) else { continue };
            if raw.contains(&0) {
                continue;
            }
            *scanned += 1;
            let text = String::from_utf8_lossy(&raw);
            for (i, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(needle) {
                    *hits += 1;
                    out.push(format!("{}:{}: {}", child_rel, i + 1, line.trim_end()));
                    if *hits >= LF_SEARCH_MAX_HITS || out.join("\n").len() > LF_EXEC_MAX {
                        *truncated = true;
                        return;
                    }
                }
            }
        }
    }
}

/// 内容搜索:跨文件定位关键词(分析项目用,免 PowerShell 启动与确认)。
#[tauri::command]
fn lf_search(
    app: tauri::AppHandle,
    rel_path: String,
    pattern: String,
    glob: Option<String>,
) -> Result<LfSearchResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = if rel_path.trim().is_empty() {
        Path::new(&base)
            .canonicalize()
            .map_err(|e| format!("授权工作区无效: {}", e))?
    } else {
        lf_safe_join(Path::new(&base), &rel_path)?
    };
    let needle = pattern.trim().to_lowercase();
    if needle.is_empty() {
        return Err("搜索关键词为空".into());
    }
    // glob 只支持 "*.ext" 后缀过滤(.ts → ".ts")
    let glob_ext = glob
        .as_deref()
        .map(|g| g.trim().to_lowercase())
        .filter(|g| g.starts_with("*."))
        .map(|g| g[1..].to_string());
    let mut out: Vec<String> = Vec::new();
    let mut hits = 0usize;
    let mut scanned = 0usize;
    let mut truncated = false;
    if target.is_file() {
        // 指向单文件:只搜该文件
        if let Ok(raw) = fs::read(&target) {
            if !raw.contains(&0) {
                scanned = 1;
                let text = String::from_utf8_lossy(&raw);
                for (i, line) in text.lines().enumerate() {
                    if line.to_lowercase().contains(&needle) {
                        hits += 1;
                        out.push(format!("{}:{}: {}", rel_path.trim(), i + 1, line.trim_end()));
                        if hits >= LF_SEARCH_MAX_HITS || out.join("\n").len() > LF_EXEC_MAX {
                            truncated = true;
                            break;
                        }
                    }
                }
            }
        }
    } else if target.is_dir() {
        lf_search_walk(&target, rel_path.trim(), &needle, &glob_ext, &mut out, &mut hits, &mut scanned, &mut truncated);
    } else {
        return Err("目标不存在".into());
    }
    Ok(LfSearchResult {
        abs_path: target.to_string_lossy().to_string(),
        text: out.join("\n"),
        truncated,
        hits,
        scanned_files: scanned,
    })
}

/// 编辑文件:把 old_text 的唯一匹配处替换为 new_text(0 处或多处匹配都拒绝,防误改)。
#[tauri::command]
fn lf_edit_file(
    app: tauri::AppHandle,
    rel_path: String,
    old_text_base64: String,
    new_text_base64: String,
) -> Result<LfEditResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    if !target.is_file() {
        return Err("目标不是文件".into());
    }
    let meta = fs::metadata(&target).map_err(|e| format!("读取文件信息失败: {}", e))?;
    if meta.len() > LF_EDIT_MAX {
        return Err("文件过大,不支持编辑(上限 1MB)".into());
    }
    let old = BASE64
        .decode(old_text_base64.as_bytes())
        .map_err(|e| format!("old_text base64 解码失败: {}", e))?;
    let new = BASE64
        .decode(new_text_base64.as_bytes())
        .map_err(|e| format!("new_text base64 解码失败: {}", e))?;
    let old_s = String::from_utf8(old).map_err(|_| "old_text 不是有效的 UTF-8".to_string())?;
    let new_s = String::from_utf8(new).map_err(|_| "new_text 不是有效的 UTF-8".to_string())?;
    let raw = fs::read(&target).map_err(|e| format!("读取文件失败: {}", e))?;
    let text = String::from_utf8(raw).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())?;
    let hits = text.matches(&old_s).count();
    if hits == 0 {
        return Err("未找到要替换的内容:old_text 与文件内容不匹配".into());
    }
    if hits > 1 {
        return Err(format!("old_text 匹配到 {} 处,请提供更长的唯一上下文片段", hits));
    }
    let updated = text.replacen(&old_s, &new_s, 1);
    let bytes = updated.len();
    // 撤销快照:edit 必然覆盖原文件,先备份原内容再写回
    let undo_id = lf_snapshot_before(&app, &target, &rel_path)?;
    fs::write(&target, updated.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(LfEditResult {
        abs_path: target.to_string_lossy().to_string(),
        bytes,
        undo_id: Some(undo_id),
    })
}

/// 移动/重命名:源与目标都必须在授权工作区内;目标已存在时拒绝(不静默覆盖)。
#[tauri::command]
fn lf_move_file(
    app: tauri::AppHandle,
    from_rel: String,
    to_rel: String,
) -> Result<LfMoveResult, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let from = lf_safe_join(Path::new(&base), &from_rel)?;
    let to = lf_safe_join(Path::new(&base), &to_rel)?;
    if !from.exists() {
        return Err("源文件不存在".into());
    }
    if to.exists() {
        return Err("目标位置已存在同名文件/目录,已拒绝覆盖".into());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::rename(&from, &to).map_err(|e| format!("移动失败(跨磁盘分区无法移动): {}", e))?;
    Ok(LfMoveResult {
        abs_path: to.to_string_lossy().to_string(),
    })
}

/// 存在性查询:create 覆盖确认用(存在则前端弹确认卡,不自动写入)。
#[tauri::command]
fn lf_exists(app: tauri::AppHandle, rel_path: String) -> Result<bool, String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    Ok(target.exists())
}

/// 在资源管理器中定位文件/目录(explorer /select)。纯 UI 动作,不进工具链路。
#[tauri::command]
fn lf_reveal(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    let target = lf_safe_join(Path::new(&base), &rel_path)?;
    if !target.exists() {
        return Err("文件不存在或已删除".into());
    }
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", target.to_string_lossy()))
        .spawn()
        .map_err(|e| format!("打开资源管理器失败: {}", e))?;
    Ok(())
}

/// 撤销一次破坏性写盘:overwrite→把备份原内容写回;create-new→把本次新建的文件移入
/// 回收站。成功才消费记录并清理备份;失败时记录放回,允许重试。
#[tauri::command]
fn lf_undo(app: tauri::AppHandle, undo_id: String) -> Result<(), String> {
    let mut store = lf_read_undo(&app);
    let Some(pos) = store.records.iter().position(|r| r.id == undo_id) else {
        return Err("撤销记录不存在或已过期".into());
    };
    let rec = store.records.remove(pos);
    let result = (|| -> Result<(), String> {
        let base = lf_read_base(&app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
        let target = lf_safe_join(Path::new(&base), &rec.rel_path)?;
        if rec.kind == "overwrite" {
            let content = fs::read(&rec.backup_file).map_err(|e| format!("读取备份失败: {}", e))?;
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&target, content).map_err(|e| format!("恢复原内容失败: {}", e))?;
        } else if target.exists() {
            trash::delete(&target).map_err(|e| format!("移入回收站失败: {}", e))?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            if rec.kind == "overwrite" && !rec.backup_file.is_empty() {
                let _ = fs::remove_file(&rec.backup_file);
            }
            lf_write_undo(&app, &store)?;
            Ok(())
        }
        Err(e) => {
            store.records.push(rec);
            let _ = lf_write_undo(&app, &store);
            Err(e)
        }
    }
}

/// exec 输出读取上限:256KB(超限继续丢弃读保持管道畅通,靠超时兕底)。
const LF_EXEC_READ_CAP: usize = 256 * 1024;
/// exec 回传输出上限:8KB(超出按 UTF-8 字符边界截断)。
const LF_EXEC_MAX: usize = 8 * 1024;
/// exec 超时:30s,超时 taskkill /T 连子进程树一起强杀。
const LF_EXEC_TIMEOUT_MS: u64 = 30_000;

/// exec 结果:退出码 + 合并输出 + 截断标记 + 耗时。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LfExecResult {
    exit_code: i32,
    output: String,
    truncated: bool,
    duration_ms: u64,
}

/// 在工作区内执行 PowerShell 命令(cwd=工作区根):
/// - 强制 UTF-8 输出(PS5 默认 GBK 是 mojibake 重灾区),2>&1 合并 stderr;
/// - 30s 超时 taskkill /T 强杀进程树;输出超 8KB 截断;
/// - 是否执行由前端白名单/确认卡决定,Rust 只负责受控执行本体。
#[cfg(windows)]
fn lf_exec_impl(app: &tauri::AppHandle, command: &str) -> Result<LfExecResult, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let base = lf_read_base(app).ok_or("尚未授权工作区,请先在设置中选择文件夹")?;
    if command.trim().is_empty() {
        return Err("命令为空".into());
    }
    // & { } 包裹隔离用户命令 + 2>&1 合并 stderr,确保单管道可读
    let script = format!(
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & {{ {} }} 2>&1",
        command
    );
    let started = std::time::Instant::now();
    let mut child = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .current_dir(&base)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动 PowerShell 失败: {}", e))?;
    let pid = child.id();
    let mut pipe = child.stdout.take().ok_or("无法读取命令输出")?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if buf.len() < LF_EXEC_READ_CAP {
                        buf.extend_from_slice(&chunk[..n]);
                    } // 超限:继续丢弃读,防止子进程因管道写满而卡死
                }
                Err(_) => break,
            }
        }
        buf
    });
    let deadline = started + std::time::Duration::from_millis(LF_EXEC_TIMEOUT_MS);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    timed_out = true;
                    let _ = std::process::Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .status();
                    break child.wait().map_err(|e| format!("等待进程退出失败: {}", e))?;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("等待进程失败: {}", e)),
        }
    };
    let raw = reader.join().map_err(|_| "读取输出线程失败".to_string())?;
    let mut output = String::from_utf8_lossy(&raw).to_string();
    let mut truncated = raw.len() >= LF_EXEC_READ_CAP;
    if output.len() > LF_EXEC_MAX {
        // 头 2/3 + 尾 1/3 保留:命令横幅在头、最终结果常在尾,中段省略价值最低。
        // 尾部起点需对齐 UTF-8 字符边界
        let ob = output.as_bytes();
        let head_end = LF_EXEC_MAX * 2 / 3;
        let mut tail_start = output.len() - LF_EXEC_MAX / 3;
        while tail_start < ob.len() && (ob[tail_start] & 0xC0) == 0x80 {
            tail_start += 1;
        }
        let new_out = format!(
            "{}\n[...中段已省略...]\n{}",
            String::from_utf8_lossy(lf_utf8_floor(&ob[..head_end])),
            String::from_utf8_lossy(&ob[tail_start..])
        );
        output = new_out;
        truncated = true;
    }
    if timed_out {
        output.push_str("\n[命令超时(30 秒),已强制终止]");
    }
    Ok(LfExecResult {
        exit_code: if timed_out { -1 } else { status.code().unwrap_or(-1) },
        output,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

/// 非 Windows 平台:命令执行仅支持 Windows 桌面端(保持全平台可编译)。
#[cfg(not(windows))]
fn lf_exec_impl(_app: &tauri::AppHandle, _command: &str) -> Result<LfExecResult, String> {
    Err("命令执行仅支持 Windows 桌面端".into())
}

#[tauri::command]
fn lf_exec(app: tauri::AppHandle, command: String) -> Result<LfExecResult, String> {
    lf_exec_impl(&app, &command)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例:再次启动时聚焦已有窗口,而不是新开一个。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // 本地文件能力:系统目录选择对话框(用于用户授权工作区根)
        .plugin(tauri_plugin_dialog::init())
        // 系统通知:AI 回复完成后弹系统级通知(前端经 @tauri-apps/plugin-notification 调用)
        .plugin(tauri_plugin_notification::init())
        // 搭子窗口(悬浮球)暂时禁用:安卓适配期移动端不支持多窗口,桌面端一并下线。
        // 恢复:取消下方注释块,并在 tauri.conf.json 的 app.windows 中加回 buddy 窗口配置。
        .setup(|app| {
            // 强制创建搭子窗口（无论 enabled 与否,先创建好）
            // if app.get_webview_window("buddy").is_none() {
            //     if let Err(e) = tauri::WebviewWindowBuilder::new(
            //         app,
            //         "buddy",
            //         WebviewUrl::App("/buddy/".into()),
            //     )
            //     .title("搭子")
            //     .inner_size(120.0, 120.0)
            //     .position(20.0, 100.0)
            //     .resizable(false)
            //     .decorations(false)
            //     .transparent(true)
            //     .shadow(true)
            //     .always_on_top(true)
            //     .skip_taskbar(true)
            //     .visible(false)
            //     .focused(false)
            //     .build()
            //     {
            //         eprintln!("Failed to create buddy window: {}", e);
            //     }
            // }

            // 客户端专属:启动即应用系统毛玻璃(前端 hydrate 后会带主题参数重同步)
            if let Some(main) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                apply_glass(&main, None);

                // 监听主窗口关闭 → 关闭搭子
                let app_handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        if let Some(buddy) = app_handle.get_webview_window("buddy") {
                            let _ = buddy.close();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_window_state,
            toggle_fullscreen,
            minimize_window,
            close_window,
            toggle_maximize,
            set_glass_effect,
            show_buddy_window,
            hide_buddy_window,
            toggle_buddy_window,
            set_buddy_position,
            get_buddy_position,
            get_screen_size,
            create_buddy_window,
            move_buddy_window,
            focus_main_window,
            show_settings_window,
            lf_set_base,
            lf_get_base,
            lf_write_file,
            lf_delete_file,
            lf_read_file,
            lf_list_dir,
            lf_edit_file,
            lf_move_file,
            lf_exists,
            lf_reveal,
            lf_undo,
            lf_exec,
            lf_overview,
            lf_search,
            lf_read_full_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}