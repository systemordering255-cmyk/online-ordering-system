const guard = require('../lib/guard');
const supabase = require('../lib/supabase');
const email    = require('../lib/email');

function generateDeliveryId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'DLV-';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function verifyPin(pin) {
  const { data } = await supabase.from('settings').select('value').eq('key', 'delivery_pin').single();
  return String(pin) === String(data?.value || '5678');
}

async function getSettings() {
  const { data } = await supabase.from('settings').select('key, value');
  const s = {};
  (data || []).forEach(r => { s[r.key] = r.value; });
  return s;
}

async function generateAndSendOtp(orderId) {
  const { data: ord } = await supabase.from('orders').select('email, customer_name, collection_method').eq('order_id', orderId).single();
  if (!ord) return;

  const otp       = String(100000 + Math.floor(Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await supabase.from('delivery_otps').upsert({ order_id: orderId, otp, expires_at: expiresAt });

  const settings = await getSettings();
  email.sendDeliveryOtp({
    email: ord.email, customerName: ord.customer_name,
    orderId, otp, collectionMethod: ord.collection_method || 'Delivery', settings
  }).catch(() => {});
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!guard(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, pin, orderId, otp, reason } = req.body || {};

  try {
    if (!(await verifyPin(pin))) return res.json({ error: 'Wrong PIN' });

    if (action === 'get-orders') {
      const { data } = await supabase
        .from('orders').select('*')
        .eq('order_status', 'Out for Delivery')
        .order('created_at', { ascending: false });
      return res.json(data || []);
    }

    if (action === 'verify-otp') {
      const { data: otpRow } = await supabase
        .from('delivery_otps').select('otp, expires_at').eq('order_id', orderId).single();

      if (!otpRow) return res.json({ success: false, error: 'OTP_REQUIRED' });
      if (new Date(otpRow.expires_at) < new Date()) {
        await supabase.from('delivery_otps').delete().eq('order_id', orderId);
        return res.json({ success: false, error: 'OTP_EXPIRED' });
      }
      if (String(otp).trim() !== String(otpRow.otp)) {
        return res.json({ success: false, error: 'OTP_INVALID' });
      }

      await supabase.from('delivery_otps').delete().eq('order_id', orderId);

      const deliveryId = generateDeliveryId();
      const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
      const { data: ord } = await supabase.from('orders').select('notes').eq('order_id', orderId).single();
      const note = `[${ts}] Delivered - OTP verified | Delivery ID: ${deliveryId}`;
      await supabase.from('orders').update({
        order_status: 'Delivered',
        notes: ord?.notes ? `${ord.notes}\n${note}` : note
      }).eq('order_id', orderId);

      const settings = await getSettings();
      const { data: o } = await supabase.from('orders').select('email, customer_name').eq('order_id', orderId).single();
      if (o) email.sendStatusUpdate(o.email, o.customer_name, orderId, 'Delivered', settings).catch(() => {});

      return res.json({ success: true, deliveryId });
    }

    if (action === 'resend-otp') {
      const { data: ord } = await supabase.from('orders').select('order_status').eq('order_id', orderId).single();
      if (!ord || ord.order_status !== 'Out for Delivery') {
        return res.json({ success: false, error: 'Order is not out for delivery.' });
      }
      await generateAndSendOtp(orderId);
      return res.json({ success: true });
    }

    if (action === 'not-delivered') {
      const { data: ord } = await supabase.from('orders').select('notes').eq('order_id', orderId).single();
      const deliveryId = generateDeliveryId();
      const ts = new Date().toLocaleString('en-IN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false });
      const note = `[${ts}] Delivery Failed - ${reason || 'No reason given'} | Delivery ID: ${deliveryId}`;
      await supabase.from('orders').update({
        order_status: 'Delivery Failed',
        notes: ord?.notes ? `${ord.notes}\n${note}` : note
      }).eq('order_id', orderId);
      return res.json({ success: true, deliveryId });
    }

    if (action === 'cash-collected') {
      const { data: ord } = await supabase.from('orders').select('payment_method').eq('order_id', orderId).single();
      if (!ord) return res.json({ error: 'Order not found.' });
      if (ord.payment_method !== 'COD') return res.json({ error: 'Not a COD order.' });
      await supabase.from('orders').update({ payment_status: 'Collected' }).eq('order_id', orderId);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
