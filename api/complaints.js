const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const { Resend } = require('resend');
const { validateAdminSession } = require('./admin-auth');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const session = await validateAdminSession(req.query.token);
      if (!session) return res.status(401).json({ error: 'Unauthorized' });
      const { data } = await supabase.from('complaints').select('*').order('created_at', { ascending: false });
      return res.json(data || []);
    }

    if (req.method === 'POST') {
      const { action, token, orderId, customerName, email, phone, subject, description, complaintId, status } = req.body || {};

      if (action === 'submit') {
        if (!orderId || !customerName || !email || !subject || !description) {
          return res.json({ success: false, error: 'Please fill in all required fields.' });
        }

        const { data: ord } = await supabase.from('orders').select('order_id').eq('order_id', orderId).single();
        if (!ord) return res.json({ success: false, error: 'Order ID not found. Please check and try again.' });

        const { data: complaint } = await supabase.from('complaints').insert({
          order_id: orderId, customer_name: customerName, email,
          phone: phone || '', subject, description, status: 'Open'
        }).select('id').single();

        // Notify owner
        const { data: settings } = await supabase.from('settings').select('key, value');
        const s = {};
        (settings || []).forEach(r => { s[r.key] = r.value; });
        const ownerEmail = s.owner_email || 'systemordering255@gmail.com';

        resend.emails.send({
          from:    'onboarding@resend.dev',
          replyTo: 'systemordering255@gmail.com',
          to:      ownerEmail,
          subject: `[${s.business_name || 'Store'}] New Complaint: ${subject}`,
          text:    `Complaint ID: ${complaint?.id}\nOrder: ${orderId}\nCustomer: ${customerName} (${email})${phone ? '\nPhone: ' + phone : ''}\n\nSubject: ${subject}\n\nDescription:\n${description}`
        }).catch(() => {});

        return res.json({ success: true, complaintId: complaint?.id });
      }

      if (action === 'update-status') {
        const session = await validateAdminSession(token);
        if (!session) return res.status(401).json({ error: 'Unauthorized' });
        await supabase.from('complaints').update({ status }).eq('id', complaintId);
        return res.json({ success: true });
      }
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
