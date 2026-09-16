//! 键鼠模拟命令模块
//!
//! 提供键盘和鼠标控制功能，使用 enigo 库实现跨平台支持

use enigo::{Enigo, Settings, Key, Direction, Axis, Button, Keyboard, Mouse};

/// 模拟按键按下
///
/// # 参数
/// - `key`: 按键名称，如 "a", "space", "return", "f1" 等
#[tauri::command]
pub fn key_down(key: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;

    let key = key.to_lowercase();
    match key.as_str() {
        // 字母键
        k if k.len() == 1 && k.chars().next().unwrap().is_ascii_alphanumeric() => {
            let c = k.chars().next().unwrap().to_ascii_lowercase();
            enigo.key(googol_key(&c), Direction::Press).map_err(|e| e.to_string())?;
        }
        // 功能键
        "space" => enigo.key(Key::Space, Direction::Press).map_err(|e| e.to_string())?,
        "return" | "enter" => enigo.key(Key::Return, Direction::Press).map_err(|e| e.to_string())?,
        "escape" | "esc" => enigo.key(Key::Escape, Direction::Press).map_err(|e| e.to_string())?,
        "tab" => enigo.key(Key::Tab, Direction::Press).map_err(|e| e.to_string())?,
        "backspace" => enigo.key(Key::Backspace, Direction::Press).map_err(|e| e.to_string())?,
        "delete" | "del" => enigo.key(Key::Delete, Direction::Press).map_err(|e| e.to_string())?,
        "up" => enigo.key(Key::UpArrow, Direction::Press).map_err(|e| e.to_string())?,
        "down" => enigo.key(Key::DownArrow, Direction::Press).map_err(|e| e.to_string())?,
        "left" => enigo.key(Key::LeftArrow, Direction::Press).map_err(|e| e.to_string())?,
        "right" => enigo.key(Key::RightArrow, Direction::Press).map_err(|e| e.to_string())?,
        "home" => enigo.key(Key::Home, Direction::Press).map_err(|e| e.to_string())?,
        "end" => enigo.key(Key::End, Direction::Press).map_err(|e| e.to_string())?,
        "pageup" => enigo.key(Key::PageUp, Direction::Press).map_err(|e| e.to_string())?,
        "pagedown" => enigo.key(Key::PageDown, Direction::Press).map_err(|e| e.to_string())?,
        // 功能键 F1-F12
        k if k.starts_with('f') && k.len() <= 3 => {
            if let Ok(n) = k[1..].parse::<u8>() {
                if (1..=12).contains(&n) {
                    let fkey = match n {
                        1 => Key::F1,
                        2 => Key::F2,
                        3 => Key::F3,
                        4 => Key::F4,
                        5 => Key::F5,
                        6 => Key::F6,
                        7 => Key::F7,
                        8 => Key::F8,
                        9 => Key::F9,
                        10 => Key::F10,
                        11 => Key::F11,
                        12 => Key::F12,
                        _ => return Err("无效的功能键".to_string()),
                    };
                    enigo.key(fkey, Direction::Press).map_err(|e| e.to_string())?;
                }
            } else {
                return Err(format!("未知的按键: {}", key));
            }
        }
        // 修饰键
        "shift" | "lshift" => enigo.key(Key::LShift, Direction::Press).map_err(|e| e.to_string())?,
        "rshift" => enigo.key(Key::RShift, Direction::Press).map_err(|e| e.to_string())?,
        "ctrl" | "control" | "lctrl" | "rctrl" => enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?,
        "alt" | "lalt" | "ralt" => enigo.key(Key::Alt, Direction::Press).map_err(|e| e.to_string())?,
        "meta" | "win" | "super" => enigo.key(Key::Meta, Direction::Press).map_err(|e| e.to_string())?,
        // 游戏常用键 (WASD 映射)
        "w" => enigo.key(Key::UpArrow, Direction::Press).map_err(|e| e.to_string())?,
        "s" => enigo.key(Key::DownArrow, Direction::Press).map_err(|e| e.to_string())?,
        "a" => enigo.key(Key::LeftArrow, Direction::Press).map_err(|e| e.to_string())?,
        "d" => enigo.key(Key::RightArrow, Direction::Press).map_err(|e| e.to_string())?,
        _ => return Err(format!("未知的按键: {}", key)),
    }

    Ok(())
}

