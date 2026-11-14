"""The real page finder (OpenCV) and reader (Tesseract through OCRmyPDF), on synthetic images. Each test
skips itself when what it needs isn't installed: CI's test job has OpenCV but not Tesseract; the image
has both (see README.md, "Tests")."""

from __future__ import annotations

import glob
import math
import os
import shutil

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")
PIL = pytest.importorskip("PIL")
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from noterat_worker import pages  # noqa: E402
from noterat_worker.scan import UndecodableImage  # noqa: E402

# ── finding the page ──


def page_image(width: int = 600, height: int = 850) -> np.ndarray:
    """A white page with lines of "text" (dark bars), in BGR."""
    page = np.full((height, width, 3), 242, np.uint8)
    rng = np.random.default_rng(0)
    for y in range(60, height - 60, 34):
        x = 50
        while x < width - 80:
            w = int(rng.integers(20, 90))
            cv2.rectangle(page, (x, y), (min(x + w, width - 50), y + 14), (40, 40, 40), -1)
            x += w + 14
    return page


def on_a_table(page: np.ndarray, corners: list[tuple[float, float]], size: tuple[int, int] = (1200, 1600), seed: int = 1) -> np.ndarray:
    """The page warped to the corners on a darker, textured background, a little blurred and noisy."""
    w, h = size
    rng = np.random.default_rng(seed)
    table = np.full((h, w, 3), (45, 65, 90), np.float32)
    table += cv2.resize(rng.normal(0, 18, (h // 20, w // 20, 3)).astype(np.float32), (w, h))  # blotches
    table += rng.normal(0, 6, (h, w, 3))  # grain
    ph, pw = page.shape[:2]
    m = cv2.getPerspectiveTransform(np.float32([[0, 0], [pw - 1, 0], [pw - 1, ph - 1], [0, ph - 1]]), np.float32(corners))
    warped = cv2.warpPerspective(page.astype(np.float32), m, (w, h))
    mask = cv2.warpPerspective(np.ones((ph, pw), np.float32), m, (w, h))[..., None]
    photo = table * (1 - mask) + warped * mask
    photo = cv2.GaussianBlur(photo, (0, 0), 1.0) + rng.normal(0, 3, photo.shape)
    return np.clip(photo, 0, 255).astype(np.uint8)


CORNERS = [(310.0, 180.0), (930.0, 260.0), (880.0, 1390.0), (230.0, 1300.0)]  # tilted, in perspective


def test_the_page_is_found_on_a_dark_table():
    photo = on_a_table(page_image(), CORNERS)
    found = pages.find_page(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY))
    assert found is not None
    for (x, y), (ex, ey) in zip(found, CORNERS):
        assert math.hypot(x - ex, y - ey) < 0.01 * 1600, (found, CORNERS)


def test_the_corners_come_from_the_top_left_clockwise_whichever_way_the_page_lies():
    turned = [CORNERS[1], CORNERS[2], CORNERS[3], CORNERS[0]]  # the same shape, its own corners shifted
    photo = on_a_table(page_image(), turned)
    found = pages.find_page(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY))
    assert found is not None
    assert math.hypot(found[0][0] - 310, found[0][1] - 180) < 16


@pytest.mark.parametrize(
    "case",
    ["only the table", "a page filling the photo", "a small card", "a page cut off by the edge"],
)
def test_no_clear_page_is_no_page(case: str):
    page = page_image()
    if case == "only the table":
        photo = on_a_table(page, [(0, 0), (1, 0), (1, 1), (0, 1)])
    elif case == "a page filling the photo":
        photo = cv2.resize(page, (1200, 1600))
    elif case == "a small card":  # a twentieth of the photo: could be anything
        photo = on_a_table(page, [(500, 600), (720, 610), (715, 900), (495, 890)])
    else:
        photo = on_a_table(page, [(300, 200), (1250, 260), (1250, 1500), (250, 1400)])
    assert pages.find_page(cv2.cvtColor(photo, cv2.COLOR_BGR2GRAY)) is None


def test_prepare_straightens_the_page_into_a_jpeg(tmp_path):
    src = tmp_path / "photo.jpg"
    cv2.imwrite(str(src), on_a_table(page_image(), CORNERS))
    page = pages.prepare(str(src), str(tmp_path / "page"), crop=True)
    assert page.cropped and page.path == str(tmp_path / "page.jpg")
    with Image.open(page.path) as im:
        assert im.format == "JPEG" and im.size == (page.width, page.height)
        assert im.info.get("dpi") == (300, 300)
    # as wide and as long as the page's longer sides in the photo
    (tl, tr, br, bl) = (np.array(c) for c in CORNERS)
    assert page.width == pytest.approx(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)), rel=0.02)
    assert page.height == pytest.approx(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)), rel=0.02)

    # without crop, a JPEG that's upright already is read as it is
    kept = pages.prepare(str(src), str(tmp_path / "kept"), crop=False)
    assert not kept.cropped and kept.path == str(src)


def test_the_exif_orientation_is_honoured(tmp_path):
    upright = Image.fromarray(page_image()[..., ::-1])  # 600 wide, 850 high
    stored = upright.transpose(Image.Transpose.ROTATE_90)  # as a phone stores it, sideways…
    exif = Image.Exif()
    exif[0x0112] = 6  # …with "turn 90° clockwise to show"
    src = tmp_path / "phone.jpg"
    stored.save(src, "JPEG", exif=exif)

    image, fmt, changed = pages.load(str(src))
    assert image.size == (600, 850) and fmt == "JPEG" and changed
    page = pages.prepare(str(src), str(tmp_path / "page"), crop=False)
    assert not page.cropped and page.path != str(src)  # an upright copy for the PDF
    with Image.open(page.path) as im:
        assert im.size == (600, 850)


