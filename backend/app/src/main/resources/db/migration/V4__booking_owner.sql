ALTER TABLE bookings ADD COLUMN parent_id uuid REFERENCES accounts(id);
UPDATE bookings b SET parent_id=c.parent_id FROM children c WHERE c.id=b.child_id;
ALTER TABLE bookings ALTER COLUMN parent_id SET NOT NULL;
CREATE INDEX bookings_parent_idx ON bookings(parent_id,created_at,id);
