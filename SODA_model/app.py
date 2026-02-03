# import torch
# import torchaudio
# from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
# from flask import Flask, request, jsonify
# from difflib import SequenceMatcher
# import json, os

# # =============================
# # LOAD MODEL ONCE (VM)
# # =============================
# device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base-960h")
# model = Wav2Vec2ForCTC.from_pretrained("facebook/wav2vec2-base-960h")
# model.to(device)
# model.eval()

# VOWELS = {"a","e","i","o","u"}

# # =============================
# # UTILS
# # =============================
# def severity(exp, pred):
#     return 1 - SequenceMatcher(None, exp, pred).ratio()

# def soda_type(exp, pred):
#     return "Correct" if exp == pred else "Substitution"

# def phoneme_position(word, phoneme):
#     i = word.find(phoneme)
#     if i == 0: return "initial"
#     if i + len(phoneme) == len(word): return "final"
#     return "medial"

# def get_phoneme(exp, pred, phonemes):
#     matcher = SequenceMatcher(None, exp, pred)
#     for tag, i1, i2, _, _ in matcher.get_opcodes():
#         if tag in ("replace","delete","insert"):
#             seg = exp[i1:i2]
#             for p in sorted(phonemes, key=len, reverse=True):
#                 if seg.startswith(p):
#                     return p
#     return None

# def build_cv(word, base):
#     i = word.find(base)
#     if i != -1 and i+len(base) < len(word):
#         if word[i+len(base)] in VOWELS:
#             return base + word[i+len(base)]
#     return base

# # =============================
# # ANALYSIS
# # =============================
# def analyze(audio_path, expected):
#     wav, sr = torchaudio.load(audio_path)
#     if wav.shape[0] > 1:
#         wav = wav.mean(dim=0, keepdim=True)

#     if sr != 16000:
#         wav = torchaudio.transforms.Resample(sr,16000)(wav)

#     wav = wav[:, :16000*4]

#     inputs = processor(
#         wav.squeeze(),
#         sampling_rate=16000,
#         return_tensors="pt"
#     ).to(device)

#     with torch.no_grad():
#         logits = model(**inputs).logits

#     pred_ids = torch.argmax(logits, dim=-1)
#     predicted = processor.decode(pred_ids[0]).lower().strip()

#     return predicted, soda_type(expected,predicted), severity(expected,predicted)

# # =============================
# # FLASK API
# # =============================
# app = Flask(__name__)

# with open("exercise_bank.json") as f:
#     bank = json.load(f)

# PHONEMES = list(bank.keys())

# @app.route("/analyze", methods=["POST"])
# def analyze_api():
#     if "audio" not in request.files:
#         return jsonify({"error":"audio required"}),400

#     expected = request.form.get("expected_text")
#     if not expected:
#         return jsonify({"error":"expected_text required"}),400

#     path = "/tmp/audio.wav"
#     request.files["audio"].save(path)

#     predicted, error, sev = analyze(path, expected.lower())
#     base = get_phoneme(expected.lower(), predicted, PHONEMES)

#     result = {
#         "expected": expected,
#         "predicted": predicted,
#         "error_type": error,
#         "severity": round(sev,2),
#         "therapy_level": "high" if sev>=0.75 else "medium" if sev>=0.4 else "low",
#         "base_phoneme": base,
#         "target_phoneme": build_cv(expected.lower(), base) if base else None,
#         "phoneme_position": phoneme_position(expected.lower(), base) if base else None
#     }

#     os.remove(path)
#     return jsonify(result)



import torch
import torchaudio
from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
from flask import Flask, request, jsonify
from difflib import SequenceMatcher
import json, os

# =============================
# LOAD MODEL ONCE
# =============================
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base-960h")
model = Wav2Vec2ForCTC.from_pretrained("facebook/wav2vec2-base-960h")
model.to(device)
model.eval()

VOWELS = {"a", "e", "i", "o", "u"}

# =============================
# UTILITY FUNCTIONS
# =============================
def calculate_severity(expected, predicted):
    return 1 - SequenceMatcher(None, expected, predicted).ratio()

def detect_soda(expected, predicted):
    return "Correct" if expected == predicted else "Substitution"

