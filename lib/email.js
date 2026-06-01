const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

const FROM    = `"Online Ordering" <${process.env.GMAIL_USER}>`;
const REPLY_TO = process.env.GMAIL_USER;
const FONT    = 'Arial,Helvetica,sans-serif';

// Gmail on mobile strips <style> blocks — every style must be inline.
// Use table-based layout so it works in all email clients.

function wrap(headerText, bodyHtml, footerText) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;background:#f5f5f5">
<tr><td style="padding:20px 8px" align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;max-width:560px">
  <tr>
    <td style="background:#4a90d9;border-radius:8px 8px 0 0;padding:22px 24px">
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;font-family:${FONT}">${headerText}</p>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:24px 24px 8px">
      ${bodyHtml}
    </td>
  </tr>
  <tr>
    <td style="background:#f9f9f9;border-top:1px solid #eeeeee;border-radius:0 0 8px 8px;padding:14px 24px;font-size:12px;color:#999999;text-align:center;font-family:${FONT}">
      ${footerText || 'Thank you for your order!'}
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Two-column label/value table — works without any CSS class support
function infoTable(rows) {
  const trs = rows.filter(Boolean).map(([label, value]) =>
    `<tr>
      <td style="padding:9px 16px 9px 0;border-bottom:1px solid #eeeeee;font-size:14px;color:#777777;font-family:${FONT};white-space:nowrap;vertical-align:top">${label}</td>
      <td style="padding:9px 0;border-bottom:1px solid #eeeeee;font-size:14px;font-weight:600;color:#333333;font-family:${FONT};text-align:right;word-break:break-word">${value}</td>
    </tr>`
  ).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0 16px">${trs}</table>`;
}

// 3-column items table (Item+Qty, Unit Price, Line Total) — fits on 320px screens
function itemsTable(items, subtotal, deliveryFee, total, symbol = 'Rs.') {
  const rows = items.map(it =>
    `<tr>
      <td style="padding:9px 6px 9px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333333;font-family:${FONT}">
        ${it.name}<br><span style="font-size:11px;color:#999999">Qty: ${it.qty}</span>
      </td>
      <td style="padding:9px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555555;font-family:${FONT};text-align:right;white-space:nowrap">${symbol}${parseFloat(it.price).toFixed(2)}</td>
      <td style="padding:9px 0 9px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;color:#333333;font-family:${FONT};text-align:right;white-space:nowrap">${symbol}${parseFloat(it.lineTotal).toFixed(2)}</td>
    </tr>`
  ).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
<thead>
<tr style="background:#f0f4ff">
  <th style="padding:9px 6px 9px 0;font-size:12px;text-align:left;color:#555555;font-weight:700;font-family:${FONT};border-bottom:2px solid #dce8ff">Item</th>
  <th style="padding:9px 4px;font-size:12px;text-align:right;color:#555555;font-weight:700;font-family:${FONT};border-bottom:2px solid #dce8ff">Price</th>
  <th style="padding:9px 0 9px 4px;font-size:12px;text-align:right;color:#555555;font-weight:700;font-family:${FONT};border-bottom:2px solid #dce8ff">Total</th>
</tr>
</thead>
<tbody>
  ${rows}
  <tr>
    <td colspan="2" style="padding:8px 4px 8px 0;text-align:right;font-size:13px;color:#777777;font-family:${FONT}">Subtotal</td>
    <td style="padding:8px 0 8px 4px;text-align:right;font-size:13px;color:#333333;font-family:${FONT};white-space:nowrap">${symbol}${parseFloat(subtotal).toFixed(2)}</td>
  </tr>
  <tr>
    <td colspan="2" style="padding:8px 4px 8px 0;text-align:right;font-size:13px;color:#777777;font-family:${FONT}">Delivery Fee</td>
    <td style="padding:8px 0 8px 4px;text-align:right;font-size:13px;color:#333333;font-family:${FONT};white-space:nowrap">${symbol}${parseFloat(deliveryFee).toFixed(2)}</td>
  </tr>
  <tr>
    <td colspan="2" style="padding:10px 4px 10px 0;text-align:right;font-size:15px;font-weight:700;color:#4a90d9;font-family:${FONT};background:#f5f9ff">Total</td>
    <td style="padding:10px 0 10px 4px;text-align:right;font-size:15px;font-weight:700;color:#4a90d9;font-family:${FONT};background:#f5f9ff;white-space:nowrap">${symbol}${parseFloat(total).toFixed(2)}</td>
  </tr>
</tbody>
</table>`;
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

  const badge = (text, bg = '#e8f4fd', color = '#4a90d9') =>
    `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${bg};color:${color};font-family:${FONT}">${text}</span>`;

  const payNote = o.paymentMethod === 'COD'
    ? `<p style="font-size:14px;color:#333333;font-family:${FONT};margin:12px 0">${badge('Cash on Delivery')}&nbsp; Please keep exact change ready.</p>`
    : `<p style="font-size:14px;color:#333333;font-family:${FONT};margin:12px 0">${badge('UPI Payment')}&nbsp; Your payment is being verified. We'll confirm shortly.</p>`;

  const body = `
    <p style="font-size:15px;color:#333333;font-family:${FONT};margin:0 0 12px">Hi <strong>${o.customerName}</strong>, thank you for your order!</p>
    ${infoTable([
      ['Order ID',   `<strong>${o.orderId}</strong>`],
      ['Collection', `<strong>${isPickup ? 'Pickup from store' : 'Delivery'}</strong>`],
      !isPickup && ['Address', o.address],
      [isPickup ? 'Ready In' : 'Est. Delivery', `~${estMins} minutes`],
    ])}
    ${itemsTable(o.items, o.subtotal, o.deliveryFee, o.total, symbol)}
    ${payNote}
    ${appUrl ? `<p style="font-size:13px;color:#666666;font-family:${FONT};margin:12px 0 0">Track your order at <a href="${appUrl}/tracking" style="color:#4a90d9">our tracking page</a>. Order ID: <strong>${o.orderId}</strong></p>` : ''}`;

  await send(
    o.email,
    `Order Confirmed - ${o.orderId} | ${business}`,
    wrap(`Order Placed - ${o.orderId}`, body, `&copy; ${business} | This is an automated email.`),
    `Your order ${o.orderId} has been placed. Total: ${symbol}${o.total}`
  );
}

