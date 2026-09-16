//! 日志命令模块
//!
//! 提供统一日志功能，支持输出到控制台和前端

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};

/// 日志级别
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "debug" => LogLevel::Debug,
            "warn" | "warning" => LogLevel::Warn,
            "error" => LogLevel::Error,
            _ => LogLevel::Info,
        }
    }
}

/// 日志条目
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: LogLevel,
    pub message: String,
    pub source: Option<String>,
}

impl LogEntry {
    pub fn new(level: LogLevel, message: String, source: Option<String>) -> Self {
        let now = chrono_lite_now();
        Self {
            timestamp: now,
            level,
            message,
            source,
        }
    }
}

/// 全局日志缓冲（存储最近的日志）
fn get_log_buffer() -> &'static Mutex<Vec<LogEntry>> {
    static LOG_BUFFER: Mutex<Vec<LogEntry>> = Mutex::new(Vec::new());
    &LOG_BUFFER
}

/// 获取当前时间字符串
fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    format!("{:02}:{:02}:{:02}.{:03}", 
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60,
        millis
    )
}

/// 初始化日志系统
pub fn init_log_system() {
    // 日志系统已通过 Mutex 隐式初始化
    println!("[INFO] 日志系统已初始化");
}

/// 添加日志到缓冲并发送到前端
fn add_log(entry: LogEntry) {
    let buffer = get_log_buffer();
    if let Ok(mut logs) = buffer.lock() {
        logs.push(entry.clone());
        // 保持最多 1000 条日志
        if logs.len() > 1000 {
            logs.drain(0..100);
        }
    }

    // 打印到控制台
    match entry.level {
        LogLevel::Debug => println!("{} {}", entry.timestamp, entry.message),
        LogLevel::Info => println!("{} {}", entry.timestamp, entry.message),
        LogLevel::Warn => eprintln!("{} {}", entry.timestamp, entry.message),
        LogLevel::Error => eprintln!("{} {}", entry.timestamp, entry.message),
    }
}

/// 发送日志到前端
fn emit_log(app: &AppHandle, entry: LogEntry) {
    let _ = app.emit("log-entry", &entry);
}

/// 记录 Debug 日志
#[tauri::command]
pub fn log_debug(message: String, app: AppHandle) -> Result<(), String> {
    let entry = LogEntry::new(LogLevel::Debug, message, None);
    add_log(entry.clone());
    emit_log(&app, entry);
    Ok(())
}

/// 记录 Info 日志
#[tauri::command]
pub fn log_info(message: String, app: AppHandle) -> Result<(), String> {
    let entry = LogEntry::new(LogLevel::Info, message, None);
    add_log(entry.clone());
    emit_log(&app, entry);
    Ok(())
}

/// 记录 Warn 日志
#[tauri::command]
pub fn log_warn(message: String, app: AppHandle) -> Result<(), String> {
    let entry = LogEntry::new(LogLevel::Warn, message, None);
    add_log(entry.clone());
    emit_log(&app, entry);
    Ok(())
}

/// 记录 Error 日志
#[tauri::command]
pub fn log_error(message: String, app: AppHandle) -> Result<(), String> {
    let entry = LogEntry::new(LogLevel::Error, message, None);
    add_log(entry.clone());
    emit_log(&app, entry);
    Ok(())
}

/// 记录带源的日志
#[tauri::command]
pub fn log_with_source(level: String, message: String, source: String, app: AppHandle) -> Result<(), String> {
    let lvl = LogLevel::from_str(&level);
    let entry = LogEntry::new(lvl, message, Some(source));
    add_log(entry.clone());
    emit_log(&app, entry);
    Ok(())
}

/// 获取所有日志
#[tauri::command]
pub fn get_all_logs() -> Result<Vec<LogEntry>, String> {
    let buffer = get_log_buffer();
    let logs = buffer.lock().map_err(|e| e.to_string())?;
    Ok(logs.clone())
}

/// 清空日志
#[tauri::command]
pub fn clear_logs() -> Result<(), String> {
    let buffer = get_log_buffer();
    let mut logs = buffer.lock().map_err(|e| e.to_string())?;
    logs.clear();
    Ok(())
}
