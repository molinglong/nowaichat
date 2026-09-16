//! 自动拾取模块
//!
//! 自动检测并拾取游戏中的物品

use screenshots::Screen;
use enigo::{Enigo, Settings, Direction, Key, Axis, Keyboard, Mouse};
use std::sync::Mutex;
use std::collections::HashSet;

/// 物品信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ItemInfo {
    /// 物品名称
    pub name: String,
    /// 物品类型
    pub item_type: ItemType,
    /// 是否稀有
    pub is_rare: bool,
}

/// 物品类型
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Material,
    Equipment,
    Currency,
    Quest,
    Other,
}

/// 拾取状态
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PickupState {
    /// 是否检测到可拾取物品
    pub has_items: bool,
    /// 物品数量
    pub item_count: usize,
    /// 稀有物品列表
    pub rare_items: Vec<String>,
}

/// 全局白名单
static PICKUP_WHITELIST: Mutex<Option<HashSet<String>>> = Mutex::new(None);
/// 全局黑名单
static PICKUP_BLACKLIST: Mutex<Option<HashSet<String>>> = Mutex::new(None);
/// 已拾取物品记录
static PICKED_ITEMS: std::sync::OnceLock<Mutex<HashSet<String>>> = std::sync::OnceLock::new();

fn get_picked_items() -> &'static Mutex<HashSet<String>> {
    PICKED_ITEMS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 初始化白名单
pub fn init_whitelist(items: Vec<&'static str>) {
    let mut guard = PICKUP_WHITELIST.lock().unwrap_or_else(|e| e.into_inner());
    let set: HashSet<String> = items.into_iter().map(|s| s.to_string()).collect();
    *guard = Some(set);
}

/// 初始化黑名单
pub fn init_blacklist(items: Vec<&'static str>) {
    let mut guard = PICKUP_BLACKLIST.lock().unwrap_or_else(|e| e.into_inner());
    let set: HashSet<String> = items.into_iter().map(|s| s.to_string()).collect();
    *guard = Some(set);
}

/// 清空已拾取记录
pub fn clear_picked_items() {
    if let Ok(mut guard) = get_picked_items().lock() {
        guard.clear();
    }
}

/// 检测滚轮拾取图标
pub fn detect_pickup_icon() -> Result<Option<(i32, i32)>, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    
    // 扫描屏幕右下角区域（滚轮拾取图标常见位置）
    let scan_region = (1600, 800, 320, 280);
    let image = screen.capture_area(
        scan_region.0,
        scan_region.1,
        scan_region.2,
        scan_region.3,
    ).map_err(|e| format!("截图失败: {}", e))?;

    let (w, h) = (image.width(), image.height());

    // 检测金色物品图标特征
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let pixel = image.get_pixel(x as u32, y as u32);
            // 检测金色 (R > 200, G > 150, B < 100)
            if pixel[0] > 200 && pixel[1] > 150 && pixel[2] < 100 {
                return Ok(Some((scan_region.0 + x, scan_region.1 + y)));
            }
        }
    }

    Ok(None)
}

/// 检测可拾取物品
pub fn detect_items() -> Result<PickupState, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    
    // 截图物品区域
    let region = (1400, 600, 500, 500);
    let image = screen.capture_area(
        region.0,
        region.1,
        region.2,
        region.3,
    ).map_err(|e| format!("截图失败: {}", e))?;

    let (w, h) = (image.width(), image.height());
    
    let mut item_count = 0;
    let mut rare_items = Vec::new();
    
    // 简化的物品检测：扫描金色像素簇
    let mut in_item = false;
    let mut item_width = 0;
    
    for y in (0..h as i32).step_by(5) {
        for x in 0..w as i32 {
            let pixel = image.get_pixel(x as u32, y as u32);
            let is_gold = pixel[0] > 200 && pixel[1] > 150 && pixel[2] < 100;
            
            if is_gold && !in_item {
                in_item = true;
                item_width = 1;
            } else if is_gold && in_item {
                item_width += 1;
            } else if !is_gold && in_item {
                // 物品宽度超过阈值认为是一个物品
                if item_width > 30 {
                    item_count += 1;
                    // 简化判断：宽度大的可能是稀有
                    if item_width > 60 {
                        rare_items.push(format!("物品 #{}", item_count));
                    }
                }
                in_item = false;
                item_width = 0;
            }
        }
    }

    Ok(PickupState {
        has_items: item_count > 0,
        item_count,
        rare_items,
    })
}

/// 执行拾取
pub fn pickup() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    
    // 按 F 键拾取
    enigo.key(Key::F, Direction::Click)
        .map_err(|e| format!("拾取按键失败: {}", e))?;
    
    Ok(())
}

/// 滚轮扫描下一个物品
pub fn scroll_to_next() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    
    // 滚轮向下滚动一格
    enigo.scroll(-3, Axis::Vertical)
        .map_err(|e| format!("滚轮失败: {}", e))?;
    
    Ok(())
}

/// 判断物品是否应该拾取
pub fn should_pickup(item_name: &str) -> bool {
    // 检查黑名单
    if let Ok(guard) = PICKUP_BLACKLIST.lock() {
        if let Some(blacklist) = guard.as_ref() {
            if blacklist.contains(item_name) {
                return false;
            }
        }
    }

    // 检查白名单
    if let Ok(guard) = PICKUP_WHITELIST.lock() {
        if let Some(whitelist) = guard.as_ref() {
            if whitelist.contains(item_name) {
                return true;
            }
        }
    }

    // 默认捡取所有物品
    true
}

/// 记录已拾取物品（防重复）
pub fn mark_picked(item_key: &str) {
    if let Ok(mut guard) = get_picked_items().lock() {
        guard.insert(item_key.to_string());
    }
}

/// 检查是否已拾取
pub fn is_picked(item_key: &str) -> bool {
    if let Ok(guard) = get_picked_items().lock() {
        return guard.contains(item_key);
    }
    false
}
