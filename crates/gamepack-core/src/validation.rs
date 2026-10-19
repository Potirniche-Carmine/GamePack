use crate::model::{Anchor, Draft, Position, Tool, Video};
use anyhow::{bail, ensure, Result};
use std::collections::HashSet;

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub(crate) fn identifier(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 128
            && value
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.')),
        "IDs must contain 1–128 ASCII letters, numbers, dots, underscores or hyphens"
    );
    Ok(())
}

pub(crate) fn label(value: &str, kind: &str) -> Result<()> {
    ensure!(
        !value.trim().is_empty() && value.len() <= 512 && !value.chars().any(char::is_control),
        "{kind} must contain 1–512 bytes and no control characters"
    );
    Ok(())
}

pub(crate) fn metadata(duration_us: i64, width: u32, height: u32) -> Result<()> {
    ensure!(
        (0..=MAX_SAFE_INTEGER).contains(&duration_us),
        "Video duration must be nonnegative integer microseconds"
    );
    ensure!(
        width <= 100_000 && height <= 100_000 && ((width == 0) == (height == 0)),
        "Video dimensions must both be zero (unknown), or both between 1 and 100000"
    );
    Ok(())
}

pub(crate) fn position(position: Position) -> Result<()> {
    ensure!(
        position.x.is_finite()
            && position.y.is_finite()
            && (0.0..=1.0).contains(&position.x)
            && (0.0..=1.0).contains(&position.y),
        "Comment position must contain finite coordinates between 0 and 1"
    );
    Ok(())
}

pub(crate) fn draft(draft: &Draft, video: &Video) -> Result<()> {
    identifier(&draft.id)?;
    identifier(&draft.project_id)?;
    identifier(&draft.video_id)?;
    if let Some(value) = draft.position {
        position(value)?;
    }
    ensure!(
        draft.text.len() <= 65_536
            && !draft
                .text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')),
        "Comment text exceeds 65536 bytes or contains unsupported control characters"
    );
    ensure!(
        draft.project_id == video.project_id,
        "Draft project must match its video"
    );
    let (at_us, end_us) = match draft.anchor {
        Anchor::Point { at_us } => (at_us, at_us),
        Anchor::Play { at_us, end_us } => (at_us, end_us),
    };
    ensure!(
        (0..=MAX_SAFE_INTEGER).contains(&at_us),
        "Frame time must be nonnegative integer microseconds"
    );
    ensure!(
        (at_us..=MAX_SAFE_INTEGER).contains(&end_us),
        "Play end must be at or after its start in safe integer microseconds"
    );
    ensure!(
        video.duration_us == 0 || end_us <= video.duration_us,
        "Anchor extends beyond the video duration"
    );
    ensure!(
        draft.drawings.len() <= 2048,
        "A comment supports at most 2048 drawings"
    );
    let mut ids = HashSet::new();
    let mut sample_count = 0usize;
    for drawing in &draft.drawings {
        identifier(&drawing.id)?;
        ensure!(
            ids.insert(&drawing.id),
            "Duplicate drawing ID: {}",
            drawing.id
        );
        ensure!(
            (0..=1_000_000).contains(&drawing.width),
            "Drawing width must be between 0 and 1000000"
        );
        ensure!(!drawing.samples.is_empty(), "Drawings must contain samples");
        if drawing.tool != Tool::Pen {
            ensure!(
                drawing.samples.len() == 2,
                "Arrow and ellipse drawings require exactly two samples"
            );
        }
        sample_count = sample_count
            .checked_add(drawing.samples.len())
            .ok_or_else(|| anyhow::anyhow!("Too many samples"))?;
        ensure!(
            sample_count <= 100_000,
            "A comment supports at most 100000 drawing samples"
        );
        let mut previous_time = at_us;
        for sample in &drawing.samples {
            ensure!(
                (0..=1_000_000).contains(&sample.x) && (0..=1_000_000).contains(&sample.y),
                "Drawing coordinates must be between 0 and 1000000"
            );
            match (&draft.anchor, sample.t_us) {
                (Anchor::Point { .. }, None) => {}
                (Anchor::Play { .. }, Some(time)) => {
                    ensure!(
                        (previous_time..=end_us).contains(&time),
                        "Play samples must be ordered and within the conversation window"
                    );
                    previous_time = time;
                }
                _ => bail!("Only play drawings require a media time on every sample"),
            }
        }
    }
    if let Some(parent) = &draft.parent_comment_id {
        identifier(parent)?;
        if parent == &draft.id {
            bail!("A comment cannot reply to itself");
        }
    }
    Ok(())
}
