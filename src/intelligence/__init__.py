"""News digest and narrative synthesis for strategic cotton procurement."""

from . import hf_nlp
from .news import NewsDigest, NewsItem, fetch_news_digest
from .synthesis import StrategicNarrative, synthesize_strategy

__all__ = [
    "hf_nlp",
    "NewsItem",
    "NewsDigest",
    "fetch_news_digest",
    "StrategicNarrative",
    "synthesize_strategy",
]
