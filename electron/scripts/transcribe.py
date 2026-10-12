"""Transcribe an audio file with faster-whisper and stream JSON lines to stdout.

Each stdout line is one JSON object:
  {"type": "info", "device": ..., "language": ..., "duration": ...}
  {"type": "segment", "start": s, "end": s, "text": ..., "words": [...]}
  {"type": "warn", "message": ...}
  {"type": "done", "count": n}
  {"type": "error", "message": ...}

`--check` only reports whether faster-whisper imports and how many CUDA devices
CTranslate2 can see, so the app can show an environment panel without loading
a model.
"""
import argparse
import glob
import json
import os
import sys


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def add_cuda_dll_dirs():
    # pip's nvidia-cublas-cu12 / nvidia-cudnn-cu12 ship their DLLs under
    # site-packages/nvidia/*/bin, which Windows will not search on its own.
    try:
        import nvidia  # namespace package, only present when the wheels are installed
    except ImportError:
        return
    for root in list(getattr(nvidia, "__path__", [])):
        for bin_dir in glob.glob(os.path.join(root, "*", "bin")):
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(bin_dir)


def check():
    add_cuda_dll_dirs()
    try:
        import faster_whisper
        import ctranslate2
    except ImportError as exc:
        emit({"type": "check", "ok": False, "error": str(exc)})
        return 0
    emit({
        "type": "check",
        "ok": True,
        "version": faster_whisper.__version__,
        "cudaDevices": ctranslate2.get_cuda_device_count(),
    })
    return 0


def load_wav(path):
    # The app always hands us 16 kHz mono s16 WAV from ffmpeg, so read it with
    # the stdlib instead of faster-whisper's PyAV decoder, whose keyword
    # arguments break across PyAV releases (av 19 dropped `metadata_errors`).
    import wave
    import numpy as np

    with wave.open(path, "rb") as wav:
        if wav.getframerate() != 16000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        frames = wav.readframes(wav.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


SAMPLE_RATE = 16000
CANDIDATE_LANGUAGES = ("zh", "en")


def pick_language(model, audio):
    # Restrict detection to Chinese vs English: short clips otherwise drift
    # to Japanese/Cantonese/etc. on a single ambiguous word.
    _, _, probs = model.detect_language(audio)
    scores = dict(probs)
    return max(CANDIDATE_LANGUAGES, key=lambda lang: scores.get(lang, 0.0))


def transcribe(args):
    add_cuda_dll_dirs()
    from faster_whisper import WhisperModel
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    compute_type = "float16" if args.device == "cuda" else "int8"
    model = WhisperModel(args.model, device=args.device, compute_type=compute_type)
    audio = load_wav(args.audio)
    forced = None if args.language in (None, "", "auto") else args.language

    # Whisper picks one language per 30 s window, so a Chinese sentence
    # inside an English window is silently dropped. Cutting at pauses and
    # detecting the language per utterance keeps mixed zh/en speech intact.
    chunks = get_speech_timestamps(
        audio,
        VadOptions(min_silence_duration_ms=500, max_speech_duration_s=25, speech_pad_ms=200),
    )
    emit({
        "type": "info",
        "device": args.device,
        "language": forced or "auto",
        "duration": round(len(audio) / SAMPLE_RATE, 3),
    })

    count = 0
    for chunk in chunks:
        piece = audio[chunk["start"]:chunk["end"]]
        offset = chunk["start"] / SAMPLE_RATE
        language = forced or pick_language(model, piece)
        segments, _ = model.transcribe(
            piece,
            language=language,
            word_timestamps=True,
            vad_filter=False,
            beam_size=5,
            # Conditioning on earlier text makes long recordings drift into
            # repetition loops; each utterance stands on its own.
            condition_on_previous_text=False,
        )
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            count += 1
            words = [
                {"start": round(offset + w.start, 3), "end": round(offset + w.end, 3), "word": w.word}
                for w in (seg.words or [])
            ]
            emit({
                "type": "segment",
                "start": round(offset + seg.start, 3),
                "end": round(offset + seg.end, 3),
                "lang": language,
                "text": text,
                "words": words,
            })
        emit({"type": "progress", "t": round(chunk["end"] / SAMPLE_RATE, 3)})
    emit({"type": "done", "count": count})
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="?")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--language", default="auto")
    args = parser.parse_args()

    if args.check:
        return check()
    if not args.audio:
        emit({"type": "error", "message": "missing audio path"})
        return 2
    try:
        return transcribe(args)
    except Exception as exc:  # surface model/CUDA failures to the app as JSON
        emit({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
