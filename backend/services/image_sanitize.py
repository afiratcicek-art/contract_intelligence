"""Chrome image (header/footer/watermark) sanitization via Pillow re-encode.

Original upload bytes are NEVER stored — EXIF/metadata/polyglot payloads
are stripped by decoding then re-encoding as clean PNG or JPEG.
"""
from io import BytesIO

from PIL import Image

MAX_CHROME_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


def reencode_chrome_image(file_bytes: bytes) -> tuple[bytes, str]:
    """Validate PNG/JPEG + size, re-encode, return (clean_bytes, ext).

    Raises ValueError on bad type/size/decode.
    """
    if not file_bytes:
        raise ValueError("Boş görsel.")
    if len(file_bytes) > MAX_CHROME_IMAGE_BYTES:
        raise ValueError(
            f"Görsel boyutu sınırı aşıldı: "
            f"{len(file_bytes) / 1024 / 1024:.1f} MB (max 5 MB)."
        )

    # Magic-byte gate before Pillow (reject non-image polyglots early)
    is_jpeg = file_bytes[:3] == b"\xff\xd8\xff"
    is_png = file_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    if not (is_jpeg or is_png):
        raise ValueError("Yalnız PNG veya JPEG görseller kabul edilir.")

    try:
        img = Image.open(BytesIO(file_bytes))
        img.load()
    except Exception as exc:
        raise ValueError(f"Görsel okunamadı: {exc}") from exc

    fmt = (img.format or "").upper()
    if fmt not in ("JPEG", "PNG"):
        raise ValueError("Yalnız PNG veya JPEG görseller kabul edilir.")

    out = BytesIO()
    if fmt == "JPEG" or is_jpeg:
        # Drop EXIF by converting without info=; force RGB
        rgb = img.convert("RGB")
        rgb.save(out, format="JPEG", quality=90, optimize=True)
        return out.getvalue(), "jpg"

    # PNG — flatten palette/alpha safely, no metadata
    if img.mode in ("P", "LA"):
        img = img.convert("RGBA")
    elif img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGBA")
    img.save(out, format="PNG", optimize=True)
    return out.getvalue(), "png"
