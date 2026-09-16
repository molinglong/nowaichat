//! 自动战斗模块
//!
//! 自动执行战斗技能循环

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use enigo::{Enigo, Settings, Direction, Key, Keyboard};
use screenshots::Screen;

/// 技能配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillConfig {
    /// 技能名称
    pub name: String,
    /// 技能按键
    pub key: String,
    /// 冷却时间（毫秒）
    pub cooldown_ms: u64,
    /// 是否需要瞄准
    pub need_target: bool,
}

/// 战斗配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightConfig {
    /// 是否启用自动战斗
    pub enabled: bool,
    /// 技能循环
    pub skills: Vec<SkillConfig>,
    /// 循环间隔（毫秒）
    pub loop_interval_ms: u64,
    /// 是否自动追踪敌人
    pub auto_target: bool,
}

impl Default for FightConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            skills: vec![
                SkillConfig { name: "普通攻击".into(), key: "a".into(), cooldown_ms: 500, need_target: false },
            ],
            loop_interval_ms: 1000,
            auto_target: true,
        }
    }
}

/// 战斗状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightState {
    /// 是否在战斗中
    pub in_combat: bool,
    /// 生命值百分比
    pub hp_percent: f32,
    /// 能量值百分比
    pub energy_percent: f32,
    /// 当前执行的技能索引
    pub current_skill_index: usize,
}

/// 战斗执行器
pub struct FightExecutor {
    config: Arc<RwLock<FightConfig>>,
    state: Arc<RwLock<FightState>>,
    paused: Arc<RwLock<bool>>,
    running: Arc<RwLock<bool>>,
}

impl FightExecutor {
    pub fn new() -> Self {
        Self {
            config: Arc::new(RwLock::new(FightConfig::default())),
            state: Arc::new(RwLock::new(FightState {
                in_combat: false,
                hp_percent: 1.0,
                energy_percent: 1.0,
                current_skill_index: 0,
            })),
            paused: Arc::new(RwLock::new(false)),
            running: Arc::new(RwLock::new(false)),
        }
    }

    /// 更新配置
    pub async fn set_config(&self, config: FightConfig) {
        let mut cfg = self.config.write().await;
        *cfg = config;
    }

    /// 获取配置
    pub async fn get_config(&self) -> FightConfig {
        self.config.read().await.clone()
    }

    /// 获取状态
    pub async fn get_state(&self) -> FightState {
        self.state.read().await.clone()
    }

    /// 开始战斗
    pub async fn start(&self) {
        let mut running = self.running.write().await;
        *running = true;
    }

    /// 停止战斗
    pub async fn stop(&self) {
        let mut running = self.running.write().await;
        *running = false;
    }

    /// 暂停战斗
    pub async fn pause(&self) {
        let mut paused = self.paused.write().await;
        *paused = true;
    }

    /// 继续战斗
    pub async fn resume(&self) {
        let mut paused = self.paused.write().await;
        *paused = false;
    }

    /// 检查是否运行中
    pub async fn is_running(&self) -> bool {
        *self.running.read().await
    }

    /// 检查是否暂停
    pub async fn is_paused(&self) -> bool {
        *self.paused.read().await
    }

    /// 等待暂停
    pub async fn wait_if_paused(&self) {
        while self.is_paused().await {
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        }
    }

    /// 执行下一个技能
    pub async fn execute_next_skill(&self) -> Result<Option<String>, String> {
        self.wait_if_paused().await;
        
        if !self.is_running().await {
            return Ok(None);
        }

        let config = self.config.read().await.clone();
        if config.skills.is_empty() {
            return Ok(None);
        }

        let mut state = self.state.write().await;
        let skill_index = state.current_skill_index % config.skills.len();
        let skill = &config.skills[skill_index];

        // 执行技能
        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("创建 Enigo 失败: {}", e))?;
        
        let key = match skill.key.to_lowercase().as_str() {
            "a" => Key::A,
            "s" => Key::S,
            "d" => Key::D,
            "f" => Key::F,
            "q" => Key::Tab,
            "e" => Key::E,
            "1" => Key::Num1,
            "2" => Key::Num2,
            "3" => Key::Num3,
            "4" => Key::Num4,
            " " => Key::Space,
            _ => Key::Space,
        };
        
        enigo.key(key, Direction::Click)
            .map_err(|e| format!("技能按键失败: {}", e))?;

        state.current_skill_index = (skill_index + 1) % config.skills.len();

        Ok(Some(skill.name.clone()))
    }
}

impl Default for FightExecutor {
    fn default() -> Self {
        Self::new()
    }
}

/// 检测是否在战斗中
pub fn detect_combat() -> Result<bool, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    
    // 截图血条/能量条区域（游戏左上角）
    let hp_region = (50, 50, 300, 20);
    let image = screen.capture_area(
        hp_region.0,
        hp_region.1,
        hp_region.2,
        hp_region.3,
    ).map_err(|e| format!("截图失败: {}", e))?;

    let (w, h) = (image.width(), image.height());
    
    // 检测红色（血条）
    let mut red_pixels = 0;
    for y in 0..h {
        for x in 0..w {
            let pixel = image.get_pixel(x, y);
            if pixel[0] > 150 && pixel[1] < 100 && pixel[2] < 100 {
                red_pixels += 1;
            }
        }
    }

    // 如果红色像素超过阈值，认为在战斗中
    let total = (w * h) as f32;
    Ok(red_pixels as f32 / total > 0.10)
}

/// 检测生命值
pub fn detect_hp() -> Result<f32, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    
    // 截图血条区域
    let region = (50, 50, 300, 20);
    let image = screen.capture_area(
        region.0,
        region.1,
        region.2,
        region.3,
    ).map_err(|e| format!("截图失败: {}", e))?;

    let (w, h) = (image.width(), image.height());
    
    // 计算红色像素比例
    let mut red_pixels = 0;
    let total = (w * h) as f32;
    
    for y in 0..h {
        for x in 0..w {
            let pixel = image.get_pixel(x, y);
            if pixel[0] > 150 && pixel[1] < 100 && pixel[2] < 100 {
                red_pixels += 1;
            }
        }
    }

    Ok(red_pixels as f32 / total)
}

/// 检测能量值
pub fn detect_energy() -> Result<f32, String> {
    let screens = Screen::all().map_err(|e| format!("获取屏幕失败: {}", e))?;
    if screens.is_empty() {
        return Err("未找到屏幕".to_string());
    }

    let screen = &screens[0];
    
    // 截图能量条区域（血条下方）
    let region = (50, 72, 300, 10);
    let image = screen.capture_area(
        region.0,
        region.1,
        region.2,
        region.3,
    ).map_err(|e| format!("截图失败: {}", e))?;

    let (w, h) = (image.width(), image.height());
    
    // 计算蓝色像素比例
    let mut blue_pixels = 0;
    let total = (w * h) as f32;
    
    for y in 0..h {
        for x in 0..w {
            let pixel = image.get_pixel(x, y);
            if pixel[0] < 100 && pixel[1] < 100 && pixel[2] > 200 {
                blue_pixels += 1;
            }
        }
    }

    Ok(blue_pixels as f32 / total)
}
