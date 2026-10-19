use crate::model::{Anchor, Drawing, Sample};

/// Evaluate source-clock ink without mutating saved samples. Equal sample times
/// reveal together (including drawing while paused); seeking simply reevaluates.
pub fn evaluate_drawings(anchor: &Anchor, drawings: &[Drawing], source_us: i64) -> Vec<Drawing> {
    match *anchor {
        Anchor::Point { at_us } if source_us == at_us => drawings.to_vec(),
        Anchor::Play { at_us, end_us } if (at_us..=end_us).contains(&source_us) => drawings
            .iter()
            .filter_map(|drawing| {
                let count = drawing
                    .samples
                    .partition_point(|s| s.t_us.unwrap_or(i64::MAX) <= source_us);
                if count == 0 {
                    return None;
                }
                let mut visible = drawing.clone();
                visible.samples.truncate(count);
                if let Some(next) = drawing.samples.get(count) {
                    let last = visible.samples.last().unwrap();
                    let from = last.t_us?;
                    let until = next.t_us?;
                    if source_us > from && until > from {
                        let progress = (source_us - from) as f64 / (until - from) as f64;
                        visible.samples.push(Sample {
                            x: (last.x as f64 + (next.x - last.x) as f64 * progress).round() as i64,
                            y: (last.y as f64 + (next.y - last.y) as f64 * progress).round() as i64,
                            t_us: Some(source_us),
                        });
                    }
                }
                Some(visible)
            })
            .collect(),
        _ => Vec::new(),
    }
}
