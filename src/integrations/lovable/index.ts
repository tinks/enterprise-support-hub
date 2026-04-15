import { createLovableAuth } from "@lovable.dev/cloud-auth-js";
import { supabase } from "@/integrations/supabase/client";

export const lovable = {
  auth: createLovableAuth(),
};

/**
 * Sign in with Google using Lovable Cloud managed OAuth.
 * After receiving tokens, sets the Supabase session automatically.
 */
export async function signInWithGoogle() {
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: window.location.origin,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.redirected) {
    return { redirected: true as const };
  }

  // Set the Supabase session with the tokens we received
  if (result.tokens) {
    await supabase.auth.setSession({
      access_token: result.tokens.access_token,
      refresh_token: result.tokens.refresh_token,
    });
  }

  return { redirected: false as const };
}
