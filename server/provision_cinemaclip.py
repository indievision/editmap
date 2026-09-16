"""Download and validate the local CinemaCLIP framing model before offline use."""

from cinemaclip import CinemaCLIP


def main() -> None:
    model = CinemaCLIP.from_pretrained("OZU-Technology/CinemaCLIP").eval()
    print(f"CinemaCLIP cached: {model.__class__.__name__}")


if __name__ == "__main__":
    main()
