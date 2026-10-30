ALTER TABLE auth_tokens ADD COLUMN consumed_at timestamptz;
CREATE INDEX auth_tokens_verify_expiry ON auth_tokens(expires_at) WHERE kind='VERIFY';
