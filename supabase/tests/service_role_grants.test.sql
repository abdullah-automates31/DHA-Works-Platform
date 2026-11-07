-- Pins the privileges migrations 0014 and push_text_grants (20261107103106) give service_role for the send-push
-- function, and checks that nothing leaked to app users. If a grant is widened or narrowed by accident, this file fails.
begin;
select no_plan();

-- notifications: read the push columns, change only push_sent_at, never create or delete.
select ok(has_column_privilege('service_role', 'public.notifications', c, 'SELECT'), 'service_role reads notifications.' || c)
from unnest(array['id', 'user_id', 'type', 'job_id', 'payload', 'push_sent_at', 'created_at']) c;
select ok(not has_column_privilege('service_role', 'public.notifications', 'read_at', 'SELECT'), 'service_role cannot read read_at');
select ok(has_column_privilege('service_role', 'public.notifications', 'push_sent_at', 'UPDATE'), 'service_role updates push_sent_at');
select ok(not has_column_privilege('service_role', 'public.notifications', c, 'UPDATE'), 'service_role cannot update notifications.' || c)
from unnest(array['id', 'user_id', 'type', 'job_id', 'payload', 'read_at', 'created_at']) c;
select ok(not has_table_privilege('service_role', 'public.notifications', 'INSERT'), 'service_role cannot create notifications');
select ok(not has_table_privilege('service_role', 'public.notifications', 'DELETE'), 'service_role cannot delete notifications');

-- device_tokens: read owner and token, delete dead tokens, nothing else.
select ok(has_column_privilege('service_role', 'public.device_tokens', 'user_id', 'SELECT'), 'service_role reads device_tokens.user_id');
select ok(has_column_privilege('service_role', 'public.device_tokens', 'push_token', 'SELECT'), 'service_role reads device_tokens.push_token');
select ok(not has_column_privilege('service_role', 'public.device_tokens', 'platform', 'SELECT'), 'service_role cannot read platform');
select ok(not has_column_privilege('service_role', 'public.device_tokens', 'updated_at', 'SELECT'), 'service_role cannot read updated_at');
select ok(has_table_privilege('service_role', 'public.device_tokens', 'DELETE'), 'service_role deletes dead tokens');
select ok(not has_table_privilege('service_role', 'public.device_tokens', 'INSERT'), 'service_role cannot add tokens');
select ok(not has_table_privilege('service_role', 'public.device_tokens', 'UPDATE'), 'service_role cannot move tokens between users');

-- profiles: the key, the account status (no push to suspended accounts), the role (customer or worker wording) and
-- the name (the customer's push names the worker). Never contact details.
select ok(has_column_privilege('service_role', 'public.profiles', c, 'SELECT'), 'service_role reads profiles.' || c)
from unnest(array['id', 'account_status', 'role', 'full_name']) c;
select ok(not has_column_privilege('service_role', 'public.profiles', c, 'SELECT'), 'service_role cannot read profiles.' || c)
from unnest(array['email', 'phone', 'cnic', 'verification_status']) c;

-- jobs and quotes: the job title, its worker, and the quote's worker and total. Never the address or the notes.
select ok(has_column_privilege('service_role', 'public.jobs', c, 'SELECT'), 'service_role reads jobs.' || c)
from unnest(array['id', 'title', 'accepted_worker_id']) c;
select ok(not has_column_privilege('service_role', 'public.jobs', c, 'SELECT'), 'service_role cannot read jobs.' || c)
from unnest(array['description', 'address_id', 'lane', 'resident_id']) c;
select ok(has_column_privilege('service_role', 'public.quotes', c, 'SELECT'), 'service_role reads quotes.' || c)
from unnest(array['id', 'worker_id', 'total']) c;
select ok(not has_column_privilege('service_role', 'public.quotes', c, 'SELECT'), 'service_role cannot read quotes.' || c)
from unnest(array['note', 'materials_note', 'reject_reason']) c;
select ok(not has_table_privilege('service_role', t, p), 'service_role cannot ' || p || ' ' || t)
from unnest(array['public.jobs', 'public.quotes']) t, unnest(array['INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_table_privilege('service_role', 'public.profiles', 'UPDATE'), 'service_role cannot change profiles');

-- App users gained nothing.
select ok(not has_table_privilege(r, 'public.device_tokens', p), r || ' has no ' || p || ' on device_tokens')
from unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_table_privilege(r, 'public.notifications', p), r || ' has no ' || p || ' on notifications')
from unnest(array['anon', 'authenticated']) r, unnest(array['INSERT', 'UPDATE', 'DELETE']) p;
select ok(not has_table_privilege('anon', 'public.notifications', 'SELECT'), 'anon cannot read notifications');
select ok(not has_column_privilege('anon', 'public.profiles', 'account_status', 'SELECT'), 'anon cannot read account status');

-- RLS is still on for both tables.
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass), 'RLS still enabled on notifications');
select ok((select relrowsecurity from pg_class where oid = 'public.device_tokens'::regclass), 'RLS still enabled on device_tokens');

select * from finish();
rollback;
