"""Download and validate the approved local CinemaCLIP framing checkpoint."""

from cinemaclip import CinemaCLIP
from cinemaclip_verification import verify_loaded_cinemaclip


def main() -> None:
    model = CinemaCLIP.from_pretrained("OZU-Technology/CinemaCLIP").eval()
    verification = verify_loaded_cinemaclip(model)
    print(f"CinemaCLIP verified: {verification['checkpoint_sha256']}")


if __name__ == "__main__":
    main()
