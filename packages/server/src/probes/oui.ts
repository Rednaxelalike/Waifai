/**
 * MAC address vendor hints.
 *
 * The full IEEE OUI registry is ~3MB and 35,000 rows. Shipping it would double
 * the install for a cosmetic feature, so this is a hand-picked table covering
 * the makes that actually appear on a Nigerian home network. Anything unknown
 * simply shows no vendor, which is fine: the household renames devices by hand
 * anyway, and the vendor guess only exists to make that first naming pass
 * easier ("Apple, Inc." is a much better prompt than "3C:22:FB:0A:11:02").
 */
const OUI: Record<string, string> = {
  // Apple
  '3C:22:FB': 'Apple', 'A4:83:E7': 'Apple', 'F0:18:98': 'Apple', 'D0:81:7A': 'Apple',
  '90:9C:4A': 'Apple', 'AC:BC:32': 'Apple', '68:AB:BC': 'Apple', 'DC:A9:04': 'Apple',
  // Samsung
  '00:12:FB': 'Samsung', '5C:0A:5B': 'Samsung', 'E8:50:8B': 'Samsung', 'F0:25:B7': 'Samsung',
  '8C:77:12': 'Samsung', 'A0:21:95': 'Samsung', 'CC:07:AB': 'Samsung',
  // Chinese Android OEMs, very common on MTN networks
  '18:59:36': 'Xiaomi', '64:CC:2E': 'Xiaomi', '7C:49:EB': 'Xiaomi', 'F8:A4:5F': 'Xiaomi',
  '00:E0:4C': 'Realtek', '10:2A:B3': 'Xiaomi',
  '28:6C:07': 'Xiaomi', '34:CE:00': 'Xiaomi',
  '00:9A:CD': 'Huawei', '48:46:FB': 'Huawei', '80:B6:86': 'Huawei', 'E0:24:7F': 'Huawei',
  '10:47:80': 'Huawei', '4C:54:99': 'Huawei', 'AC:E3:42': 'Huawei',
  '94:65:2D': 'OnePlus', 'C0:EE:FB': 'OnePlus',
  '6C:5A:B5': 'TCL/Alcatel', '3C:BB:FD': 'Tecno', 'B0:F1:A3': 'Infinix',
  '54:9F:13': 'Itel', 'D4:38:9C': 'Oppo', '2C:5B:B8': 'Oppo', 'F8:E6:1A': 'Vivo',
  // Networking kit
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi',
  '00:1A:11': 'Google', 'F4:F5:D8': 'Google', '54:60:09': 'Google',
  'D8:0D:17': 'TP-Link', '50:C7:BF': 'TP-Link', 'AC:84:C6': 'TP-Link',
  '00:1D:7E': 'Cisco-Linksys', 'C0:56:27': 'Belkin', '00:24:01': 'D-Link',
  // Laptops and desktops
  '00:1B:63': 'Intel', '3C:97:0E': 'Intel', '8C:16:45': 'Intel', 'A4:C3:F0': 'Intel',
  '00:21:CC': 'Dell', 'F8:BC:12': 'Dell', '18:66:DA': 'Dell',
  '3C:D9:2B': 'HP', '70:5A:0F': 'HP', '9C:B6:D0': 'Lenovo', '54:E1:AD': 'Lenovo',
  // Media devices
  '00:04:4B': 'NVIDIA', 'B0:A7:37': 'Roku', '74:75:48': 'Amazon', 'FC:65:DE': 'Amazon',
  '00:17:88': 'Philips Hue', 'CC:50:E3': 'Espressif (IoT)', '24:0A:C4': 'Espressif (IoT)',
  'A0:20:A6': 'Espressif (IoT)', '2C:F4:32': 'Espressif (IoT)',
};

/**
 * Modern phones rotate a random MAC per network unless the user disables the
 * feature. The IEEE marks these by setting the locally-administered bit in the
 * first octet, so they are detectable.
 *
 * This matters a lot for a household dashboard: a randomised MAC means the
 * same phone can appear as a brand-new "unknown device" after a Wi-Fi reset,
 * which would otherwise fire a false security alert every few weeks.
 */
export function isRandomisedMac(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  if (!Number.isFinite(first)) return false;
  // Bit 1 (0x02) set = locally administered. Bit 0 (0x01) set = multicast.
  return (first & 0x02) !== 0 && (first & 0x01) === 0;
}

export function vendorFor(mac: string): string | null {
  const prefix = mac.toUpperCase().replace(/-/g, ':').slice(0, 8);
  const hit = OUI[prefix];
  if (hit) return hit;
  if (isRandomisedMac(mac)) return 'Private address (randomised)';
  return null;
}
