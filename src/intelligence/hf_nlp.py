"""
Hugging Face–powered NLP for headline sentiment and optional semantic relevance.

Designed for spinning-mill procurement: combine rule-based keywords with transformer
sentiment (default: FinBERT for financial tone). Optional multilingual model for
Bengali or other local RSS feeds.

Environment (optional):
  CMI_USE_HF_NLP       — "1" (default if deps installed) / "0" to force keyword-only
  CMI_HF_SENTIMENT_MODEL — e.g. ProsusAI/finbert, nlptown/bert-base-multilingual-uncased-sentiment
  CMI_HF_DEVICE        — cpu | cuda | mps (default: auto)
  CMI_BLEND_KEYWORD    — weight for keyword score (default 0.35)
  CMI_BLEND_HF         — weight for HF score (default 0.65); normalized to sum to 1
  CMI_HF_RELEVANCE     — "1" to rank/filter headlines by similarity to cotton/commodity query
"""
from __future__ import annotations

import logging
import os
import threading
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .news import NewsItem

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_sentiment_pipe: Any = None
_sentiment_model_id: str | None = None
_st_model: Any = None
_ST_MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"

_DEFAULT_FINBERT = "ProsusAI/finbert"
_MULTILINGUAL_SENTIMENT = "nlptown/bert-base-multilingual-uncased-sentiment"


def hf_dependencies_available() -> bool:
    try:
        import transformers  # noqa: F401
        import torch  # noqa: F401

        return True
    except ImportError:
        return False


def sentence_transformers_available() -> bool:
    try:
        import sentence_transformers  # noqa: F401

        return True
    except ImportError:
        return False


def use_hf_nlp() -> bool:
    if os.getenv("CMI_USE_HF_NLP", "").strip().lower() in ("0", "false", "no"):
        return False
    return hf_dependencies_available()


def use_relevance_filter() -> bool:
    return (
        os.getenv("CMI_HF_RELEVANCE", "").strip().lower() in ("1", "true", "yes")
        and sentence_transformers_available()
    )


def _device_map() -> int | str:
    raw = os.getenv("CMI_HF_DEVICE", "").strip().lower()
    if raw == "cpu":
        return -1
    if raw in ("cuda", "mps"):
        return 0 if raw == "cuda" else "mps"
    try:
        import torch

        if torch.cuda.is_available():
            return 0
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return -1


def _get_sentiment_pipeline(model_id: str | None = None) -> tuple[Any, str]:
    global _sentiment_pipe, _sentiment_model_id
    mid = model_id or os.getenv("CMI_HF_SENTIMENT_MODEL", _DEFAULT_FINBERT).strip() or _DEFAULT_FINBERT
    with _lock:
        if _sentiment_pipe is not None and _sentiment_model_id == mid:
            return _sentiment_pipe, mid
        from transformers import pipeline

        device = _device_map()
        logger.info("Loading HF sentiment pipeline: %s (device=%s)", mid, device)
        try:
            _sentiment_pipe = pipeline(
                "sentiment-analysis",
                model=mid,
                tokenizer=mid,
                device=device,
                truncation=True,
                max_length=512,
            )
        except (TypeError, ValueError, RuntimeError) as e:
            logger.warning("HF pipeline device fallback to CPU: %s", e)
            _sentiment_pipe = pipeline(
                "sentiment-analysis",
                model=mid,
                tokenizer=mid,
                device=-1,
                truncation=True,
                max_length=512,
            )
        _sentiment_model_id = mid
        return _sentiment_pipe, mid


def _finbert_label_to_buyer_stress(result: dict[str, Any]) -> float:
    """
    Map FinBERT-style output to [-1, 1] for *buyer* procurement tilt alignment.

    Negative financial sentiment (bad news / tightness) → negative scalar here
    so that strategic.py's news_tilt = -sentiment * k yields earlier cover (positive tilt).
    Positive sentiment (constructive / softer tone) → positive scalar → delay.
    """
    label = str(result.get("label", "")).lower()
    score = float(result.get("score", 0.5))
    # FinBERT: positive / negative / neutral
    if "positive" in label:
        return 0.25 + 0.75 * score  # softer conditions for buyer
    if "negative" in label:
        return -0.25 - 0.75 * score  # stress / tightness
    return 0.0


