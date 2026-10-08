# Local schema and canonical comments

`local-v1.sql` is the Rust-owned SQLite schema. `PRAGMA user_version=2` adds a singleton settings table; opening a v1 library adds the table and defaults theme to `system` without replacing existing records. Older binaries reject this newer schema.

Bootstrap includes `settings: {theme: 'system' | 'light' | 'dark'}`. `set_theme {theme}` persists and returns these settings. Preferences belong to the chosen root's database.
It is local application storage, not an exchange format. ZIP import/export is not
implemented. SQLite uses WAL, foreign keys, a ten-second busy timeout, and FULL
synchronous writes. Posting acquires an immediate write transaction, validates the
saved draft, inserts one complete comment, and removes that draft before commit.
Comment IDs equal draft IDs. Retrying a successful post returns its original record.
SQL triggers reject any update or deletion of a posted row.

The CXX bridge is namespace `gamepack`, function
`rust::String dispatch(rust::Str root, rust::Str request)`. The generated include is
`target/cxxbridge/gamepack-core/src/lib.rs.h`; its include root is
`target/cxxbridge`. The macOS static archive is
`target/release/libgamepack_core.a`. Call the bridge on a background serial queue.
The Rust boundary catches unwinds and reports recoverable failures as JSON.

Requests and model fields follow `docs/mvp-contract.md`. The root must be an
absolute UTF-8 path, supplied on every request. Root selection and the environment
override belong to the host. The engine canonicalizes the root, creates `media/`,
`cache/`, `tmp/`, `config/`, and keeps all database files beneath it. Application
storage entries cannot be symlinks. Media imports stream into a root-local staging
file, hash the copied bytes, flush, and publish using a non-overwriting hard link.
The source is opened read-only. The identity is
`blake3:<64 lowercase hexadecimal characters>:<decimal byte size>`. One media file
is reused across project memberships. Failed database commits may leave a verified
unreferenced media object; a subsequent matching import safely reuses it. The engine
does not decode or validate video codecs; native players discover timing/dimensions.

All time fields, including `created_at` and `created_at_reported`, are integer
microseconds; creation fields use Unix epoch time. Metadata may initially be zero.
Bounds against known duration are checked on save and again on post. Metadata
updates cannot invalidate a posted anchor in any membership sharing the media.

Canonical comment digest v1 is BLAKE3 of compact UTF-8 JSON representing the
complete returned Comment with its `digest` member omitted. Object keys are sorted
lexicographically at every depth; array order is preserved. Integer values use
unquoted decimal JSON numbers. Strings use serde_json's JSON escaping without
Unicode normalization. `parent_comment_id` is always present, with `null` when
absent. No trailing newline is included. Scope, IDs, profile snapshot, creation
time, anchor, text, drawings, and schema version are covered. Paths and UI state
are absent. The digest detects changes; it does not authenticate a person.

Drawing evaluation uses source time with no interpolation. Point scenes show all
samples only at their exact anchor; the UI clears them on ordinary playback.
Interval scenes use `[start_us,end_us)`. A drawing uses
`[visible_from_us,visible_until_us)` relative to the anchor. Pen samples appear
when `t_us <= offset`; equal-time samples appear together. Arrows and ellipses
appear completely at `visible_from_us`. Array order is layer order. Seeking
reconstructs the same scene independently of prior playback.

Validation limits: request 8 MiB, text 65,536 UTF-8 bytes, 2,048 drawings, 100,000
total samples per draft, 128 ancestors, 512 bytes per display name/project title,
128 ASCII characters per local ID. Times and byte counts must fit the JavaScript
safe integer range. Coordinates and widths use the inclusive range 0–1,000,000.
Arrow and ellipse geometry has exactly two samples. Drawing IDs are unique within
a comment. Samples are nondecreasing and lie inside the drawing's visibility
window; all point sample times and visibility fields are zero. Unknown fields,
duplicate JSON keys at any depth, fractional integer fields, invalid tools/colors,
invalid references, and control characters in labels/text are rejected. Text
permits newline, carriage return, and tab. Blank drafts are allowed; posts require
text or a drawing and a nonempty profile name. Profile names are trimmed when set;
posted text and geometry are not silently normalized.

For inspection, run `cargo run -p gamepack-core --bin gamepack -- /absolute/root
'{"command":"bootstrap"}'`. Without the JSON argument the CLI accepts one request
per stdin line. CLI errors use the same JSON envelope as native calls.
