import re

import pytest

from core.cognitive import modes
from core.cognitive.modes import (
    AGENTS,
    ALL_AGENTS,
    BUTTERFLY,
    CATEGORIES,
    COGNITIVE_MODES,
    CognitiveMode,
    get_mode,
    modes_for_agent,
    modes_in_category,
)

ARABIC = re.compile(r"[؀-ۿ]")


def test_registry_size_and_categories():
    assert len(COGNITIVE_MODES) >= 60
    assert len(CATEGORIES) == 11
    for category in CATEGORIES:
        assert modes_in_category(category), f"empty category: {category}"


@pytest.mark.parametrize("mode", COGNITIVE_MODES.values(), ids=lambda m: m.name)
def test_every_mode_is_complete(mode: CognitiveMode):
    assert re.fullmatch(r"/[a-z]+", mode.name)
    assert mode.category in CATEGORIES
    assert mode.description_ar.strip() and ARABIC.search(mode.description_ar)
    assert mode.description_en.strip() and not ARABIC.search(mode.description_en)
    assert len(mode.targets) >= 1
    assert set(mode.targets) <= AGENTS
    assert len(set(mode.targets)) == len(mode.targets)


def test_no_duplicate_names_in_source_list():
    names = [m.name for m in modes._MODES]
    assert len(names) == len(set(names))
    assert len(names) == len(COGNITIVE_MODES)


def test_duplicate_is_rejected():
    mode = get_mode("/verify")
    with pytest.raises(ValueError, match="duplicate"):
        modes._index([mode, mode])


@pytest.mark.parametrize("dropped", ["/oraclexam", "/selfiest"])
def test_misspelled_duplicates_were_dropped(dropped):
    assert dropped not in COGNITIVE_MODES


def test_lookup_helpers():
    assert get_mode("causeeffect") is get_mode("/causeeffect")
    with pytest.raises(KeyError):
        get_mode("/nope")
    butterfly = {m.name for m in modes_for_agent(BUTTERFLY)}
    assert {"/causeeffect", "/firstprinciples", "/logicchain", "/verify"} <= butterfly
    assert all(
        BUTTERFLY in m.targets or ALL_AGENTS in m.targets
        for m in modes_for_agent(BUTTERFLY)
    )


def test_registry_is_read_only():
    with pytest.raises(TypeError):
        COGNITIVE_MODES["/new"] = get_mode("/verify")  # type: ignore[index]
