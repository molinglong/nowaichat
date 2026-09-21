use serde::Serialize;
use tauri::{Manager, WebviewWindow, WebviewUrl, PhysicalPosition};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use std::io::Cursor;

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
        // 启动时初始化搭子窗口（保持存在,仅隐藏）
        .setup(|app| {
            // 强制创建搭子窗口（无论 enabled 与否,先创建好）
            if app.get_webview_window("buddy").is_none() {
                if let Err(e) = tauri::WebviewWindowBuilder::new(
                    app,
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
                .visible(false)
                .focused(false)
                .build()
                {
                    eprintln!("Failed to create buddy window: {}", e);
                }
            }

            // 监听主窗口关闭 → 关闭搭子
            if let Some(main) = app.get_webview_window("main") {
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
            show_buddy_window,
            hide_buddy_window,
            toggle_buddy_window,
            set_buddy_position,
            get_buddy_position,
            get_screen_size,
            create_buddy_window,
            move_buddy_window,
            focus_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}