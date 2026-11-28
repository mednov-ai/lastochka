ALTER TABLE vk_enquiry_settings
    ADD COLUMN callback_id uuid,
    ADD COLUMN callback_group bigint,
    ADD COLUMN callback_secret bytea,
    ADD COLUMN callback_confirmation varchar(128),
    ADD CONSTRAINT vk_callback_complete CHECK (
        num_nonnulls(callback_id, callback_group, callback_secret, callback_confirmation) IN (0, 4)
    );
