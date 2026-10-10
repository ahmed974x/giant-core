"""Truth Layer: a credibility score for every GDELT news item before Director 00 may use it (ADR-021).

    truth_score = 0.45 x source reputation + 0.30 x corroboration + 0.25 x language neutrality - penalties   (0..1)

  source reputation : curated tiers in sources.json (wire, record, public, official, specialist, state-controlled,
                      satire, unknown). No external API; the list is reviewed like code.
  corroboration     : how many *independent* sources carry the story. GDELT events report NumSources directly;
                      GKG articles are matched to other articles in the same batch that share at least two specific
                      entities (place, organisation, person) from a different domain.
  neutrality        : GDELT tone and polarity (emotive coverage scores lower) plus loaded-language patterns in the
                      headline or URL slug ("shocking", "exposed", "you won't believe", "traitors", ...).
  penalties         : opinion/editorial pages, propaganda patterns, single-source claims from unknown outlets.

Items scoring below 0.7 are "unverified": they are stored and shown, but Director 00 and the Butterfly Engine do not
use them as evidence for decisions. Every score keeps its flags, so a human can see *why* an item was held back.
Pure standard library: no model, no network, microseconds per item.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

THRESHOLD = 0.70
_SOURCES = json.loads((Path(__file__).with_name("sources.json")).read_text(encoding="utf-8"))
TIERS = {k: v["score"] for k, v in _SOURCES["tiers"].items()}
DOMAINS: dict[str, str] = _SOURCES["domains"]

OPINION = re.compile(r"/(opinion|opinions|op-?ed|oped|comment|commentary|editorial|editorials|column|columns|columnists?|blogs?|analysis/opinion|views?)/", re.I)
LOADED = re.compile(
    r"\b(shocking|bombshell|exposed|exposes|you won'?t believe|the truth about|wake up|cover-?up|traitors?|puppets?|"
    r"regime'?s? lies|lies of|evil|destroy(?:ed|s)?|slams?|annihilat\w*|false flag|deep state|globalists?|"
    r"mainstream media|msm|hoax|crisis actors?|they don'?t want you to know)\b", re.I)


@dataclass
class Item:
    """One GDELT news item. Fields not available for a source are left at their defaults."""
    id: str
    url: str
    title: str = ""
    tone: float = 0.0                   # GDELT AvgTone / V2Tone[0], roughly -10..+10
    polarity: float | None = None       # V2Tone[3] (GKG): share of strongly emotional words
    num_sources: int | None = None      # GDELT export NumSources (events)
    corroborating_domains: set[str] = field(default_factory=set)   # filled by corroborate() for GKG batches


def domain(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def reputation(url: str) -> tuple[float, str]:
    """Tier score for the URL's domain, matching parent domains too (edition.cnn.com -> cnn.com)."""
    host = domain(url)
    parts = host.split(".")
    for i in range(len(parts) - 1):
        tier = DOMAINS.get(".".join(parts[i:]))
        if tier:
            return TIERS[tier], tier
    if host.endswith((".gov", ".mil", ".int")) or ".gov." in host:
        return TIERS["official"], "official"
    return TIERS["unknown"], "unknown"


def _slug_text(url: str) -> str:
    path = urlparse(url).path
    return re.sub(r"[-_/]+", " ", re.sub(r"\.\w{2,5}$", "", path))


def score(item: Item) -> dict:
    flags: list[str] = []
    rep, tier = reputation(item.url)
    if tier in ("state_controlled", "satire", "unknown"):
        flags.append(f"source:{tier}")

    sources = item.num_sources if item.num_sources is not None else 1 + len(item.corroborating_domains - {domain(item.url)})
    corroboration = min(1.0, (sources - 1) / 3)                  # 1 source -> 0, 4+ independent sources -> 1
    if sources <= 1:
        flags.append("single_source")

    tone_extremity = min(1.0, abs(item.tone) / 8)
    polarity = min(1.0, (item.polarity or 0) / 15)
    neutrality = 1.0 - max(tone_extremity, polarity)
    if neutrality < 0.5:
        flags.append("emotive_language")

    text = f"{item.title} {_slug_text(item.url)}"
    penalty = 0.0
    if LOADED.search(text):
        flags.append("propaganda_pattern")
        penalty += 0.15
    if OPINION.search(urlparse(item.url).path + "/"):
        flags.append("opinion")
        penalty += 0.10
    if sources <= 1 and tier == "unknown":
        penalty += 0.05                                          # an unknown outlet nobody else confirms

    s = max(0.0, min(1.0, 0.45 * rep + 0.30 * corroboration + 0.25 * neutrality - penalty))
    return {"event_id": item.id, "score": round(s, 3), "status": "verified" if s >= THRESHOLD else "unverified",
            "flags": flags, "source_tier": tier, "sources": sources}


def corroborate(items: list[Item], entities: dict[str, set[str]]) -> None:
    """For a GKG batch: an item is corroborated by other-domain items sharing at least two of its specific entities.
    `entities` maps item id -> its places/organisations/people (lower-case)."""
    by_id = {i.id: i for i in items}
    index: dict[str, set[str]] = {}
    for iid, ents in entities.items():
        for e in ents:
            index.setdefault(e, set()).add(iid)
    for iid, ents in entities.items():
        shared: dict[str, int] = {}
        for e in ents:
            for other in index[e]:
                if other != iid:
                    shared[other] = shared.get(other, 0) + 1
        mine = domain(by_id[iid].url)
        by_id[iid].corroborating_domains = {domain(by_id[o].url) for o, n in shared.items() if n >= 2 and domain(by_id[o].url) != mine}


def usable(result: dict) -> bool:
    """Director 00 and the Butterfly Engine use an item as evidence only when this is True."""
    return result["score"] >= THRESHOLD
