//! 核心任务模块
//!
//! 包含各种自动化任务的实现

pub mod process;
pub mod auto_skip;
pub mod auto_pick;
pub mod auto_fight;

/// 任务状态
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskStatus {
    pub name: String,
    pub state: TaskState,
    pub progress: f32,
    pub message: String,
}

/// 任务状态枚举
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Idle,
    Running,
    Paused,
    Completed,
    Failed,
}

/// 任务结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskResult {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}
