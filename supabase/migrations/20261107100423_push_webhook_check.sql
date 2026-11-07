-- send-push checks the x-push-secret header against Vault (push_webhook_secret) through this function, so the
-- shared secret lives only in Vault and no PUSH_WEBHOOK_SECRET function secret is needed (this replaces that
-- note in the push_notifications migration). Callable by the service role only.

create or replace function public.push_webhook_secret_matches(p_secret text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets where name = 'push_webhook_secret' and decrypted_secret = p_secret
  );
$function$;

revoke all on function public.push_webhook_secret_matches(text) from public, anon, authenticated;
grant execute on function public.push_webhook_secret_matches(text) to service_role;
