use anyhow::{ensure, Result};
use std::collections::{BTreeMap, HashSet};

pub(crate) fn validate(overrides: &BTreeMap<String, Option<String>>) -> Result<()> {
    let defaults: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../packages/app/src/shortcut-defaults.json"
    ))?;
    ensure!(
        overrides
            .keys()
            .all(|id| defaults.iter().any(|item| item["id"] == *id)),
        "Unknown shortcut action"
    );
    let mut used = HashSet::new();
    for item in &defaults {
        let id = item["id"].as_str().unwrap();
        let key = match overrides.get(id) {
            Some(value) => value.as_deref(),
            None => item["key"].as_str(),
        };
        let Some(chord) = key else { continue };
        let mut parts: Vec<_> = chord.split('+').collect();
        let key = parts.pop().unwrap_or("");
        let modifiers: Vec<_> = ["Mod", "Alt", "Shift"]
            .into_iter()
            .filter(|value| parts.contains(value))
            .collect();
        ensure!(modifiers == parts, "Invalid shortcut modifiers");
        let single = key.len() == 1
            && key
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || b",.[]/;='-".contains(&c));
        ensure!(
            single
                || [
                    "Space",
                    "Enter",
                    "Backspace",
                    "Delete",
                    "Home",
                    "End",
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown"
                ]
                .contains(&key),
            "Invalid shortcut key"
        );
        ensure!(
            !["Mod+Q", "Mod+W", "Mod+H", "Mod+M", "Mod+C", "Mod+X", "Mod+V", "Mod+A"]
                .contains(&chord),
            "Shortcut is reserved for the system or text editing"
        );
        ensure!(
            key != "Enter" || parts.contains(&"Mod"),
            "Return is reserved for focused controls"
        );
        ensure!(
            id != "submit" || parts.contains(&"Mod"),
            "Posting requires Command or Control"
        );
        ensure!(
            used.insert(chord.to_owned()),
            "Shortcut is already assigned"
        );
    }
    Ok(())
}
