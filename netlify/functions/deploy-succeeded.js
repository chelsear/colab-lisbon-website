// Runs automatically after every successful Netlify deploy (the file name is the trigger).
// On production deploys it sends every URL in the live sitemap to IndexNow, which shares them with
// Bing, Yandex and the other engines that use it. Google doesn't use IndexNow.
const SITE = 'https://colablisbon.com';
const INDEXNOW_KEY = '745b2b6e90658c6e86361ed79c888845'; // also served at /<key>.txt for verification

exports.handler = async (event) => {
  let context;
  try {
    context = JSON.parse(event.body || '{}').payload?.context;
  } catch (err) {
    context = undefined;
  }
  if (context !== 'production') {
    console.log(`IndexNow skipped: ${context || 'unknown'} deploy`);
    return { statusCode: 200 };
  }

  try {
    const sitemap = await (await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(5000) })).text();
    const urlList = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()))];
    if (urlList.length === 0) {
      console.error('IndexNow skipped: no URLs found in sitemap');
      return { statusCode: 200 };
    }

    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(SITE).host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(8000),
    });
    console.log(`IndexNow: submitted ${urlList.length} URLs, HTTP ${res.status}`);
  } catch (err) {
    console.error('IndexNow submission failed:', err.message);
  }
  return { statusCode: 200 };
};
