import fs from 'node:fs';
import path from 'node:path';
import type { PcoServiceType } from '../../shared/types';
import { projectRoot, resetEnvCache } from '../env';
import { PcoAuthError, PcoClient, toResource, type JsonApiResource } from './client';

/**
 * Local handling of the Planning Center Personal Access Token.
 *
 * Rules:
 *  - a credential is tested against the real API before it is stored
 *  - the secret is written to the git-ignored `.env` file with 0600 permissions
 *  - it is never written to SQLite, never returned by the API and never logged
 *  - saving reloads the cached environment and swaps the live adapter, so no
 *    server restart is needed
 */
export interface PcoCredentials {
  appId: string;
  secret: string;
}

export interface PcoCredentialCheck {
  ok: boolean;
  message: string;
  serviceTypes: PcoServiceType[];
}

export interface ValidatePcoCredentialsOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Test a token against Planning Center without storing it anywhere. */
export async function validatePcoCredentials(
  credentials: PcoCredentials,
  options: ValidatePcoCredentialsOptions = {},
): Promise<PcoCredentialCheck> {
  const appId = credentials.appId.trim();
  const secret = credentials.secret.trim();
  if (!appId || !secret) {
    return {
      ok: false,
      message: 'Enter both the Planning Center application id and the secret.',
      serviceTypes: [],
    };
  }

  try {
    const client = new PcoClient({
      appId,
      secret,
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      // A single verification request should fail fast rather than back off.
      minIntervalMs: 0,
      maxRetries: 1,
    });
    const doc = await client.request('/services/v2/service_types', { per_page: 100 });
    const serviceTypes = (Array.isArray(doc.data) ? doc.data : [doc.data])
      .map(toResource)
      .filter((resource): resource is JsonApiResource => Boolean(resource))
      .map((resource) => ({
        id: resource.id,
        name: String(resource.attributes.name ?? `Service type ${resource.id}`),
      }));

    return {
      ok: true,
      message:
        serviceTypes.length === 0
          ? 'Connected to Planning Center, but this token cannot see any service types. Check that it has Services access.'
          : `Connected to Planning Center. ${serviceTypes.length} service type${serviceTypes.length === 1 ? '' : 's'} visible.`,
      serviceTypes,
    };
  } catch (error) {
    if (error instanceof PcoAuthError) {
      return {
        ok: false,
        message:
          'Planning Center rejected these credentials. Check the application id and secret, and that the token has Services access.',
        serviceTypes: [],
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not reach Planning Center',
      serviceTypes: [],
    };
  }
}

/** Quote a value so dotenv reads it back verbatim (secrets may contain # or spaces). */
function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function envFilePath(): string {
  return path.resolve(projectRoot, process.env.ENV_FILE ?? '.env');
}

/**
 * Write the token into `.env`, preserving unrelated lines and replacing any
 * existing PCO_APP_ID / PCO_SECRET entries. The file is written atomically with
 * owner-only permissions.
 */
export function writePcoCredentialsToEnv(
  credentials: PcoCredentials,
  envPath: string = envFilePath(),
): string {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lines = existing.length > 0 ? existing.replace(/\r\n/g, '\n').split('\n') : [];

  const setValue = (key: string, value: string): void => {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const entry = `${key}=${quoteEnvValue(value)}`;
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) lines[index] = entry;
    else lines.push(entry);
  };

  setValue('PCO_APP_ID', credentials.appId.trim());
  setValue('PCO_SECRET', credentials.secret.trim());

  const text = `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
  const tempPath = `${envPath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(tempPath, text, { mode: 0o600 });
  try {
    fs.chmodSync(tempPath, 0o600);
  } catch {
    // Filesystems without POSIX permissions (e.g. some network shares).
  }
  fs.renameSync(tempPath, envPath);
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // As above.
  }
  return envPath;
}

/** Apply the credential to the running process and drop the cached environment. */
export function applyPcoCredentials(credentials: PcoCredentials): void {
  process.env.PCO_APP_ID = credentials.appId.trim();
  process.env.PCO_SECRET = credentials.secret.trim();
  resetEnvCache();
}
