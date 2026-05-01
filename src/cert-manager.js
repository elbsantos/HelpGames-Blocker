const forge = require('node-forge');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs  = require('fs').promises;
const path = require('path');
const os   = require('os');

const execAsync = promisify(exec);

const CA_CN = 'HelpGames Blocker CA';

let caForgeCert    = null;
let caForgeKey     = null;
let domainForgeKey = null; // chave RSA partilhada por todos os certs de domínio
let domainKeyPem   = null;

const certCache = new Map(); // domain → { cert, key }

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

async function init(dataDir) {
  await loadOrGenerateCA(dataDir);
  await loadOrGenerateDomainKey(dataDir);
  if (os.platform() === 'win32') await installCA(dataDir);
}

// ─── CA ───────────────────────────────────────────────────────────────────────

async function loadOrGenerateCA(dataDir) {
  const keyPath  = path.join(dataDir, 'hg-ca.key.pem');
  const certPath = path.join(dataDir, 'hg-ca.cert.pem');

  try {
    const [kPem, cPem] = await Promise.all([
      fs.readFile(keyPath, 'utf-8'),
      fs.readFile(certPath, 'utf-8'),
    ]);
    caForgeKey  = forge.pki.privateKeyFromPem(kPem);
    caForgeCert = forge.pki.certificateFromPem(cPem);
    console.log('[CertManager] CA carregada do disco');
  } catch {
    console.log('[CertManager] A gerar nova CA (~2s)...');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = buildCACert(keys);

    caForgeKey  = keys.privateKey;
    caForgeCert = cert;

    await fs.writeFile(keyPath,  forge.pki.privateKeyToPem(keys.privateKey), 'utf-8');
    await fs.writeFile(certPath, forge.pki.certificateToPem(cert),           'utf-8');
    console.log('[CertManager] CA gerada e guardada');
  }
}

function buildCACert(keys) {
  const cert = forge.pki.createCertificate();
  cert.publicKey    = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter  = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);

  const attrs = [
    { name: 'commonName',       value: CA_CN },
    { name: 'organizationName', value: 'HelpGames' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true,             critical: true },
    { name: 'keyUsage',         keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return cert;
}

// ─── CHAVE DE DOMÍNIO (partilhada — só gerada uma vez) ───────────────────────

async function loadOrGenerateDomainKey(dataDir) {
  const keyPath = path.join(dataDir, 'hg-domain.key.pem');
  try {
    const kPem   = await fs.readFile(keyPath, 'utf-8');
    const privKey = forge.pki.privateKeyFromPem(kPem);
    domainForgeKey = {
      privateKey: privKey,
      publicKey:  forge.pki.rsa.setPublicKey(privKey.n, privKey.e),
    };
    domainKeyPem = kPem;
    console.log('[CertManager] Domain key carregada do disco');
  } catch {
    console.log('[CertManager] A gerar domain key (~2s)...');
    const keys     = forge.pki.rsa.generateKeyPair(2048);
    domainForgeKey = { privateKey: keys.privateKey, publicKey: keys.publicKey };
    domainKeyPem   = forge.pki.privateKeyToPem(keys.privateKey);
    await fs.writeFile(keyPath, domainKeyPem, 'utf-8');
    console.log('[CertManager] Domain key gerada');
  }
}

// ─── CERT STORE DO WINDOWS ────────────────────────────────────────────────────

async function installCA(dataDir) {
  const certPath = path.join(dataDir, 'hg-ca.cert.pem');
  // Garantir que o ficheiro existe (pode ter sido carregado do disco)
  await fs.writeFile(certPath, forge.pki.certificateToPem(caForgeCert), 'utf-8');

  try {
    // -f = force (não falha se já existe); requer Administrador (app.exe já pede UAC)
    await execAsync(`certutil -addstore -f "Root" "${certPath}"`);
    console.log('[CertManager] ✅ CA instalada no Windows Certificate Store');
    console.log('[CertManager]    HTTPS de sites bloqueados mostrará a página HelpGames');
  } catch (err) {
    console.warn('[CertManager] ⚠️ Não foi possível instalar a CA:', err.message);
    console.warn('[CertManager]    Sites HTTPS bloqueados mostrarão erro SSL em vez da página de bloqueio.');
  }
}

async function removeCA() {
  if (os.platform() !== 'win32') return;
  try {
    await execAsync(`certutil -delstore "Root" "${CA_CN}"`);
    console.log('[CertManager] CA removida do Certificate Store');
  } catch (e) { /* já não existia */ }
}

// ─── GERAÇÃO DE CERT POR DOMÍNIO (reutiliza domain key — é rápido) ──────────

function getCertForDomain(domain) {
  const host = domain.replace(/^www\./, '').toLowerCase();
  if (certCache.has(host)) return certCache.get(host);

  const cert = forge.pki.createCertificate();
  cert.publicKey    = domainForgeKey.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter  = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(caForgeCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage',    digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: host },
        { type: 2, value: 'www.' + host },
      ],
    },
  ]);
  cert.sign(caForgeKey, forge.md.sha256.create());

  const result = { cert: forge.pki.certificateToPem(cert), key: domainKeyPem };
  certCache.set(host, result);
  console.log('[CertManager] Cert gerado para:', host);
  return result;
}

module.exports = { init, removeCA, getCertForDomain };
