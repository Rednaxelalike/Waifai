import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OntPage } from './client.ts';
import {
  detectKinds,
  parseDevices,
  parseOntInfo,
  parseOptical,
  parseUptime,
  parseWan,
  ponIsUp,
} from './parse.ts';

/**
 * Parser tests against the page shapes HG8145V5 firmware actually produces.
 *
 * These matter more than usual because the real input is unreachable from a
 * development machine - the ONT only exists on the household LAN. Without
 * these, a regex change is unverifiable until it silently breaks a month of
 * collection.
 *
 * The three layouts below are the ones seen across MTN's firmware revisions:
 * a JS-literal page, a plain HTML table, and a label/value list.
 */

const page = (body: string, path = '/test.asp'): OntPage => ({ path, body, status: 200, ok: true });

// Layout 1: data hidden in JS constructor calls, the most common Huawei style.
const JS_OPTICAL = page(`
<html><head><script>
var ponStatusPara = new stPonStatus("O5","-19.24","2.51","23.400","3.29","0.012");
function InitPage(){ Frm_RxPower.value = "-19.24"; }
</script></head>
<body><table><tr><td>PON Status</td><td>O5</td></tr></table></body></html>
`);

// Layout 2: a real HTML table, seen on newer builds.
const TABLE_OPTICAL = page(`
<html><body>
<table class="table_data">
  <tr><th>Item</th><th>Value</th></tr>
  <tr><td>Rx Optical Power(dBm)</td><td>-22.87</td></tr>
  <tr><td>Tx Optical Power(dBm)</td><td>2.14</td></tr>
  <tr><td>Temperature(C)</td><td>41.5</td></tr>
  <tr><td>Voltage(V)</td><td>3.28</td></tr>
  <tr><td>Bias Current(mA)</td><td>12.7</td></tr>
  <tr><td>PON Status</td><td>O5</td></tr>
</table></body></html>
`);

// Layout 3: integer-scaled optical values, which some builds report.
const SCALED_OPTICAL = page(`
<html><body>Rx Optical Power : -2103 &nbsp; Tx Optical Power : 251</body></html>
`);

test('reads optical values out of JS literals', () => {
  const s = parseOptical([JS_OPTICAL]);
  assert.equal(s.rxPower, -19.24);
  assert.equal(s.ponStatus, 'O5');
  assert.ok(ponIsUp(s.ponStatus));
});

test('reads optical values out of an HTML table', () => {
  const s = parseOptical([TABLE_OPTICAL]);
  assert.equal(s.rxPower, -22.87);
  assert.equal(s.txPower, 2.14);
  assert.equal(s.temperature, 41.5);
  assert.equal(s.voltage, 3.28);
  assert.equal(s.biasCurrent, 12.7);
});

test('rescales optical values reported as scaled integers', () => {
  // -2103 is -21.03 dBm scaled by 100; a raw -2103 dBm would be nonsense.
  const s = parseOptical([SCALED_OPTICAL]);
  assert.equal(s.rxPower, -21.03);
  assert.equal(s.txPower, 2.51);
});

test('rejects out-of-range values rather than storing nonsense', () => {
  // The page mentions Rx power but the number is impossible, so the range
  // check must discard it. A wrong reading is worse than a missing one: it
  // would poison the drift regression for weeks.
  const junk = page('<body>Rx Optical Power: 999999 Tx Optical Power: nonsense</body>');
  const s = parseOptical([junk]);
  assert.equal(s.rxPower, null);
  assert.equal(s.txPower, null);
});

test('merges fields found across several pages', () => {
  const a = page('<body>Rx Optical Power(dBm): -18.10</body>', '/a.asp');
  const b = page('<body>Temperature(C): 39.0 PON Status: O5</body>', '/b.asp');
  const s = parseOptical([a, b]);
  assert.equal(s.rxPower, -18.1);
  assert.equal(s.temperature, 39);
  assert.equal(s.ponStatus, 'O5');
});

test('recognises PON states that mean the link is carrying traffic', () => {
  assert.ok(ponIsUp('O5'));
  assert.ok(ponIsUp('Online'));
  assert.ok(!ponIsUp('O1'));
  assert.ok(!ponIsUp('LOS'));
  assert.ok(!ponIsUp(null));
});

// ---------------------------------------------------------------------------

