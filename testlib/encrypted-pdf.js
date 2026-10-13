import { createHash } from 'node:crypto';

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
  0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password) {
  const bytes = Buffer.from(String(password), 'utf8');
  const out = Buffer.alloc(32);
  bytes.copy(out, 0, 0, Math.min(32, bytes.length));
  PAD.copy(out, Math.min(32, bytes.length));
  return out;
}

function md5(parts) {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let index = 0; index < 256; index += 1) s[index] = index;
  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + s[index] + key[index % key.length]) & 255;
    const swap = s[index];
    s[index] = s[j];
    s[j] = swap;
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let index = 0; index < data.length; index += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const swap = s[i];
    s[i] = s[j];
    s[j] = swap;
    out[index] = data[index] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function hex(bytes) {
  return `<${Buffer.from(bytes).toString('hex')}>`;
}

export function encryptedPdf({ userPassword, ownerPassword = userPassword } = {}) {
  const fileId = Buffer.from('0123456789ABCDEF', 'latin1');
  const permissions = -4;
  const ownerKey = md5([padPassword(ownerPassword)]).subarray(0, 5);
  const ownerEntry = rc4(ownerKey, padPassword(userPassword));
  const permissionBytes = Buffer.alloc(4);
  permissionBytes.writeInt32LE(permissions);
  const userKey = md5([
    padPassword(userPassword),
    ownerEntry,
    permissionBytes,
    fileId,
  ]).subarray(0, 5);
  const userEntry = rc4(userKey, PAD);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>',
    '<< /Length 6 >>\nstream\nBT\nET\nendstream',
    `<< /Filter /Standard /V 1 /R 2 /O ${hex(ownerEntry)} /U ${hex(userEntry)} /P ${permissions} >>`,
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, 'latin1');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  const id = fileId.toString('hex');
  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 5 0 R /ID [<${id}> <${id}>] >>\n`;
  body += `startxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
