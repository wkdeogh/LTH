// Next can normalize the internal request URL to localhost. Match the browser
// Origin against the actual Host, which also scopes the app's session cookie.
export function sameRequestOrigin(request: Pick<Request, 'headers' | 'url'>) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin), internal = new URL(request.url);
    const host = request.headers.get('host') ?? internal.host;
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
    const protocol = forwarded === 'http' || forwarded === 'https' ? `${forwarded}:` : internal.protocol;
    return parsed.origin === origin && ['http:', 'https:'].includes(parsed.protocol)
      && parsed.protocol === protocol && parsed.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}
