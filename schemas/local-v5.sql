-- Card placement is mutable local presentation state. Posted review content and
-- its digest remain immutable, including when a card is moved after publication.
CREATE TABLE IF NOT EXISTS comment_positions (
    comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
    x REAL NOT NULL CHECK(x BETWEEN 0 AND 1),
    y REAL NOT NULL CHECK(y BETWEEN 0 AND 1)
);
