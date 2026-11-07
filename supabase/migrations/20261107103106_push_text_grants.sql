-- send-push (FCM) writes the push text from the job title, the worker's name and the quote amount, and picks the
-- wording by the recipient's role. Migration 0014 gave service_role only the columns of the earlier Expo
-- dispatcher; these are the extra columns the current function reads, nothing more.
grant select (role, full_name) on public.profiles to service_role;
grant select (id, title, accepted_worker_id) on public.jobs to service_role;
grant select (id, worker_id, total) on public.quotes to service_role;
