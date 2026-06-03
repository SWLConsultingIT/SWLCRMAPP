-- Better team notes: a type (general | call) and a pin flag so a good note can
-- be surfaced in the lead's Profile Overview. Additive.
alter table lead_notes add column if not exists note_type text not null default 'general';
alter table lead_notes add column if not exists pinned boolean not null default false;
