CREATE TRIGGER command_receipts_no_update
BEFORE UPDATE ON command_receipts
BEGIN
    SELECT RAISE(ABORT, 'command receipts are immutable');
END;

CREATE TRIGGER command_receipts_no_delete
BEFORE DELETE ON command_receipts
BEGIN
    SELECT RAISE(ABORT, 'command receipts are immutable');
END;

CREATE TRIGGER idempotency_keys_no_update
BEFORE UPDATE ON idempotency_keys
BEGIN
    SELECT RAISE(ABORT, 'idempotency identities are immutable');
END;

CREATE TRIGGER idempotency_keys_no_delete
BEFORE DELETE ON idempotency_keys
BEGIN
    SELECT RAISE(ABORT, 'idempotency identities are immutable');
END;
