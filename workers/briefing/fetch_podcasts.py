"""
fetch_podcasts.py — Scrape and store podcast episodes from tracked YouTube channels.

Transcript priority:
  1. Local GPU diarization (WhisperX + Pyannote on Refinery RTX 3090)
     → produces speaker-labeled text: [SPEAKER_00]: ...
  2. YouTube captions (youtube_transcript_api)
     → plain transcript, free, instant

If both fail for a video, it's skipped.
Runs on Refinery (so GPU diarization works). Owned by Sharp Claw.

Usage:
  python3 fetch_podcasts.py [max_per_channel]
  python3 fetch_podcasts.py 3 --captions-only    # skip diarization (debug)
"""
import os
import requests
import json
import re
import sys
import time
import shutil
import argparse
import subprocess
import psycopg2
import psycopg2.extras
from youtube_transcript_api import YouTubeTranscriptApi

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "core"))
from job_logger import start_job, finish_job

DB_CONFIG = dict(
    dbname="cvc_db",
    user="producer",
    password=os.environ["CVC_DB_PASSWORD"],
    host=os.environ.get("CVC_DB_HOST", "localhost"),
    port=5432,
)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"}

# All 19 tracked channels — verticals first (most relevant to CVC thesis)
CHANNELS = [
    # Vertical / thesis-relevant — priority
    {"name": "The Robot Report",      "handle": "@therobotreport7420",      "tier": "vertical"},
    {"name": "Supply Chain Now",      "handle": "@SupplyChainNow",          "tier": "vertical"},
    {"name": "FreightWaves",          "handle": "@FreightWaves",            "tier": "vertical"},
    {"name": "ILTB Podcast",          "handle": "@ILTB_Podcast",            "tier": "vertical"},
    {"name": "Eric Kimberling",       "handle": "@erickimberling",          "tier": "enterprise"},
    # VC / macro
    {"name": "All-In Podcast",        "handle": "@allin",                   "tier": "macro"},
    {"name": "BG2 Pod",               "handle": "@Bg2Pod",                  "tier": "macro"},
    {"name": "20VC",                  "handle": "@20VC",                    "tier": "vc"},
    {"name": "This Week in Startups", "handle": "@startups",                "tier": "vc"},
    {"name": "TBPN Live",             "handle": "@TBPNLive",                "tier": "vc"},
    {"name": "a16z",                  "handle": "@a16z",                    "tier": "vc"},
    {"name": "Capital Allocators",    "handle": "@capitalallocatorspodcast","tier": "vc"},
    {"name": "Acquired FM",           "handle": "@AcquiredFM",              "tier": "vc"},
    {"name": "Founders Podcast",      "handle": "@founderspodcast1",        "tier": "vc"},
    # Tech
    {"name": "Lex Fridman",           "handle": "@lexfridman",              "tier": "tech"},
    {"name": "Dwarkesh Patel",        "handle": "@DwarkeshPatel",           "tier": "tech"},
    {"name": "Big Technology",        "handle": "@Alex.kantrowitz",         "tier": "tech"},
    # Markets
    {"name": "Risk Reversal Media",   "handle": "@RiskReversalMedia",       "tier": "markets"},
    {"name": "The Compound",          "handle": "@TheCompoundNews",         "tier": "markets"},
]


