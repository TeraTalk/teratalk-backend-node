"""
Merged SODA speech therapy analysis API.

Default behavior:
- `POST /analyze` runs the **advanced** pipeline matching `app.py`'s `POST /analyze?advanced=true`.
- `POST /analyze?advanced=true` runs the **advanced** pipeline matching `app_optimized.py`'s `POST /analyze?advanced=true`.
- `POST /analyze?advanced=false` runs basic-only analysis (optimized pipeline).

This file is a merged/updated entrypoint based on `app_optimized.py`, adapted
to work on Windows (temp dir) and to default to advanced mode.
"""

import json
import logging
import math
import os
import subprocess
import tempfile
import uuid
from difflib import SequenceMatcher
from functools import lru_cache
from itertools import zip_longest
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import torch
import torchaudio
import torch.nn.functional as F
from flask import Flask, jsonify, request
from g2p_en import G2p
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# CONFIG
ASR_MODEL_WAV2VEC2 = "facebook/wav2vec2-base-960h"
BASE_DIR = Path(__file__).parent
TEMP_DIR = Path(tempfile.gettempdir())
MAX_AUDIO_DURATION_SEC = 4
SAMPLE_RATE = 16000
MAX_WORD_LENGTH = 30

VOWELS = {"a", "e", "i", "o", "u"}

PHONEME_FEATURES = {
    "p": {"place": "bilabial", "manner": "stop", "tongue": "bilabial", "voiced": False},
    "b": {"place": "bilabial", "manner": "stop", "tongue": "bilabial", "voiced": True},
    "t": {"place": "alveolar", "manner": "stop", "tongue": "alveolar", "voiced": False},
    "d": {"place": "alveolar", "manner": "stop", "tongue": "alveolar", "voiced": True},
    "k": {"place": "velar", "manner": "stop", "tongue": "velar", "voiced": False},
    "g": {"place": "velar", "manner": "stop", "tongue": "velar", "voiced": True},
    "s": {"place": "alveolar", "manner": "fricative", "tongue": "alveolar", "voiced": False},
    "z": {"place": "alveolar", "manner": "fricative", "tongue": "alveolar", "voiced": True},
    "f": {
        "place": "labiodental",
        "manner": "fricative",
        "tongue": "labiodental",
        "voiced": False,
    },
    "v": {
        "place": "labiodental",
        "manner": "fricative",
        "tongue": "labiodental",
        "voiced": True,
    },
    "th": {"place": "dental", "manner": "fricative", "tongue": "dental", "voiced": False},
    "dh": {"place": "dental", "manner": "fricative", "tongue": "dental", "voiced": True},
    "sh": {"place": "postalveolar", "manner": "fricative", "tongue": "postalveolar", "voiced": False},
    "ch": {"place": "postalveolar", "manner": "affricate", "tongue": "postalveolar", "voiced": False},
    "jh": {"place": "postalveolar", "manner": "affricate", "tongue": "postalveolar", "voiced": True},
    "zh": {"place": "postalveolar", "manner": "fricative", "tongue": "postalveolar", "voiced": True},
    "hh": {"place": "glottal", "manner": "fricative", "tongue": "glottal", "voiced": False},
    "r": {"place": "alveolar", "manner": "liquid", "tongue": "alveolar", "voiced": True},
    "l": {"place": "alveolar", "manner": "liquid", "tongue": "alveolar", "voiced": True},
    "w": {"place": "bilabial", "manner": "glide", "tongue": "bilabial", "voiced": True},
    "y": {"place": "palatal", "manner": "glide", "tongue": "palatal", "voiced": True},
    "m": {"place": "bilabial", "manner": "nasal", "tongue": "bilabial", "voiced": True},
    "n": {"place": "alveolar", "manner": "nasal", "tongue": "alveolar", "voiced": True},
    "ng": {"place": "velar", "manner": "nasal", "tongue": "velar", "voiced": True},
}

TONGUE_FEEDBACK = {
    "alveolar": "Place the tongue tip behind the upper front teeth.",
    "bilabial": "Use both lips together.",
    "labiodental": "Gently touch the upper teeth to the lower lip (e.g., for /f/ and /v/).",
    "dental": "Place the tongue tip lightly between the teeth (e.g., for /th/).",
    "velar": "Raise the back of the tongue toward the soft palate.",
    "palatal": "Raise the tongue toward the hard palate.",
    "postalveolar": "Curl the tongue slightly behind the alveolar ridge.",
    "glottal": "Keep the throat open and let air flow from the voice box (e.g., /h/).",
}

