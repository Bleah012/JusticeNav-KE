"""Release overlays preserve managed records and published service dependencies."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import pathway_management as pathways
from app import resource_management as resources
from app import service_management as services
from app.catalog import CatalogStore, CatalogUnavailable
from app.catalog_release import include_release_records
from app.config import Settings
from app.pathways import PathwayStore, PathwayUnavailable

PATHWAY_ID = "employment-dispute-information"
SERVICE_ID = "employment-labour-relations-court"


def snapshot(state=None):
    value = None if state is None else state.model_dump(mode="json", by_alias=True)
    return SimpleNamespace(exists=state is not None, to_dict=lambda: value)


def published_ids(state):
    return {row.service.id for row in state.records if row.publication == "published"}


@pytest.fixture(params=["service", "resource", "pathway"])
def release(request):
    settings = Settings(_env_file=None)
    if request.param == "service":
        repository = services.FirestoreServiceRepository(settings)
        state = services.initial_state(CatalogStore())
        identifier, limit = SERVICE_ID, 50
    elif request.param == "resource":
        repository = resources.FirestoreResourceRepository(settings)
        state = resources.initial_state(CatalogStore())
        identifier, limit = "elrc-employment-information", 100
    else:
        repository = pathways.FirestorePathwayRepository(settings, Mock())
        state = pathways.initial_state(PathwayStore())
        identifier, limit = PATHWAY_ID, 30
    return SimpleNamespace(
        repository=repository,
        state=state,
        field=request.param,
        identifier=identifier,
        limit=limit,
    )


def test_only_new_allowlisted_ids_are_added_idempotently(release):
    original = release.state.model_copy(deep=True)
    old_row = next(
        row
        for row in original.records
        if getattr(row, release.field).id != release.identifier
    )
    custom = old_row.model_copy(deep=True)
    getattr(custom, release.field).id = "administrator-record"
    original.records = [custom]
    original.deleted_ids = ["previously-deleted"]
    before = original.model_dump()

    result = release.repository.decode(snapshot(original))

    assert [getattr(row, release.field).id for row in result.records] == [
        "administrator-record",
        release.identifier,
    ]
    assert result.records[0] == custom
    assert result.deleted_ids == original.deleted_ids
    assert original.model_dump() == before
    assert release.repository.decode(snapshot(result)) == result


def test_release_tombstones_are_never_resurrected(release):
    state = release.state.model_copy(deep=True)
    state.records = [
        row
        for row in state.records
        if getattr(row, release.field).id != release.identifier
    ]
    state.deleted_ids = [release.identifier]
    assert release.repository.decode(snapshot(state)) == state


@pytest.mark.parametrize("publication", ["draft", "published", "archived"])
def test_existing_release_records_keep_all_administrator_choices(release, publication):
    state = release.state.model_copy(deep=True)
    row = next(
        row
        for row in state.records
        if getattr(row, release.field).id == release.identifier
    )
    content = getattr(row, release.field)
    setattr(content, "name" if release.field == "service" else "title", "Edited")
    row.publication = publication
    row.ever_published = publication != "draft"
    row.revision = 7
    row.review_note = "Administrator review"
    row.updated_by = "administrator"
    row.updated_at = datetime(2026, 11, 21, tzinfo=UTC)

    assert release.repository.decode(snapshot(state)) == state
    if release.field == "pathway":
        assert release.repository.decode(snapshot(state), set()) == state
        assert release.repository.decode(snapshot(state), {SERVICE_ID}) == state


def test_overlay_revalidates_record_bounds(release):
    template = next(
        row
        for row in release.state.records
        if getattr(row, release.field).id != release.identifier
    )
    rows = []
    for index in range(release.limit):
        row = template.model_copy(deep=True)
        getattr(row, release.field).id = f"existing-{index}"
        rows.append(row)
    state = type(release.state)(records=rows)
    with pytest.raises(ValueError):
        release.repository.decode(snapshot(state))


def service_state(publication):
    state = services.initial_state(CatalogStore())
    row = next(row for row in state.records if row.service.id == SERVICE_ID)
    if publication == "deleted":
        state.records.remove(row)
        state.deleted_ids.append(SERVICE_ID)
    else:
        row.publication = publication
        row.ever_published = publication != "draft"
    return state


def old_pathways():
    state = pathways.initial_state(PathwayStore())
    state.records = [row for row in state.records if row.pathway.id != PATHWAY_ID]
    return state


def sdk_client(service_snapshot, pathway_snapshot):
    events = []
    references = {}
    client = Mock()

    def collection(name):
        def document(identifier):
            key = (name, identifier)
            if key not in references:
                reference = Mock()

                def get(**kwargs):
                    events.append((identifier, kwargs))
                    return (
                        service_snapshot
                        if identifier == "services-v1"
                        else pathway_snapshot
                    )

                reference.get.side_effect = get
                references[key] = reference
            return references[key]

        return SimpleNamespace(document=document)

    client.collection.side_effect = collection
    return client, events, references


def coupled_repositories(publication, state):
    client, events, references = sdk_client(
        snapshot(service_state(publication)), snapshot(state)
    )
    service_repository = services.FirestoreServiceRepository(Settings(_env_file=None))
    repository = pathways.FirestorePathwayRepository(
        Settings(_env_file=None), service_repository
    )
    service_repository.pathway_repository = repository
    service_repository._client = repository._client = client
    return repository, client, events, references


@pytest.mark.parametrize("publication", ["published", "draft", "archived", "deleted"])
@pytest.mark.parametrize("existing_document", [True, False])
def test_reads_gate_new_pathways_without_sdk_writes(publication, existing_document):
    state = old_pathways() if existing_document else None
    repository, client, events, references = coupled_repositories(publication, state)
    transaction = Mock()

    for result in (
        repository.read(),
        repository.read_in_transaction(client, transaction),
    ):
        row = pathways.find_record(result, PATHWAY_ID)
        active = publication == "published"
        assert row.publication == ("published" if active else "draft")
        assert row.ever_published is active
        assert row.revision == 1
        assert row.updated_at is None and row.updated_by is None
        public = pathways.ManagedPathwayStore(
            PathwayStore(), SimpleNamespace(read=lambda: result)
        ).load()
        assert (PATHWAY_ID in {row.id for row in public.pathways}) is active
        assert all(
            row.service_id in published_ids(service_state(publication))
            for row in public.pathways
        )

    assert len(events) == 4  # Linked repositories do not recurse through pathways.
    assert all(kwargs.get("transaction") is transaction for _, kwargs in events[2:])
    client.transaction.assert_not_called()
    transaction.set.assert_not_called()
    transaction.create.assert_not_called()
    for reference in references.values():
        assert all(call[0] == "get" for call in reference.mock_calls)


def test_direct_decode_default_keeps_published_seed_for_sdk_fixtures():
    repository = pathways.FirestorePathwayRepository(Settings(_env_file=None), Mock())
    row = pathways.find_record(repository.decode(snapshot()), PATHWAY_ID)
    assert row.publication == "published"


def test_service_failure_makes_pathway_read_unavailable():
    repository, _, _, _ = coupled_repositories("published", old_pathways())
    repository.service_repository.read = Mock(side_effect=CatalogUnavailable)
    with pytest.raises(PathwayUnavailable):
        repository.read()


@pytest.mark.parametrize("publication", ["archived", "deleted"])
def test_publication_uses_transaction_dependency_and_blocks_writes(
    monkeypatch, publication
):
    repository, client, events, _ = coupled_repositories(publication, old_pathways())
    monkeypatch.setattr(pathways.firestore, "transactional", lambda function: function)
    change = pathways.PublicationChange(
        expectedRevision=1,
        publication="published",
        reviewed=True,
        reviewNote="Source reviewed",
    )

    with pytest.raises(pathways.PathwayProblem) as error:
        repository.change(PATHWAY_ID, change, "admin", {SERVICE_ID})

    assert error.value.status == 409
    assert [identifier for identifier, _ in events] == ["services-v1", "pathways-v1"]
    client.transaction.return_value.set.assert_not_called()
    client.transaction.return_value.create.assert_not_called()


def test_normal_mutation_persists_draft_overlay_after_transaction_reads(monkeypatch):
    repository, client, events, _ = coupled_repositories("archived", old_pathways())
    transaction = client.transaction.return_value
    monkeypatch.setattr(pathways.firestore, "transactional", lambda function: function)

    def write(*args):
        assert [identifier for identifier, _ in events] == [
            "services-v1",
            "pathways-v1",
        ]
        assert all(kwargs["transaction"] is transaction for _, kwargs in events)

    transaction.set.side_effect = write
    guide = (
        old_pathways()
        .records[0]
        .pathway.model_copy(update={"id": "administrator-guide"})
    )
    repository.change(
        guide.id,
        pathways.PathwaySave(pathway=guide, expectedRevision=0),
        "admin",
        {SERVICE_ID},
    )

    persisted = pathways.PathwayState.model_validate(transaction.set.call_args.args[1])
    row = pathways.find_record(persisted, PATHWAY_ID)
    assert row.publication == "draft" and not row.ever_published
    assert repository.decode(snapshot(persisted), {SERVICE_ID}) == persisted
    transaction.set.assert_called_once()
    transaction.create.assert_called_once()
    assert transaction.create.call_args.args[1]["action"] == "pathway.create"


def test_pathway_overlay_enforces_serialized_size_before_exposing_additions():
    repository = pathways.FirestorePathwayRepository(Settings(_env_file=None), Mock())
    release_row = pathways.find_record(
        pathways.initial_state(PathwayStore()), PATHWAY_ID
    )
    template = old_pathways().records[0]
    rows = []
    for index in range(29):
        row = template.model_copy(deep=True)
        row.pathway.id = f"large-{index}"
        row.pathway.matters = ["x" * 2000] * 10
        row.pathway.requirements = []
        rows.append(row)
    state = pathways.PathwayState(records=rows)
    target = 750_000 - len(release_row.model_dump_json().encode("utf-8")) // 2
    for row in state.records:
        while len(row.pathway.requirements) < 10:
            remaining = target - len(state.model_dump_json().encode("utf-8"))
            if remaining <= 4:
                break
            row.pathway.requirements.append("x" * min(2000, remaining - 4))
    state = pathways.PathwayState.model_validate(state.model_dump())
    before = state.model_dump()
    assert len(state.model_dump_json().encode("utf-8")) < 750_000

    with pytest.raises(ValueError, match="document-size limit"):
        include_release_records(
            state, pathways.initial_state(PathwayStore()), "pathway", {PATHWAY_ID}
        )
    with pytest.raises(ValueError, match="document-size limit"):
        repository.decode(snapshot(state), {SERVICE_ID})

    assert state.model_dump() == before