/// 模拟按键释放
#[tauri::command]
pub fn key_up(key: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;

    let key = key.to_lowercase();
    match key.as_str() {
        k if k.len() == 1 && k.chars().next().unwrap().is_ascii_alphanumeric() => {
            let c = k.chars().next().unwrap().to_ascii_lowercase();
            enigo.key(googol_key(&c), Direction::Release).map_err(|e| e.to_string())?;
        }
        "space" => enigo.key(Key::Space, Direction::Release).map_err(|e| e.to_string())?,
        "return" | "enter" => enigo.key(Key::Return, Direction::Release).map_err(|e| e.to_string())?,
        "escape" | "esc" => enigo.key(Key::Escape, Direction::Release).map_err(|e| e.to_string())?,
        "tab" => enigo.key(Key::Tab, Direction::Release).map_err(|e| e.to_string())?,
        "backspace" => enigo.key(Key::Backspace, Direction::Release).map_err(|e| e.to_string())?,
        "delete" | "del" => enigo.key(Key::Delete, Direction::Release).map_err(|e| e.to_string())?,
        "up" => enigo.key(Key::UpArrow, Direction::Release).map_err(|e| e.to_string())?,
        "down" => enigo.key(Key::DownArrow, Direction::Release).map_err(|e| e.to_string())?,
        "left" => enigo.key(Key::LeftArrow, Direction::Release).map_err(|e| e.to_string())?,
        "right" => enigo.key(Key::RightArrow, Direction::Release).map_err(|e| e.to_string())?,
        "home" => enigo.key(Key::Home, Direction::Release).map_err(|e| e.to_string())?,
        "end" => enigo.key(Key::End, Direction::Release).map_err(|e| e.to_string())?,
        "pageup" => enigo.key(Key::PageUp, Direction::Release).map_err(|e| e.to_string())?,
        "pagedown" => enigo.key(Key::PageDown, Direction::Release).map_err(|e| e.to_string())?,
        k if k.starts_with('f') && k.len() <= 3 => {
            if let Ok(n) = k[1..].parse::<u8>() {
                if (1..=12).contains(&n) {
                    let fkey = match n {
                        1 => Key::F1,
                        2 => Key::F2,
                        3 => Key::F3,
                        4 => Key::F4,
                        5 => Key::F5,
                        6 => Key::F6,
                        7 => Key::F7,
                        8 => Key::F8,
                        9 => Key::F9,
                        10 => Key::F10,
                        11 => Key::F11,
                        12 => Key::F12,
                        _ => return Err("无效的功能键".to_string()),
                    };
                    enigo.key(fkey, Direction::Release).map_err(|e| e.to_string())?;
                }
            } else {
                return Err(format!("未知的按键: {}", key));
            }
        }
        "shift" | "lshift" => enigo.key(Key::LShift, Direction::Release).map_err(|e| e.to_string())?,
        "rshift" => enigo.key(Key::RShift, Direction::Release).map_err(|e| e.to_string())?,
        "ctrl" | "control" | "lctrl" | "rctrl" => enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?,
        "alt" | "lalt" | "ralt" => enigo.key(Key::Alt, Direction::Release).map_err(|e| e.to_string())?,
        "meta" | "win" | "super" => enigo.key(Key::Meta, Direction::Release).map_err(|e| e.to_string())?,
        "w" => enigo.key(Key::UpArrow, Direction::Release).map_err(|e| e.to_string())?,
        "s" => enigo.key(Key::DownArrow, Direction::Release).map_err(|e| e.to_string())?,
        "a" => enigo.key(Key::LeftArrow, Direction::Release).map_err(|e| e.to_string())?,
        "d" => enigo.key(Key::RightArrow, Direction::Release).map_err(|e| e.to_string())?,
        _ => return Err(format!("未知的按键: {}", key)),
    }

    Ok(())
}

/// 模拟按键按下并释放（点击）
#[tauri::command]
pub fn key_press(key: String) -> Result<(), String> {
    key_down(key.clone())?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    key_up(key)
}

/// 鼠标移动到指定坐标
#[tauri::command]
pub fn mouse_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    enigo.move_mouse(x, y, enigo::Coordinate::Abs).map_err(|e| e.to_string())?;
    Ok(())
}

/// 鼠标左键点击
#[tauri::command]
pub fn mouse_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    enigo.move_mouse(x, y, enigo::Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.button(Button::Left, Direction::Press).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    enigo.button(Button::Left, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

/// 鼠标右键点击
#[tauri::command]
pub fn mouse_right_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    enigo.move_mouse(x, y, enigo::Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.button(Button::Right, Direction::Press).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    enigo.button(Button::Right, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

/// 鼠标中键点击
#[tauri::command]
pub fn mouse_middle_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    enigo.move_mouse(x, y, enigo::Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.button(Button::Middle, Direction::Press).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    enigo.button(Button::Middle, Direction::Release).map_err(|e| e.to_string())?;
    Ok(())
}

/// 鼠标滚动（正数向上，负数向下）
#[tauri::command]
pub fn mouse_scroll(lines: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("创建 Enigo 失败: {}", e))?;
    enigo.scroll(lines, Axis::Vertical).map_err(|e| e.to_string())?;
    Ok(())
}

/// 辅助函数：将单字符转换为对应的 Key
fn googol_key(c: &char) -> Key {
    match c {
        'a' => Key::A,
        'b' => Key::B,
        'c' => Key::C,
        'd' => Key::D,
        'e' => Key::E,
        'f' => Key::F,
        'g' => Key::G,
        'h' => Key::H,
        'i' => Key::I,
        'j' => Key::J,
        'k' => Key::K,
        'l' => Key::L,
        'm' => Key::M,
        'n' => Key::N,
        'o' => Key::O,
        'p' => Key::P,
        'q' => Key::Q,
        'r' => Key::R,
        's' => Key::S,
        't' => Key::T,
        'u' => Key::U,
        'v' => Key::V,
        'w' => Key::W,
        'x' => Key::X,
        'y' => Key::Y,
        'z' => Key::Z,
        '0' => Key::Num0,
        '1' => Key::Num1,
        '2' => Key::Num2,
        '3' => Key::Num3,
        '4' => Key::Num4,
        '5' => Key::Num5,
        '6' => Key::Num6,
        '7' => Key::Num7,
        '8' => Key::Num8,
        '9' => Key::Num9,
        _ => Key::Space,
    }
}
