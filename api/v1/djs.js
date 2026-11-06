import {getSupabase} from "../_lib/supabase.js";
import {sendError,requireMethod} from "../_lib/http.js";
export default async function handler(req,res) {
  if (!requireMethod(req,res,"GET")) return;
  try {
    const q=String(req.query.q || "").trim().slice(0,80);
    const db=getSupabase();
    let query=db.from("dj_profiles").select("user_id,genres,profiles!inner(display_name,username,avatar_url,bio,location)").eq("is_public",true).limit(30);
    if (q) query=query.ilike("profiles.display_name",`%${q.replace(/[%_]/g,"")}%`);
    const {data,error}=await query;
    if (error) return sendError(res,500,"QUERY_FAILED","Unable to load DJs");
    return res.status(200).json({success:true,data:data || []});
  } catch {
    return sendError(res,503,"BACKEND_UNAVAILABLE","The discovery service is temporarily unavailable");
  }
}
