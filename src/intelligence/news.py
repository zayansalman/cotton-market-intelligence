from __future__ import annotations

import re
import ssl
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

# SSL context for RSS fetch (some feeds require TLS)
_SSL = ssl.create_default_context()


@dataclass
class NewsItem:
    title: str
    link: str = ""
    summary: str = ""


@dataclass
class NewsDigest:
    items: list[NewsItem]
    sentiment_score: float  # blended; -1 stress/tighten cover → +1 soft/delay
    keywords_hit: dict[str, int] = field(default_factory=dict)
    sources_fetched: int = 0
    keyword_sentiment_score: float = 0.0
    hf_sentiment_score: float | None = None
    hf_model_id: str | None = None
    relevance_ranked: bool = False


_BEARISH = (
    "drought",
    "heat",
    "freeze",
    "export ban",
    "embargo",
    "tight",
    "shortage",
    "war",
    "sanction",
    "strike",
    "logistics",
    "freight",
    "inflation",
    "rally",
    "surge",
    "record high",
)
_BULLISH = (
    "surplus",
    "record crop",
    "bumper",
    "plunge",
    "drop",
    "bearish",
    "oversupply",
    "slow demand",
    "recession",
    "lower",
)


def _score_text(text: str) -> tuple[float, dict[str, int]]:
    t = text.lower()
    hits: dict[str, int] = {}
    score = 0.0
    for kw in _BEARISH:
        if kw in t:
            hits[f"bearish:{kw}"] = hits.get(f"bearish:{kw}", 0) + 1
            score -= 0.12
    for kw in _BULLISH:
        if kw in t:
            hits[f"bullish:{kw}"] = hits.get(f"bullish:{kw}", 0) + 1
            score += 0.1
    return float(max(-1.0, min(1.0, score))), hits


def _parse_rss(xml_bytes: bytes) -> list[NewsItem]:
    root = ET.fromstring(xml_bytes)
    items: list[NewsItem] = []
    # RSS 2.0: channel/item ; Atom: entry
    for path in (".//item", ".//{http://www.w3.org/2005/Atom}entry"):
        for node in root.findall(path):
            title_el = node.find("title")
            link_el = node.find("link")
            title = (title_el.text or "").strip() if title_el is not None else ""
            link = ""
            if link_el is not None:
                link = (link_el.text or link_el.get("href") or "").strip()
            summ_el = node.find("description") or node.find(
                "{http://www.w3.org/2005/Atom}summary"
            )
            summary = (summ_el.text or "").strip() if summ_el is not None else ""
            summary = re.sub(r"<[^>]+>", "", summary)[:500]
            if title:
                items.append(NewsItem(title=title, link=link, summary=summary))
    return items[:25]


def fetch_news_digest(feed_urls: list[str], timeout: int = 12) -> NewsDigest:
    """
    Fetch headlines from RSS/Atom URLs and aggregate sentiment.

    If ``transformers`` + ``torch`` are installed (see ``requirements-ml.txt``),
    blends **keyword** scores with **Hugging Face** sentiment (default: FinBERT).
    Optional semantic re-ranking via ``sentence-transformers`` when
    ``CMI_HF_RELEVANCE=1`` (see ``src/intelligence/hf_nlp.py``).
    """
    from . import hf_nlp

    all_items: list[NewsItem] = []
    sources = 0
    for url in feed_urls:
        if not url or not url.startswith("http"):
            continue
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "cotton-market-intelligence/1.0"},
            )
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as resp:
                raw = resp.read()
            all_items.extend(_parse_rss(raw))
            sources += 1
        except OSError:
            continue

    relevance_ranked = False
    if hf_nlp.use_relevance_filter() and all_items:
        all_items = hf_nlp.rank_by_cotton_relevance(all_items)
        relevance_ranked = True

    slice_items = all_items[:40]
    combined = " ".join(i.title + " " + i.summary for i in slice_items)
    kw_sentiment, hits = _score_text(combined)

    texts = [f"{i.title}. {i.summary}" for i in slice_items[:25]]
    hf_sent, hf_mid = hf_nlp.score_headlines_hf(texts)
    blended = hf_nlp.blend_scores(kw_sentiment, hf_sent)

    return NewsDigest(
        items=all_items[:15],
        sentiment_score=blended,
        keywords_hit=hits,
        sources_fetched=sources,
        keyword_sentiment_score=kw_sentiment,
        hf_sentiment_score=hf_sent,
        hf_model_id=hf_mid,
        relevance_ranked=relevance_ranked,
    )


def load_feed_urls_from_yaml(path: Any) -> list[str]:
    """Load list of feed URLs from YAML file path (str or Path)."""
    from pathlib import Path

    import yaml

    p = Path(path)
    if not p.exists():
        return []
    data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    feeds = data.get("feeds", [])
    return [f.get("url", "") for f in feeds if isinstance(f, dict)]
