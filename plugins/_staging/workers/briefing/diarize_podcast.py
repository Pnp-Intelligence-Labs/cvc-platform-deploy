#!/usr/bin/env python3
"""
diarize_podcast.py — Local GPU transcription + speaker diarization.

Stack:
  WhisperX large-v3  — high-accuracy transcription with word timestamps
  Pyannote 3.1       — speaker diarization (requires HF_TOKEN)
  yt-dlp             — audio download

Output format:
  [SPEAKER_00]: First speaker text here.
  [SPEAKER_01]: Second speaker text here.
  ...

Requirements (Refinery only):
  - CUDA-capable GPU (RTX 3090)
  - HF_TOKEN env var (HuggingFace read token, model access accepted)
  - yt-dlp, whisperx, pyannote.audio installed

Called by fetch_podcasts.py. Falls back to YouTube captions if this fails.
"""

import os
import sys
import logging
import subprocess
import tempfile
import shutil
import torch
from typing import Optional

logger = logging.getLogger(__name__)

HF_TOKEN      = os.environ.get("HF_TOKEN", "")
WHISPER_MODEL = "large-v3"
DEVICE        = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE_TYPE  = "float16" if DEVICE == "cuda" else "int8"
BATCH_SIZE    = 16   # safe for RTX 3090 24GB VRAM with large-v3

# Module-level model cache — loaded once per process, reused across all videos
_whisper_model    = None
_align_model      = None
_align_metadata   = None
_align_lang       = None
_diarize_pipeline = None


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        import whisperx
        logger.info(f"diarize: loading WhisperX {WHISPER_MODEL} on {DEVICE} ({COMPUTE_TYPE})")
        _whisper_model = whisperx.load_model(
            WHISPER_MODEL, DEVICE, compute_type=COMPUTE_TYPE
        )
        logger.info("diarize: WhisperX model loaded")
    return _whisper_model


def _get_align_model(language: str):
    global _align_model, _align_metadata, _align_lang
    if _align_model is None or _align_lang != language:
        import whisperx
        logger.info(f"diarize: loading alignment model for lang={language}")
        _align_model, _align_metadata = whisperx.load_align_model(
            language_code=language, device=DEVICE
        )
        _align_lang = language
    return _align_model, _align_metadata


def _get_diarize_pipeline():
    global _diarize_pipeline
    if _diarize_pipeline is None:
        if not HF_TOKEN:
            raise RuntimeError(
                "HF_TOKEN not set — required for pyannote/speaker-diarization-3.1. "
                "Set HF_TOKEN and accept the model terms at huggingface.co."
            )
        from pyannote.audio import Pipeline
        logger.info("diarize: loading Pyannote speaker-diarization-3.1")
        _diarize_pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=HF_TOKEN,
        )
        _diarize_pipeline.to(torch.device(DEVICE))
        logger.info("diarize: Pyannote pipeline loaded")
    return _diarize_pipeline


def download_audio(youtube_url: str, output_dir: str) -> Optional[str]:
    """
    Download best-quality audio from YouTube using yt-dlp.
    Returns path to the downloaded .wav file, or None on failure.
    """
    output_template = os.path.join(output_dir, "audio.%(ext)s")
    # Resolve yt-dlp path — cron may have a stripped PATH that misses ~/.local/bin
    ytdlp_bin = (shutil.which("yt-dlp")
                 or os.path.expanduser("~/.local/bin/yt-dlp")
                 or "yt-dlp")
    cmd = [
        ytdlp_bin,
        "--format", "bestaudio",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "0",
        "--output", output_template,
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        youtube_url,
    ]
    try:
        subprocess.run(cmd, timeout=300, check=True, capture_output=True)
    except subprocess.TimeoutExpired:
        logger.warning(f"diarize: yt-dlp timed out for {youtube_url}")
        return None
    except subprocess.CalledProcessError as e:
        logger.warning(f"diarize: yt-dlp failed for {youtube_url}: {e.stderr.decode()[:200]}")
        return None

    # Find the output file (yt-dlp fills in the extension)
    for fname in os.listdir(output_dir):
        if fname.startswith("audio."):
            return os.path.join(output_dir, fname)

    logger.warning(f"diarize: yt-dlp ran but no audio file found in {output_dir}")
    return None


def _format_segments(result: dict) -> str:
    """
    Merge WhisperX segments (with speaker labels from Pyannote) into
    grouped speaker-turn text.

    Format: [SPEAKER_00]: text...\n[SPEAKER_01]: text...
    """
    lines = []
    current_speaker = None
    current_words = []

    for segment in result.get("segments", []):
        speaker = segment.get("speaker") or "SPEAKER_UNK"
        text = segment.get("text", "").strip()
        if not text:
            continue

        if speaker != current_speaker:
            if current_words and current_speaker:
                lines.append(f"[{current_speaker}]: {' '.join(current_words)}")
            current_speaker = speaker
            current_words = [text]
        else:
            current_words.append(text)

    if current_words and current_speaker:
        lines.append(f"[{current_speaker}]: {' '.join(current_words)}")

    return "\n".join(lines)


