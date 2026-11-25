// Follow public game-page metadata and confirm the selected URL serves an image.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { isIP } = require('node:net');
const ipaddr = require('ipaddr.js');
const { Parser } = require('htmlparser2');

function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true, family: 4 }, (err, records) => {
    if (err) return callback(err);
    const publicRecords = records.filter((r) => ipaddr.parse(r.address).range() === 'unicast');
    if (!publicRecords.length) return callback(Error('Alamat publik tidak tersedia.'));
    const first = publicRecords[0];
    if (options.all) callback(null, publicRecords);
    else callback(null, first.address, first.family);
  });
}
function request(url, signal) {
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, ''))
  )
    throw Error('Gunakan URL halaman game publik.');
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    transport
      .get(
        url,
        { lookup: publicLookup, signal, agent: false, headers: { 'User-Agent': 'CheeseBlack/1.0' } },
        resolve,
      )
      .on('error', reject);
  });
}
async function resource(url, signal, open) {
  for (let hops = 0; hops < 5; hops++) {
    const res = await open(url, signal);
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.destroy();
      url = new URL(res.headers.location, url);
      continue;
    }
    return { url, res };
  }
  throw Error('Terlalu banyak redirect.');
}
function metaImage(html) {
  let og, twitter;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag !== 'meta') return;
      const key = (attrs.property || attrs.name || '').toLowerCase();
      if (key === 'og:image' && !og) og = attrs.content;
      if (key === 'twitter:image' && !twitter) twitter = attrs.content;
    },
  });
  parser.end(html);
  return og || twitter;
}
async function imageFromPage(link, open = request) {
  const signal = AbortSignal.timeout(5500);
  let url = new URL(link);
  for (let step = 0; step < 2; step++) {
    const result = await resource(url, signal, open);
    const res = result.res;
    try {
      if (res.statusCode !== 200) return null;
      const type = (res.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return result.url.href;
      if (step || type !== 'text/html') return null;
      const chunks = [];
      let size = 0;
      for await (const chunk of res) {
        const buf = Buffer.from(chunk);
        chunks.push(buf.subarray(0, 256 * 1024 - size));
        size += buf.length;
        if (size >= 256 * 1024 || buf.toString().toLowerCase().includes('</head>')) break;
      }
      const img = metaImage(Buffer.concat(chunks).toString('utf8'));
      if (!img) return null;
      url = new URL(img, result.url);
    } finally {
      res.destroy();
    }
  }
  return null;
}
module.exports = { imageFromPage };
