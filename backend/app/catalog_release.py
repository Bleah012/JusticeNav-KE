"""Overlay explicitly added release records without replacing administrator decisions."""


def include_release_records(state, seed_state, field, identifiers):
    """Pure read: append new IDs only; preserve edits, archives and deletion tombstones.

    No Firestore write or audit event occurs during a read. The next normal
    administrator mutation persists the overlay in its existing transaction.
    Revalidation enforces catalogue bounds and the 750,000-byte document budget
    instead of silently dropping records.
    """
    known = {getattr(row, field).id for row in state.records} | set(state.deleted_ids)
    additions = [
        row
        for row in seed_state.records
        if getattr(row, field).id in identifiers and getattr(row, field).id not in known
    ]
    if not additions:
        return state
    value = state.model_dump()
    value["records"] += [row.model_dump() for row in additions]
    result = type(state).model_validate(value)
    if len(result.model_dump_json().encode("utf-8")) > 750_000:
        raise ValueError("Catalogue exceeds the document-size limit")
    return result
