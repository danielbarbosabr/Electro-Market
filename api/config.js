const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

module.exports = async (req, res) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Troque "users" por uma tabela que você sabe que existe no banco.
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    res.status(200).json({
      conectado: !error,
      data,
      error
    });

  } catch (err) {
    res.status(500).json({
      conectado: false,
      erro: err.message,
      stack: err.stack
    });
  }
};
