//! 任务命令模块
//!
//! 提供自动化任务的 Tauri 命令接口

use crate::core::auto_skip;
use crate::core::auto_pick;
use crate::core::auto_fight::{self, FightExecutor};
use std::sync::Arc;
use tokio::sync::RwLock;

/// 全局战斗执行器
static FIGHT_EXECUTOR: std::sync::OnceLock<Arc<RwLock<FightExecutor>>> = std::sync::OnceLock::new();

fn get_fight_executor() -> &'static Arc<RwLock<FightExecutor>> {
    FIGHT_EXECUTOR.get_or_init(|| Arc::new(RwLock::new(FightExecutor::new())))
}

// ============== AutoSkip 命令 ==============

/// 检测跳过按钮
#[tauri::command]
pub fn detect_skip_button() -> Result<bool, String> {
    auto_skip::detect_skip_button()
}

/// 检测对话状态
#[tauri::command]
pub fn detect_dialog() -> Result<auto_skip::DialogState, String> {
    auto_skip::detect_dialog_state()
}

/// 执行跳过
#[tauri::command]
pub fn skip_dialog() -> Result<(), String> {
    auto_skip::skip_dialog()
}

/// 选择对话选项
#[tauri::command]
pub fn select_option(option_index: usize) -> Result<(), String> {
    auto_skip::select_option(option_index)
}

// ============== AutoPick 命令 ==============

/// 初始化白名单
#[tauri::command]
pub fn init_pick_whitelist(items: Vec<String>) -> Result<(), String> {
    let static_items: Vec<&'static str> = items
        .into_iter()
        .map(|s| Box::leak(s.into_boxed_str()) as &'static str)
        .collect();
    auto_pick::init_whitelist(static_items);
    Ok(())
}

/// 初始化黑名单
#[tauri::command]
pub fn init_pick_blacklist(items: Vec<String>) -> Result<(), String> {
    let static_items: Vec<&'static str> = items
        .into_iter()
        .map(|s| Box::leak(s.into_boxed_str()) as &'static str)
        .collect();
    auto_pick::init_blacklist(static_items);
    Ok(())
}

/// 清空已拾取记录
#[tauri::command]
pub fn clear_picked_items() -> Result<(), String> {
    auto_pick::clear_picked_items();
    Ok(())
}

/// 检测拾取图标
#[tauri::command]
pub fn detect_pickup_icon() -> Result<Option<(i32, i32)>, String> {
    auto_pick::detect_pickup_icon()
}

/// 检测可拾取物品
#[tauri::command]
pub fn detect_items() -> Result<auto_pick::PickupState, String> {
    auto_pick::detect_items()
}

/// 执行拾取
#[tauri::command]
pub fn pickup() -> Result<(), String> {
    auto_pick::pickup()
}

/// 滚轮扫描下一个
#[tauri::command]
pub fn scroll_to_next() -> Result<(), String> {
    auto_pick::scroll_to_next()
}

// ============== AutoFight 命令 ==============

/// 检测是否在战斗中
#[tauri::command]
pub fn detect_combat() -> Result<bool, String> {
    auto_fight::detect_combat()
}

/// 检测生命值
#[tauri::command]
pub fn detect_hp() -> Result<f32, String> {
    auto_fight::detect_hp()
}

/// 检测能量值
#[tauri::command]
pub fn detect_energy() -> Result<f32, String> {
    auto_fight::detect_energy()
}

/// 获取战斗状态
#[tauri::command]
pub fn get_fight_state() -> Result<auto_fight::FightState, String> {
    let executor = get_fight_executor();
    let guard = futures::executor::block_on(async { executor.read().await.get_state().await });
    Ok(guard)
}

/// 设置战斗配置
#[tauri::command]
pub fn set_fight_config(config: auto_fight::FightConfig) -> Result<(), String> {
    let executor = get_fight_executor();
    futures::executor::block_on(async { executor.read().await.set_config(config).await });
    Ok(())
}

/// 开始自动战斗
#[tauri::command]
pub fn start_auto_fight() -> Result<(), String> {
    let executor = get_fight_executor();
    futures::executor::block_on(async { executor.read().await.start().await });
    Ok(())
}

/// 停止自动战斗
#[tauri::command]
pub fn stop_auto_fight() -> Result<(), String> {
    let executor = get_fight_executor();
    futures::executor::block_on(async { executor.read().await.stop().await });
    Ok(())
}

/// 暂停自动战斗
#[tauri::command]
pub fn pause_auto_fight() -> Result<(), String> {
    let executor = get_fight_executor();
    futures::executor::block_on(async { executor.read().await.pause().await });
    Ok(())
}

/// 继续自动战斗
#[tauri::command]
pub fn resume_auto_fight() -> Result<(), String> {
    let executor = get_fight_executor();
    futures::executor::block_on(async { executor.read().await.resume().await });
    Ok(())
}

/// 执行下一个技能
#[tauri::command]
pub fn execute_next_skill() -> Result<Option<String>, String> {
    let executor = get_fight_executor();
    futures::executor::block_on(async { executor.read().await.execute_next_skill().await })
}
