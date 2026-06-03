-- Optional reason on a lead tag, shown on hover over the tag chip.
alter table lead_tags add column if not exists reason text;
