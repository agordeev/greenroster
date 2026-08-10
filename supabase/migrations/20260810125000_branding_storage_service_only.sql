-- Branding objects are written and signed only by the trusted web server. No
-- authenticated browser role receives direct bucket mutation or path-read
-- privileges; the service role bypasses Storage RLS for controlled actions.

drop policy if exists group_branding_objects_read on storage.objects;
drop policy if exists group_branding_objects_insert on storage.objects;
drop policy if exists group_branding_objects_update on storage.objects;
drop policy if exists group_branding_objects_delete on storage.objects;