def _multilingual_star_to_stress(result: dict[str, Any]) -> float:
    """nlptown 1–5 stars → [-1, 1]."""
    label = str(result.get("label", "")).lower()
    score = float(result.get("score", 0.5))
    if "1 star" in label or "2 star" in label:
        return -0.9 * score
    if "5 star" in label or "4 star" in label:
        return 0.85 * score
    if "3 star" in label:
        return 0.0
    return _finbert_label_to_buyer_stress(result)


def _result_to_stress(result: dict[str, Any], model_id: str) -> float:
    mid = model_id.lower()
    if "nlptown" in mid or "multilingual" in mid:
        return _multilingual_star_to_stress(result)
    return _finbert_label_to_buyer_stress(result)


def score_headlines_hf(texts: list[str]) -> tuple[float | None, str | None]:
    """
    Mean sentiment stress in [-1, 1] across non-empty texts. Returns (None, None) on failure.
    """
    if not texts or not use_hf_nlp():
        return None, None
    try:
        pipe, mid = _get_sentiment_pipeline()
    except Exception as e:
        logger.warning("HF sentiment pipeline failed to load: %s", e)
        return None, None

    stresses: list[float] = []
    batch_size = 8
    try:
        for i in range(0, len(texts), batch_size):
            chunk = [t[:2000] for t in texts[i : i + batch_size] if (t or "").strip()]
            if not chunk:
                continue
            out = pipe(chunk)
            if isinstance(out, dict):
                out = [out]
            for res in out:
                stresses.append(_result_to_stress(res, mid))
    except Exception as e:
        logger.warning("HF sentiment inference failed: %s", e)
        return None, None

    if not stresses:
        return None, mid
    return float(sum(stresses) / len(stresses)), mid


def blend_scores(keyword: float, hf: float | None) -> float:
    wk = float(os.getenv("CMI_BLEND_KEYWORD", "0.35"))
    wh = float(os.getenv("CMI_BLEND_HF", "0.65"))
    s = wk + wh
    if s <= 0:
        return keyword
    wk, wh = wk / s, wh / s
    if hf is None:
        return keyword
    return wk * keyword + wh * hf


def rank_by_cotton_relevance(items: list[NewsItem]) -> list[NewsItem]:
    """Sort headlines by semantic similarity to a cotton/commodity procurement query."""
    global _st_model
    if not items or not use_relevance_filter():
        return items
    try:
        from sentence_transformers import SentenceTransformer, util
        import torch
    except ImportError:
        return items

    query = (
        "cotton fiber lint yarn textile spinning commodity price ICE futures "
        "USDA crop supply demand import export"
    )
    texts = [f"{it.title} {it.summary}"[:512] for it in items]

    with _lock:
        if _st_model is None:
            logger.info("Loading sentence-transformers model: %s", _ST_MODEL_ID)
            _st_model = SentenceTransformer(_ST_MODEL_ID)

    try:
        emb_q = _st_model.encode(query, convert_to_tensor=True)
        emb_t = _st_model.encode(texts, convert_to_tensor=True)
        sim = util.cos_sim(emb_q, emb_t)[0]
        pairs = sorted(
            zip(items, sim.cpu().tolist()),
            key=lambda x: -x[1],
        )
        return [p[0] for p in pairs]
    except Exception as e:
        logger.warning("Relevance ranking skipped: %s", e)
        return items


def recommended_multilingual_model() -> str:
    """For Bengali / mixed-language feeds (e.g. Bangladesh press)."""
    return _MULTILINGUAL_SENTIMENT


__all__ = [
    "hf_dependencies_available",
    "sentence_transformers_available",
    "use_hf_nlp",
    "use_relevance_filter",
    "score_headlines_hf",
    "blend_scores",
    "rank_by_cotton_relevance",
    "recommended_multilingual_model",
]
