import { createPrivatePhotoViewer } from '../admin-private-photo/handler.mjs';

Deno.serve(createPrivatePhotoViewer({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  targetRpc: 'photo_recovery_target_for_session',
}));
