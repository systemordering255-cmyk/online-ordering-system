const supabase = require('../lib/supabase');

// Combined call for home page: settings + products + reviews (replaces getPageData() in GAS)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [settingsRes, productsRes, reviewsRes] = await Promise.all([
      supabase.from('settings').select('key, value'),
      supabase.from('products').select('*').eq('active', true).order('category').order('name'),
      supabase.from('reviews').select('customer_name, rating, comment, created_at')
        .eq('approved', true).order('created_at', { ascending: false }).limit(20)
    ]);

    if (settingsRes.error) throw settingsRes.error;
    if (productsRes.error) throw productsRes.error;
    if (reviewsRes.error) throw reviewsRes.error;

    const settings = {};
    settingsRes.data.forEach(row => { settings[row.key] = row.value; });

    return res.json({
      settings,
      products: productsRes.data,
      reviews:  reviewsRes.data
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