async function sendOwnerAlert(o) {
  const symbol      = o.settings?.currency_symbol || 'Rs.';
  const business    = o.settings?.business_name   || 'Your Store';
  const ownerEmail  = o.settings?.owner_email      || 'systemordering255@gmail.com';
  const deliveryFee = parseFloat(o.settings?.delivery_fee) || 0;

  const body = `
    <p style="font-size:15px;color:#333333;font-family:${FONT};margin:0 0 12px">A new order has been placed!</p>
    ${infoTable([
      ['Order ID',   `<strong>${o.orderId}</strong>`],
      ['Customer',   o.customerName],
      ['Phone',      o.phone],
      ['Email',      o.email],
      ['Collection', `<strong>${o.collectionMethod === 'Pickup' ? 'Pickup' : 'Delivery'}</strong>`],
      o.collectionMethod !== 'Pickup' && ['Address', o.address],
      ['Payment',    o.paymentMethod],
      o.utr && ['UTR / Ref', `<strong>${o.utr}</strong>`],
    ])}
    ${itemsTable(o.items, o.total - deliveryFee, deliveryFee, o.total, symbol)}`;

  await send(
    ownerEmail,
    `New Order - ${o.orderId}`,
    wrap(`New Order Alert - ${o.orderId}`, body, `${business} Admin Notification`),
    `New order ${o.orderId} from ${o.customerName}. Total: ${symbol}${o.total}`
  );
}

