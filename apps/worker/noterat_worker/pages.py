"""Finding the page in a photo, and straightening it (OpenCV), for a scan taken on the website.

Conservative on purpose: a page is only cropped out when it shows as a clear four-cornered shape that
covers a good share of the photo and has a plausible shape. Anything less, and the photo is read as it
is; a photo left alone is better than a receipt with its total cut off.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
from PIL import Image, ImageOps

from .scan import Page, UndecodableImage

# The page is looked for on a copy this big (its longer side): plenty for the edges of a page, and fast.
FIND_SIDE = 1000
# A page has to cover at least this share of the photo (a long receipt held at arm's length is about
# a sixth of it), and less than all of it (then the photo is the page already).
MIN_AREA = 0.10
MAX_AREA = 0.98
# Corners between these angles (degrees): a page photographed at a slant, not any four-sided shape.
MIN_ANGLE, MAX_ANGLE = 45.0, 135.0
# The straightened page's long side over its short side; a long receipt is about 1:7.
MAX_ASPECT = 9.0
# How far apart a side's length and the opposite side's may be (perspective makes one shorter).
MIN_SIDE_RATIO = 0.5
# The share of the four-cornered shape the region has to fill: a page, not a page and a hand.
MIN_FILL = 0.85
JPEG_QUALITY = 90
DPI = 300

# Formats Pillow writes without loss: a page from one of these is kept as PNG for the PDF, not JPEG.
_LOSSLESS = {"PNG", "GIF", "BMP", "TIFF", "PPM"}


def load(path: str) -> tuple[Image.Image, str, bool]:
    """The image, upright (as its EXIF orientation says), in RGB or grayscale; its format (JPEG, PNG…);
    and whether it had to be turned or converted (False: its file can go into the PDF as it is)."""
    try:
        with Image.open(path) as im:
            im.load()  # decodes it all now, so a truncated file shows here
            fmt = im.format or ""
            turned = im.getexif().get(0x0112, 1) not in (0, 1)  # EXIF Orientation
            image = ImageOps.exif_transpose(im)
    except MemoryError:
        raise
    except Exception as e:  # Pillow raises all sorts for a file that isn't an image (OSError, SyntaxError, …)
        raise UndecodableImage(_why(e)) from e
    changed = turned or fmt != "JPEG"
    if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
        # a transparent background is white paper, not black
        rgba = image.convert("RGBA")
        image = Image.new("RGB", rgba.size, "white")
        image.paste(rgba, mask=rgba.getchannel("A"))
        changed = True
    elif image.mode not in ("RGB", "L"):
        image = image.convert("L" if image.mode in ("1", "I", "I;16", "F") else "RGB")
        changed = True
    if image.width < 16 or image.height < 16:
        raise UndecodableImage(f"the image is too small to read ({image.width}×{image.height} pixels)")
    return image, fmt, changed


def prepare(src: str, dest: str, crop: bool) -> Page:
    """See scan.Scanner.prepare."""
    image, fmt, changed = load(src)
    if crop:
        corners = find_page(np.asarray(image.convert("L")))
        if corners is not None:
            page = warp(image, corners)
            path = dest + ".jpg"
            page.save(path, "JPEG", quality=JPEG_QUALITY, dpi=(DPI, DPI), optimize=True)
            return Page(path, True, page.width, page.height, [(int(round(x)), int(round(y))) for x, y in corners])
    if not changed:
        return Page(src, False, image.width, image.height)
    # turned by its EXIF, or not a JPEG: a copy the PDF can take as it is (the job keeps the original)
    if fmt in _LOSSLESS:
        path = dest + ".png"
        image.save(path, "PNG", dpi=(DPI, DPI))
    else:
        path = dest + ".jpg"
        image.save(path, "JPEG", quality=JPEG_QUALITY, dpi=(DPI, DPI))
    return Page(path, False, image.width, image.height)


def find_page(gray: np.ndarray) -> list[tuple[float, float]] | None:
    """The page's corners in the photo (top left, top right, bottom right, bottom left), or None when
    there's no clear page. gray: the upright photo in grayscale."""
    h, w = gray.shape[:2]
    scale = min(1.0, FIND_SIDE / max(h, w))
    small = cv2.resize(gray, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA) if scale < 1 else gray
    blur = cv2.GaussianBlur(small, (5, 5), 0)

    # Two ways of seeing the page, as either can fail on its own: its outline (edges, closed so a faint
    # stretch doesn't break it, without growing it), and the paper being lighter than what it lies on
    # (Otsu's threshold, closed so the text doesn't leave holes).
    otsu, bright = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edges = cv2.Canny(blur, 0.5 * otsu, otsu)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

    best: np.ndarray | None = None
    best_area = 0.0
    for mask in (edges, bright):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
            quad = _quadrilateral(contour)
            if quad is None or not _plausible(quad, contour, small.shape[1], small.shape[0]):
                continue
            area = cv2.contourArea(quad)
            if area > best_area:
                best, best_area = quad, area
    if best is None:
        return None
    return [(float(x) / scale, float(y) / scale) for x, y in _order(best)]


