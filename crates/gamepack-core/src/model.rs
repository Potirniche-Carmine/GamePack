use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub author_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Video {
    pub id: String,
    pub project_id: String,
    pub media_id: String,
    pub title: String,
    pub path: String,
    pub byte_size: u64,
    pub duration_us: i64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Anchor {
    Point { at_us: i64 },
    Interval { start_us: i64, end_us: i64 },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Tool {
    Pen,
    Arrow,
    Ellipse,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Sample {
    pub x: i64,
    pub y: i64,
    pub t_us: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Drawing {
    pub id: String,
    pub tool: Tool,
    pub color: String,
    pub width: i64,
    pub visible_from_us: i64,
    pub visible_until_us: i64,
    pub samples: Vec<Sample>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Draft {
    pub id: String,
    pub project_id: String,
    pub video_id: String,
    pub text: String,
    pub anchor: Anchor,
    #[serde(default)]
    pub parent_comment_id: Option<String>,
    pub drawings: Vec<Drawing>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Comment {
    #[serde(flatten)]
    pub draft: Draft,
    pub comment_id: String,
    pub media_id: String,
    pub author_id: String,
    pub name_at_posting: String,
    pub created_at_reported: i64,
    pub digest: String,
    pub schema_version: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Request {
    Bootstrap,
    SetProfile {
        name: String,
    },
    CreateProject {
        title: String,
    },
    ImportVideo {
        path: String,
        project_id: String,
        #[serde(default)]
        duration_us: i64,
        #[serde(default)]
        width: u32,
        #[serde(default)]
        height: u32,
    },
    UpdateVideoMetadata {
        video_id: String,
        duration_us: i64,
        width: u32,
        height: u32,
    },
    SaveDraft {
        draft: Draft,
    },
    DiscardDraft {
        draft_id: String,
    },
    PostDraft {
        draft_id: String,
    },
    VerifyVideo {
        video_id: String,
    },
}
