module.exports = (req, res) => {
    res.json({
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_KEY: !!process.env.SUPABASE_KEY,
        GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
        ENV: Object.keys(process.env).filter(k => k.includes('SUPABASE'))
    });
};