def transcribe_and_diarize(audio_path: str) -> Optional[str]:
    """
    Run WhisperX + Pyannote on a local audio file.
    Returns formatted diarized transcript, or None on failure.
    """
    import whisperx

    try:
        logger.info(f"diarize: transcribing {os.path.basename(audio_path)}")
        audio = whisperx.load_audio(audio_path)
        model = _get_whisper_model()
        # Force English — all CVC podcast channels are English.
        # Without this, short clips get misidentified by the 30s language detector.
        result = model.transcribe(audio, batch_size=BATCH_SIZE, language="en")

        # Early exit: if WhisperX VAD found no speech, skip diarization entirely.
        # Running diarize_pipeline on silent audio can trigger a CUDA SIGABRT.
        if not result.get("segments"):
            logger.warning("diarize: no speech segments after transcription — skipping diarization")
            return None

        language = "en"
        logger.info(f"diarize: language detected = {language}, aligning...")

        align_model, align_metadata = _get_align_model(language)
        result = whisperx.align(
            result["segments"], align_model, align_metadata, audio, DEVICE,
            return_char_alignments=False,
        )

        logger.info("diarize: running speaker diarization...")
        diarize_pipeline = _get_diarize_pipeline()
        # Use soundfile to load waveform — avoids torchcodec/torchaudio backend issues
        import soundfile as sf
        import numpy as np
        data, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
        waveform = torch.from_numpy(data.T)  # (channels, samples)
        diarize_segments = diarize_pipeline({"waveform": waveform, "sample_rate": sample_rate})

        # Convert DiarizeOutput → list of (start, end, speaker) tuples.
        # Pyannote 4.x wraps the Annotation inside DiarizeOutput.speaker_diarization
        annotation = (
            diarize_segments.speaker_diarization
            if hasattr(diarize_segments, "speaker_diarization")
            else diarize_segments
        )
        turns = [
            (seg.start, seg.end, spk)
            for seg, _, spk in annotation.itertracks(yield_label=True)
        ]

        if not turns:
            logger.warning("diarize: no speaker turns extracted from diarization output")
            return None

        logger.info(f"diarize: {len(turns)} speaker turns extracted, assigning to segments...")

        # Assign speaker to each transcript segment by midpoint overlap
        for segment in result.get("segments", []):
            seg_mid = (segment["start"] + segment["end"]) / 2
            best_spk = None
            best_overlap = 0.0
            for t_start, t_end, spk in turns:
                # Compute overlap between segment and turn
                overlap = min(segment["end"], t_end) - max(segment["start"], t_start)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_spk = spk
            if best_spk:
                segment["speaker"] = best_spk

        logger.info("diarize: speaker assignment complete")

        formatted = _format_segments(result)
        if len(formatted) < 200:
            logger.warning("diarize: output suspiciously short — treating as failure")
            return None

        return formatted

    except Exception as e:
        logger.warning(f"diarize: transcribe_and_diarize failed: {e}")
        return None


def diarize_youtube(youtube_url: str) -> Optional[str]:
    """
    Full pipeline: yt-dlp download → WhisperX transcription → Pyannote diarization.

    Returns formatted diarized text on success.
    Returns None on any failure (caller should fall back to YouTube captions).

    Audio is downloaded to a temp directory and cleaned up after processing.
    """
    if DEVICE == "cpu":
        logger.info("diarize: no GPU available — skipping local diarization")
        return None

    if not HF_TOKEN:
        logger.info("diarize: HF_TOKEN not set — skipping local diarization")
        return None

    tmpdir = tempfile.mkdtemp(prefix="cvc_diarize_")
    try:
        audio_path = download_audio(youtube_url, tmpdir)
        if not audio_path:
            return None

        file_size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        logger.info(f"diarize: audio downloaded ({file_size_mb:.1f} MB)")

        # Skip very short clips (< ~2 min of audio ≈ < 3 MB WAV)
        if file_size_mb < 3.0:
            logger.info("diarize: clip too short for diarization — falling back to captions")
            return None

        return transcribe_and_diarize(audio_path)

    finally:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


def unload_models() -> None:
    """Release GPU memory. Call between large batches if needed."""
    global _whisper_model, _align_model, _diarize_pipeline
    _whisper_model    = None
    _align_model      = None
    _diarize_pipeline = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    logger.info("diarize: models unloaded, GPU cache cleared")


# ── Standalone test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="Test local diarization on a YouTube URL")
    parser.add_argument("url", help="YouTube URL to diarize")
    parser.add_argument("--output", default=None, help="Write output to file instead of stdout")
    args = parser.parse_args()

    print(f"Device: {DEVICE} | Model: {WHISPER_MODEL} | HF_TOKEN: {'set' if HF_TOKEN else 'NOT SET'}")

    result = diarize_youtube(args.url)
    if result:
        if args.output:
            with open(args.output, "w") as f:
                f.write(result)
            print(f"Wrote {len(result):,} chars to {args.output}")
        else:
            print(f"\n{'='*60}\n{result[:3000]}\n{'='*60}")
            print(f"\nTotal: {len(result):,} chars")
    else:
        print("Diarization failed or skipped — check logs above")
        sys.exit(1)
