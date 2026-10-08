use crate::model::{Anchor, Drawing, Tool};

/// Reconstructs a selected scene from source time, without a playback clock or
/// interpolation. Equal-time pen samples appear together. Shapes appear whole
/// at `visible_from_us`; point scenes show all samples only at their anchor.
pub fn evaluate_drawings(anchor: &Anchor, drawings: &[Drawing], source_us: i64) -> Vec<Drawing> {
    let offset = match *anchor {
        Anchor::Point { at_us } if source_us == at_us => return drawings.to_vec(),
        Anchor::Interval { start_us, end_us } if (start_us..end_us).contains(&source_us) => {
            source_us - start_us
        }
        _ => return Vec::new(),
    };
    drawings
        .iter()
        .filter_map(|drawing| {
            if !(drawing.visible_from_us..drawing.visible_until_us).contains(&offset) {
                return None;
            }
            let mut visible = drawing.clone();
            if drawing.tool == Tool::Pen {
                visible.samples.truncate(
                    drawing
                        .samples
                        .partition_point(|sample| sample.t_us <= offset),
                );
            }
            (!visible.samples.is_empty()).then_some(visible)
        })
        .collect()
}
