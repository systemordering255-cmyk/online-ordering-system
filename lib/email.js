const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

const FROM = `"Online Ordering" <${process.env.GMAIL_USER}>`;
const REPLY_TO = process.env.GMAIL_USER;

const STYLES = `
<style>
body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:0}
.wrap{max-width:600px;margin:30px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.header{background:#4a90d9;color:#fff;padding:24px 32px}
.header h1{margin:0;font-size:22px}
.body{padding:28px 32px;color:#333}
.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
.items-table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}
.items-table th{background:#f0f4ff;padding:8px;text-align:left}
.items-table td{padding:8px;border-bottom:1px solid #eee}
.total-row td{font-weight:bold;font-size:16px;color:#4a90d9}
.badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:bold;background:#e8f4fd;color:#4a90d9}
.footer{padding:16px 32px;font-size:12px;color:#999;text-align:center;background:#f9f9f9;border-top:1px solid #eee}
</style>`;

function wrap(headerText, bodyHtml, footerText) {
  return `<!DOCTYPE html><html><head>${STYLES}</head><body>
    <div class="wrap">
      <div class="header"><h1>${headerText}</h1></div>
      <div class="body">${bodyHtml}</div>
      <div class="footer">${footerText || 'Thank you for your order!'}</div>
    </div></body></html>`;
}

function itemsTable(items, subtotal, deliveryFee, total, symbol = 'Rs.') {
  const rows = items.map(it =>
    `<tr><td>${it.name}</td><td>${it.qty}</td><td>${symbol}${parseFloat(it.price).toFixed(2)}</td><td>${symbol}${parseFloat(it.lineTotal).toFixed(2)}</td></tr>`
  ).join('');
  return `<table class="items-table">
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${rows}
      <tr><td colspan="3" style="text-align:right">Subtotal</td><td>${symbol}${parseFloat(subtotal).toFixed(2)}</td></tr>
      <tr><td colspan="3" style="text-align:right">Delivery Fee</td><td>${symbol}${parseFloat(deliveryFee).toFixed(2)}</td></tr>
      <tr class="total-row"><td colspan="3" style="text-align:right">Total</td><td>${symbol}${parseFloat(total).toFixed(2)}</td></tr>
    </tbody></table>`;
}

async function send(to, subject, html, text) {
  return transporter.sendMail({ from: FROM, replyTo: REPLY_TO, to, subject, html, text });
}

async function sendOrderConfirmation(o) {
  const symbol   = o.settings?.currency_symbol || 'Rs.';
  const business = o.settings?.business_name   || 'Our Store';
  const estMins  = o.settings?.estimated_delivery_mins || 45;
  const appUrl   = process.env.APP_URL || '';
  const isPickup = o.collectionMethod === 'Pickup';

  const payNote = o.paymentMethod === 'COD'
    ? `<p><span class="badge">Cash on Delivery</span> - Please keep exact change ready.</p>`
    : `<p><span class="badge">UPI Payment</span> - Your payment is being verified. We'll confirm shortly.</p>`;

  const body = `
    <p>Hi <strong>${o.customerName}</strong>, thank you for your order!</p>
    <div class="info-row"><span>Order ID</span><strong>${o.orderId}</strong></div>
    <div class="info-row"><span>Collection</span><strong>${isPickup ? 'Pickup from store' : 'Delivery'}</strong></div>
    ${isPickup ? '' : `<div class="info-row"><span>Address</span><span>${o.address}</span></div>`}
    <div class="info-row"><span>${isPickup ? 'Ready In' : 'Estimated Delivery'}</span><span>~${estMins} minutes</span></div>
    ${itemsTable(o.items, o.subtotal, o.deliveryFee, o.total, symbol)}
    ${payNote}
    ${appUrl ? `<p style="font-size:13px;color:#666">Track your order at <a href="${appUrl}/tracking">our tracking page</a>. Order ID: <strong>${o.orderId}</strong></p>` : ''}`;

  await send(
    o.email,
    `Order Confirmed - ${o.orderId} | ${business}`,
    wrap(`Order Placed - ${o.orderId}`, body, `&copy; ${business} | This is an automated email.`),
    `Your order ${o.orderId} has been placed. Total: ${symbol}${o.total}`
  );
}

async function sendOwnerAlert(o) {
  const symbol    = o.settings?.currency_symbol || 'Rs.';
  const business  = o.settings?.business_name   || 'Your Store';
  const ownerEmail = o.settings?.owner_email    || 'systemordering255@gmail.com';
  const deliveryFee = parseFloat(o.settings?.delivery_fee) || 0;

  const body = `
    <p>A new order has been placed!</p>
    <div class="info-row"><span>Order ID</span><strong>${o.orderId}</strong></div>
    <div class="info-row"><span>Customer</span><span>${o.customerName}</span></div>
    <div class="info-row"><span>Phone</span><span>${o.phone}</span></div>
    <div class="info-row"><span>Email</span><span>${o.email}</span></div>
    <div class="info-row"><span>Collection</span><strong>${o.collectionMethod === 'Pickup' ? 'Pickup' : 'Delivery'}</strong></div>
    ${o.collectionMethod !== 'Pickup' ? `<div class="info-row"><span>Address</span><span>${o.address}</span></div>` : ''}
    <div class="info-row"><span>Payment</span><span>${o.paymentMethod}</span></div>
    ${o.utr ? `<div class="info-row"><span>UTR / Ref</span><strong>${o.utr}</strong></div>` : ''}
    ${itemsTable(o.items, o.total - deliveryFee, deliveryFee, o.total, symbol)}`;

  await send(
    ownerEmail,
    `New Order - ${o.orderId}`,
    wrap(`New Order Alert - ${o.orderId}`, body, `${business} Admin Notification`),
    `New order ${o.orderId} from ${o.customerName}. Total: ${symbol}${o.total}`
  );
}

