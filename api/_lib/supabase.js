import { createClient } from "@supabase/supabase-js";
export function getSupabase() {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase environment is not configured");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function getUser(req) {
  const token=(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return {user:null,error:"Authentication required"};
  const supabase=getSupabase();
  const {data,error}=await supabase.auth.getUser(token);
  return {user:data?.user || null,error:error?.message || null};
}