test('picks the public WAN address and ignores LAN addresses', () => {
  const p = page(`
    <body>
      <tr><td>LAN IP Address</td><td>192.168.100.1</td></tr>
      <tr><td>WAN IP Address</td><td>105.112.44.19</td></tr>
      <tr><td>Connection Status</td><td>Connected</td></tr>
      <tr><td>Bytes Received</td><td>884213770124</td></tr>
      <tr><td>Bytes Sent</td><td>41220118834</td></tr>
      <tr><td>Online Duration</td><td>3 day(s) 04 hour(s) 11 min(s)</td></tr>
    </body>`);
  const w = parseWan([p]);
  assert.equal(w.ipv4, '105.112.44.19');
  assert.equal(w.up, true);
  assert.equal(w.rxBytes, 884213770124);
  assert.equal(w.txBytes, 41220118834);
  assert.equal(w.connectionUptimeSec, 3 * 86400 + 4 * 3600 + 11 * 60);
});

test('treats CGNAT space as a real WAN address', () => {
  // MTN FibreX hands out 100.64.0.0/10. Excluding it as "private" would make
  // the monitor report a permanently dead WAN on most of their lines.
  const w = parseWan([page('<body>WAN IP Address: 100.78.13.201 Connected</body>')]);
  assert.equal(w.ipv4, '100.78.13.201');
  assert.equal(w.up, true);
});

test('reports the WAN down when nothing says otherwise', () => {
  const w = parseWan([page('<body>Connection Status: Disconnected LAN IP: 192.168.100.1</body>')]);
  assert.equal(w.ipv4, null);
  assert.equal(w.up, false);
});

test('parses the several duration formats this firmware uses', () => {
  assert.equal(parseUptime('5 day(s) 3 hour(s) 2 min(s) 10 sec(s)'), 5 * 86400 + 3 * 3600 + 130);
  assert.equal(parseUptime('12 hours 30 mins'), 12 * 3600 + 1800);
  assert.equal(parseUptime('nothing here'), null);
});

// ---------------------------------------------------------------------------

test('extracts attached devices from JS records', () => {
  const p = page(`<script>
    var devs = new Array();
    devs[0] = new USERDevice("1","192.168.100.7","3C:22:FB:0A:11:02","kemi-iphone","5GHz","-54dBm");
    devs[1] = new USERDevice("2","192.168.100.9","B8:27:EB:AA:BB:CC","raspberrypi","Ethernet","");
  </script>`);
  const devices = parseDevices([p]);
  assert.equal(devices.length, 2);

  const phone = devices.find((d) => d.mac === '3C:22:FB:0A:11:02');
  assert.equal(phone?.ip, '192.168.100.7');
  assert.equal(phone?.hostname, 'kemi-iphone');
  assert.equal(phone?.connection, '5G');
  assert.equal(phone?.rssi, -54);

  const pi = devices.find((d) => d.mac === 'B8:27:EB:AA:BB:CC');
  assert.equal(pi?.connection, 'ethernet');
});

test('extracts attached devices from an HTML table', () => {
  const p = page(`
    <table>
      <tr><th>Host</th><th>MAC</th><th>IP</th><th>Interface</th></tr>
      <tr><td>galaxy-a54</td><td>E8-50-8B-11-22-33</td><td>192.168.100.14</td><td>2.4GHz</td></tr>
    </table>`);
  const [d] = parseDevices([p]);
  // Dash-separated MACs are normalised so the same device never appears twice.
  assert.equal(d?.mac, 'E8:50:8B:11:22:33');
  assert.equal(d?.ip, '192.168.100.14');
  assert.equal(d?.hostname, 'galaxy-a54');
  assert.equal(d?.connection, '2.4G');
});

test('merges one device seen on two pages instead of duplicating it', () => {
  const dhcp = page('<tr><td>AA:BB:CC:DD:EE:01</td><td>192.168.100.20</td></tr>', '/dhcp.asp');
  const wlan = page(
    '<script>new WlanUser("AA:BB:CC:DD:EE:01","tobi-laptop","5GHz","-61dBm")</script>',
    '/wlan.asp',
  );
  const devices = parseDevices([dhcp, wlan]);
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.ip, '192.168.100.20');
  assert.equal(devices[0]?.hostname, 'tobi-laptop');
});

// ---------------------------------------------------------------------------

test('discovery reports what each page actually yielded', () => {
  assert.deepEqual(detectKinds(TABLE_OPTICAL).sort(), ['optical', 'pon']);
  // A page that answered but contains nothing we understand must report
  // nothing, so polling can stop fetching it.
  assert.deepEqual(detectKinds(page('<html><body>Menu</body></html>')), []);
  assert.deepEqual(detectKinds({ path: '/x', body: '', status: 404, ok: false }), []);
});

// ---------------------------------------------------------------------------
// Layout 4: V5R022C10S590, the build MTN ships today.
//
// Two things make this one different from every layout above, and both make
// the earlier parsers return nothing at all rather than return something
// wrong: values are hex-escaped, and they are positional arguments to a
// constructor declared higher up the same page. These fixtures are trimmed
// verbatim from a live HG8145V5 so that the escaping is exactly as served.
// ---------------------------------------------------------------------------

