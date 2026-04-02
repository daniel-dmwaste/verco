-- Add new status values to both NCN and NP enums
-- NOTE: Must be in its own transaction before values can be used in DML
ALTER TYPE ncn_status ADD VALUE 'Issued';
ALTER TYPE ncn_status ADD VALUE 'Disputed';
ALTER TYPE ncn_status ADD VALUE 'Closed';

ALTER TYPE np_status ADD VALUE 'Issued';
ALTER TYPE np_status ADD VALUE 'Disputed';
ALTER TYPE np_status ADD VALUE 'Closed';