async function sendStatusUpdate(customerEmail, customerName, orderId, status, settings) {
  const symbol   = settings?.currency_symbol || 'Rs.';
  const business = settings?.business_name   || 'Our Store';

  const messages = {
    'Confirmed':        "Your order is confirmed and we're getting it ready!",
    'Preparing':        'Your order is being prepared.',
    'Out for Delivery': 'Great news! Your order is on its way to you.',
    'Delivered':        'Your order has been delivered. Enjoy!'
  };

  const msg = messages[status] || `Your order status has been updated to: ${status}`;
  const body = `
    <p>Hi <strong>${customerName}</strong>,</p>
    <p>${msg}</p>
    <div class="info-row"><span>Order ID</span><strong>${orderId}</strong></div>
    <div class="info-row"><span>New Status</span><span class="badge">${status}</span></div>
    ${status === 'Delivered' ? '<p style="margin-top:20px">We hope you enjoyed your order! We would love to hear your feedback.</p>' : ''}`;

  const subjects = { 'Confirmed': `Order Confirmed - ${orderId}`, 'Delivered': `Order Delivered - ${orderId}` };
  await send(
    customerEmail,
    subjects[status] || `Order Update - ${orderId}`,
    wrap(`Order Update - ${orderId}`, body, `&copy; ${business} | This is an automated email.`),
    `Order ${orderId} status: ${status}`
  );
}

async function sendDeliveryOtp(o) {
  const business  = o.settings?.business_name || 'Our Store';
  const isPickup  = o.collectionMethod === 'Pickup';
  const expMins   = 30;

  const headline    = isPickup ? 'Your order is ready for pickup!' : 'Your order is on the way!';
  const instruction = isPickup
    ? 'Show this OTP to our staff when you arrive to collect your order.'
    : 'Your delivery agent will ask for this OTP at your door. Share it only with them.';

  const body = `
    <p>Hi <strong>${o.customerName}</strong>,</p>
    <p style="font-size:15px">${headline}</p>
    <div class="info-row"><span>Order ID</span><strong>${o.orderId}</strong></div>
    <p style="margin:18px 0 8px;font-size:14px;color:#555">${instruction}</p>
    <div style="text-align:center;margin:24px 0">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#92400e;margin-bottom:10px;font-weight:700">${isPickup ? 'Pickup' : 'Delivery'} OTP</p>
      <div style="display:inline-block;background:#fef3c7;border:2px dashed #f59e0b;border-radius:14px;padding:18px 40px">
        <span style="font-size:44px;font-weight:900;letter-spacing:14px;color:#b45309;font-family:monospace">${o.otp}</span>
      </div>
      <p style="margin-top:10px;font-size:12px;color:#92400e">Valid for ${expMins} minutes</p>
    </div>
    <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#78350f">
      <strong>Never share this OTP</strong> over phone or with anyone other than your delivery agent standing at your door.
    </div>`;

  await send(
    o.email,
    `${isPickup ? 'Pickup' : 'Delivery'} OTP - ${o.orderId} | ${business}`,
    wrap(`${isPickup ? 'Pickup' : 'Delivery'} OTP - ${o.orderId}`, body, `&copy; ${business} | Do not reply.`),
    `Your ${isPickup ? 'pickup' : 'delivery'} OTP for order ${o.orderId} is: ${o.otp} (valid for ${expMins} minutes)`
  );
}

async function sendCancellationEmail(customerEmail, customerName, orderId, reason, settings, cancelledBy) {
  const business = settings?.business_name || 'Our Store';
  const isCustomerCancel = cancelledBy === 'customer';

  const reasonMessages = {
    'Out of stock':   'We regret to inform you that one or more items in your order are currently out of stock. Your order has been cancelled.',
    'Customer request': 'As per your cancellation request, we have successfully processed the cancellation of your order.',
    'Cannot fulfill': 'Due to operational constraints, we are unable to process your order. Your order has been cancelled.',
    'Duplicate order': 'Our system detected this as a duplicate order. We have cancelled it to avoid double charges.',
    'Other':          'Due to unforeseen circumstances, we are unable to fulfill your order. Your order has been cancelled.'
  };

  const msg = isCustomerCancel
    ? 'Your order cancellation request has been successfully processed. We hope to serve you again soon.'
    : (reasonMessages[reason] || reasonMessages['Other']);

  const body = `
    <p>Hi <strong>${customerName}</strong>,</p>
    <p style="color:#b91c1c">${msg}</p>
    <div class="info-row"><span>Order ID</span><strong>${orderId}</strong></div>
    <div class="info-row"><span>Status</span><span class="badge" style="background:#fde8e8;color:#dc2626">Cancelled</span></div>
    <div class="info-row"><span>Cancelled by</span><strong>${isCustomerCancel ? 'You (Customer)' : 'Store'}</strong></div>`;

  await send(
    customerEmail,
    `Order ${isCustomerCancel ? 'Cancelled' : 'Cancellation Notice'} - ${orderId} | ${business}`,
    wrap(`Order Cancellation - ${orderId}`, body, `&copy; ${business} | This is an automated email.`),
    `Your order ${orderId} has been cancelled.`
  );
}

module.exports = {
  sendOrderConfirmation,
  sendOwnerAlert,
  sendStatusUpdate,
  sendDeliveryOtp,
  sendCancellationEmail
};
