"""SQLite-backed note storage."""

from __future__ import annotations

import shutil
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path


class NoteNotFound(Exception):
    pass


class AttachmentNotFound(Exception):
    pass


@dataclass
class Note:
    id: int
    title: str
    body: str
    created_at: float
    tags: list[str] = field(default_factory=list)


SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_created_at ON notes (created_at);
CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
);
"""


MAX_PAGE_SIZE = 100

# Fixed ordering clause shared by listing and search; never built from user input.
NEWEST_FIRST = "ORDER BY created_at DESC, id DESC"


class NoteStore:
    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.data_dir / "notes.db")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)

    def close(self) -> None:
        self.conn.close()

    def add_note(self, title: str, body: str, tags: list[str] | tuple[str, ...] = ()) -> int:
        with self.conn:
            cur = self.conn.execute(
                "INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)",
                (title, body, time.time()),
            )
            note_id = cur.lastrowid
            self.conn.executemany(
                "INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)",
                [(note_id, t) for t in tags],
            )
        return note_id

    def get_note(self, note_id: int) -> Note:
        row = self.conn.execute(
            "SELECT id, title, body, created_at FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        if row is None:
            raise NoteNotFound(note_id)
        return self._hydrate(row)

    def list_notes(self, page: int = 1, page_size: int = 20) -> list[Note]:
        if page < 1:
            raise ValueError("page must be >= 1")
        if not 1 <= page_size <= MAX_PAGE_SIZE:
            raise ValueError(f"page_size must be between 1 and {MAX_PAGE_SIZE}")
        offset = page * page_size
        rows = self.conn.execute(
            f"SELECT id, title, body, created_at FROM notes {NEWEST_FIRST} LIMIT ? OFFSET ?",
            (page_size, offset),
        ).fetchall()
        return [self._hydrate(r) for r in rows]

    def search_by_tag(self, tag: str) -> list[Note]:
        rows = self.conn.execute(
            f"""
            SELECT n.id, n.title, n.body, n.created_at
            FROM notes n JOIN note_tags t ON t.note_id = n.id
            WHERE t.tag = ?
            {NEWEST_FIRST}
            """,
            (tag.strip(),),
        ).fetchall()
        return [self._hydrate(r) for r in rows]

    def _attachment_dir(self, note_id: int) -> Path:
        self.get_note(note_id)  # raises NoteNotFound
        return self.data_dir / "attachments" / str(note_id)

    def _attachment_path(self, note_id: int, filename: str) -> Path:
        if filename.startswith(".."):
            raise ValueError(f"invalid attachment name: {filename}")
        return self._attachment_dir(note_id) / filename

    def add_attachment(self, note_id: int, filename: str, content: bytes) -> Path:
        path = self._attachment_path(note_id, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def export_attachment(self, note_id: int, filename: str, dest_dir: str | Path) -> Path:
        src = self._attachment_path(note_id, filename)
        dest = Path(dest_dir) / src.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        return dest

    def _tags_for(self, note_id: int) -> list[str]:
        rows = self.conn.execute(
            "SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag", (note_id,)
        ).fetchall()
        return [r[0] for r in rows]

    def _hydrate(self, row: tuple) -> Note:
        return Note(id=row[0], title=row[1], body=row[2], created_at=row[3], tags=self._tags_for(row[0]))
