"""Record the synthetic Codex-to-export walkthrough for the README.

Optional authoring dependencies: playwright, Chrome, and ffmpeg (or imageio-ffmpeg).
Run `npm run demo` before this script so docs/index.html is current.
"""

from pathlib import Path
from shutil import which
from subprocess import run
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PAGE = (ROOT / "docs" / "index.html").as_uri()
OUT = ROOT / "docs" / "demo-walkthrough.gif"


def ffmpeg_executable():
    executable = which("ffmpeg")
    if executable:
        return executable
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ImportError as error:
        raise RuntimeError("Install ffmpeg or `python -m pip install imageio-ffmpeg`.") from error
    return get_ffmpeg_exe()


def move_cursor(page, selector):
    target = page.locator(selector)
    target.scroll_into_view_if_needed()
    box = target.bounding_box()
    assert box, selector
    page.evaluate("([x, y]) => { const cursor = document.querySelector('#walkthrough-cursor'); cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; cursor.style.opacity = '1'; }", [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
    page.wait_for_timeout(260)


with TemporaryDirectory() as temp, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel="chrome", args=["--disable-gpu"])
    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        device_scale_factor=1,
        locale="en-US",
        accept_downloads=True,
        record_video_dir=temp,
        record_video_size={"width": 1280, "height": 800},
    )
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(PAGE)
    page.wait_for_selector(".event-card")
    page.evaluate(r"""() => {
      const style = document.createElement('style');
      style.textContent = `
        #walkthrough-intro { position:fixed;inset:0;z-index:1000;background:radial-gradient(circle at 80% 10%,#233b29,#0c1318 48%);display:grid;place-items:center;transition:opacity .38s; }
        #walkthrough-intro .frame { width:min(850px,calc(100vw - 110px)); }
        #walkthrough-intro .eyebrow { color:#b9ef80;font:700 12px ui-monospace,Consolas,monospace;letter-spacing:2px;margin-bottom:22px; }
        #walkthrough-intro h1 { color:#f0f7e9;font:700 52px/1.05 Inter,'Segoe UI',sans-serif;letter-spacing:-2px;margin:0 0 30px; }
        #walkthrough-intro h1 em { color:#c5f48e;font-style:normal; }
        #walkthrough-intro .terminal { border:1px solid #3d5746;border-radius:14px;overflow:hidden;background:#101b1e;box-shadow:0 30px 100px #0008; }
        #walkthrough-intro .terminal-head { padding:12px 18px;background:#1e2d2a;color:#a8c5ad;font:700 11px ui-monospace,Consolas,monospace;letter-spacing:1px;display:flex;justify-content:space-between; }
        #walkthrough-intro .terminal-head b { color:#c7ef97; }
        #walkthrough-intro pre { margin:0;padding:25px;color:#e4f0e0;font:15px/1.65 ui-monospace,Consolas,monospace;min-height:210px;white-space:pre-wrap; }
        #walkthrough-caption { position:fixed;z-index:1002;left:50%;bottom:24px;transform:translateX(-50%);border:1px solid #67844f;border-radius:8px;background:#12201cee;padding:11px 18px;color:#dcf9c2;font:800 12px ui-monospace,Consolas,monospace;letter-spacing:1.2px;box-shadow:0 8px 30px #0007;white-space:nowrap; }
        #walkthrough-cursor { position:fixed;z-index:1003;width:20px;height:20px;margin:-10px 0 0 -10px;border:2px solid #132319;border-radius:50%;background:#c8fb91;box-shadow:0 0 0 5px #c8fb9144,0 0 26px #c8fb91aa;pointer-events:none;opacity:0;transition:left .25s ease,top .25s ease,opacity .2s; }
        #walkthrough-toast { position:fixed;z-index:1002;right:24px;top:82px;border:1px solid #709157;border-radius:10px;padding:15px 18px;background:#203427;color:#eaffd6;box-shadow:0 20px 55px #0009;font:700 12px ui-monospace,Consolas,monospace; }
        #walkthrough-toast small { display:block;color:#a9c49e;margin-top:7px;font-size:10px; }
      `;
      document.head.append(style);
      const intro = document.createElement('div');
      intro.id = 'walkthrough-intro';
      intro.innerHTML = `<div class="frame"><div class="eyebrow">AGENTLENS / SYNTHETIC CODEX RUN</div><h1>From coding run<br>to <em>inspectable replay.</em></h1><div class="terminal"><div class="terminal-head"><span>CODEX CLI · AGENTLENS RECORDING</span><b>● LIVE</b></div><pre id="walkthrough-terminal"></pre></div></div>`;
      document.body.append(intro);
      const caption = document.createElement('div'); caption.id = 'walkthrough-caption'; caption.textContent = '01 / 05 · CODEX EXECUTES'; document.body.append(caption);
      const cursor = document.createElement('div'); cursor.id = 'walkthrough-cursor'; document.body.append(cursor);
      document.querySelector('#walkthrough-terminal').textContent = '$ agentlens run codex "Fix cache invalidation"\n';
      const list = document.querySelector('#timeline-list');
      list.style.transition = 'opacity .45s ease, transform .45s ease';
      list.style.opacity = '0';
      list.style.transform = 'translateY(14px)';
    }""")
    page.wait_for_timeout(480)
    page.evaluate("document.querySelector('#walkthrough-terminal').textContent += 'Recording Codex in /workspace/atlas\\n  › rg --files src tests\\n'")
    page.wait_for_timeout(410)
    page.evaluate("document.querySelector('#walkthrough-terminal').textContent += '  › cat src/cache.ts\\n  ✎ 2 files changed\\n'")
    page.wait_for_timeout(420)
    page.evaluate("document.querySelector('#walkthrough-terminal').textContent += '  ✓ 14,356 tokens · replay ready\\n'")
    page.wait_for_timeout(430)

    page.evaluate("window.scrollTo({ top: 510, behavior: 'instant' }); document.querySelector('#walkthrough-caption').textContent = '02 / 05 · TIMELINE APPEARS'; document.querySelector('#walkthrough-intro').style.opacity = '0'; document.querySelector('#timeline-list').style.opacity = '1'; document.querySelector('#timeline-list').style.transform = 'translateY(0)';")
    page.wait_for_timeout(390)
    page.evaluate("document.querySelector('#walkthrough-intro').remove()")
    page.wait_for_timeout(580)

    page.evaluate("document.querySelector('#walkthrough-caption').textContent = '03 / 05 · INSPECT COMMAND OUTPUT'")
    move_cursor(page, ".event-card:nth-child(2)")
    page.locator(".event-card").nth(1).click()
    assert "cat src/cache.ts" in page.locator("#inspector-content").inner_text()
    page.wait_for_timeout(760)

    page.evaluate("document.querySelector('#walkthrough-caption').textContent = '04 / 05 · REVIEW CODE DIFF'")
    move_cursor(page, '[data-view="changes"]')
    page.locator('[data-view="changes"]').click()
    move_cursor(page, ".change-row:first-child")
    page.locator(".change-row").first.click()
    assert "PATCH" in page.locator("#inspector-content").inner_text()
    page.wait_for_timeout(790)

    page.evaluate("document.querySelector('#walkthrough-caption').textContent = '05 / 05 · EXPORT SHARE-SAFE HTML'")
    page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
    move_cursor(page, "#download-btn")
    with page.expect_download() as export:
        page.locator("#download-btn").click()
    assert export.value.suggested_filename.endswith(".html")
    page.evaluate("""() => { const toast = document.createElement('div'); toast.id = 'walkthrough-toast'; toast.innerHTML = '✓ SHARE-SAFE HTML EXPORTED<small>One file · offline · ready for a PR</small>'; document.body.append(toast); }""")
    page.wait_for_timeout(880)
    assert not page_errors, page_errors
    video = Path(page.video.path())
    page.close()
    context.close()
    browser.close()

    ffmpeg = ffmpeg_executable()
    palette = Path(temp) / "palette.png"
    settings = ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.35", "-i", str(video)]
    filters = "fps=8,scale=1152:720:flags=lanczos"
    run([ffmpeg, *settings, "-vf", f"{filters},palettegen=max_colors=96", str(palette)], check=True)
    run([ffmpeg, *settings, "-i", str(palette), "-lavfi", f"{filters}[frames];[frames][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", str(OUT)], check=True)

print(OUT)
