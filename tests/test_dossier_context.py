"""dossier_context — seed ids + excerpt assembly (no LLM)."""
from uuid import uuid4

from backend.services.dossier_context import assemble_dossier_context, seed_linkable_ids
from tests.test_dispute_ready import FakeDB, PROJECT_A


def test_seed_includes_change_links_and_manual_skip():
    db = FakeDB()
    change_id = str(uuid4())
    corr_id = str(uuid4())
    db.tables["correspondence_change_links"] = [
        {"change_id": change_id, "correspondence_id": corr_id},
    ]
    ids = seed_linkable_ids(db, change_id=change_id)
    assert corr_id in ids


def test_assemble_includes_manual_exhibit_note():
    db = FakeDB()
    dispute_id = str(uuid4())
    db.tables["projects"] = [{
        "id": PROJECT_A,
        "name": "Site A",
        "contract_type": "FIDIC",
    }]
    db.tables["pdf_document"] = []
    db.tables["disputes"] = [{
        "id": dispute_id,
        "project_id": PROJECT_A,
        "dispute_number": "DSP-001",
        "title": "HVAC",
        "summary": "Rejected",
        "origin": "change",
        "source_change_id": None,
        "source_correspondence_id": None,
        "dispute_impacts": [],
        "dispute_issues": [{
            "title": "Cost",
            "dispute_positions": [{
                "side": "claim",
                "title": "EOT",
                "summary": "14 days",
                "dispute_position_refs": [{
                    "ref_type": "manual",
                    "manual_title": "MOM 12 Apr",
                    "manual_note": "Employer refused time.",
                    "document_id": None,
                    "entity_id": None,
                }],
            }],
        }],
    }]
    ctx = assemble_dossier_context(db, PROJECT_A, dispute_id=dispute_id)
    assert "MOM 12 Apr" in ctx["corpus"]
    assert "Employer refused time." in ctx["corpus"]
    assert ctx["project_name"] == "Site A"
