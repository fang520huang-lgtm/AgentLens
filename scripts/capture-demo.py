"""Capture static screenshots of the synthetic replay and comparison demos."""

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
    compare = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1, locale="en-US")
    compare_errors = []
    compare.on("pageerror", lambda error: compare_errors.append(str(error)))
    compare.goto((ROOT / "docs" / "compare.html").as_uri())
    compare.wait_for_selector(".timeline-row")
    assert "Event 3" in compare.locator("#fork-heading").inner_text()
    assert compare.locator("#b-outcome").inner_text() == "FAILED"
    compare.screenshot(path=str(OUT / "compare.png"), animations="disabled")
    compare.evaluate("window.scrollTo({ top: document.querySelector('#timeline').getBoundingClientRect().top + window.scrollY - 86, behavior: 'instant' })")
    compare.screenshot(path=str(OUT / "compare-timeline.png"), animations="disabled")
    compare.evaluate("window.scrollTo({ top: document.querySelector('#changes').getBoundingClientRect().top + window.scrollY - 86, behavior: 'instant' })")
    compare.screenshot(path=str(OUT / "compare-patches.png"), animations="disabled")
    compare.locator(".patch-path").last.click()
    assert compare.locator("#patch-b").inner_text() == "No patch for this file in this run."
    compare.locator(".timeline-row").filter(has_text="npm test").first.locator(".timeline-cell").last.click()
    assert "1 failed" in compare.locator("#event-detail").inner_text()
    with compare.expect_download() as export:
        compare.locator("#download-btn").click()
    assert "SHARE SAFE" in Path(export.value.path()).read_text(encoding="utf-8")
    assert not compare_errors, compare_errors
    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1, locale="en-US")
    mobile.goto(URL)
    mobile.locator(".event-card").first.click()
    assert "open" in mobile.locator("#inspector").get_attribute("class")
    mobile.locator("#inspector-close").click()
    assert "open" not in mobile.locator("#inspector").get_attribute("class")
    mobile.locator('[data-view="changes"]').click()
    mobile.locator(".change-row").first.click()
    assert "open" in mobile.locator("#inspector").get_attribute("class")
    mobile.goto((ROOT / "docs" / "compare.html").as_uri())
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    mobile.screenshot(path=str(OUT / "compare-mobile.png"), animations="disabled")
    for width in (768, 1024, 1440):
        mobile.set_viewport_size({"width": width, "height": 900})
        assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), width
    browser.close()

print(OUT)
