import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const JWT = process.env.PAGES_JWT;
const PROJECT_NAME = 'agentflow';
const ACCOUNT_ID = '74b9cf4e6140208d3593aed9f23ee2c5';

function getFiles(dir, base = '') {
  const files = [];
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const relPath = base ? join(base, item) : item;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getFiles(fullPath, relPath));
    } else {
      files.push({ path: relPath, fullPath });
    }
  }
  return files;
}

function hashFile(path) {
  const content = readFileSync(path);
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  const distPath = './dist';
  const files = getFiles(distPath);

  // Build manifest: { path: hash }
  const manifest = {};
  const fileList = [];
  for (const f of files) {
    const hash = hashFile(f.fullPath);
    manifest[f.path] = hash;
    fileList.push({ ...f, hash });
  }

  console.log('Files:', Object.keys(manifest));

  // Step 1: Check missing
  const hashes = Object.values(manifest);
  const checkRes = await fetch('https://api.cloudflare.com/client/v4/pages/assets/check-missing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JWT}`,
    },
    body: JSON.stringify({ hashes }),
  });
  const checkData = await checkRes.json();
  console.log('Check missing:', checkData);

  const missingHashes = checkData.result || hashes;

  // Step 2: Upload missing files
  const uploadPayload = [];
  for (const file of fileList) {
    if (!missingHashes.includes(file.hash)) continue;

    const content = readFileSync(file.fullPath);
    const base64 = content.toString('base64');
    const ext = file.path.split('.').pop();
    let contentType = 'application/octet-stream';
    if (ext === 'html') contentType = 'text/html';
    else if (ext === 'css') contentType = 'text/css';
    else if (ext === 'js') contentType = 'application/javascript';
    else if (ext === 'svg') contentType = 'image/svg+xml';

    uploadPayload.push({
      key: file.hash,
      value: base64,
      metadata: { contentType },
      base64: true,
    });
  }

  if (uploadPayload.length > 0) {
    const uploadRes = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT}`,
      },
      body: JSON.stringify(uploadPayload),
    });
    console.log('Upload:', await uploadRes.json());
  } else {
    console.log('No files to upload');
  }

  // Step 3: Upsert hashes
  const upsertRes = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JWT}`,
    },
    body: JSON.stringify({ hashes }),
  });
  console.log('Upsert hashes:', await upsertRes.json());

  // Step 4: Create deployment (multipart/form-data)
  const boundary = '----FormBoundary' + Date.now();
  const manifestJson = JSON.stringify(manifest);

  const formParts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="manifest"',
    '',
    manifestJson,
    `--${boundary}`,
    'Content-Disposition: form-data; name="branch"',
    '',
    'main',
    `--${boundary}--`,
  ];
  const body = formParts.join('\r\n');

  const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${JWT}`,
    },
    body,
  });
  const deployData = await deployRes.json();
  console.log('Deployment:', JSON.stringify(deployData, null, 2));
}

main().catch(console.error);
