"""Generate the three figures for the Results & Discussion sections.

Outputs (written into ./images/):
  fig_latency.png           - verification latency distribution vs 200 ms target
  fig_qr_recognition.png    - A/B grouped bar chart for survey item 4.2
  fig_qr_comparison.png     - side-by-side Big QR vs Small QR

Run from the CS199_2526A_QRCodeSecurity/ directory:
    python3 figures.py
"""

from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import qrcode
from PIL import Image

ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images"
LOGS = ROOT / "logs"
IMAGES.mkdir(exist_ok=True)


def load_latency_trials() -> list[int]:
    """Pull the per-trial verify_ms values from the captured benchmark log."""
    log = (LOGS / "latency.txt").read_text()
    match = re.search(r"__LATENCY_JSON__(.*?)__LATENCY_JSON_END__", log, re.S)
    if match:
        data = json.loads(match.group(1))
        return [t["verifyMs"] for t in data["trialLog"]]
    # Fallback: parse the trial-by-trial table.
    rows = re.findall(r"^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$", log, re.M)
    return [int(verify) for _, _, verify, _ in rows]


def fig_latency(verify_ms: list[int]) -> None:
    fig, ax = plt.subplots(figsize=(7.0, 3.6), dpi=200)

    edges = np.arange(min(verify_ms) - 0.5, max(verify_ms) + 1.5, 1.0)
    ax.hist(
        verify_ms,
        bins=edges,
        color="#2c5aa0",
        edgecolor="white",
        linewidth=0.8,
        alpha=0.92,
        zorder=3,
    )

    mean = float(np.mean(verify_ms))
    p99 = float(np.percentile(verify_ms, 99))
    ax.axvline(mean, color="#d73027", linestyle="--", linewidth=1.3, zorder=4,
               label=f"Mean = {mean:.2f} ms")
    ax.axvline(p99, color="#fc8d59", linestyle=":", linewidth=1.3, zorder=4,
               label=f"p99 = {p99:.0f} ms")

    ax.text(
        0.02, 0.92,
        "Target: < 200 ms (off-chart)\n25x margin at p99",
        transform=ax.transAxes,
        ha="left", va="top",
        fontsize=9,
        bbox=dict(boxstyle="round,pad=0.4", facecolor="#f0f0f0",
                  edgecolor="#888888", linewidth=0.6),
    )

    ax.set_xlabel("Verification latency (ms)")
    ax.set_ylabel("Number of trials")
    ax.set_title(f"Verification latency distribution (n = {len(verify_ms)})")
    ax.grid(axis="y", linestyle="--", linewidth=0.5, color="#cccccc", zorder=0)
    ax.set_xticks(np.arange(min(verify_ms), max(verify_ms) + 1, 1))
    ax.set_axisbelow(True)
    ax.legend(loc="upper right", framealpha=0.95, fontsize=9)
    ax.set_ylim(0, max(np.histogram(verify_ms, bins=edges)[0]) * 1.20)

    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    fig.tight_layout()
    out = IMAGES / "fig_latency.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {out.relative_to(ROOT)}")


def fig_qr_recognition() -> None:
    """Q4.2 grouped bar chart: A (Big QR) vs B (Small QR), 5 each."""
    categories = ["Yes,\nimmediately", "Took 2-3 s\nto focus", "Failed /\nretry"]
    group_a = [2, 3, 0]   # Big QR
    group_b = [5, 0, 0]   # Small QR

    x = np.arange(len(categories))
    width = 0.36

    fig, ax = plt.subplots(figsize=(7.0, 3.8), dpi=200)
    bars_a = ax.bar(x - width / 2, group_a, width,
                    label="Group A (Big QR, n = 5)", color="#2c5aa0",
                    edgecolor="white", linewidth=0.8, zorder=3)
    bars_b = ax.bar(x + width / 2, group_b, width,
                    label="Group B (Small QR, n = 5)", color="#fc8d59",
                    edgecolor="white", linewidth=0.8, zorder=3)

    for bars in (bars_a, bars_b):
        for bar in bars:
            height = bar.get_height()
            if height > 0:
                ax.annotate(
                    f"{int(height)}/5",
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 3),
                    textcoords="offset points",
                    ha="center", va="bottom", fontsize=9,
                )

    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    ax.set_ylabel("Participants")
    ax.set_yticks(np.arange(0, 6, 1))
    ax.set_ylim(0, 5.7)
    ax.set_title("UAT Item 4.2 — Did the cashier's scanner recognise the QR\non the first attempt?")
    ax.grid(axis="y", linestyle="--", linewidth=0.5, color="#cccccc", zorder=0)
    ax.set_axisbelow(True)
    ax.legend(loc="upper right", framealpha=0.95, fontsize=9)

    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    fig.tight_layout()
    out = IMAGES / "fig_qr_recognition.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {out.relative_to(ROOT)}")


def _render_qr(payload: str, error_correction=qrcode.constants.ERROR_CORRECT_M) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,                       # auto-fit
        error_correction=error_correction,
        box_size=8,
        border=2,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img, qr.version


def fig_qr_comparison() -> None:
    """Render two real QRs of comparable display size: Big (full payload) vs
    Small (reference token only). Both rendered to the same physical bbox so
    the difference in module density is visible at a glance."""

    big_payload = json.dumps({
        "PK":  "0x" + secrets.token_hex(48),
        "g":   "0x" + secrets.token_hex(48),
        "Fsig": "0x" + secrets.token_hex(48),
        "M": {
            "merchant_id": "MID-7732-NCR-2026",
            "amount": 1500,
            "timestamp": 1714610000000,
            "nonce": secrets.token_hex(16),
        },
    }, separators=(",", ":"))

    small_payload = "tx://" + secrets.token_urlsafe(12)

    big_img, big_v = _render_qr(big_payload, qrcode.constants.ERROR_CORRECT_L)
    small_img, small_v = _render_qr(small_payload, qrcode.constants.ERROR_CORRECT_M)

    fig, axes = plt.subplots(1, 2, figsize=(7.2, 4.0), dpi=200)

    target_size = max(big_img.size[0], small_img.size[0])

    def fit(im: Image.Image) -> Image.Image:
        canvas = Image.new("RGB", (target_size, target_size), "white")
        x = (target_size - im.size[0]) // 2
        y = (target_size - im.size[1]) // 2
        canvas.paste(im, (x, y))
        return canvas

    axes[0].imshow(fit(big_img))
    axes[0].set_title(
        f"(a) Big QR — full in-band payload\n"
        f"version {big_v}, ~{len(big_payload)} bytes",
        fontsize=10,
    )

    axes[1].imshow(fit(small_img))
    axes[1].set_title(
        f"(b) Small QR — reference token\n"
        f"version {small_v}, {len(small_payload)} bytes",
        fontsize=10,
    )

    for ax in axes:
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_visible(False)

    fig.tight_layout()
    out = IMAGES / "fig_qr_comparison.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {out.relative_to(ROOT)} (Big v={big_v}, Small v={small_v})")


def main() -> None:
    print("Generating thesis figures...")
    verify_ms = load_latency_trials()
    print(f"  loaded {len(verify_ms)} latency trials")
    fig_latency(verify_ms)
    fig_qr_recognition()
    fig_qr_comparison()
    print("Done.")


if __name__ == "__main__":
    main()
