"""Score CinemaCLIP's three-frame framing against human-labelled film stills."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

from PIL import Image

from cinemaclip_verification import CinemaCLIPVerificationError, verify_loaded_cinemaclip
from cv_engine import ACTIVE_FRAMING_SIZES, CinemaShotScaleClassifier

MINIMUM_SHOTS_FOR_QUALIFIED_REPORT = 100
MINIMUM_FILMS_FOR_QUALIFIED_REPORT = 3
MINIMUM_SHOTS_PER_LABEL = 10
MINIMUM_ACCURACY_FOR_QUALIFIED_REPORT = 0.75


def load_manifest(path: Path) -> List[Dict[str, Any]]:
    document = json.loads(path.read_text())
    shots = document.get("shots") if isinstance(document, dict) else None
    if not isinstance(shots, list) or not shots:
        raise ValueError("Manifest must contain a non-empty `shots` list.")
    for shot in shots:
        if not isinstance(shot, dict) or shot.get("expected") not in ACTIVE_FRAMING_SIZES:
            raise ValueError(f"Each shot needs an expected label from {', '.join(ACTIVE_FRAMING_SIZES)}.")
        if not isinstance(shot.get("frames"), list) or len(shot["frames"]) != 3:
            raise ValueError("Each labelled shot must contain exactly three interior frame paths.")
        if not shot.get("film"):
            raise ValueError("Each labelled shot needs a film identifier for coverage reporting.")
    return shots


def score_shots(shots: List[Dict[str, Any]], manifest_path: Path, classifier: CinemaShotScaleClassifier) -> Dict[str, Any]:
    labels = Counter(shot["expected"] for shot in shots)
    films = {shot["film"] for shot in shots}
    correct = uncertain = 0
    per_label = {label: {"total": 0, "correct": 0} for label in ACTIVE_FRAMING_SIZES}
    rows = []
    for shot in shots:
        images = []
        for relative_path in shot["frames"]:
            frame_path = (manifest_path.parent / relative_path).resolve()
            if not frame_path.is_file():
                raise ValueError(f"Labelled frame is missing: {relative_path}")
            with Image.open(frame_path) as image:
                images.append(image.convert("RGB"))
        predicted, is_uncertain, confidence = classifier.classify_frames(images)
        expected, is_correct = shot["expected"], predicted == shot["expected"]
        correct += is_correct
        uncertain += is_uncertain
        per_label[expected]["total"] += 1
        per_label[expected]["correct"] += is_correct
        rows.append({
            "id": shot.get("id"),
            "film": shot["film"],
            "expected": expected,
            "predicted": predicted,
            "uncertain": is_uncertain,
            "confidence": round(confidence, 4),
        })
    accuracy = correct / len(shots)
    coverage_ok = (
        len(shots) >= MINIMUM_SHOTS_FOR_QUALIFIED_REPORT
        and len(films) >= MINIMUM_FILMS_FOR_QUALIFIED_REPORT
        and all(labels[label] >= MINIMUM_SHOTS_PER_LABEL for label in ACTIVE_FRAMING_SIZES)
    )
    return {
        "model": classifier.model_name,
        "shots": len(shots),
        "films": len(films),
        "accuracy": round(accuracy, 4),
        "uncertain_rate": round(uncertain / len(shots), 4),
        "label_counts": dict(labels),
        "per_label": {
            label: {
                **values,
                "accuracy": round(values["correct"] / values["total"], 4) if values["total"] else None,
            }
            for label, values in per_label.items()
        },
        "qualified_on_this_dataset": coverage_ok and accuracy >= MINIMUM_ACCURACY_FOR_QUALIFIED_REPORT,
        "qualification": {
            "minimum_shots": MINIMUM_SHOTS_FOR_QUALIFIED_REPORT,
            "minimum_films": MINIMUM_FILMS_FOR_QUALIFIED_REPORT,
            "minimum_shots_per_label": MINIMUM_SHOTS_PER_LABEL,
            "minimum_accuracy": MINIMUM_ACCURACY_FOR_QUALIFIED_REPORT,
            "coverage_ok": coverage_ok,
        },
        "results": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="JSON manifest of human-labelled three-frame film shots")
    parser.add_argument("--output", type=Path, help="Write the full JSON report here")
    args = parser.parse_args()
    shots, classifier = load_manifest(args.manifest), CinemaShotScaleClassifier()
    verification = verify_loaded_cinemaclip(classifier._get_model())
    report = score_shots(shots, args.manifest, classifier)
    report["checkpoint"] = verification
    text = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(text + "\n")
    print(text)
    return 0 if report["qualified_on_this_dataset"] else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, CinemaCLIPVerificationError) as error:
        print(f"Benchmark failed: {error}", file=sys.stderr)
        raise SystemExit(1)