def test_a_transparent_png_lies_on_white(tmp_path):
    src = tmp_path / "screenshot.png"
    Image.new("RGBA", (200, 100), (0, 0, 0, 0)).save(src)
    page = pages.prepare(str(src), str(tmp_path / "page"), crop=False)
    assert page.path.endswith(".png")
    with Image.open(page.path) as im:
        assert im.mode == "RGB" and im.getpixel((10, 10)) == (255, 255, 255)


@pytest.mark.parametrize("data", [b"", b"not an image at all" * 50, b"\xff\xd8\xff\xe0 a JPEG that stops"])
def test_what_isnt_an_image_is_undecodable(tmp_path, data: bytes):
    src = tmp_path / "file"
    src.write_bytes(data)
    with pytest.raises(UndecodableImage):
        pages.prepare(str(src), str(tmp_path / "page"), crop=True)


def test_a_truncated_jpeg_is_undecodable(tmp_path):
    whole = tmp_path / "whole.jpg"
    Image.fromarray(page_image()).save(whole, "JPEG")
    cut = tmp_path / "cut.jpg"
    cut.write_bytes(whole.read_bytes()[:3000])
    with pytest.raises(UndecodableImage):
        pages.load(str(cut))


# ── reading (Tesseract through OCRmyPDF) ──

RECEIPT = ["ICA Nära Ekhagen", "2026-11-14", "Mjölk 1,5 l   16,90", "Kaffe   59,90", "TOTALT   76,80", "Kort"]

# Pillow's own font hasn't got å, ä and ö; one of these has
FONTS = ["DejaVuSans.ttf", "LiberationSans-Regular.ttf", "NotoSans-Regular.ttf", "Arial.ttf", "arial.ttf"]
FONT_DIRS = ["/usr/share/fonts", "/usr/local/share/fonts", "/Library/Fonts", "/System/Library/Fonts", "C:/Windows/Fonts"]


def font(size: int) -> ImageFont.FreeTypeFont:
    for name in FONTS:
        for folder in FONT_DIRS:
            found = glob.glob(os.path.join(folder, "**", name), recursive=True)
            if found:
                return ImageFont.truetype(found[0], size)
    pytest.skip("no font with å, ä and ö to draw a receipt with")


def receipt(lines: list[str] = RECEIPT) -> Image.Image:
    f = font(34)
    img = Image.new("L", (640, 120 + 56 * len(lines)), 250)
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((50, 60 + 56 * i), line, font=f, fill=25)
    return img


@pytest.fixture(scope="module")
def ocr():
    if not shutil.which("tesseract"):
        pytest.skip("Tesseract isn't installed")
    pytest.importorskip("ocrmypdf")
    from noterat_worker.ocr import Ocr

    engine = Ocr()
    if not {"swe", "eng"} <= set(engine.languages):
        pytest.skip(f"Tesseract hasn't got swe and eng (it has {engine.languages})")
    return engine


def words(text: str) -> str:
    return " ".join(text.split())


def test_a_swedish_receipt_is_read(ocr, tmp_path):
    src = tmp_path / "receipt.png"
    receipt().save(src)
    blank = tmp_path / "blank.png"
    Image.new("L", (640, 400), 250).save(blank)
    second = tmp_path / "second.png"
    receipt(["Sida två", "Välkommen åter"]).save(second)

    images = [pages.prepare(str(p), str(tmp_path / f"page-{i}"), crop=False).path for i, p in enumerate((src, blank, second))]
    pdf = tmp_path / "scan.pdf"
    texts = ocr.read(images, str(pdf), "swe+eng", lambda: False)

    assert len(texts) == 3
    first = words(texts[0])
    # (not "1,5 l" whole: in a sans-serif font an l is a bar, and Tesseract may well take it for a 1)
    for expected in ("ICA Nära Ekhagen", "2026-11-14", "Mjölk 1,5", "16,90", "Kaffe 59,90", "TOTALT 76,80", "Kort"):
        assert expected in first, texts[0]
    assert texts[1].strip() == ""
    assert "Välkommen åter" in words(texts[2])
    assert pdf.read_bytes().startswith(b"%PDF")


def test_a_photographed_receipt_is_cropped_and_read(ocr, tmp_path):
    flat = cv2.cvtColor(np.asarray(receipt().convert("RGB")), cv2.COLOR_RGB2BGR)
    corners = [(330.0, 300.0), (900.0, 350.0), (870.0, 1220.0), (290.0, 1170.0)]
    src = tmp_path / "photo.jpg"
    cv2.imwrite(str(src), on_a_table(flat, corners), [cv2.IMWRITE_JPEG_QUALITY, 88])

    page = pages.prepare(str(src), str(tmp_path / "page"), crop=True)
    assert page.cropped
    (text,) = ocr.read([page.path], str(tmp_path / "scan.pdf"), "swe+eng", lambda: False)
    assert "TOTALT 76,80" in words(text), text
    assert "Ekhagen" in text


def test_a_language_tesseract_hasnt_got_is_said_so(ocr, tmp_path):
    from noterat_worker.scan import UnknownLanguage

    if "tlh" in ocr.languages:
        pytest.skip("this Tesseract reads Klingon")
    src = tmp_path / "receipt.png"
    receipt().save(src)
    with pytest.raises(UnknownLanguage):
        ocr.read([str(src)], str(tmp_path / "scan.pdf"), "tlh", lambda: False)
