const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value');
      if (error) throw error;

      const settings = {};
      data.forEach(row => { settings[row.key] = row.value; });

      if (req.query.pageData) {
        const [productsRes, reviewsRes] = await Promise.all([
          supabase.from('products').select('*').eq('active', true).order('category').order('name'),
          supabase.from('reviews').select('customer_name, rating, comment, created_at')
            .eq('approved', true).order('created_at', { ascending: false }).limit(20)
        ]);
        if (productsRes.error) throw productsRes.error;
        if (reviewsRes.error) throw reviewsRes.error;
        return res.json({ settings, products: productsRes.data, reviews: reviewsRes.data });
      }

      return res.json(settings);
    }

    if (req.method === 'POST') {
      const { token, settings } = req.body;
      const session = await validateAdminSession(token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const upserts = Object.entries(settings).map(([key, value]) => ({
        key,
        value: String(value)
      }));

      const { error } = await supabase
        .from('settings')
        .upsert(upserts, { onConflict: 'key' });
      if (error) throw error;
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

async function validateAdminSession(token) {
  if (!token) return null;
  const { data } = await supabase
    .from('admin_sessions')
    .select('username, expires_at')
    .eq('token', token)
    .single();
  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
