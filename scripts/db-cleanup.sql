-- Removes addresses where the owner never confirmed (clicked the magic link).
-- Cascades to their tokens and members. Safe to run multiple times.
-- Does NOT touch the testfamily seed address.

-- Tokens first (foreign key ordering)
DELETE FROM tokens
WHERE address_id IN (
  SELECT a.id FROM addresses a
  WHERE a.id != 'addr_testfamily'
    AND NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.address_id = a.id AND m.confirmed = 1
    )
);

DELETE FROM members
WHERE address_id IN (
  SELECT a.id FROM addresses a
  WHERE a.id != 'addr_testfamily'
    AND NOT EXISTS (
      SELECT 1 FROM members m
      WHERE m.address_id = a.id AND m.confirmed = 1
    )
);

DELETE FROM addresses
WHERE id != 'addr_testfamily'
  AND NOT EXISTS (
    SELECT 1 FROM members m
    WHERE m.address_id = addresses.id AND m.confirmed = 1
  );