async function sendStatusUpdate(customerEmail, customerName, orderId, status, settings) {
  const business = settings?.business_name || 'Our Store';

  const messages = {
    'Confirmed':        "Your order is confirmed and we're getting it ready!",
    'Preparing':        'Your order is being prepared.',
    'Out for Delivery': 'Great news! Your order is on its way to you.',
    'Delivered':        'Your order has been delivered. Enjoy!'
  };

  const msg = messages[status] || `Your order status has been updated to: ${status}`;
  const [bg, color] = status === 'Delivered' ? ['#e8f5e9', '#2e7d32'] : ['#e8f4fd', '#4a90d9'];

  const body = `
    <p style="font-size:15px;color:#333333;font-family:${FONT};margin:0 0 12px">Hi <strong>${customerName}</strong>,</p>
    <p style="font-size:14px;color:#333333;font-family:${FONT};margin:0 0 16px">${msg}</p>
    ${infoTable([
      ['Order ID', `<strong>${orderId}</strong>`],
      ['Status',   `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${bg};color:${color};font-family:${FONT}">${status}</span>`],
    ])}
    ${status === 'Delivered' ? `<p style="font-size:14px;color:#555555;font-family:${FONT};margin:16px 0 0">We hope you enjoyed your order! We would love to hear your feedback.</p>` : ''}`;

  const subjects = { 'Confirmed': `Order Confirmed - ${orderId}`, 'Delivered': `Order Delivered - ${orderId}` };
  await send(
    customerEmail,
    subjects[status] || `Order Update - ${orderId}`,
    wrap(`Order Update - ${orderId}`, body, `&copy; ${business} | This is an automated email.`),
    `Order ${orderId} status: ${status}`
  );
}

async function sendDeliveryOtp(o) {
  const business = o.settings?.business_name || 'Our Store';
  const isPickup = o.collectionMethod === 'Pickup';
  const expMins  = 30;

  const headline    = isPickup ? 'Your order is ready for pickup!' : 'Your order is on the way!';
  const instruction = isPickup
    ? 'Show this OTP to our staff when you arrive to collect your order.'
    : 'Your delivery agent will ask for this OTP at your door. Share it only with them.';

  const body = `
    <p style="font-size:15px;color:#333333;font-family:${FONT};margin:0 0 8px">Hi <strong>${o.customerName}</strong>,</p>
    <p style="font-size:15px;color:#333333;font-family:${FONT};margin:0 0 16px">${headline}</p>
    ${infoTable([['Order ID', `<strong>${o.orderId}</strong>`]])}
    <p style="font-size:14px;color:#555555;font-family:${FONT};margin:16px 0 8px">${instruction}</p>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin:20px 0">
      <tr><td align="center">
        <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#92400e;font-weight:700;font-family:${FONT}">${isPickup ? 'Pickup' : 'Delivery'} OTP</p>
        <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;background:#fef3c7;border:2px dashed #f59e0b;border-radius:14px;margin:0 auto">
          <tr><td style="padding:16px 28px;font-size:40px;font-weight:900;letter-spacing:10px;color:#b45309;font-family:'Courier New',Courier,monospace;text-align:center">${o.otp}</td></tr>
        </table>
        <p style="margin:10px 0 0;font-size:12px;color:#92400e;font-family:${FONT}">Valid for ${expMins} minutes</p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;background:#fef3c7;border-left:4px solid #f59e0b;margin:0 0 8px">
      <tr><td style="padding:12px 16px;font-size:13px;color:#78350f;font-family:${FONT};line-height:1.5">
        <strong>Never share this OTP</strong> over phone or with anyone other than your delivery agent standing at your door.
      </td></tr>
    </table>`;

  await send(
    o.email,
    `${isPickup ? 'Pickup' : 'Delivery'} OTP - ${o.orderId} | ${business}`,
    wrap(`${isPickup ? 'Pickup' : 'Delivery'} OTP - ${o.orderId}`, body, `&copy; ${business} | Do not reply.`),
    `Your ${isPickup ? 'pickup' : 'delivery'} OTP for order ${o.orderId} is: ${o.otp} (valid for ${expMins} minutes)`
  );
}

async function sendCancellationEmail(customerEmail, customerName, orderId, reason, settings, cancelledBy) {
  const business         = settings?.business_name || 'Our Store';
  const isCustomerCancel = cancelledBy === 'customer';

  const reasonMessages = {
    'Out of stock':     'We regret to inform you that one or more items in your order are currently out of stock. Your order has been cancelled.',
    'Customer request': 'As per your cancellation request, we have successfully processed the cancellation of your order.',
    'Cannot fulfill':   'Due to operational constraints, we are unable to process your order. Your order has been cancelled.',
    'Duplicate order':  'Our system detected this as a duplicate order. We have cancelled it to avoid double charges.',
    'Other':            'Due to unforeseen circumstances, we are unable to fulfill your order. Your order has been cancelled.'
  };

  const msg = isCustomerCancel
    ? 'Your order cancellation request has been successfully processed. We hope to serve you again soon.'
    : (reasonMessages[reason] || reasonMessages['Other']);

  const body = `
    <p style="font-size:15px;color:#333333;font-family:${FONT};margin:0 0 8px">Hi <strong>${customerName}</strong>,</p>
    <p style="font-size:14px;color:#b91c1c;font-family:${FONT};margin:0 0 16px">${msg}</p>
    ${infoTable([
      ['Order ID',     `<strong>${orderId}</strong>`],
      ['Status',       `<span style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:#fde8e8;color:#dc2626;font-family:${FONT}">Cancelled</span>`],
      ['Cancelled by', `<strong>${isCustomerCancel ? 'You (Customer)' : 'Store'}</strong>`],
    ])}`;

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
