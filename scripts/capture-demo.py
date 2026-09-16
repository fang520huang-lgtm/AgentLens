"""Capture three static screenshots of the synthetic demo for the README."""

from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "docs" / "index.html").as_uri()
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        channel="chrome",
        args=["--disable-gpu"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1, locale="en-US")
    page.goto(URL)
    page.wait_for_selector(".event-card")
    assert page.locator("#event-counter").inner_text() == f"{page.locator('.event-card').count()} EVENTS"

    def capture(name):
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(OUT / name), animations="disabled")

    capture("timeline.png")
    page.locator(".event-card").nth(1).click()
    capture("command-detail.png")
    page.locator('[data-view="changes"]').click()
    page.locator(".change-row").first.click()
    capture("code-changes.png")
    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1, locale="en-US")
    mobile.goto(URL)
    mobile.locator(".event-card").first.click()
    assert "open" in mobile.locator("#inspector").get_attribute("class")
    mobile.locator("#inspector-close").click()
    assert "open" not in mobile.locator("#inspector").get_attribute("class")
    mobile.locator('[data-view="changes"]').click()
    mobile.locator(".change-row").first.click()
    assert "open" in mobile.locator("#inspector").get_attribute("class")
    browser.close()

print(OUT)
