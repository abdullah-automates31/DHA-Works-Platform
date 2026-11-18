-- 0061: close the unused authenticator-app functions (audit, 18 Nov 2026).
--
-- The six authenticator-app (TOTP) functions from 0052 are no longer callable by app roles. The portal stopped using
-- them in 0055; leaving them open let any signed-in account call them. Owner can reopen them by granting again.
--
-- An earlier draft of this migration (never applied on DEV) also limited a verified admin session to 7 days. The owner
-- chose on 18 Nov 2026 that an admin sign-in lasts until sign-out (as in 0051), so is_admin() and admin_fresh() are
-- unchanged here.

revoke execute on function public.admin_enroll_proof_status() from authenticated;
revoke execute on function public.admin_totp_status() from authenticated;
revoke execute on function public.admin_totp_factor() from authenticated;
revoke execute on function public.admin_register_totp(uuid) from authenticated;
revoke execute on function public.admin_reset_totp() from authenticated;
revoke execute on function public.admin_mark_session_verified() from authenticated;