PROCESS_LIBRARY: Dict[str, Dict[str, str]] = {
    "gliding": {
        "label": "Gliding",
        "description": "Liquids like /r/ or /l/ are produced as glides (often /w/ or /y/).",
        "therapy_focus": "Work on lip rounding vs. tongue shaping for /r,l/; start with syllables and minimal pairs.",
    },
    "stopping": {
        "label": "Stopping",
        "description": "Fricatives/affricates are produced as stops (airflow is stopped instead of continuous).",
        "therapy_focus": "Cue continuous airflow (“long sound”) for fricatives; use visual airflow cues (tissue, hand).",
    },
    "fronting": {
        "label": "Fronting",
        "description": "Back sounds (velars /k,g/) are produced as front sounds (often /t,d/).",
        "therapy_focus": "Cue tongue-back lift (\"back sound\"); try /k/ in isolation then CV (ku, ka).",
    },
    "backing": {
        "label": "Backing",
        "description": "Front sounds (often alveolars /t,d/) are produced as back sounds (often /k,g/).",
        "therapy_focus": "Cue tongue-tip placement behind teeth; contrast /t/ vs /k/ with tactile cues.",
    },
    "voicing": {
        "label": "Voicing",
        "description": "Voiceless sounds are produced as voiced sounds (e.g., /t/→/d/).",
        "therapy_focus": "Use hand-on-throat cue to feel voice on/off; practice minimal pairs.",
    },
    "devoicing": {
        "label": "Devoicing",
        "description": "Voiced sounds are produced as voiceless sounds (e.g., /b/→/p/).",
        "therapy_focus": "Cue vibration for voiced targets; elongate voiced sounds where possible (e.g., /z/).",
    },
    "deaffrication": {
        "label": "Deaffrication",
        "description": "Affricates (like /ch/) are produced as fricatives or stops.",
        "therapy_focus": "Shape the stop+fricative sequence; start with \"t\" + \"sh\" blended to /ch/.",
    },
    "palatalization": {
        "label": "Palatalization",
        "description": "Alveolars (like /s/) shift toward palatal/postalveolar (like /sh/).",
        "therapy_focus": "Cue tongue groove and \"smile\" lips for /s/; contrast /s/ vs /sh/ in minimal pairs.",
    },
    "depalatalization": {
        "label": "Depalatalization",
        "description": "Postalveolars (like /sh/) shift toward alveolars (like /s/).",
        "therapy_focus": "Cue tongue retraction and rounding for /sh/; use \"quiet\" /sh/ vs \"snake\" /s/ contrast.",
    },
}

# LOAD MODELS
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
logger.info(f"Using device: {device}")

wav2vec2_processor = Wav2Vec2Processor.from_pretrained(ASR_MODEL_WAV2VEC2)
wav2vec2_model = Wav2Vec2ForCTC.from_pretrained(ASR_MODEL_WAV2VEC2).to(device)
wav2vec2_model.eval()

g2p = G2p()


def extract_phonemes_from_bank(bank: Dict[str, Any]) -> List[str]:
    phonemes: List[str] = []
    if "consonants" in bank:
        for category in bank["consonants"].values():
            if isinstance(category, dict):
                phonemes.extend(category.keys())
    if "vowels" in bank:
        for category in bank["vowels"].values():
            if isinstance(category, dict):
                phonemes.extend(category.keys())
    if "diphthongs" in bank and isinstance(bank["diphthongs"], dict):
        phonemes.extend(bank["diphthongs"].keys())
    return phonemes


try:
    with open(BASE_DIR / "exercise_bank.json", "r", encoding="utf-8") as f:
        exercise_bank = json.load(f)
    if isinstance(exercise_bank, dict) and "metadata" in exercise_bank:
        PHONEMES = extract_phonemes_from_bank(exercise_bank)
        logger.info(f"Loaded {len(PHONEMES)} phonemes from enhanced exercise bank")
    else:
        PHONEMES = list(exercise_bank.keys()) if isinstance(exercise_bank, dict) else []
        logger.info(f"Loaded {len(PHONEMES)} phonemes from exercise bank (legacy format)")
except FileNotFoundError:
    logger.warning("exercise_bank.json not found, using empty phoneme list")
    PHONEMES = []
except Exception as e:
    logger.error(f"Error loading exercise bank: {e}")
    PHONEMES = []


def calculate_severity(a: Any, b: Any) -> float:
    if not a and not b:
        return 0.0
    if not a or not b:
        return 1.0
    return 1 - SequenceMatcher(None, a, b).ratio()


def detect_soda(expected: str, predicted: str) -> str:
    if expected == predicted:
        return "Correct"
    matcher = SequenceMatcher(None, expected, predicted)
    ops = [tag for tag, *_ in matcher.get_opcodes() if tag != "equal"]
    if not ops:
        return "Correct"
    if all(op == "replace" for op in ops):
        return "Substitution"
    if all(op == "delete" for op in ops):
        return "Omission"
    if all(op == "insert" for op in ops):
        return "Addition"
    return "Mixed"


def phoneme_position(word: str, phoneme: str) -> Optional[str]:
    idx = word.find(phoneme)
    if idx == -1:
        return None
    if idx == 0:
        return "initial"
    if idx + len(phoneme) == len(word):
        return "final"
    return "medial"