def phoneme_position(word, phoneme):
    idx = word.find(phoneme)
    if idx == 0:
        return "initial"
    if idx + len(phoneme) == len(word):
        return "final"
    return "medial"

def get_mismatched_phoneme(expected, predicted, phoneme_list):
    matcher = SequenceMatcher(None, expected, predicted)

    for tag, i1, i2, _, _ in matcher.get_opcodes():
        if tag in ("replace", "delete", "insert"):
            segment = expected[i1:i2]
            for p in sorted(phoneme_list, key=len, reverse=True):
                if segment.startswith(p):
                    return p
    return None

def build_cv(word, base):
    idx = word.find(base)
    if idx != -1 and idx + len(base) < len(word):
        if word[idx + len(base)] in VOWELS:
            return base + word[idx + len(base)]
    return base

# =============================
# PRONUNCIATION ANALYSIS
# =============================
def analyze_pronunciation(audio_path, expected):
    wav, sr = torchaudio.load(audio_path)

    if wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)

    if sr != 16000:
        wav = torchaudio.transforms.Resample(sr, 16000)(wav)

    wav = wav[:, :16000 * 4]  # max 4 seconds

    inputs = processor(
        wav.squeeze(),
        sampling_rate=16000,
        return_tensors="pt"
    ).to(device)

    with torch.no_grad():
        logits = model(**inputs).logits

    pred_ids = torch.argmax(logits, dim=-1)
    predicted = processor.decode(pred_ids[0]).lower().strip()

    severity = calculate_severity(expected, predicted)
    error_type = detect_soda(expected, predicted)

    return predicted, error_type, severity

# =============================
# FLASK APP
# =============================
app = Flask(__name__)

with open("exercise_bank.json") as f:
    exercise_bank = json.load(f)

PHONEMES = list(exercise_bank.keys())

@app.route("/analyze", methods=["POST"])
def analyze():

    # ----------------------------------
    # VALIDATIONS (AS REQUESTED)
    # ----------------------------------

    # 1. Validate request format
    if not request.content_type or "multipart/form-data" not in request.content_type:
        return jsonify({
            "error": "Invalid request format. multipart/form-data required"
        }), 400

    audio = request.files.get("audio")
    expected = request.form.get("expected_text")

    # 2. Neither audio nor expected_text sent
    if audio is None and expected is None:
        return jsonify({
            "error": "Both audio file and expected_text are required"
        }), 400

    # 3. Audio missing
    if audio is None:
        return jsonify({
            "error": "Audio file is required"
        }), 400

    # 4. Expected text missing
    if expected is None:
        return jsonify({
            "error": "expected_text is required"
        }), 400

    # 5. Empty audio file
    if audio.filename == "":
        return jsonify({
            "error": "Audio file is empty"
        }), 400

    # 6. Empty expected text
    expected = expected.strip()
    if expected == "":
        return jsonify({
            "error": "expected_text cannot be empty"
        }), 400

    # ----------------------------------
    # PROCESSING
    # ----------------------------------
    audio_path = "/tmp/audio.wav"
    audio.save(audio_path)

    predicted, error_type, severity = analyze_pronunciation(
        audio_path, expected.lower()
    )

    is_correct = error_type == "Correct"

    base_phoneme = None
    target_phoneme = None
    phoneme_pos = None

    if not is_correct:
        base_phoneme = get_mismatched_phoneme(
            expected.lower(),
            predicted,
            PHONEMES
        )

        if base_phoneme:
            target_phoneme = build_cv(expected.lower(), base_phoneme)
            phoneme_pos = phoneme_position(expected.lower(), base_phoneme)

    if os.path.exists(audio_path):
        os.remove(audio_path)

    return jsonify({
        "expected": expected,
        "predicted": predicted,
        "is_correct": is_correct,
        "error_type": error_type,
        "severity": round(severity, 2),
        "therapy_level": (
            "high" if severity >= 0.75 else
            "medium" if severity >= 0.4 else
            "low"
        ),
        "base_phoneme": base_phoneme,
        "target_phoneme": target_phoneme,
        "phoneme_position": phoneme_pos
    })
