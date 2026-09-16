"""Capture the synthetic demo as a README GIF (optional: playwright and Pillow)."""

from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "docs" / "index.html").as_uri()
OUT = ROOT / "docs" / "demo.gif"


with TemporaryDirectory() as temp, sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        args=["--disable-gpu"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    page.goto(URL)
    page.wait_for_selector(".event-card")
    shots = []

    def capture(name):
        path = Path(temp) / f"{name}.png"
        page.screenshot(path=str(path))
        shots.append(Image.open(path).convert("RGB"))

    capture("01-overview")
    page.locator(".event-card").nth(1).click()
    capture("02-read")
    page.locator(".event-card").nth(3).click()
    capture("03-edit")
    page.locator('[data-view="changes"]').click()
    page.locator(".change-row").first.click()
    capture("04-diff")
    page.locator('[data-view="timeline"]').click()
    page.locator(".event-card").nth(5).click()
    capture("05-test")
    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.goto(URL)
    mobile.locator(".event-card").first.click()
    assert "open" in mobile.locator("#inspector").get_attribute("class")
    mobile.locator("#inspector-close").click()
    assert "open" not in mobile.locator("#inspector").get_attribute("class")
    mobile.locator('[data-view="changes"]').click()
    mobile.locator(".change-row").first.click()
    assert "open" in mobile.locator("#inspector").get_attribute("class")
    browser.close()

palette_frames = [frame.quantize(colors=128, method=Image.Quantize.FASTOCTREE) for frame in shots]
palette_frames[0].save(
    OUT,
    save_all=True,
    append_images=palette_frames[1:],
    duration=[1200, 1100, 1100, 1400, 1200],
    loop=0,
    optimize=True,
)
print(OUT)
