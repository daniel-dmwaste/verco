-- Change allocation_override from category-level set_remaining to service-level extra_allocations
-- The pricing engine rolls up service extras to the parent category automatically

ALTER TABLE allocation_override DROP COLUMN category_id;
ALTER TABLE allocation_override ADD COLUMN service_id uuid NOT NULL REFERENCES service(id);
ALTER TABLE allocation_override RENAME COLUMN set_remaining TO extra_allocations;

DROP INDEX IF EXISTS idx_allocation_override_category;
CREATE INDEX idx_allocation_override_service ON allocation_override(service_id, fy_id);
