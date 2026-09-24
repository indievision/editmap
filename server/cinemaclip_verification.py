"""Verify that the CinemaCLIP runtime received the intended pretrained checkpoint."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict

import torch
from huggingface_hub import snapshot_download
from safetensors import safe_open


CINEMACLIP_MODEL_ID = "OZU-Technology/CinemaCLIP"
# Official CinemaCLIP checkpoint resolved on 2026-09-17. Pinning it prevents a
# cache entry, a random base CLIP, or an upstream revision being silently used.
CINEMACLIP_CHECKPOINT_SHA256 = "a397d8eaa0f6797b9e4be73ecc5c9a12209aa5a9f84b5c53eaac31e61ce88c74"
_SENTINEL_TENSORS = ("clip.visual.conv1.weight", "classifier_heads.shot_framing.linear.weight")


class CinemaCLIPVerificationError(RuntimeError):
    """The local CinemaCLIP runtime is not the checkpoint we approved."""


def local_cinemaclip_snapshot() -> Path:
    """Return a cached official snapshot without allowing a network fetch."""
    try:
        return Path(snapshot_download(CINEMACLIP_MODEL_ID, local_files_only=True))
    except Exception as error:
        raise CinemaCLIPVerificationError(
            "CinemaCLIP weights are not cached locally. Run "
            "`server/.venv/bin/python server/provision_cinemaclip.py` while online."
        ) from error


def verify_loaded_cinemaclip(model: Any) -> Dict[str, Any]:
    """Check checkpoint identity and loaded visual/framing tensors after loading."""
    snapshot = local_cinemaclip_snapshot()
    config_path = snapshot / "config.json"
    checkpoint_path = snapshot / "model.safetensors"
    if not config_path.is_file() or not checkpoint_path.is_file():
        raise CinemaCLIPVerificationError("Cached CinemaCLIP snapshot is incomplete.")

    config = json.loads(config_path.read_text())
    if config.get("open_clip_model_name") != "ViT-B-32-256" or config.get("embed_dim") != 512:
        raise CinemaCLIPVerificationError("Cached CinemaCLIP config is not the expected ViT-B-32-256 checkpoint.")
    digest = hashlib.sha256(checkpoint_path.read_bytes()).hexdigest()
    if digest != CINEMACLIP_CHECKPOINT_SHA256:
        raise CinemaCLIPVerificationError(
            "Cached CinemaCLIP checkpoint hash does not match the approved pretrained weights."
        )

    state = model.state_dict()
    with safe_open(str(checkpoint_path), framework="pt", device="cpu") as checkpoint:
        for key in _SENTINEL_TENSORS:
            if key not in checkpoint.keys() or key not in state:
                raise CinemaCLIPVerificationError(f"CinemaCLIP checkpoint is missing required tensor: {key}")
            if not torch.equal(state[key].detach().cpu(), checkpoint.get_tensor(key)):
                raise CinemaCLIPVerificationError(
                    f"CinemaCLIP loaded state does not match the approved checkpoint tensor: {key}"
                )
    return {"model_id": CINEMACLIP_MODEL_ID, "checkpoint_sha256": digest, "snapshot": str(snapshot), "verified": True}
