"""
backfill_titles.py — One-time fix for podcast episodes stored with broken YouTube UI titles
("Keyboard shortcuts", "Playback", "General", "Want to join this channel?").

Root cause: the old regex scraper in fetch_podcasts.py extracted titles and video IDs in
separate passes over the page HTML, causing YouTube UI elements to be paired with real video IDs.

Fix: use yt-dlp to fetch the real title for each video ID stored in content_hash.

Run on Refinery:
  cd ~/repos/cvc-intelligence/workers/briefing
  PYTHONPATH=../../core python3 backfill_titles.py
"""
import os
import sys
import json
import shutil
import subprocess
import time
import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))

DB_CONFIG = dict(
    dbname="cvc_db",
    user="producer",
    password=os.environ["CVC_DB_PASSWORD"],
    host=os.environ.get("CVC_DB_HOST", "localhost"),
    port=5432,
)

BROKEN_TITLES = ("Keyboard shortcuts", "Playback", "General", "Want to join this channel?", "Untitled")

YTDLP_BIN = (shutil.which("yt-dlp")
             or os.path.expanduser("~/.local/bin/yt-dlp")
             or "yt-dlp")


def get_real_title(video_id: str) -> str | None:
    try:
        result = subprocess.run(
            [YTDLP_BIN, "--no-download", "--print", "title", "--no-warnings",
             f"https://www.youtube.com/watch?v={video_id}"],
            capture_output=True, text=True, timeout=20,
        )
        title = result.stdout.strip()
        if title and title not in BROKEN_TITLES:
            return title
        return None
    except Exception as e:
        print(f"    yt-dlp error for {video_id}: {e}")
        return None


def main():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT id, title, content_hash
        FROM cvc.content_items
        WHERE content_type = 'podcast_episode'
          AND title = ANY(%s)
          AND content_hash LIKE 'yt-%%'
        ORDER BY created_at DESC
    """, (list(BROKEN_TITLES),))

    rows = cur.fetchall()
    print(f"Found {len(rows)} episodes with broken titles")

    fixed = 0
    failed = 0

    for i, row in enumerate(rows):
        video_id = row["content_hash"].replace("yt-", "")
        print(f"[{i+1}/{len(rows)}] {row['content_hash']} (was: '{row['title']}')")

        real_title = get_real_title(video_id)
        if real_title:
            cur.execute(
                "UPDATE cvc.content_items SET title = %s WHERE id = %s",
                (real_title, row["id"]),
            )
            conn.commit()
            print(f"    → {real_title}")
            fixed += 1
        else:
            print(f"    Could not retrieve title")
            failed += 1

        time.sleep(0.5)  # be polite to YouTube

    conn.close()
    print(f"\nDone: {fixed} fixed, {failed} could not retrieve")


if __name__ == "__main__":
    main()
