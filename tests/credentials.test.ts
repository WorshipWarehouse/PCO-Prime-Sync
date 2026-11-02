import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validatePcoCredentials,
  writePcoCredentialsToEnv,
} from '../src/server/pco/credentials';

const tempDirs: string[] = [];

function tempEnvFile(contents = ''): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pco-prime-sync-'));
  tempDirs.push(dir);
  const file = path.join(dir, '.env');
  if (contents) fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function jsonApiResponse(data: unknown[], status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('validatePcoCredentials', () => {
  it('reports the service types visible to a valid token', async () => {
    const result = await validatePcoCredentials(
      { appId: 'app-id', secret: 'secret' },
      {
        fetchImpl: async () =>
          jsonApiResponse([
            { id: '111', type: 'ServiceType', attributes: { name: 'Sunday Service' } },
            { id: '222', type: 'ServiceType', attributes: { name: 'Midweek' } },
          ]),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.serviceTypes).toEqual([
      { id: '111', name: 'Sunday Service' },
      { id: '222', name: 'Midweek' },
    ]);
    expect(result.message).toContain('2 service types');
  });

  it('rejects a token Planning Center does not accept', async () => {
    const result = await validatePcoCredentials(
      { appId: 'app-id', secret: 'wrong' },
      { fetchImpl: async () => new Response('{"errors":[]}', { status: 401 }) },
    );

    expect(result.ok).toBe(false);
    expect(result.serviceTypes).toEqual([]);
    expect(result.message).toMatch(/rejected/i);
    // The secret must never be echoed back.
    expect(result.message).not.toContain('wrong');
  });

  it('reports a reachable-but-empty token without pretending it works', async () => {
    const result = await validatePcoCredentials(
      { appId: 'app-id', secret: 'secret' },
      { fetchImpl: async () => jsonApiResponse([]) },
    );

    expect(result.ok).toBe(true);
    expect(result.serviceTypes).toEqual([]);
    expect(result.message).toMatch(/cannot see any service types/i);
  });

  it('requires both halves of the token', async () => {
    const result = await validatePcoCredentials({ appId: 'app-id', secret: '   ' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/both/i);
  });

  it('surfaces network failures as a failed check', async () => {
    const result = await validatePcoCredentials(
      { appId: 'app-id', secret: 'secret' },
      {
        fetchImpl: async () => {
          throw new Error('getaddrinfo ENOTFOUND api.planningcenteronline.com');
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ENOTFOUND');
  });
});

describe('writePcoCredentialsToEnv', () => {
  it('preserves unrelated entries and replaces existing credentials', () => {
    const file = tempEnvFile(
      ['# local settings', 'PORT=5178', 'PCO_APP_ID=old-id', 'PCO_SECRET=old-secret', 'TZ=America/New_York', ''].join(
        '\n',
      ),
    );

    writePcoCredentialsToEnv({ appId: 'new-id', secret: 'new-secret' }, file);
    const text = fs.readFileSync(file, 'utf8');

    expect(text).toContain('# local settings');
    expect(text).toContain('PORT=5178');
    expect(text).toContain('TZ=America/New_York');
    expect(text).toContain('PCO_APP_ID="new-id"');
    expect(text).toContain('PCO_SECRET="new-secret"');
    expect(text).not.toContain('old-id');
    expect(text).not.toContain('old-secret');
  });

  it('creates the file with owner-only permissions', () => {
    const file = tempEnvFile();
    writePcoCredentialsToEnv({ appId: 'id', secret: 'secret' }, file);

    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('quotes secrets that contain characters dotenv would otherwise truncate', () => {
    const file = tempEnvFile();
    writePcoCredentialsToEnv({ appId: 'id', secret: 'p#ss word"with\\slashes' }, file);
    const text = fs.readFileSync(file, 'utf8');

    expect(text).toContain('PCO_SECRET="p#ss word\\"with\\\\slashes"');
  });
});
