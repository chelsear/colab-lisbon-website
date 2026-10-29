// Password gate for /master-claude/* while the course isn't public yet.
// The password lives in the MASTER_CLAUDE_PASSWORD env var. A correct password sets an HttpOnly
// cookie holding a hash of it, so changing the env var logs everyone out.
// To make the course public again, delete the [[edge_functions]] block for it in netlify.toml.

const COOKIE = 'mc_access';

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function gatePage(showError) {
  const error = showError ? '<p class="err">Wrong password, try again.</p>' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Private | CoLab</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Archivo+Black&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;
         font-family: 'DM Sans', sans-serif; background: linear-gradient(135deg, #e7583b 0%, #FFB4A2 100%); color: #545454; }
  .box { background: #fff; border: 5px solid #545454; box-shadow: 10px 10px 0 rgba(0,0,0,.3); padding: 40px; max-width: 380px; width: 100%; text-align: center; }
  h1 { font-family: 'Archivo Black', sans-serif; text-transform: uppercase; font-size: 1.8rem; margin: 0 0 10px; }
  p { margin: 0 0 20px; line-height: 1.5; }
  input { width: 100%; box-sizing: border-box; padding: 14px; border: 3px solid #545454; font-size: 1rem; font-family: inherit; margin-bottom: 15px; }
  button { width: 100%; background: #545454; color: #e9f174; border: 3px solid #545454; padding: 14px; font-family: 'Bebas Neue', sans-serif;
           font-size: 1.4rem; letter-spacing: 2px; cursor: pointer; box-shadow: 5px 5px 0 #e9f174; }
  .err { color: #e7583b; font-weight: 700; }
  a { color: #545454; font-size: .95rem; }
</style>
</head>
<body>
  <form class="box" method="POST">
    <h1>Coming Soon</h1>
    <p>This page is private for now.</p>
    ${error}
    <input type="password" name="password" placeholder="Password" autofocus required aria-label="Password">
    <button type="submit">Unlock</button>
    <p style="margin: 20px 0 0;"><a href="/">Go to colablisbon.com →</a></p>
  </form>
</body>
</html>`;
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export default async (request, context) => {
  const password = Netlify.env.get('MASTER_CLAUDE_PASSWORD');
  if (!password) return html(gatePage(false), 401); // fail closed if the env var is missing

  const expected = await sha256('master-claude:' + password);
  if (context.cookies.get(COOKIE) === expected) {
    const res = await context.next();
    res.headers.set('x-robots-tag', 'noindex');
    return res;
  }

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (form && form.get('password') === password) {
      context.cookies.set({ name: COOKIE, value: expected, path: '/master-claude', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 60 * 60 * 24 * 30 });
      return new Response(null, { status: 303, headers: { location: new URL(request.url).pathname, 'cache-control': 'no-store' } });
    }
    return html(gatePage(true), 401);
  }

  return html(gatePage(false), 401);
};
