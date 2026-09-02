/**
 * Copy to clipboard, including on plain http.
 *
 * This matters more here than in most apps: the dashboard's normal address is
 * `http://192.168.1.x`, which is not a secure context, so `navigator.clipboard`
 * is simply absent - the Wi-Fi password copy button was silently throwing.
 * The textarea route is the only thing that works there.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through - permission denied, or an insecure origin.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** True when the Web Share sheet is actually usable, not merely defined. */
export function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && isSecureContext;
}