def get_recent_videos(handle, max_results=5):
    """
    Use yt-dlp --flat-playlist to get video IDs and titles together as structured data.
    Avoids the old regex approach that mismatched titles with video IDs by scraping
    YouTube UI elements ("Keyboard shortcuts", "Playback", etc.) as false positives.
    """
    ytdlp_bin = (shutil.which("yt-dlp")
                 or os.path.expanduser("~/.local/bin/yt-dlp")
                 or "yt-dlp")
    try:
        result = subprocess.run(
            [
                ytdlp_bin,
                "--flat-playlist",
                "--playlist-end", str(max_results),
                "-J",
                "--no-warnings",
                f"https://www.youtube.com/{handle}/videos",
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"    yt-dlp error: {result.stderr[:200]}")
            return []

        data = json.loads(result.stdout)
        videos = []
        for entry in (data.get("entries") or [])[:max_results]:
            if not entry:
                continue
            vid = entry.get("id")
            title = entry.get("title") or "Untitled"
            if vid:
                videos.append({
                    "id":    vid,
                    "title": title,
                    "link":  f"https://www.youtube.com/watch?v={vid}",
                })
        return videos
    except Exception as e:
        print(f"    Error fetching channel: {e}")
        return []


def get_caption_transcript(video_id: str):
    """
    Fallback: YouTube auto-captions via youtube_transcript_api.
    Returns (text, "youtube_captions") or ("BLOCKED", None) or (None, None).
    """
    try:
        ytt = YouTubeTranscriptApi()
        transcript = ytt.fetch(video_id, languages=["en"])
        text = " ".join([s.text for s in transcript.snippets])
        return text, "youtube_captions"
    except Exception as e:
        msg = str(e)
        if "blocked" in msg.lower() or "IPBlocked" in msg or "RequestBlocked" in msg:
            return "BLOCKED", None
        return None, None


def get_transcript(video_id: str, youtube_url: str, captions_only: bool = False):
    """
    Try diarization first, fall back to YouTube captions.
    Returns (text, source) where source is 'diarized' | 'youtube_captions' | None.
    Returns ("BLOCKED", None) if YouTube captions are IP-blocked.
    """
    if not captions_only:
        try:
            from diarize_podcast import diarize_youtube
            diarized = diarize_youtube(youtube_url)
            if diarized:
                return diarized, "diarized"
        except Exception as e:
            print(f"    Diarization error: {e}")

    return get_caption_transcript(video_id)


def process_manual_urls(conn, cur, captions_only=False):
    """
    Fetch transcripts for episodes manually queued via the Admin Signal Queue UI.
    Rows are inserted by the API with enrichment_status='needs_transcript'.
    After transcript is fetched, status is promoted to 'raw' for the enrichment worker.
    """
    cur.execute("""
        SELECT id, title, url FROM cvc.content_items
        WHERE content_type = 'podcast_episode'
          AND tags::text ILIKE '%manual%'
          AND enrichment_status = 'raw'
          AND (raw_text IS NULL OR LENGTH(raw_text) < 100)
        ORDER BY created_at ASC
    """)
    pending = cur.fetchall()
    if not pending:
        return

    print(f"\n--- Manual Signal Queue: {len(pending)} pending ---")
    for row in pending:
        video_id_match = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", row["url"] or "")
        if not video_id_match:
            print(f"  SKIP (no video ID): {row['title']}")
            continue

        video_id = video_id_match.group(1)
        print(f"  Fetching: {row['title'][:60]}")
        transcript, source = get_transcript(video_id, row["url"], captions_only=captions_only)

        if transcript == "BLOCKED":
            print("    IP BLOCKED — stopping manual queue processing")
            return

        if transcript and len(transcript) > 100:
            cur.execute("""
                UPDATE cvc.content_items
                SET raw_text = %s, summary = %s, enrichment_status = 'raw',
                    tags = tags || %s::jsonb
                WHERE id = %s
            """, (
                transcript[:50000],
                transcript[:500],
                json.dumps([source or "unknown"]),
                row["id"],
            ))
            conn.commit()
            print(f"    OK [{source}]: {len(transcript):,} chars → promoted to raw")
        else:
            print(f"    No transcript available")


def run(max_per_channel=5, captions_only=False):
    run_id = start_job("Briefing Podcast Fetch", "refinery")

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Process any manually queued URLs first
    process_manual_urls(conn, cur, captions_only=captions_only)

    total_new = total_skip = total_fail = 0
    total_diarized = total_captions = 0

    for channel in CHANNELS:
        print(f"\n--- {channel['name']} ({channel['tier']}) ---")
        videos = get_recent_videos(channel["handle"], max_per_channel)
        if not videos:
            print("    No videos found")
            continue
        print(f"    Found {len(videos)} videos")
        time.sleep(1)

        for i, video in enumerate(videos):
            content_hash = f"yt-{video['id']}"
            cur.execute(
                "SELECT id FROM cvc.content_items WHERE content_hash = %s",
                (content_hash,),
            )
            if cur.fetchone():
                total_skip += 1
                continue

            print(f"  [{i+1}] {video['title'][:70]}...")
            transcript, source = get_transcript(
                video["id"], video["link"], captions_only=captions_only,
            )

            if transcript == "BLOCKED":
                print("    IP BLOCKED — stopping")
                conn.commit()
                conn.close()
                print(f"\nStopped: {total_new} new | {total_skip} existing | {total_fail} failed")
                finish_job(run_id, "error", {"new": total_new, "diarized": total_diarized, "captions": total_captions, "failed": total_fail}, error_text="IP BLOCKED by YouTube")
                return

            if transcript and len(transcript) > 200:
                source_tag = source or "unknown"
                initial_tags = json.dumps(["podcast", channel["name"], channel["tier"], source_tag])
                cur.execute("""
                    INSERT INTO cvc.content_items
                        (content_type, title, url, raw_text, summary, tags,
                         enrichment_status, content_hash)
                    VALUES ('podcast_episode', %s, %s, %s, %s, %s, 'raw', %s)
                    ON CONFLICT (content_hash) DO NOTHING
                """, (
                    video["title"],
                    video["link"],
                    transcript[:50000],
                    transcript[:500],
                    initial_tags,
                    content_hash,
                ))
                conn.commit()
                if cur.rowcount == 0:
                    # Already existed — count as skip
                    total_skip += 1
                    print("    Skipped (already in DB)")
                    time.sleep(2)
                    continue
                total_new += 1
                if source == "diarized":
                    total_diarized += 1
                    print(f"    OK [diarized]: {len(transcript):,} chars")
                else:
                    total_captions += 1
                    print(f"    OK [captions]: {len(transcript):,} chars")
            else:
                total_fail += 1
                print("    No transcript")

            time.sleep(2)

    conn.close()
    print(f"\n{'='*50}")
    print(f"DONE: {total_new} new ({total_diarized} diarized, {total_captions} captions)")
    print(f"      {total_skip} existing | {total_fail} failed")
    print(f"{'='*50}")
    finish_job(run_id, "ok", {"new": total_new, "diarized": total_diarized, "captions": total_captions, "failed": total_fail})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CVC Podcast Fetcher")
    parser.add_argument("max_per_channel", nargs="?", type=int, default=5)
    parser.add_argument("--captions-only", action="store_true",
                        help="Skip local diarization, use YouTube captions only")
    args = parser.parse_args()

    print("=" * 50)
    print(f"CVC Podcast Fetch — {args.max_per_channel} per channel")
    print(f"Mode: {'captions-only' if args.captions_only else 'diarize → captions fallback'}")
    print("=" * 50)
    run(args.max_per_channel, captions_only=args.captions_only)
