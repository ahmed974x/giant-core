"""Tests for the second brain (ADR-081). Pure logic first; then, when MIND_TEST_SOCKET is set (scripts/test-nerve.sh),
an end-to-end run through the brain.* functions as the `ameen` login on a throw-away database."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import analysis
import atomise
import clusters
import exporter
import linker
import service
import pg8000
import pytest
import worker
from embed import HashingEmbedder


def vec(*xs):
    return list(xs) + [0.0] * (8 - len(xs))


# ── Atomiser ──
def test_a_note_splits_into_atoms_in_order_without_duplicates():
    note = "فكرة: مصباح يتبع الكتاب.\n- لازم أسوي نموذج\nلازم أسوي نموذج\n"
    assert atomise.split_atoms(note) == ["فكرة: مصباح يتبع الكتاب.", "لازم أسوي نموذج"]


def test_types_follow_the_first_matching_rule():
    assert atomise.classify("ليش ما اشتغل المحرك؟") == "question"
    assert atomise.classify("What should I do next?") == "question"
    assert atomise.classify("لازم أتصل بالمورد اليوم") == "task"
    assert atomise.classify("خايف أن السعر ينزل") == "worry"
    assert atomise.classify("قررت أوقف التداول اليدوي") == "decision"
    assert atomise.classify("Brent closed at 84 USD") == "fact"
    assert atomise.classify("https://example.org/report") == "source"
    assert atomise.classify("مصباح يتبع الكتاب") == "idea"


def test_entities_keep_names_and_tags():
    assert atomise.entities("Brent and #oil with @Maha") == ["Brent", "oil", "Maha"]


# ── Linker ──
def atom(i, text, typ, emb, ents=()):
    return {"id": i, "text": text, "type": typ, "entities": list(ents), "embedding": emb,
            "captured_at": datetime(2026, 10, 16, tzinfo=UTC)}


def test_close_atoms_get_a_similar_link_with_a_reason():
    a, b = atom(1, "lamp", "idea", vec(1, 0.1)), atom(2, "lamp follows the book", "idea", vec(1, 0.12))
    out = linker.candidates([a], [b], 0.55)
    assert [(x["src"], x["dst"], x["type"]) for x in out] == [(1, 2, "similar_to")]
    assert "similar wording" in out[0]["why"]


def test_an_idea_and_a_task_that_share_a_name_lead_to_each_other():
    idea = atom(1, "reading lamp", "idea", vec(1, 0.2), ["Lamp"])
    task = atom(2, "buy the lamp parts", "task", vec(0.9, 0.3), ["Lamp"])
    kinds = [x["type"] for x in linker.candidates([task], [idea], 0.99)]
    assert "leads_to" in kinds


def test_opposite_wording_on_the_same_thing_is_flagged_not_merged():
    yes = atom(1, "Brent will break 90", "fact", vec(1, 0.5))
    no = atom(2, "Brent will not break 90", "fact", vec(1, 0.5))
    kinds = {x["type"] for x in linker.candidates([no], [yes], 0.99)}
    assert "contradicts" in kinds and "similar_to" not in kinds


def test_at_most_five_candidates_per_atom():
    old = [atom(i, f"t{i}", "idea", vec(1, 0.01 * i)) for i in range(2, 30)]
    out = linker.candidates([atom(1, "x", "idea", vec(1, 0))], old, 0.5)
    assert len(out) <= linker.MAX_PER_ATOM


# ── Themes ──
def test_two_separate_groups_become_two_named_themes():
    nodes = [{"id": i, "text": "lamp reading book" if i < 4 else "oil price brent"} for i in range(1, 7)]
    edges = [{"src": a, "dst": b, "confidence": 0.9} for a, b in [(1, 2), (2, 3), (1, 3), (4, 5), (5, 6), (4, 6)]]
    mapping, named = clusters.assign(nodes, edges)
    assert mapping[1] == mapping[2] == mapping[3] != mapping[4]
    assert len(named) == 2 and named[0]["size"] == 3
    assert "lamp" in named[0]["name"] or "reading" in named[0]["name"] or "book" in named[0]["name"]


def test_the_same_graph_gives_the_same_themes():
    nodes = [{"id": i, "text": f"word{i % 3} thing"} for i in range(1, 10)]
    edges = [{"src": i, "dst": i + 1, "confidence": 0.5} for i in range(1, 9)]
    assert clusters.assign(nodes, edges) == clusters.assign(nodes, edges)


# ── Rescue ──
def test_a_brain_dump_is_sorted_and_capped():
    atoms = [atom(i, f"thought {i}", "idea", vec(1, 0.001 * i)) for i in range(1, 6)]
    atoms += [atom(10 + i, f"task {i}", "task", vec(0, 1, 0.01 * i)) for i in range(5)]
    atoms += [atom(20, "why?", "question", vec(0, 0, 1))]
    out = analysis.brain_dump(atoms)
    assert len(out["next_actions"]) == 3
    assert len(out["parked"]) >= 2                       # the tasks beyond three are parked, not dropped
    assert [q["id"] for q in out["questions"]] == [20]
    assert len(out["themes"]) <= 7


def test_a_loop_is_a_worry_back_on_three_days_with_no_closing_link():
    now = datetime(2026, 10, 16, 12, tzinfo=UTC)
    loop_atoms = [{"id": i, "text": "I keep worrying about the deadline", "type": "worry", "embedding": vec(1, 0.01 * i),
                   "captured_at": now - timedelta(days=d)} for i, d in ((1, 0), (2, 1), (3, 2))]
    loops = analysis.find_loops(loop_atoms, [], now)
    assert loops and loops[0]["days"] == 3 and loops[0]["ids"] == [1, 2, 3]
    closed = analysis.find_loops(loop_atoms, [{"src": 1, "dst": 9, "type": "leads_to", "state": "accepted"}], now)
    assert closed == []


def test_collision_is_deterministic_per_day_and_crosses_themes():
    atoms = [atom(1, "lamp", "idea", vec(1, 0)), atom(2, "oil", "idea", vec(0.3, 0.95))]   # cosine 0.3: related, not the same
    clus = {1: 0, 2: 1}
    first = analysis.collision(atoms, clus, "2026-10-16")
    assert first and first == analysis.collision(atoms, clus, "2026-10-16")
    assert analysis.collision(atoms, {1: 0, 2: 0}, "2026-10-16") is None   # same theme: no collision


def test_think_answers_only_from_the_owners_atoms_and_asks_next():
    assert analysis.think("x", [])["cites"] == []
    out = analysis.think("lamp?", [{"id": 4, "text": "lamp idea", "type": "question"}])
    assert out["cites"] == [4] and "[#4]" in out["answer"] and out["next_question"]


def test_no_analysis_module_can_reach_a_proposal():
    for mod in (analysis, linker, clusters, atomise, exporter):
        source = Path(mod.__file__).read_text(encoding="utf-8")
        assert "proposals" not in source and "fahd" not in source


# ── Export ──
def test_export_writes_one_linked_file_per_atom(tmp_path):
    snap = {"clusters": [{"key": 0, "name": "lamp", "size": 1}],
            "nodes": [{"id": 1, "text": "lamp idea", "type": "idea", "captured_at": "2026-10-16", "cluster": 0}],
            "edges": [{"src": 1, "dst": 2, "type": "similar_to", "state": "suggested", "why": "close"}]}
    files = exporter.render(snap)
    assert list(files) == ["lamp/n1.md"]
    assert "[[n2]] (suggested)" in files["lamp/n1.md"] and "id: n1" in files["lamp/n1.md"]
    assert exporter.write(str(tmp_path), files) == 1
    assert (tmp_path / "lamp" / "n1.md").read_text(encoding="utf-8").startswith("---")


def test_export_never_writes_outside_its_folder(tmp_path):
    with pytest.raises(ValueError):
        exporter.write(str(tmp_path / "out"), {"../escape.md": "x"})


def test_the_nightly_run_waits_for_its_hour_and_runs_once_a_day():
    now = datetime(2026, 10, 16, 2, 30, tzinfo=UTC)
    assert worker.due(now, None, 2)
    assert not worker.due(now, "2026-10-16", 2)
    assert not worker.due(datetime(2026, 10, 16, 1, tzinfo=UTC), None, 2)


def test_the_hashing_embedder_is_what_the_brain_uses_offline():
    assert HashingEmbedder().name.startswith("hashing-")


# ── End to end (throw-away Postgres from scripts/test-nerve.sh) ──
needs_db = pytest.mark.skipif(not os.environ.get("MIND_TEST_SOCKET"), reason="needs MIND_TEST_SOCKET (scripts/test-nerve.sh)")


@needs_db
def test_end_to_end_capture_link_decide_and_forget_is_refused_for_the_worker(tmp_path):
    os.environ.update(AMEEN_DB_SOCKET=os.environ["MIND_TEST_SOCKET"], AMEEN_DB_USER="ameen",
                      AMEEN_DB_PASSWORD=os.environ.get("AMEEN_DB_PASSWORD", "test-only"), POSTGRES_DB="omega_test")
    import store
    db = store.connect()
    try:
        first = service.capture(db, "lamp idea: a reading lamp that follows the book\nلازم أسوي نموذج أولي للمصباح")
        assert first["raw_id"] and len(first["atoms"]) == 2
        assert [a["type"] for a in first["atoms"]] == ["idea", "task"]
        second = service.capture(db, "the reading lamp should follow the book")
        assert second["suggested_links"] >= 1
        snap = store.snapshot(db)
        edge = next(e for e in snap["edges"] if e["state"] == "suggested")
        store.decide(db, edge["id"], "accepted")
        assert next(e for e in store.snapshot(db)["edges"] if e["id"] == edge["id"])["state"] == "accepted"
        assert store.capture(db, "my key is sk-ant-api03-abcdefghijklmnopqrstuv") is None      # refused, nothing stored
        out = service.refresh_clusters(db)
        assert out["clusters"] >= 1
        assert service.digest(db)["open_suggestions"] >= 0
        assert service.export(db, str(tmp_path)) >= 3
        assert sorted(p.name for p in tmp_path.rglob("n*.md")) == sorted(f"n{a['id']}.md" for a in first["atoms"] + second["atoms"])
        graph = service.graph_view(db)
        assert all("embedding" not in n for n in graph["nodes"])
        # the worker is not the owner: it cannot erase the brain
        try:
            db.run("SELECT brain.forget_user('owner')")
            raise AssertionError("the worker must not be able to forget")
        except pg8000.exceptions.DatabaseError as exc:
            assert "permission denied" in str(exc)
    finally:
        db.close()
