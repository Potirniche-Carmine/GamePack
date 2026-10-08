//! Offline GamePack engine. All durable state belongs to the explicit root.
mod evaluator;
mod json;
pub mod model;
mod store;
mod validation;

pub use evaluator::evaluate_drawings;
use serde_json::json;

#[cxx::bridge(namespace = "gamepack")]
mod ffi {
    extern "Rust" {
        fn dispatch(root: &str, request: &str) -> String;
    }
}

/// A synchronous CXX boundary. The host must call this off the UI thread.
/// Recoverable failures and caught unwinds are returned as JSON, never foreign
/// exceptions. No pointers, connection handles or borrowed buffers are retained.
pub fn dispatch(root: &str, request: &str) -> String {
    let result = std::panic::catch_unwind(|| -> anyhow::Result<serde_json::Value> {
        anyhow::ensure!(request.len() <= 8 * 1024 * 1024, "Request exceeds 8 MiB");
        let value: json::UniqueValue = serde_json::from_str(request)?;
        let request: model::Request = serde_json::from_value(value.0)?;
        store::Store::open(root)?.execute(request)
    });
    match result {
        Ok(Ok(data)) => json!({"ok": true, "data": data}).to_string(),
        Ok(Err(error)) => json!({"ok": false, "error": format!("{error:#}")}).to_string(),
        Err(_) => json!({"ok": false, "error": "Internal engine failure; the operation did not acknowledge success. Retry using the same draft ID."}).to_string(),
    }
}
