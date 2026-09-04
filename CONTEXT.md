# Grounded Journal

Personal journaling grounded in real-world places: user-isolated entries, Gemini reflections enriched with place context.

## Language

**Entry**:
The user's raw journal input, immutable once written. May stand without Grounding.
_Avoid_: post, note, turn

**Reflection**:
Gemini's response to a Session turn, each bound to exactly one Entry; an Entry may have many.
_Avoid_: reply, answer, summary

**Grounding**:
The persisted binding of one Entry to one Place context (place_id + snapshot + timestamp) — the audit trail of what Gemini saw. An Entry may carry several; each is visible to the Entry's whole Session. Editable until the first Reflection, frozen after.
_Avoid_: attachment, annotation, context blob

**Place**:
A real-world location identified by its public place_id. Cached API payloads are infrastructure (place cache), not part of this concept.
_Avoid_: location, venue, spot

**Session**:
One multi-turn exchange: exactly one Entry plus its follow-up turns and Reflections. Authentication is sign-in, not a Session.
_Avoid_: conversation, thread, visit

**Turn**:
A single follow-up message inside a Session. Unlike an Entry, never groundable on its own.
_Avoid_: message

**Vault**:
The private store owned by exactly one user; every Entry, Session, and Grounding lives inside exactly one Vault, and the Vault boundary is the privacy boundary.
_Avoid_: account, workspace, store
