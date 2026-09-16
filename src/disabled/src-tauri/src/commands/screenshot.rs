//! 截图命令模块
//!
//! 提供游戏画面截取功能，支持全屏截图和区域截图

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use screenshots::Screen;
use image::ImageEncoder;

/// 截图结果
#[derive(serde::Serialize)]
pub struct ScreenshotResult {
    /// Base64 编码的图片数据
    pub data: String,
    /// 图片宽度
    pub width: u32,
    /// 图片高度
    pub height: u32,
    /// 格式 (png/jpeg)
    pub format: String,
}

/// 截取全屏截图
///
/// 返回当前屏幕的截图，以 Base64 编码的 PNG 格式
#[tauri::command]
pub fn capture_full_screen() -> Result<ScreenshotResult, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err("未找到可用屏幕".to_string());
    }

    // 默认截取主屏幕
    let screen = &screens[0];

    let image = screen
        .capture()
        .map_err(|e| format!("截图失败: {}", e))?;

    let width = image.width();
    let height = image.height();

    // 转换为 PNG
    let mut buffer = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buffer);
    encoder
        .write_image(image.as_raw(), width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;

    let data = BASE64.encode(&buffer);

    Ok(ScreenshotResult {
        data,
        width,
        height,
        format: "png".to_string(),
    })
}

/// 截取指定区域
///
/// # 参数
/// - `x`: 左上角 X 坐标
/// - `y`: 左上角 Y 坐标  
/// - `width`: 区域宽度
/// - `height`: 区域高度
#[tauri::command]
pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<ScreenshotResult, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;

    if screens.is_empty() {
        return Err("未找到可用屏幕".to_string());
    }

    let screen = &screens[0];

    let image = screen
        .capture_area(x, y, width, height)
        .map_err(|e| format!("区域截图失败: {}", e))?;

    let img_width = image.width();
    let img_height = image.height();

    // 转换为 PNG
    let mut buffer = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buffer);
    encoder
        .write_image(image.as_raw(), img_width, img_height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("编码 PNG 失败: {}", e))?;

    let data = BASE64.encode(&buffer);

    Ok(ScreenshotResult {
        data,
        width: img_width,
        height: img_height,
        format: "png".to_string(),
    })
}

/// 获取所有屏幕信息
#[tauri::command]
pub fn get_screens_info() -> Result<Vec<ScreenInfo>, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕列表失败: {}", e))?;

    Ok(screens
        .iter()
        .map(|s| ScreenInfo {
            id: s.display_info.id,
            x: s.display_info.x,
            y: s.display_info.y,
            width: s.display_info.width,
            height: s.display_info.height,
            scale_factor: s.display_info.scale_factor,
            is_primary: s.display_info.is_primary,
        })
        .collect())
}

/// 屏幕信息
#[derive(serde::Serialize)]
pub struct ScreenInfo {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    pub is_primary: bool,
}
