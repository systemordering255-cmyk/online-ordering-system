const ALLOWED_DOMAIN = 'online-ordering-system-rho.vercel.app';

// User-agent substrings that identify common scraping tools/libraries
const BOT_SIGNATURES = [
  'python-requests', 'python-urllib', 'Python/',
  'Go-http-client', 'Go/',
  'curl/', 'Wget/', 'wget/',
  'Scrapy/', 'httpx/', 'aiohttp/', 'HTTPie/',
  'Java/', 'java/', 'okhttp', 'ApacheHttpClient',
  'libwww', 'LWP::', 'WWW-Mechanize', 'mechanize',
  'Faraday', 'RestSharp', 'axios/', 'node-fetch',
  'PostmanRuntime', 'insomnia/',
];

module.exports = function guard(req, res) {
  const ua      = (req.headers['user-agent'] || '').trim();
  const origin  = (req.headers['origin']   || '');
  const referer = (req.headers['referer']  || '');

  // Block missing or bot User-Agent
  if (!ua || BOT_SIGNATURES.some(s => ua.includes(s))) {
    res.status(403).json({ error: 'Forbidden.' });
    return false;
  }

  // For write requests: origin or referer must come from our domain
  if (req.method !== 'GET') {
    const fromDomain = origin.includes(ALLOWED_DOMAIN) || referer.includes(ALLOWED_DOMAIN);
    if (!fromDomain) {
      res.status(403).json({ error: 'Forbidden.' });
      return false;
    }
  }

  return true;
};