def get_mismatched_phoneme(expected: str, predicted: str) -> Optional[str]:
    matcher = SequenceMatcher(None, expected, predicted)
    for tag, i1, i2, _, _ in matcher.get_opcodes():
        if tag in ("replace", "delete", "insert"):
            segment = expected[i1:i2]
            for p in sorted(PHONEMES, key=len, reverse=True):
                if segment.startswith(p):
                    return p
    return None


def build_cv(word: str, base: str) -> str:
    idx = word.find(base)
    if idx != -1 and idx + len(base) < len(word):
        nxt = word[idx + len(base)]
        if nxt in VOWELS:
            return base + nxt
    return base


def therapy_level(sev: float) -> str:
    if sev >= 0.75:
        return "high"
    if sev >= 0.4:
        return "medium"
    return "low"


def clean_phonemes(lst: List[Any]) -> List[str]:
    return [p for p in lst if str(p).isalpha()]


@lru_cache(maxsize=2000)
def g2p_cached(word: str) -> List[str]:
    return clean_phonemes(g2p(word))


def word_to_phonemes(word: str) -> List[str]:
    phonemes = g2p(word)
    return [str(p).lower() for p in phonemes if str(p).isalpha()]


def levenshtein_distance(a: List[str], b: List[str]) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i]
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def summarize_audio_research_features(audio: torch.Tensor) -> Dict[str, float]:
    a = audio.detach().float().flatten()
    n = int(a.numel())
    if n <= 0:
        return {
            "duration_sec": 0.0,
            "rms": 0.0,
            "peak": 0.0,
            "zcr": 0.0,
            "rms_db": float("-inf"),
        }
    duration = n / float(SAMPLE_RATE)
    rms = torch.sqrt(torch.mean(a**2) + 1e-12).item()
    peak = torch.max(torch.abs(a)).item()
    if n > 1:
        zcr = torch.mean((a[:-1] * a[1:] < 0).float()).item()
    else:
        zcr = 0.0
    rms_db = 20.0 * math.log10(max(rms, 1e-12))
    return {
        "duration_sec": round(duration, 3),
        "rms": round(float(rms), 6),
        "peak": round(float(peak), 6),
        "zcr": round(float(zcr), 6),
        "rms_db": round(float(rms_db), 3),
    }


def detect_phonological_processes(
    expected_ph: List[str], predicted_ph: List[str]
) -> List[Dict[str, Any]]:
    """
    Heuristic process labels from expected vs. ASR-derived phoneme sequences.
    Intended for research exploration (not ground-truth).
    """
    processes: List[Dict[str, Any]] = []

    if expected_ph == predicted_ph:
        return processes

    # Deletions
    if len(predicted_ph) < len(expected_ph) and expected_ph:
        if predicted_ph == expected_ph[: len(predicted_ph)]:
            last = expected_ph[-1]
            if last in PHONEME_FEATURES:
                processes.append(
                    {
                        "process": "final_consonant_deletion",
                        "evidence": {"expected_tail": last, "predicted_tail": None},
                    }
                )

    # Cluster reduction (very rough): consecutive consonants in expected + overall deletion.
    exp_cons_idx = [
        i for i, p in enumerate(expected_ph) if p in PHONEME_FEATURES  # consonant set here
    ]
    for i in range(len(exp_cons_idx) - 1):
        a_i = exp_cons_idx[i]
        b_i = exp_cons_idx[i + 1]
        if b_i == a_i + 1 and len(predicted_ph) < len(expected_ph):
            processes.append(
                {
                    "process": "cluster_reduction",
                    "evidence": {
                        "expected_cluster": expected_ph[a_i : b_i + 1],
                        "predicted_len": len(predicted_ph),
                        "expected_len": len(expected_ph),
                    },
                }
            )
            break

    # Substitution-style processes via feature diffs.
    for idx, (e, p) in enumerate(zip_longest(expected_ph, predicted_ph, fillvalue=None)):
        if e is None or p is None or e == p:
            continue
        if e not in PHONEME_FEATURES or p not in PHONEME_FEATURES:
            continue
        ef = PHONEME_FEATURES[e]
        pf = PHONEME_FEATURES[p]

        def _add(proc: str) -> None:
            lib = PROCESS_LIBRARY.get(proc, {})
            processes.append(
                {
                    "process": proc,
                    "label": lib.get("label", proc.replace("_", " ").title()),
                    "description": lib.get("description"),
                    "therapy_focus": lib.get("therapy_focus"),
                    "evidence": {"index": idx, "expected": e, "produced": p},
                }
            )

        if e in {"r", "l"} and p in {"w", "y"}:
            _add("gliding")

        if ef.get("manner") in {"fricative", "affricate"} and pf.get("manner") == "stop":
            _add("stopping")

        if ef.get("place") == "velar" and pf.get("place") == "alveolar":
            _add("fronting")

        if ef.get("place") == "alveolar" and pf.get("place") == "velar":
            _add("backing")

        if ef.get("voiced") is True and pf.get("voiced") is False:
            _add("devoicing")
        if ef.get("voiced") is False and pf.get("voiced") is True:
            _add("voicing")

        # Common additional patterns
        if e == "ch" and p in {"sh", "t", "s"}:
            _add("deaffrication")
        if e == "s" and p == "sh":
            _add("palatalization")
        if e == "sh" and p == "s":
            _add("depalatalization")

    # De-duplicate
    seen: Set[Tuple[str, str]] = set()
    deduped: List[Dict[str, Any]] = []
    for pr in processes:
        key = (str(pr.get("process")), json.dumps(pr.get("evidence", {}), sort_keys=True))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(pr)
    return deduped