def warp(image: Image.Image, corners: list[tuple[float, float]]) -> Image.Image:
    """The page between the corners, seen straight on."""
    tl, tr, br, bl = (np.array(c, dtype=np.float32) for c in corners)
    width = round(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = round(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    src = np.array([tl, tr, br, bl], dtype=np.float32)
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, dst)
    out = cv2.warpPerspective(np.asarray(image), matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(out)  # L or RGB, as the photo was


def _quadrilateral(contour: np.ndarray) -> np.ndarray | None:
    """The contour as four corners, if it is about that shape. Its convex hull, so a torn edge or a
    dent where the text touches the edge doesn't spoil it."""
    hull = cv2.convexHull(contour)
    perimeter = cv2.arcLength(hull, True)
    for epsilon in (0.02, 0.03, 0.04, 0.05):
        approx = cv2.approxPolyDP(hull, epsilon * perimeter, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)
        if len(approx) < 4:
            return None
    return None


def _plausible(quad: np.ndarray, contour: np.ndarray, width: int, height: int) -> bool:
    if not cv2.isContourConvex(quad.reshape(4, 1, 2)):
        return False
    area = cv2.contourArea(quad)
    if not MIN_AREA * width * height <= area <= MAX_AREA * width * height:
        return False
    if cv2.contourArea(contour) < MIN_FILL * area:
        return False
    tl, tr, br, bl = (np.array(p) for p in _order(quad))
    # a page cut off by the edge of the photo: two corners on the edge are where the photo ends, not
    # where the page does
    margin = 0.01 * max(width, height)
    on_edge = sum(1 for x, y in (tl, tr, br, bl) if x < margin or y < margin or x > width - 1 - margin or y > height - 1 - margin)
    if on_edge >= 2:
        return False
    for prev, corner, nxt in ((bl, tl, tr), (tl, tr, br), (tr, br, bl), (br, bl, tl)):
        a, b = prev - corner, nxt - corner
        cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        if not MIN_ANGLE <= math.degrees(math.acos(max(-1.0, min(1.0, cos)))) <= MAX_ANGLE:
            return False
    top, bottom = np.linalg.norm(tr - tl), np.linalg.norm(br - bl)
    left, right = np.linalg.norm(bl - tl), np.linalg.norm(br - tr)
    if min(top, bottom) < MIN_SIDE_RATIO * max(top, bottom) or min(left, right) < MIN_SIDE_RATIO * max(left, right):
        return False
    long, short = max(top, bottom, left, right), min(max(top, bottom), max(left, right))
    return short > 0 and long / short <= MAX_ASPECT


def _order(quad: np.ndarray) -> list[tuple[float, float]]:
    """Four corners clockwise (on screen) from the top left: the one nearest the photo's top left
    corner comes first, so a page keeps the way up it had in the photo."""
    points = [(float(x), float(y)) for x, y in quad.reshape(4, 2)]
    cx = sum(x for x, _ in points) / 4
    cy = sum(y for _, y in points) / 4
    points.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))  # y points down: clockwise on screen
    first = min(range(4), key=lambda i: points[i][0] + points[i][1])
    return points[first:] + points[:first]


def _why(e: Exception) -> str:
    if isinstance(e, Image.DecompressionBombError):
        return "the image is too big to read"
    if isinstance(e, FileNotFoundError):
        return "the image file is missing"
    return "the file isn't an image that can be read"
