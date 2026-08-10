CREATE TABLE portfolio_phase_receipts(
    receipt_id TEXT PRIMARY KEY,
    phase TEXT NOT NULL CHECK(phase IN ('P0','P1','P2','P3','P4','P5')),
    authority TEXT NOT NULL CHECK(authority IN ('autonomous','human')),
    receipt_digest TEXT NOT NULL CHECK(
        length(receipt_digest)=71 AND substr(receipt_digest,1,7)='sha256:'
    ),
    receipt_json BLOB NOT NULL,
    authenticated_actor_id TEXT NOT NULL CHECK(length(authenticated_actor_id)>0),
    authenticated_at TEXT NOT NULL
) STRICT;

CREATE TABLE portfolio_phase_heads(
    phase TEXT PRIMARY KEY CHECK(phase IN ('P0','P1','P2','P3','P4','P5')),
    receipt_id TEXT NOT NULL UNIQUE,
    receipt_digest TEXT NOT NULL CHECK(
        length(receipt_digest)=71 AND substr(receipt_digest,1,7)='sha256:'
    ),
    FOREIGN KEY(receipt_id) REFERENCES portfolio_phase_receipts(receipt_id)
) STRICT;

CREATE TRIGGER portfolio_phase_receipts_no_update
BEFORE UPDATE ON portfolio_phase_receipts
BEGIN
    SELECT RAISE(ABORT, 'portfolio phase receipts are immutable');
END;

CREATE TRIGGER portfolio_phase_receipts_no_delete
BEFORE DELETE ON portfolio_phase_receipts
BEGIN
    SELECT RAISE(ABORT, 'portfolio phase receipts are immutable');
END;
