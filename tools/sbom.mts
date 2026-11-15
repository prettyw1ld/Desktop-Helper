// SBOM (CycloneDX 1.5, JSON) из package-lock.json, без новых зависимостей.
//   node tools/sbom.mts            → dist/sbom.cdx.json (всё, что попадает в установщик, и чем собирали)
// Службе ИБ: файл грузится в Dependency-Track и подобные системы.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface LockPkg { version?: string; resolved?: string; integrity?: string; dev?: boolean; optional?: boolean; license?: string; link?: boolean }

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockPkg> };

/** sha512-<base64> из lock → { alg, content: hex } */
function hash(integrity = ''): { alg: string; content: string }[] {
  const m = /^(sha(?:1|256|384|512))-(.+)$/.exec(integrity.split(' ')[0] ?? '');
  if (!m) return [];
  const alg = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[m[1]!]!;
  return [{ alg, content: Buffer.from(m[2]!, 'base64').toString('hex') }];
}

const components = Object.entries(lock.packages)
  .filter(([p, v]) => p && !v.link && v.version)
  .map(([p, v]) => {
    const name = p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const purl = `pkg:npm/${name.replace('@', '%40')}@${v.version}`;
    return {
      type: 'library',
      'bom-ref': `${purl}?path=${encodeURIComponent(p)}`,
      name,
      version: v.version,
      purl,
      // dev: нужен только для сборки, в установщик не попадает
      // Electron записан как dev, но это и есть среда, в которой работает Пушик: он в установщике
      scope: name === 'electron' ? 'required' : v.dev ? 'excluded' : v.optional ? 'optional' : 'required',
      ...(v.license ? { licenses: [{ license: { id: v.license } }] } : {}),
      ...(hash(v.integrity).length ? { hashes: hash(v.integrity) } : {}),
      ...(v.resolved ? { externalReferences: [{ type: 'distribution', url: v.resolved }] } : {}),
    };
  })
  .sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ name: 'pushik tools/sbom.mts' }],
    component: { type: 'application', 'bom-ref': `pkg:npm/${pkg.name}@${pkg.version}`, name: pkg.name, version: pkg.version },
  },
  components,
};

const out = path.join(root, 'dist', 'sbom.cdx.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(bom, null, 2));
const shipped = components.filter((c) => c.scope !== 'excluded').length;
console.log(`SBOM: ${components.length} components (${shipped} shipped) → ${path.relative(root, out)}`);