def build_tongue_hypotheses(
    expected_ph: List[str],
    predicted_ph: List[str],
    asr_confidence: float,
) -> List[Dict[str, Any]]:
    hypotheses: List[Dict[str, Any]] = []
    base_conf = max(0.0, min(float(asr_confidence), 1.0))
    for idx, (e, p) in enumerate(zip_longest(expected_ph, predicted_ph, fillvalue=None)):
        if e is None or p is None or e == p:
            continue
        if e not in PHONEME_FEATURES or p not in PHONEME_FEATURES:
            continue
        ef = PHONEME_FEATURES[e]
        pf = PHONEME_FEATURES[p]
        e_pos = ef.get("tongue")
        p_pos = pf.get("tongue")
        tip = TONGUE_FEEDBACK.get(e_pos)
        confidence = base_conf
        if ef.get("place") != pf.get("place"):
            confidence = min(1.0, confidence + 0.1)
        hypotheses.append(
            {
                "index": idx,
                "target_phoneme": e,
                "produced_phoneme": p,
                "target_place": ef.get("place"),
                "produced_place": pf.get("place"),
                "target_manner": ef.get("manner"),
                "produced_manner": pf.get("manner"),
                "target_voiced": ef.get("voiced"),
                "produced_voiced": pf.get("voiced"),
                "target_tongue_position": e_pos,
                "produced_tongue_position": p_pos,
                "suggested_tip": tip,
                "confidence": round(confidence, 3),
            }
        )
    return hypotheses


def format_therapist_recommendations(
    *,
    processes: List[Dict[str, Any]],
    tongue_hypotheses: List[Dict[str, Any]],
    articulation: Optional[List[Dict[str, Any]]] = None,
    max_items: int = 6,
) -> List[str]:
    recs: List[str] = []
    for pr in processes:
        label = pr.get("label") or str(pr.get("process") or "").replace("_", " ").title()
        focus = pr.get("therapy_focus")
        if label and focus:
            recs.append(f"{label}: {focus}")
        elif label:
            recs.append(f"Pattern to watch: {label}.")
    if articulation:
        for err in articulation:
            e = err.get("expected")
            p = err.get("produced")
            details = err.get("details") or {}
            if e and p and isinstance(details, dict):
                summary = ", ".join(str(v) for v in details.values() if v)
                if summary:
                    recs.append(f"Articulation cue for /{e}/ vs /{p}/: {summary}.")
    for h in tongue_hypotheses:
        target = h.get("target_phoneme")
        tip = h.get("suggested_tip")
        if target and tip:
            recs.append(f"Target /{target}/: {tip}")
    # De-duplicate while preserving order
    seen: Set[str] = set()
    out: List[str] = []
    for r in recs:
        if r in seen:
            continue
        seen.add(r)
        out.append(r)
        if len(out) >= max_items:
            break
    return out