const HW_OPTICAL = page(String.raw`
<script>
    function stOpticInfo(domain,LinkStatus,transOpticPower,revOpticPower,voltage,temperature,bias,rfRxPower,rfOutputPower,VendorName,VendorSN)
    { this.domain = domain; }
    function stOpticInfo(domain,LinkStatus,transOpticPower,revOpticPower,voltage,temperature,bias,rfRxPower,rfOutputPower, VendorName, VendorSN, DateCode, TxWaveLength, RxWaveLength, MaxTxDistance, LosStatus)
    { this.domain = domain; }
    var opticInfos = new Array(new stOpticInfo("InternetGatewayDevice.X_HW_DEBUG.AMP.Optic","ok","2\x2e36\x20","\x2d12\x2e54","3300","53","13","\x2d\x2d","\x2d\x2d","HUAWEI\x20\x20","2413WM034346N\x20","250411","1310","1490","20","0"),null);
</script>
`);

const HW_DEVICEINFO = page(String.raw`
<script>
function ONTInfo(domain,ONTID,Status) { this.Status = Status; }
function stDeviceInfo(domain,SerialNumber,HardwareVersion,SoftwareVersion,ModelName,VendorID,ReleaseTime,Mac,Description,ManufactureInfo,DeviceAlias, WanMac)
{ this.Mac = Mac; }
var dev_uptime = '11946';
var ontInfos = new Array(new ONTInfo("InternetGatewayDevice.X_HW_DEBUG.AMP.ONT","0","O5"),null);
var deviceInfos = new Array(new stDeviceInfo("InternetGatewayDevice.DeviceInfo","48575443DACE2CB3","26AD\x2eA","V5R022C10S590","HG8145V5","HWTC","2025\x2d09\x2d04","2C\x3a27\x3a68\x3a17\x3a15\x3aF4","EchoLife\x20HG8145V5\x20GPON\x20Terminal\x20\x28CLASS\x20B\x2b\x2fPRODUCT\x20ID\x3a2150087569AGR4001572\x29","2150087569AGR4001572\x2eC442","",""),null);
</script>
`);

const HW_ETHINFO = page(String.raw`
<script>
function GEMStats(domain, gemId, tcontId, txPackets, txPackets_H, txBytes, txBytes_H, rxPackets, rxPackets_H, rxBytes, rxBytes_H, discard, direction, type) { this.gemId = gemId; }
var gemStats = new Array(
  new GEMStats("...Gemport.GemInfo.1.Stats","4095","0","0","0","0","0","0","0","0","0","0","Downstream","IPTV"),
  new GEMStats("...Gemport.GemInfo.2.Stats","256","1","4565846","0","205497522","0","2863358","0","3764941744","0","0","Bidirection","Ethernet"),
  null);
</script>
`);

const HW_WANLIST = page(String.raw`
<script>
  var PPPWanList = new Array(new WanPPP("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1","0","0","AlwaysOn","2C\x3a27\x3a68\x3a17\x3a15\x3aF5","Connected","ERROR\x5fNONE","","NCE\x5fHOME\x5fUPublic\x5fIP\x5f437","1","","","Connected","IP\x5fRouted","10\x2e48\x2e85\x2e214","10\x2e48\x2e0\x2e1","1","0","102\x2e88\x2e158\x2e7\x2c197\x2e210\x2e211\x2e1","FN212603","AlwaysOn","4294967295","437"),null);
</script>
`);

const HW_DEVICES = page(String.raw`
<script>
function USERDevice(Domain,IpAddr,MacAddr,Port,IpType,DevType,DevStatus,PortType,Time,HostName,IPv4Enabled,IPv6Enabled,DeviceType,UserDevAlias,UserSpecifiedDeviceType,LeaseTimeRemaining,TrafficSendRate,TrafficRecvRate)
{ this.MacAddr = MacAddr; }
var UserDevInfo = new Array(
 new USERDevice("...X_HW_UserDev.1","192\x2e168\x2e100\x2e5","60\x3a75\x3a6c\x3a28\x3adf\x3a46","LAN1","DHCP","","Online","ETH","1\x3a20","LGwebOSTV","1","1","0","","0","74243","0","0"),
 new USERDevice("...X_HW_UserDev.6","192\x2e168\x2e100\x2e8","f4\x3ad1\x3a08\x3ae4\x3a62\x3afe","SSID1","DHCP","MSFT\x205\x2e0","Online","WIFI","0\x3a3","DESKTOP\x2dJCT7IDU","1","1","0","","0","86212","0","0"),
 null);
</script>
`);

