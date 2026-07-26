const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({
      error: 'SUPABASE_URL/SUPABASE_KEY não configuradas.'
    });
  }

  res.status(200).json({
    SUPABASE_URL,
    SUPABASE_KEY,
    GOOGLE_CLIENT_ID
  });
};
