export default async function handler(req,res) {
  if (req.method !== "GET") return res.status(405).json({success:false,error:{code:"METHOD_NOT_ALLOWED",message:"Method not allowed"}});
  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  return res.status(configured ? 200 : 503).json({
    success: configured,
    service: "vybez-api",
    backend: configured ? "supabase-configured" : "supabase-not-configured",
    timestamp: new Date().toISOString()
  });
}
