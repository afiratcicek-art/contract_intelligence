"""sanitize_body_html / html_to_plain — allow-list and model-input shape."""
from backend.core.html_sanitizer import html_to_plain, sanitize_body_html


def test_keeps_allowlisted_classes():
    html = '<p class="indent-1 space-after-md text-align-justify">Hello</p>'
    out = sanitize_body_html(html)
    assert "indent-1" in out
    assert "space-after-md" in out
    assert "text-align-justify" in out
    assert "Hello" in out


def test_drops_unknown_class_without_breaking_the_tag():
    html = '<p class="MsoNormal">Hello</p>'
    out = sanitize_body_html(html)
    assert "MsoNormal" not in out
    assert out.startswith("<p")
    assert "Hello" in out
    assert "<pHello" not in out


def test_strips_script_and_event_handlers():
    html = '<p onclick="alert(1)">x</p><script>alert(1)</script>'
    out = sanitize_body_html(html)
    assert "script" not in out.lower()
    assert "onclick" not in out.lower()
    assert "alert" not in out


def test_html_to_plain_uses_block_boundaries():
    html = "<p>First</p><p>Second</p>"
    assert html_to_plain(html) == "First\nSecond"


def test_html_to_plain_does_not_forward_tags():
    html = '<p class="indent-1">Clause <strong>4.1</strong></p>'
    plain = html_to_plain(html)
    assert "<" not in plain
    assert "4.1" in plain
    assert "Clause" in plain


def test_html_to_plain_unescapes_entities():
    html = "<p>A &amp; B</p>"
    assert html_to_plain(html) == "A & B"


def test_html_to_plain_keeps_table_cells_apart():
    html = "<table><tr><td>A</td><td>B</td></tr></table>"
    plain = html_to_plain(html)
    assert "A" in plain
    assert "B" in plain
    assert "AB" not in plain
