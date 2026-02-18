import os
import json
import uuid
import shutil
import subprocess
import torch
import torchaudio

from flask import Flask, request, jsonify
from difflib import SequenceMatcher
from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC

# Level 2 (G2P)
from g2p_en import G2p

# MFA TextGrid parsing
import textgrid



# CONFIG

ASR_NAME = "facebook/wav2vec2-base-960h"

# Your app folder on VM (important for service)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Temp paths (simple; later you can make per-request unique)
RAW_PATH = "/tmp/input_audio"
WAV_PATH = "/tmp/audio_16k.wav"

# MFA settings (Docker-based)
MFA_ENABLED = True  # set False if you want to temporarily disable MFA
MFA_IMAGE = "mmcauliffe/montreal-forced-aligner:latest"

MFA_DIR = os.path.join(BASE_DIR, "mfa")
MFA_CORPUS_ROOT = os.path.join(MFA_DIR, "corpus")
MFA_OUTPUT_ROOT = os.path.join(MFA_DIR, "output")
MFA_MODELS_ROOT = os.path.join(MFA_DIR, "models")

# These model names commonly work in MFA v3+.
# If your MFA container uses different names, you can change here.
MFA_ACOUSTIC_MODEL = "english_mfa"
MFA_DICTIONARY_MODEL = "english_us_mfa"



# LOAD ASR ONCE

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

processor = Wav2Vec2Processor.from_pretrained(ASR_NAME)
model = Wav2Vec2ForCTC.from_pretrained(ASR_NAME)
model.to(device)
model.eval()

# G2P object (Level 2)
g2p = G2p()

VOWELS = {"a", "e", "i", "o", "u"}



# LOAD EXERCISE BANK / PHONEME INVENTORY

with open(os.path.join(BASE_DIR, "exercise_bank.json"), "r", encoding="utf-8") as f:
    exercise_bank = json.load(f)

# The phoneme keys you support (p, b, sh, th, etc.)
PHONEMES = list(exercise_bank.keys())



# UTILITY FUNCTIONS

def calculate_severity(expected, predicted):
    """Severity based on string similarity (0 best)."""
    return 1 - SequenceMatcher(None, expected, predicted).ratio()


def detect_soda(expected, predicted):
    """
    Improved SODA classification using edit operations.
    Returns: Correct / Substitution / Omission / Addition / Mixed (or combos)
    """
    if expected == predicted:
        return "Correct"

    matcher = SequenceMatcher(None, expected, predicted)
    ops = [tag for tag, *_ in matcher.get_opcodes() if tag != "equal"]

    # Pure types
    if ops and all(op == "replace" for op in ops):
        return "Substitution"
    if ops and all(op == "delete" for op in ops):
        return "Omission"
    if ops and all(op == "insert" for op in ops):
        return "Addition"

    # Mixed types (common)
    if "replace" in ops and "delete" in ops and "insert" not in ops:
        return "Omission+Substitution"
    if "replace" in ops and "insert" in ops and "delete" not in ops:
        return "Addition+Substitution"
    if "insert" in ops and "delete" in ops and "replace" not in ops:
        return "Addition+Omission"

    return "Mixed"


def phoneme_position(word, phoneme):
    """initial / medial / final based on where phoneme occurs in the expected word string."""
    idx = word.find(phoneme)
    if idx == 0:
        return "initial"
    if idx != -1 and idx + len(phoneme) == len(word):
        return "final"
    return "medial"


def get_mismatched_phoneme(expected, predicted, phoneme_list):
    """
    Your existing phoneme inference:
    Uses mismatch segments in expected vs predicted (text), tries to match your phoneme keys.
    """
    matcher = SequenceMatcher(None, expected, predicted)
    for tag, i1, i2, _, _ in matcher.get_opcodes():
        if tag in ("replace", "delete", "insert"):
            segment = expected[i1:i2]
            for p in sorted(phoneme_list, key=len, reverse=True):
                if segment.startswith(p):
                    return p
    return None


