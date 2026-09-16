//! 自动跳过剧情模块
//!
//! 检测并自动跳过游戏中的剧情对话

use image::GenericImageView;
use screenshots::Screen;
use enigo::{Enigo, Settings, Direction, Key, Keyboard};
use screenshots::image::ImageBuffer;
use screenshots::image::Rgba;

/// 对话状态
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DialogState {
    /// 是否检测到对话
    pub has_dialog: bool,
    /// 检测到的选项数量
    pub option_count: usize,
    /// 对话文本
    pub dialog_text: String,
}

/// 跳过按钮区域（需要根据游戏调整）
const SKIP_BUTTON_REGION: (i32, i32, u32, u32) = (1700, 950, 200, 60);
/// 对话框区域
const DIALOG_REGION: (i32, i32, u32, u32) = (400, 800, 1120, 280);
/// 选项区域
const OPTION_REGION: (i32, i32, u32, u32) = (500, 950, 920, 150);

/// 检测跳过按钮是否存在
pub fn detect_skip_button() -> Result<bool, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    let image = screen.capture_area(
        SKIP_BUTTON_REGION.0,
        SKIP_BUTTON_REGION.1,
        SKIP_BUTTON_REGION.2,
        SKIP_BUTTON_REGION.3,
    ).map_err(|e| format!("截图失败: {}", e))?;

    // 直接使用 ImageBuffer
    let img = &image;
    let (w, h) = (image.width(), image.height());
    let mut skip_pixels = 0;
    let total_pixels = (w * h) as f32;

    for y in 0..h {
        for x in 0..w {
            let pixel = img.get_pixel(x, y);
            // 检测浅蓝色 (R < 100, G > 200, B > 200)
            if pixel[0] < 100 && pixel[1] > 200 && pixel[2] > 200 {
                skip_pixels += 1;
            }
        }
    }

    // 如果浅蓝色像素超过 30%，认为检测到跳过按钮
    Ok(skip_pixels as f32 / total_pixels > 0.30)
}

/// 检测对话状态
pub fn detect_dialog_state() -> Result<DialogState, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    
    // 截图对话框区域
    let dialog_img = screen.capture_area(
        DIALOG_REGION.0,
        DIALOG_REGION.1,
        DIALOG_REGION.2,
        DIALOG_REGION.3,
    ).map_err(|e| format!("对话框截图失败: {}", e))?;

    // 检测对话框特征（半透明白色背景）
    let (w, h) = (dialog_img.width(), dialog_img.height());
    let mut dialog_pixels = 0;
    let total_pixels = (w * h) as f32;

    for y in 0..h {
        for x in 0..w {
            let pixel = dialog_img.get_pixel(x, y);
            // 检测半透明白色 (R > 200, G > 200, B > 200, A > 100)
            if pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200 && pixel[3] > 100 {
                dialog_pixels += 1;
            }
        }
    }

    let has_dialog = dialog_pixels as f32 / total_pixels > 0.10;

    // 截图选项区域检测选项数量
    let option_img = screen.capture_area(
        OPTION_REGION.0,
        OPTION_REGION.1,
        OPTION_REGION.2,
        OPTION_REGION.3,
    ).map_err(|e| format!("选项截图失败: {}", e))?;

    let option_count = count_dialog_options(&option_img);

    Ok(DialogState {
        has_dialog,
        option_count,
        dialog_text: String::new(),
    })
}

/// 计算对话框选项数量
fn count_dialog_options(img: &ImageBuffer<Rgba<u8>, Vec<u8>>) -> usize {
    let (w, h) = (img.width(), img.height());
    
    // 检测选项分隔线（垂直方向的深色线条）
    let mut dividers = 0;
    for x in (50..w as i32 - 50).step_by(10) {
        let mut is_divider = true;
        for y in 0..h as i32 {
            let pixel = img.get_pixel(x as u32, y as u32);
            // 如果有明显深色，认为是分隔线
            if pixel[0] > 50 || pixel[1] > 50 || pixel[2] > 50 {
                is_divider = false;
                break;
            }
        }
        if is_divider {
            dividers += 1;
        }
    }

    // 选项数 = 分隔线数 + 1
    (dividers + 1).min(4).max(1)
}

/// 执行跳过操作
pub fn skip_dialog() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    
    // 按空格跳过对话
    enigo.key(Key::Space, Direction::Click)
        .map_err(|e| format!("按键失败: {}", e))?;
    
    Ok(())
}

/// 选择对话选项
pub fn select_option(option_index: usize) -> Result<(), String> {
    if option_index > 3 {
        return Err("选项索引超出范围".to_string());
    }

    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    
    // 选项 1-4 对应键盘 1-4
    let key = match option_index {
        0 => Key::Num1,
        1 => Key::Num2,
        2 => Key::Num3,
        3 => Key::Num4,
        _ => return Err("无效选项".to_string()),
    };
    
    enigo.key(key, Direction::Click)
        .map_err(|e| format!("按键失败: {}", e))?;
    
    Ok(())
}
