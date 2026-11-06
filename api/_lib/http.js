export function sendError(res,status,code,message) {
  return res.status(status).json({success:false,error:{code,message}});
}
export function requireMethod(req,res,method) {
  if (req.method !== method) { sendError(res,405,"METHOD_NOT_ALLOWED","Method not allowed"); return false; }
  return true;
}
export function getBearerToken(req) {
  const value=req.headers.authorization || "";
  const match=value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