def build_cv(word, base):
    """Build CV like ra/no/thu etc if vowel follows."""
    idx = word.find(base)
    if idx != -1 and idx + len(base) < len(word):
        nxt = word[idx + len(base)]
        if nxt in VOWELS:
            return base + nxt
    return base


def therapy_level_from_severity(sev):
    if sev >= 0.75:
        return "high"
    if sev >= 0.40:
        return "medium"
    return "low"



# AUDIO NORMALIZATION (m4a/mp3/wav -> WAV 16k mono)

def convert_to_wav_16k_mono(input_path, output_path):
    """
    Converts input audio (m4a/mp3/wav/etc) to WAV PCM 16kHz mono using ffmpeg.
    Requires ffmpeg installed on server.
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-ac", "1",
        "-ar", "16000",
        "-f", "wav",
        output_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)



# LEVEL 2 (G2P) — phoneme sequences from text

def g2p_clean(phoneme_list):
    """
    g2p_en returns tokens that can include punctuation/spaces.
    Keep only alphabetic phoneme tokens.
    """
    cleaned = []
    for p in phoneme_list:
        p = str(p).strip()
        if p.isalpha():
            cleaned.append(p)
    return cleaned


def phoneme_severity(expected_word, predicted_word):
    """
    Compare expected vs predicted at phoneme-sequence level (Level 2).
    Returns (exp_ph, pred_ph, sev_ph)
    """
    exp_ph = g2p_clean(g2p(expected_word))
    pred_ph = g2p_clean(g2p(predicted_word))
    sev_ph = 1 - SequenceMatcher(None, exp_ph, pred_ph).ratio()
    return exp_ph, pred_ph, sev_ph


def first_mismatched_phoneme(exp_ph, pred_ph):
    """
    Find first mismatched phoneme token from expected phoneme sequence.
    """
    matcher = SequenceMatcher(None, exp_ph, pred_ph)
    for tag, i1, i2, _, _ in matcher.get_opcodes():
        if tag in ("replace", "delete") and i1 < len(exp_ph):
            return exp_ph[i1], i1
    return None, None



# ASR (Wav2Vec2)

def analyze_pronunciation(wav_path, expected):
    wav, sr = torchaudio.load(wav_path)

    if wav.ndim > 1 and wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)

    if sr != 16000:
        wav = torchaudio.transforms.Resample(sr, 16000)(wav)

    wav = wav[:, :16000 * 4]  # max 4 sec

    inputs = processor(
        wav.squeeze(),
        sampling_rate=16000,
        return_tensors="pt"
    ).to(device)

    with torch.no_grad():
        logits = model(**inputs).logits

    pred_ids = torch.argmax(logits, dim=-1)
    predicted = processor.decode(pred_ids[0]).lower().strip()

    # Text-level severity (your current approach)
    sev_text = calculate_severity(expected, predicted)

    # Improved SODA type (text edits)
    error_type = detect_soda(expected, predicted)

    return predicted, error_type, sev_text



# MFA (Forced Alignment) — Hybrid timestamps

def ensure_mfa_dirs():
    os.makedirs(MFA_CORPUS_ROOT, exist_ok=True)
    os.makedirs(MFA_OUTPUT_ROOT, exist_ok=True)
    os.makedirs(MFA_MODELS_ROOT, exist_ok=True)


def ensure_mfa_models_downloaded():
    """
    Download MFA dictionary + acoustic model once into MFA_MODELS_ROOT.
    This keeps it cached across runs.
    """
    ensure_mfa_dirs()

    # Download to /models mounted volume
    cmd = [
        "docker", "run", "--rm",
        "-v", f"{MFA_MODELS_ROOT}:/models",
        MFA_IMAGE,
        "bash", "-lc",
        (
            "mfa model download acoustic "
            f"{MFA_ACOUSTIC_MODEL} -o /models && "
            "mfa model download dictionary "
            f"{MFA_DICTIONARY_MODEL} -o /models"
        )
    ]
    subprocess.run(cmd, check=True)


def run_mfa_alignment(wav_path, transcript_text):
    """
    Create a tiny MFA corpus:
      corpus/<job>/sample.wav
      corpus/<job>/sample.txt

    Run alignment inside Docker and return path to TextGrid.
    """
    ensure_mfa_dirs()
    job_id = str(uuid.uuid4())

    corpus_dir = os.path.join(MFA_CORPUS_ROOT, job_id)
    out_dir = os.path.join(MFA_OUTPUT_ROOT, job_id)
    os.makedirs(corpus_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    base = "sample"
    wav_dst = os.path.join(corpus_dir, f"{base}.wav")
    txt_dst = os.path.join(corpus_dir, f"{base}.txt")

    shutil.copyfile(wav_path, wav_dst)
    with open(txt_dst, "w", encoding="utf-8") as f:
        f.write(transcript_text.strip() + "\n")

    # In MFA Docker, dictionary is usually *.dict and acoustic is *.zip in /models
    dict_path = os.path.join("/models", f"{MFA_DICTIONARY_MODEL}.dict")
    acoustic_path = os.path.join("/models", f"{MFA_ACOUSTIC_MODEL}.zip")

    cmd = [
        "docker", "run", "--rm",
        "-v", f"{corpus_dir}:/corpus",
        "-v", f"{out_dir}:/output",
        "-v", f"{MFA_MODELS_ROOT}:/models",
        MFA_IMAGE,
        "bash", "-lc",
        (
            "mfa align /corpus "
            f"{dict_path} {acoustic_path} "
            "/output --clean --overwrite"
        )
    ]
    subprocess.run(cmd, check=True)

    tg_path = os.path.join(out_dir, f"{base}.TextGrid")
    return tg_path, corpus_dir, out_dir


def pick_phone_tier(tg):
    """
    MFA TextGrid typically has a phones tier. Try to find it.
    """
    for t in tg.tiers:
        if "phone" in t.name.lower():
            return t
    return tg.tiers[0] if tg.tiers else None


# Basic mapping from your phoneme bank labels to common ARPAbet phones.
# This is not perfect but helps. You can expand later.
THERAPY_TO_ARPA = {
    "p": "P", "b": "B", "t": "T", "d": "D", "k": "K", "g": "G",
    "m": "M", "n": "N", "ng": "NG",
    "f": "F", "v": "V", "s": "S", "z": "Z",
    "sh": "SH", "zh": "ZH",
    "ch": "CH", "j": "JH",
    "l": "L", "r": "R",
    "w": "W", "y": "Y", "h": "HH",
    "th": "TH", "dh": "DH",
}

def find_phone_timestamp(textgrid_path, therapy_phoneme):
    """
    Find the first time interval for the requested phoneme in the TextGrid.
    Uses a simple therapy->ARPAbet map.
    Returns (start, end) or (None, None).
    """
    if not therapy_phoneme:
        return None, None

    arpa = THERAPY_TO_ARPA.get(therapy_phoneme, therapy_phoneme).lower()

    tg = textgrid.TextGrid.fromFile(textgrid_path)
    tier = pick_phone_tier(tg)
    if tier is None:
        return None, None

    for interval in tier.intervals:
        label = (interval.mark or "").strip().lower()
        if label == arpa:
            return float(interval.minTime), float(interval.maxTime)

    return None, None



# FLASK APP

app = Flask(__name__)

@app.route("/analyze", methods=["POST"])
def analyze():
    try:
        
        # VALIDATIONS
        
        audio = request.files.get("audio")
        expected = request.form.get("expected_text")

        if audio is None and (expected is None or expected.strip() == ""):
            return jsonify({"error": "Both audio and expected_text are required"}), 400

        if audio is None:
            return jsonify({"error": "Audio file is required"}), 400

        if expected is None or expected.strip() == "":
            return jsonify({"error": "expected_text is required"}), 400

        if audio.filename == "":
            return jsonify({"error": "Audio file is empty"}), 400

        expected = expected.strip().lower()

        
        # SAVE + CONVERT AUDIO
        
        audio.save(RAW_PATH)

        try:
            convert_to_wav_16k_mono(RAW_PATH, WAV_PATH)
        except Exception:
            return jsonify({
                "error": "Audio conversion failed",
                "details": "Install ffmpeg and ensure file is valid (m4a/mp3/wav)."
            }), 400

        
        # 1) ASR + TEXT-LEVEL ANALYSIS
        
        predicted, error_type, sev_text = analyze_pronunciation(WAV_PATH, expected)
        is_correct = (error_type == "Correct")

        
        # 2) LEVEL-2 (G2P) PHONEME ANALYSIS
        
        exp_ph, pred_ph, sev_ph = phoneme_severity(expected, predicted)
        mismatch_ph, mismatch_idx = first_mismatched_phoneme(exp_ph, pred_ph)

        
        # 3) YOUR THERAPY PHONEME INFERENCE (bank-based)
        
        base_phoneme = None
        target_phoneme = None
        phoneme_pos = None

        if not is_correct:
            base_phoneme = get_mismatched_phoneme(expected, predicted, PHONEMES)
            if base_phoneme:
                target_phoneme = build_cv(expected, base_phoneme)
                phoneme_pos = phoneme_position(expected, base_phoneme)

        
        # 4) HYBRID MFA ALIGNMENT (timestamps)
        
        mfa_enabled_request = request.args.get("mfa", "true").lower() == "true"
        tg_start = None
        tg_end = None

        # We align expected_text to audio (therapy target alignment)
        if MFA_ENABLED and mfa_enabled_request:
            try:
                ensure_mfa_models_downloaded()
                tg_path, corpus_dir, out_dir = run_mfa_alignment(WAV_PATH, expected)

                # Find timestamps for your detected base phoneme (mapped to ARPA)
                tg_start, tg_end = find_phone_timestamp(tg_path, base_phoneme)

                # Cleanup MFA artifacts
                shutil.rmtree(corpus_dir, ignore_errors=True)
                shutil.rmtree(out_dir, ignore_errors=True)
            except Exception:
                # MFA failure should NOT break your whole API
                tg_start, tg_end = None, None

        
        # CLEANUP TEMP FILES
        
        for p in (RAW_PATH, WAV_PATH):
            if os.path.exists(p):
                os.remove(p)

        
        # FINAL SEVERITY / LEVEL
        
        # You can choose to use sev_text or sev_ph. Here we keep core idea (sev_text)
        # but also return sev_ph for research reporting.
        therapy_level = therapy_level_from_severity(sev_text)

        return jsonify({
            "expected": expected,
            "predicted": predicted,

            "is_correct": is_correct,
            "error_type": error_type,

            # Severity signals
            "severity_text": round(sev_text, 2),
            "severity_phoneme": round(sev_ph, 2),

            "therapy_level": therapy_level,

            # Therapy phoneme inference (your bank)
            "base_phoneme": base_phoneme,
            "target_phoneme": target_phoneme,
            "phoneme_position": phoneme_pos,

            # Level-2 G2P phonemes (for explainability / research)
            "expected_phonemes": exp_ph,
            "predicted_phonemes": pred_ph,
            "first_mismatched_phoneme": mismatch_ph,
            "mismatched_phoneme_position": (
                "initial" if mismatch_idx == 0 else
                "final" if mismatch_idx is not None and mismatch_idx == len(exp_ph) - 1 else
                "medial" if mismatch_idx is not None else None
            ),

            # MFA timestamps (Hybrid)
            "mfa_enabled": (MFA_ENABLED and mfa_enabled_request),
            "target_phoneme_start": tg_start,
            "target_phoneme_end": tg_end
        })

    except Exception as e:
        # Always return JSON, not HTML
        return jsonify({"error": "Internal server error", "details": str(e)}), 500