test('reads hex-escaped optical values out of a positional record', () => {
  const o = parseOptical([HW_OPTICAL]);
  assert.equal(o.rxPower, -12.54);
  assert.equal(o.txPower, 2.36);
  assert.equal(o.temperature, 53);
  assert.equal(o.biasCurrent, 13);
});

test('converts an optical supply voltage reported in millivolts', () => {
  // 3300 mV, not 3300 V. Left unscaled it fails the plausibility range and the
  // field is dropped entirely.
  assert.equal(parseOptical([HW_OPTICAL]).voltage, 3.3);
});

test('picks the constructor overload whose arity matches the call', () => {
  // opticinfo.asp declares stOpticInfo twice, with 11 and 16 parameters. Under
  // the 11-parameter signature, `revOpticPower` names a different column.
  assert.equal(parseOptical([HW_OPTICAL]).rxPower, -12.54);
});

test('finds the PON state inside a script, where stripTags cannot reach', () => {
  assert.equal(parseOptical([HW_DEVICEINFO]).ponStatus, 'O5');
  assert.ok(ponIsUp(parseOptical([HW_DEVICEINFO]).ponStatus));
});

test('reads WAN byte counters from GEM port statistics', () => {
  const w = parseWan([HW_ETHINFO]);
  assert.equal(w.rxBytes, 3_764_941_744);
  assert.equal(w.txBytes, 205_497_522);
});

test('excludes IPTV GEM ports from the household data total', () => {
  // Multicast TV never touches the internet plan, so counting it would inflate
  // the usage figure against the cap MTN actually bills.
  assert.equal(parseWan([HW_ETHINFO]).rxBytes, 3_764_941_744);
});

test('recombines the high word of a split 64-bit counter', () => {
  const wrapped = page(HW_ETHINFO.body.replace('"3764941744","0"', '"3764941744","2"'));
  assert.equal(parseWan([wrapped]).rxBytes, 2 * 2 ** 32 + 3_764_941_744);
});

test('accepts a CGNAT WAN address inside RFC1918 space', () => {
  // MTN FibreX hands the ONT a 10/8 address. Rejecting RFC1918 outright - the
  // right rule anywhere else - leaves this line with no WAN address at all.
  const w = parseWan([HW_WANLIST]);
  assert.equal(w.ipv4, '10.48.85.214');
  assert.equal(w.up, true);
});

test('takes the external address rather than the gateway beside it', () => {
  assert.equal(parseWan([HW_WANLIST]).ipv4, '10.48.85.214');
});

test('still refuses a LAN address as the WAN address', () => {
  const lanOnly = page('<body>IP Address 192.168.100.1 Connected</body>');
  assert.equal(parseWan([lanOnly]).ipv4, null);
});

test('names devices from the HostName field, not the OS vendor string', () => {
  const devices = parseDevices([HW_DEVICES]);
  const desktop = devices.find((d) => d.mac === 'F4:D1:08:E4:62:FE');
  // The row also contains "MSFT 5.0", which is hostname-shaped and comes first.
  assert.equal(desktop?.hostname, 'DESKTOP-JCT7IDU');
  assert.equal(desktop?.ip, '192.168.100.8');
  assert.equal(desktop?.connection, '2.4G');
});

test('distinguishes a wired device from a wireless one by port', () => {
  const tv = parseDevices([HW_DEVICES]).find((d) => d.mac === '60:75:6C:28:DF:46');
  assert.equal(tv?.hostname, 'LGwebOSTV');
  assert.equal(tv?.connection, 'ethernet');
});

test('reads model and firmware from the device-info record', () => {
  assert.deepEqual(detectKinds(HW_DEVICEINFO).sort(), ['info', 'pon', 'uptime']);
});

test('reads the system uptime out of the script, where stripTags cannot reach', () => {
  // This build publishes uptime only as a JS variable that the page then ticks
  // up in the browser, so the rendered text has no such label anywhere. It is
  // also the single value that lets an unwatched power cut be reconstructed
  // afterwards, which is why it gets its own test rather than riding along.
  const info = parseOntInfo([HW_DEVICEINFO]);
  assert.equal(info.uptimeSec, 11946);
  assert.equal(info.model, 'HG8145V5');
  assert.equal(info.firmware, 'V5R022C10S590');
});

test('discovery recognises every page this firmware serves', () => {
  assert.ok(detectKinds(HW_OPTICAL).includes('optical'));
  assert.ok(detectKinds(HW_ETHINFO).includes('counters'));
  assert.ok(detectKinds(HW_WANLIST).includes('wan_ip'));
  assert.ok(detectKinds(HW_DEVICES).includes('devices'));
});
