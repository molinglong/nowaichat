use serde::Serialize;
use tauri::{Manager, WebviewWindow, WebviewUrl, PhysicalPosition};

// 核心功能模块
mod commands;
mod overlay;
mod core;

// 初始化日志系统
use commands::log::init_log_system;

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

/// 发送事件到搭子窗口
#[tauri::command]
fn send_to_buddy(app: tauri::AppHandle, event: String, data: String) -> Result<(), String> {
    if let Some(buddy) = app.get_webview_window("buddy") {
        // 前端期望格式: { type: string, data?: unknown }
        // 如果 data 是 JSON 字符串，解析后发送；否则直接发送原始字符串
        let payload = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&data) {
            serde_json::json!({
                "type": event,
                "data": parsed
            })
        } else {
            serde_json::json!({
                "type": event,
                "data": data
            })
        };
        buddy.emit("buddy-event", &payload).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 发送事件到遮罩窗口
#[tauri::command]
fn send_to_overlay(app: tauri::AppHandle, event: String, data: String) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        // 前端期望格式: { type: string, data?: unknown }
        let payload = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&data) {
            serde_json::json!({
                "type": event,
                "data": parsed
            })
        } else {
            serde_json::json!({
                "type": event,
                "data": data
            })
        };
        overlay.emit("overlay-event", &payload).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 发送事件到主窗口
#[tauri::command]
fn send_to_main(app: tauri::AppHandle, event: String, data: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.emit(&event, &data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 广播事件到所有窗口
#[tauri::command]
fn broadcast_event(app: tauri::AppHandle, event: String, data: String) -> Result<(), String> {
    app.emit(&event, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志系统
    init_log_system();

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
            // 窗口控制
            get_window_state,
            toggle_fullscreen,
            minimize_window,
            close_window,
            toggle_maximize,
            // 搭子窗口
            show_buddy_window,
            hide_buddy_window,
            toggle_buddy_window,
            set_buddy_position,
            get_buddy_position,
            get_screen_size,
            create_buddy_window,
            move_buddy_window,
            focus_main_window,
            // 截图命令
            commands::screenshot::capture_full_screen,
            commands::screenshot::capture_region,
            commands::screenshot::get_screens_info,
            // 键鼠命令
            commands::input::key_down,
            commands::input::key_up,
            commands::input::key_press,
            commands::input::mouse_move,
            commands::input::mouse_click,
            commands::input::mouse_right_click,
            commands::input::mouse_middle_click,
            commands::input::mouse_scroll,
            // 日志命令
            commands::log::log_debug,
            commands::log::log_info,
            commands::log::log_warn,
            commands::log::log_error,
            commands::log::log_with_source,
            commands::log::get_all_logs,
            commands::log::clear_logs,
            // 遮罩窗口
            overlay::show_overlay,
            overlay::hide_overlay,
            overlay::toggle_overlay,
            send_to_overlay,
            send_to_buddy,
            send_to_main,
            broadcast_event,
            // AutoSkip 命令
            commands::task::detect_skip_button,
            commands::task::detect_dialog,
            commands::task::skip_dialog,
            commands::task::select_option,
            // AutoPick 命令
            commands::task::init_pick_whitelist,
            commands::task::init_pick_blacklist,
            commands::task::clear_picked_items,
            commands::task::detect_pickup_icon,
            commands::task::detect_items,
            commands::task::pickup,
            commands::task::scroll_to_next,
            // AutoFight 命令
            commands::task::detect_combat,
            commands::task::detect_hp,
            commands::task::detect_energy,
            commands::task::get_fight_state,
            commands::task::set_fight_config,
            commands::task::start_auto_fight,
            commands::task::stop_auto_fight,
            commands::task::pause_auto_fight,
            commands::task::resume_auto_fight,
            commands::task::execute_next_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
