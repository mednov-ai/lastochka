-- Additive indexes for ordered payment pages and bank reconciliation candidates.
CREATE INDEX payment_requests_created_id_idx
    ON payment_requests (created_at DESC, id DESC);

CREATE INDEX alfa_attempts_due_environment_idx
    ON alfa_test_attempts (environment, next_check_at, payment_id)
    WHERE (archived = false AND operation_state NOT IN ('PAID', 'CANCELLED'))
       OR callback_pending = true;
