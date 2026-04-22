-- Allow each company_bio to restrict which Aircall numbers they can use.
-- Admins see all numbers; clients only see the ones assigned to their company.
-- NULL = no restriction (defaults to all numbers).

ALTER TABLE company_bios
ADD COLUMN IF NOT EXISTS aircall_number_ids jsonb;

COMMENT ON COLUMN company_bios.aircall_number_ids IS
'Array of Aircall number IDs this company can use. NULL or empty = no access. Admin UI manages this.';
