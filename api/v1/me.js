import {getSupabase,getUser} from "../_lib/supabase.js";
import {sendError,requireMethod} from "../_lib/http.js";
export default async function handler(req,res) {
  if (!requireMethod(req,res,"GET")) return;
  try {
    const {user,error:authError}=await getUser(req);
    if (!user) return sendError(res,401,"UNAUTHENTICATED",authError || "Authentication required");
    const db=getSupabase();
    const {data,error}=await db.from("profiles").select("id,account_type,display_name,username,avatar_url,bio,location,created_at").eq("id",user.id).single();
    if (error) return sendError(res,404,"PROFILE_NOT_FOUND","Profile not found");
    return res.status(200).json({success:true,data:{user:{id:user.id,email:user.email},profile:data}});
  } catch (e) {
    return sendError(res,503,"BACKEND_UNAVAILABLE","The account service is temporarily unavailable");
  }
}
