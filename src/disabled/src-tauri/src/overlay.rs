//! 遮罩窗口模块
//!
//! 提供透明、全屏、置顶的遮罩窗口，用于显示日志和进度

use tauri::{AppHandle, Manager};

/// 显示遮罩窗口
#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<String, String> {
    let label = "overlay";

    // 检查是否已存在
    if let Some(overlay) = app.get_webview_window(label) {
        overlay.show().map_err(|e| e.to_string())?;
        overlay.unminimize().map_err(|e| e.to_string())?;
        return Ok(label.to_string());
    }

    // 创建新遮罩窗口
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App("/overlay/".into()),
    )
    .title("AIChatt Overlay")
    .fullscreen(true)  // 全屏覆盖
    .transparent(true) // 透明背景
    .decorations(false) // 无边框
    .always_on_top(true) // 置顶
    .skip_taskbar(true) // 不显示在任务栏
    .resizable(false) // 不可调整大小
    .visible(true)
    .focused(false) // 不抢占焦点
    .build()
    .map_err(|e| format!("创建遮罩窗口失败: {}", e))?;

    Ok(label.to_string())
}

/// 隐藏遮罩窗口
#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 切换遮罩窗口显示/隐藏
#[tauri::command]
pub fn toggle_overlay(app: AppHandle) -> Result<bool, String> {
    let label = "overlay";

    if let Some(overlay) = app.get_webview_window(label) {
        let is_visible = overlay.is_visible().unwrap_or(false);
        if is_visible {
            overlay.hide().map_err(|e| e.to_string())?;
        } else {
            overlay.show().map_err(|e| e.to_string())?;
            overlay.unminimize().map_err(|e| e.to_string())?;
        }
        Ok(!is_visible)
    } else {
        // 窗口不存在，创建并显示
        show_overlay(app)?;
        Ok(true)
    }
}
