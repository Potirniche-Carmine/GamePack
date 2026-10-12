use crate::model::{Anchor, Drawing};

/// A review is a completed drawing on one source frame. No stroke replay or
/// visibility windows exist in the stored model.
pub fn evaluate_drawings(anchor: &Anchor, drawings: &[Drawing], source_us: i64) -> Vec<Drawing> {
    let Anchor::Point { at_us } = *anchor;
    if source_us == at_us {
        drawings.to_vec()
    } else {
        Vec::new()
    }
}
