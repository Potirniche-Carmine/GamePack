//! One-time v6 conversion. Older shapes are never accepted by the runtime API.
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Transaction};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

fn freeze(body: &mut Value) -> Result<()> {
    let record = body.as_object_mut().context("Invalid saved review")?;
    let anchor = record.get("anchor").context("Missing saved frame")?;
    let time = match anchor["kind"].as_str() {
        Some("point") => anchor["at_us"].as_i64(),
        // Retain the completed geometry on the final frame of an old clip.
        Some("interval") => anchor["end_us"].as_i64().and_then(|end| end.checked_sub(1)),
        _ => None,
    }
    .context("Invalid saved review time")?;
    ensure!(time >= 0, "Invalid saved review time");
    record.insert("anchor".into(), json!({"kind":"point", "at_us":time}));
    for drawing in record
        .get_mut("drawings")
        .and_then(Value::as_array_mut)
        .context("Missing saved drawings")?
    {
        let drawing = drawing.as_object_mut().context("Invalid saved drawing")?;
        for key in ["color", "visible_from_us", "visible_until_us"] {
            drawing.remove(key);
        }
        for sample in drawing
            .get_mut("samples")
            .and_then(Value::as_array_mut)
            .context("Missing saved samples")?
        {
            sample
                .as_object_mut()
                .context("Invalid saved sample")?
                .remove("t_us");
        }
    }
    Ok(())
}

pub(crate) fn freeze_reviews(tx: &Transaction<'_>) -> Result<()> {
    // Keep original posted bytes and digests for recovery/audit. This archive is
    // never read as a compatibility fallback; deleting a review deletes it too.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS review_v1_archive (
        comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
        body TEXT NOT NULL, digest TEXT NOT NULL
    );",
    )?;
    let mut rows = tx.prepare("SELECT id,body,digest FROM comments ORDER BY created_at,id")?;
    let saved = rows
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut converted = HashMap::new();
    for (id, body, _) in &saved {
        let mut record: Value = serde_json::from_str(body)?;
        freeze(&mut record)?;
        converted.insert(id.clone(), record);
    }
    // A reply belongs to its conversation's frame, including old clip replies.
    let root_time = |record: &Value| -> Result<Value> {
        let mut current = record;
        let mut seen = HashSet::new();
        while let Some(parent) = current["parent_comment_id"].as_str() {
            ensure!(
                seen.len() < 128 && seen.insert(parent),
                "Invalid saved reply ancestry"
            );
            current = converted
                .get(parent)
                .context("Missing saved reply parent")?;
        }
        Ok(current["anchor"].clone())
    };
    tx.execute_batch("DROP TRIGGER comments_no_update;")?;
    for (id, body, digest) in &saved {
        let mut record = converted[id].clone();
        // Idempotence also supports development databases whose version was
        // reset while already containing the new format.
        if record["schema_version"] == 2 {
            continue;
        }
        record["anchor"] = root_time(&record)?;
        record["schema_version"] = json!(2);
        record.as_object_mut().unwrap().remove("digest");
        let new_digest = blake3::hash(&serde_json::to_vec(&record)?)
            .to_hex()
            .to_string();
        record["digest"] = json!(new_digest);
        let _: crate::model::Comment = serde_json::from_value(record.clone())?;
        tx.execute(
            "INSERT INTO review_v1_archive VALUES(?1,?2,?3)",
            params![id, body, digest],
        )?;
        tx.execute(
            "UPDATE comments SET body=?1,digest=?2 WHERE id=?3",
            params![serde_json::to_string(&record)?, new_digest, id],
        )?;
    }
    tx.execute_batch("CREATE TRIGGER comments_no_update BEFORE UPDATE ON comments BEGIN SELECT RAISE(ABORT,'Posted comments are immutable'); END;")?;
    let mut drafts = tx.prepare("SELECT id,body FROM drafts")?;
    let drafts = drafts
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, body) in drafts {
        let mut record: Value = serde_json::from_str(&body)?;
        freeze(&mut record)?;
        record["anchor"] = root_time(&record)?;
        let _: crate::model::Draft = serde_json::from_value(record.clone())?;
        tx.execute(
            "UPDATE drafts SET body=?1 WHERE id=?2",
            params![serde_json::to_string(&record)?, id],
        )?;
    }
    let old_preference: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('preferences') WHERE name='pause_after_drawing')", [], |row| row.get(0))?;
    if old_preference {
        tx.execute_batch("ALTER TABLE preferences DROP COLUMN pause_after_drawing;")?;
    }
    Ok(())
}