def simplify_tongue_hypotheses(
    tongue_hypotheses: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    simplified: List[Dict[str, Any]] = []
    for h in tongue_hypotheses:
        simplified.append(
            {
                "target_phoneme": h.get("target_phoneme"),
                "produced_phoneme": h.get("produced_phoneme"),
                "target_tongue_position": h.get("target_tongue_position"),
                "suggested_tip": h.get("suggested_tip"),
                "confidence": h.get("confidence"),
            }
        )
    return simplified


def _parse_bool_arg(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    v = value.strip().lower()
    if v in {"1", "true", "yes", "y", "on"}:
        return True
    if v in {"0", "false", "no", "n", "off"}:
        return False
    return default


def normalize_error_type(value: Any) -> str:
    s = str(value or "").strip().lower()
    mapping = {
        "correct": "correct",
        "substitution": "substitution",
        "omission": "omission",
        "addition": "addition",
        "mixed": "mixed",
    }
    return mapping.get(s, s or "unknown")


def build_clean_response(
    *,
    mode: str,
    advanced: bool,
    expected: str,
    predicted: str,
    is_correct: bool,
    error_type: Any,
    severity_text: float,
    severity_phoneme: float,
    therapy_level_value: str,
    base_phoneme: Optional[str],
    target_phoneme: Optional[str],
    phoneme_position_value: Optional[str],
    asr_confidence: Optional[float],
    advanced_analysis: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    # construct dictionary with keys in the desired client order
    resp: Dict[str, Any] = {}
    if asr_confidence is not None:
        resp["asr_confidence"] = round(float(asr_confidence), 3)
    resp["base_phoneme"] = base_phoneme
    resp["error_type"] = normalize_error_type(error_type)
    resp["expected"] = expected
    resp["is_correct"] = bool(is_correct)
    resp["phoneme_position"] = phoneme_position_value
    resp["predicted"] = predicted
    resp["severity_phoneme"] = round(float(severity_phoneme), 3)
    resp["severity_text"] = round(float(severity_text), 3)
    resp["target_phoneme"] = target_phoneme
    resp["therapy_level"] = therapy_level_value
    resp["advanced_analysis"] = advanced_analysis if advanced else None
    # meta is appended last; attach_meta may override later but keep here for
    # fallback consistency.
    resp["meta"] = {
        "mode": mode,
        "advanced": bool(advanced),
        "model": ASR_MODEL_WAV2VEC2,
        "device": str(device),
        "asr_confidence": round(float(asr_confidence), 3)
        if asr_confidence is not None
        else None,
    }
    return resp


def attach_meta(
    response: Dict[str, Any],
    *,
    mode: str,
    advanced: bool,
    asr_confidence: Optional[float],
    include_meta: bool = True,
) -> Dict[str, Any]:
    """
    Optionally append a `meta` block and enforce a stable key order.

    This implementation now defaults to **not** adding a `meta` section,
    reflecting requests to drop it entirely. Use ``include_meta=True`` to
    retain the extra fields when needed.

    Ordering rules applied to the returned dict are:
    1. basic fields (asr_confidence, base_phoneme, etc.) in fixed sequence
    2. anything else already present (e.g. advanced_analysis)
    3. the `meta` block (if requested)
    """
    if not include_meta:
        # skip inserting the meta block entirely
        return response

    meta = {
        "mode": mode,
        "advanced": bool(advanced),
        "model": ASR_MODEL_WAV2VEC2,
        "device": str(device),
        "asr_confidence": round(float(asr_confidence), 3) if asr_confidence is not None else None,
    }
    ordered: Dict[str, Any] = {}

    # Default/basic keys first (only if present), in desired order
    basic_order = [
        "asr_confidence",
        "base_phoneme",
        "error_type",
        "expected",
        "is_correct",
        "phoneme_position",
        "predicted",
        "severity_phoneme",
        "severity_text",
        "target_phoneme",
        "therapy_level",
    ]
    for key in basic_order:
        if key in response:
            ordered[key] = response[key]

    # Any other legacy fields that might have been added
    for key, value in response.items():
        if key in ordered or key == "advanced_analysis":
            continue
        ordered[key] = value

    # Advanced details next
    if "advanced_analysis" in response:
        ordered["advanced_analysis"] = response["advanced_analysis"]

    # Meta last
    ordered["meta"] = meta

    # append the meta block last
    ordered["meta"] = meta
    return ordered


def articulation_analysis(expected_ph: List[str], predicted_ph: List[str]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for e, p in zip_longest(expected_ph, predicted_ph, fillvalue=None):
        if e == p or e is None or p is None:
            continue
        if e not in PHONEME_FEATURES or p not in PHONEME_FEATURES:
            continue
        ef = PHONEME_FEATURES[e]
        pf = PHONEME_FEATURES[p]
        errors: Dict[str, str] = {}
        if ef["place"] != pf["place"]:
            errors["place_error"] = f"{ef['place']} → {pf['place']}"
        if ef["manner"] != pf["manner"]:
            errors["manner_error"] = f"{ef['manner']} → {pf['manner']}"
        if ef.get("voiced") != pf.get("voiced"):
            errors["voicing_error"] = (
                f"{'voiced' if ef.get('voiced') else 'voiceless'} → "
                f"{'voiced' if pf.get('voiced') else 'voiceless'}"
            )
        if errors:
            results.append({"expected": e, "produced": p, "details": errors})
    return results


def tongue_feedback(expected_ph: List[str], predicted_ph: List[str]) -> List[Dict[str, Any]]:
    feedback: List[Dict[str, Any]] = []
    for e, p in zip_longest(expected_ph, predicted_ph, fillvalue=None):
        if e == p or e is None or p is None:
            continue
        if e not in PHONEME_FEATURES or p not in PHONEME_FEATURES:
            continue
        e_pos = PHONEME_FEATURES[e]["tongue"]
        p_pos = PHONEME_FEATURES[p]["tongue"]
        tip = TONGUE_FEEDBACK.get(e_pos)
        feedback.append(
            {
                "expected_phoneme": e,
                "produced_phoneme": p,
                "expected_tongue_position": e_pos,
                "produced_tongue_position": p_pos,
                "therapy_tip": tip,
            }
        )
    return feedback


def soda_error_type(expected_ph: List[str], predicted_ph: List[str]) -> str:
    if expected_ph == predicted_ph:
        return "correct"
    if len(predicted_ph) < len(expected_ph):
        return "omission"
    if len(predicted_ph) > len(expected_ph):
        return "addition"
    return "substitution"


def error_taxonomy_details(e: str, p: str) -> Dict[str, Optional[str]]:
    """
    Returns therapist-friendly taxonomy info for a single expected→produced pair.
    """
    category = "substitution"
    if e in {"r", "l"} and p in {"w", "y"}:
        category = "gliding"
    elif e in {"s", "z", "sh", "zh", "ch", "jh", "f", "v", "th", "dh"} and p in {"t", "d", "k", "g"}:
        category = "stopping"
    elif e in {"k", "g", "ng"} and p in {"t", "d", "n"}:
        category = "fronting"
    elif e in {"t", "d", "n"} and p in {"k", "g", "ng"}:
        category = "backing"
    elif e in {"p", "t", "k", "s", "f", "th", "sh", "ch"} and p in {"b", "d", "g", "z", "v", "dh", "zh", "jh"}:
        category = "voicing"
    elif e in {"b", "d", "g", "z", "v", "dh", "zh", "jh"} and p in {"p", "t", "k", "s", "f", "th", "sh", "ch"}:
        category = "devoicing"
    elif e == "ch" and p in {"sh", "s", "t"}:
        category = "deaffrication"
    elif e == "s" and p == "sh":
        category = "palatalization"
    elif e == "sh" and p == "s":
        category = "depalatalization"

    lib = PROCESS_LIBRARY.get(category, {})
    return {
        "category": category,
        "label": lib.get("label"),
        "description": lib.get("description"),
        "therapy_focus": lib.get("therapy_focus"),
    }


def build_error_taxonomy_from_alignment(
    expected_ph: List[str], predicted_ph: List[str]
) -> List[Dict[str, Any]]:
    """
    Build taxonomy using aligned phoneme sequences (not simple positional zip),
    so categories like gliding/stopping/fronting show up more reliably.
    """
    taxonomy: List[Dict[str, Any]] = []
    sm = SequenceMatcher(None, expected_ph, predicted_ph)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        exp_seg = expected_ph[i1:i2]
        pred_seg = predicted_ph[j1:j2]

        if tag == "replace":
            for off, (e, p) in enumerate(zip_longest(exp_seg, pred_seg, fillvalue=None)):
                if e is None or p is None:
                    continue
                if e == p:
                    continue
                item: Dict[str, Any] = {
                    "expected": e,
                    "produced": p,
                    "expected_index": i1 + off,
                    "produced_index": j1 + off,
                }
                item.update(error_taxonomy_details(e, p))
                taxonomy.append(item)
        elif tag == "delete":
            for off, e in enumerate(exp_seg):
                taxonomy.append(
                    {
                        "expected": e,
                        "produced": None,
                        "expected_index": i1 + off,
                        "produced_index": None,
                        "category": "omission",
                        "label": "Omission",
                        "description": "A target sound may be omitted.",
                        "therapy_focus": "Try slowing the word and adding the missing sound with clear models and tactile/visual cues.",
                    }
                )
        elif tag == "insert":
            for off, p in enumerate(pred_seg):
                taxonomy.append(
                    {
                        "expected": None,
                        "produced": p,
                        "expected_index": None,
                        "produced_index": j1 + off,
                        "category": "addition",
                        "label": "Addition",
                        "description": "An extra sound may be inserted.",
                        "therapy_focus": "Work on smooth transitions between sounds and pacing; practice the target word slowly then increase rate.",
                    }
                )
    return taxonomy


def error_taxonomy(e: str, p: str) -> str:
    return str(error_taxonomy_details(e, p).get("category") or "substitution")


def acoustic_confidence(audio: torch.Tensor) -> float:
    if audio.numel() == 0:
        return 0.0
    energy = torch.mean(audio**2).item()
    variance = torch.var(audio).item()
    return min(energy + variance, 1.0)


def get_asr_confidence(logits: torch.Tensor) -> float:
    probs = F.softmax(logits, dim=-1)
    max_probs = torch.max(probs, dim=-1).values
    return torch.mean(max_probs).item()


def composite_severity(
    expected: str,
    predicted: str,
    expected_ph: List[str],
    predicted_ph: List[str],
    audio: torch.Tensor,
    asr_confidence: float,
) -> float:
    text_score = 1 - calculate_severity(expected, predicted)
    phoneme_score = 1 - calculate_severity(expected_ph, predicted_ph)
    acoustic_score = acoustic_confidence(audio)
    score = (
        0.35 * text_score
        + 0.25 * phoneme_score
        + 0.20 * acoustic_score
        + 0.20 * asr_confidence
    )
    return 1 - score


def composite_severity_app_py(
    expected: str,
    predicted: str,
    expected_ph: List[str],
    predicted_ph: List[str],
    audio: torch.Tensor,
) -> float:
    """
    Composite severity matching `app.py`'s advanced endpoint.
    (Different weighting vs. the optimized pipeline.)
    """
    text_score = 1 - calculate_severity(expected, predicted)
    phoneme_score = 1 - calculate_severity(expected_ph, predicted_ph)
    acoustic_score = acoustic_confidence(audio)
    score = 0.4 * text_score + 0.3 * phoneme_score + 0.3 * acoustic_score
    return 1 - score


def convert_to_wav_16k_mono(input_path: Path, output_path: Path) -> None:
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(input_path),
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "wav",
                str(output_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise ValueError("Audio conversion timed out")
    except subprocess.CalledProcessError as e:
        raise ValueError(f"Audio conversion failed: {e}")


def load_audio_tensor(wav_path: Path) -> torch.Tensor:
    wav, sr = torchaudio.load(str(wav_path))
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    if sr != SAMPLE_RATE:
        resampler = torchaudio.transforms.Resample(sr, SAMPLE_RATE)
        wav = resampler(wav)
    return wav.squeeze()


def analyze_asr_wav2vec2(wav_path: Path) -> Tuple[str, float]:
    wav, _ = torchaudio.load(str(wav_path))
    max_samples = SAMPLE_RATE * MAX_AUDIO_DURATION_SEC
    wav = wav[:, :max_samples]
    inputs = wav2vec2_processor(
        wav.squeeze(),
        sampling_rate=SAMPLE_RATE,
        return_tensors="pt",
    ).to(device)
    with torch.no_grad():
        logits = wav2vec2_model(**inputs).logits
    pred_ids = torch.argmax(logits, dim=-1)
    predicted_text = wav2vec2_processor.decode(pred_ids[0]).lower().strip()
    confidence = get_asr_confidence(logits)
    return predicted_text, confidence


def validate_single_word(text: str) -> Tuple[bool, Optional[str]]:
    text = text.strip()
    if not text:
        return False, "Input cannot be empty"
    if " " in text:
        return (
            False,
            "Input must be a single word or sound, not a sentence. Please provide only one word.",
        )
    sentence_punctuation = {".", ",", "!", "?", ";", ":", "-", "—", "–", "'", '"'}
    if any(char in sentence_punctuation for char in text):
        return False, "Input must be a single word or sound. Remove punctuation marks and hyphens."
    if len(text) > MAX_WORD_LENGTH:
        return (
            False,
            f"Input too long. Maximum length is {MAX_WORD_LENGTH} characters for a single word/sound.",
        )
    if not text.isalpha():
        return (
            False,
            "Input must contain only alphabetic characters (letters only, no numbers, hyphens, or special characters).",
        )
    if not any(c.isalpha() for c in text):
        return False, "Input must contain at least one letter."
    return True, None


def perform_basic_analysis(expected: str, predicted: str) -> Dict[str, Any]:
    sev_text = calculate_severity(expected, predicted)
    error_type = detect_soda(expected, predicted)
    is_correct = error_type == "Correct"
    base_phoneme = None
    target_phoneme = None
    phoneme_pos = None
    if not is_correct:
        base_phoneme = get_mismatched_phoneme(expected, predicted)
        if base_phoneme:
            target_phoneme = build_cv(expected, base_phoneme)
            phoneme_pos = phoneme_position(expected, base_phoneme)
    exp_ph = g2p_cached(expected)
    pred_ph = g2p_cached(predicted)
    sev_ph = calculate_severity(exp_ph, pred_ph)
    return {
        "is_correct": is_correct,
        "error_type": error_type,
        "severity_text": round(sev_text, 2),
        "severity_phoneme": round(sev_ph, 2),
        "therapy_level": therapy_level(sev_text),
        "base_phoneme": base_phoneme,
        "target_phoneme": target_phoneme,
        "phoneme_position": phoneme_pos,
        "expected_phonemes": exp_ph,
        "predicted_phonemes": pred_ph,
    }


app = Flask(__name__)


@app.route("/analyze", methods=["POST"])
def analyze():
    job_id = str(uuid.uuid4())
    raw_path = TEMP_DIR / f"{job_id}.input"
    wav_path = TEMP_DIR / f"{job_id}.wav"
    # parse optional query parameters; default to omitting meta block
    # clients may still request it by passing include_meta=true
    include_meta = _parse_bool_arg(request.args.get("include_meta"), False)

    try:
        audio = request.files.get("audio")
        expected = request.form.get("expected_text")
        if not audio or not expected:
            return (
                jsonify(
                    {
                        # even error responses follow the same include_meta flag
                        **({} if not include_meta else {"meta": {"advanced": None}}),
                        "error": {"message": "audio and expected_text required"},
                    }
                ),
                400,
            )

        expected = expected.strip().lower()

        is_valid, error_msg = validate_single_word(expected)
        if not is_valid:
            return (
                jsonify(
                    {
                        "meta": {"advanced": advanced},
                        "error": {
                            "message": "Invalid input format",
                            "details": error_msg,
                            "note": "This system analyzes single words or sounds only, not sentences or phrases.",
                        },
                    }
                ),
                400,
            )

        audio.save(str(raw_path))
        try:
            convert_to_wav_16k_mono(raw_path, wav_path)
        except Exception as e:
            logger.error(f"Audio conversion failed: {e}")
            return (
                jsonify(
                    {
                        "meta": {"advanced": advanced},
                        "error": {"message": "Audio conversion failed", "details": str(e)},
                    }
                ),
                400,
            )

        try:
            predicted, asr_confidence = analyze_asr_wav2vec2(wav_path)
        except Exception as e:
            logger.error(f"ASR failed: {e}")
            return (
                jsonify(
                    {
                        "meta": {"advanced": advanced},
                        "error": {"message": "Speech recognition failed", "details": str(e)},
                    }
                ),
                500,
            )

        if not predicted:
            return (
                jsonify(
                    {
                        "meta": {"advanced": True},
                        "error": {"message": "No speech detected"},
                    }
                ),
                400,
            )

        predicted_words = predicted.split()
        if len(predicted_words) > 1:
            predicted = predicted_words[0]
            logger.warning(f"ASR returned multiple words, using first word: {predicted}")
        predicted = predicted.strip(".,!?;:")

        basic_results = perform_basic_analysis(expected, predicted)
        # order keys so that asr_confidence comes first, meta goes last
        response: Dict[str, Any] = {
            "asr_confidence": round(asr_confidence, 3),
            "base_phoneme": basic_results["base_phoneme"],
            "error_type": basic_results["error_type"],
            "expected": expected,
            "is_correct": basic_results["is_correct"],
            "phoneme_position": basic_results["phoneme_position"],
            "predicted": predicted,
            "severity_phoneme": basic_results["severity_phoneme"],
            "severity_text": basic_results["severity_text"],
            "target_phoneme": basic_results["target_phoneme"],
            "therapy_level": basic_results["therapy_level"],
        }

        # Always run advanced analysis by default
        wav = load_audio_tensor(wav_path)
        expected_ph = word_to_phonemes(expected)
        predicted_ph = word_to_phonemes(predicted)
        articulation = articulation_analysis(expected_ph, predicted_ph)
        taxonomy = build_error_taxonomy_from_alignment(expected_ph, predicted_ph)
        tongue = tongue_feedback(expected_ph, predicted_ph)
        sev_acoustic = composite_severity(
            expected,
            predicted,
            expected_ph,
            predicted_ph,
            wav,
            asr_confidence,
        )

        per_dist = levenshtein_distance(expected_ph, predicted_ph)
        per = (per_dist / max(len(expected_ph), 1)) if expected_ph else 0.0
        processes = detect_phonological_processes(expected_ph, predicted_ph)
        tongue_hypotheses = build_tongue_hypotheses(
            expected_ph, predicted_ph, asr_confidence
        )

        # Therapist-oriented summary (advanced-only model)
        recommendations = format_therapist_recommendations(
            processes=processes,
            tongue_hypotheses=tongue_hypotheses,
            articulation=articulation,
        )
        response["advanced_analysis"] = {
            "severity_text": basic_results["severity_text"],
            "severity_phoneme": basic_results["severity_phoneme"],
            "acoustic_severity": round(sev_acoustic, 3),
            "base_soda_error": soda_error_type(expected_ph, predicted_ph),
            "articulation_errors": articulation,
            "error_taxonomy": taxonomy,
            # "tongue_position_analysis": tongue,
            # "severity_breakdown": {
            #     "text_edit_severity": basic_results["severity_text"],
            #     "phoneme_edit_severity": basic_results["severity_phoneme"],
            #     "phoneme_edit_distance": per_dist,
            #     "phoneme_error_rate": round(float(per), 3),
            #     "asr_confidence": round(float(asr_confidence), 3),
            # },
            # "phonological_processes": processes,
            "tongue_placement_hypotheses": simplify_tongue_hypotheses(
                tongue_hypotheses
            ),
            "recommendations": recommendations,
        }
        return jsonify(
            attach_meta(
                response,
                mode="advanced",
                advanced=True,
                asr_confidence=asr_confidence,
                include_meta=include_meta,
            )
        )
    except Exception as e:
        logger.exception("Unexpected error in analyze endpoint")
        return (
            jsonify(
                {
                    "meta": {"advanced": None},
                    "error": {"message": "Internal server error", "details": str(e)},
                }
            ),
            500,
        )
    finally:
        for p in (raw_path, wav_path):
            try:
                if p.exists():
                    p.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete {p}: {e}")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "device": str(device), "model": ASR_MODEL_WAV2VEC2})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=False)
