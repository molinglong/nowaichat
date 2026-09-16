//! 流程执行器
//!
//! 提供异步任务执行框架

use std::sync::Arc;
use tokio::sync::RwLock;

/// 任务执行器
pub struct ProcessExecutor {
    /// 当前是否暂停
    paused: Arc<RwLock<bool>>,
    /// 当前是否停止
    stopped: Arc<RwLock<bool>>,
}

impl ProcessExecutor {
    pub fn new() -> Self {
        Self {
            paused: Arc::new(RwLock::new(false)),
            stopped: Arc::new(RwLock::new(false)),
        }
    }

    /// 暂停执行
    pub async fn pause(&self) {
        let mut paused = self.paused.write().await;
        *paused = true;
    }

    /// 恢复执行
    pub async fn resume(&self) {
        let mut paused = self.paused.write().await;
        *paused = false;
    }

    /// 停止执行
    pub async fn stop(&self) {
        let mut stopped = self.stopped.write().await;
        *stopped = true;
    }

    /// 重置状态
    pub async fn reset(&self) {
        let mut paused = self.paused.write().await;
        let mut stopped = self.stopped.write().await;
        *paused = false;
        *stopped = false;
    }

    /// 检查是否暂停
    pub async fn is_paused(&self) -> bool {
        *self.paused.read().await
    }

    /// 检查是否停止
    pub async fn is_stopped(&self) -> bool {
        *self.stopped.read().await
    }

    /// 等待直到不暂停
    pub async fn wait_if_paused(&self) {
        while self.is_paused().await {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }
}

impl Default for ProcessExecutor {
    fn default() -> Self {
        Self::new()
    }
}
