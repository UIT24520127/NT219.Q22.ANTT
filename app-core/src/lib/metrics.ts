import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Singleton — tránh re-register khi Next.js hot reload
declare global {
  var __metricsRegistry: Registry | undefined;
}

const register = global.__metricsRegistry ?? (global.__metricsRegistry = new Registry());

if (!global.__metricsRegistry) {
  collectDefaultMetrics({ register });
}

function counter(config: ConstructorParameters<typeof Counter>[0]) {
  return (register.getSingleMetric(config.name) as Counter<string>) ??
    new Counter({ ...config, registers: [register] });
}

function histogram(config: ConstructorParameters<typeof Histogram>[0]) {
  return (register.getSingleMetric(config.name) as Histogram<string>) ??
    new Histogram({ ...config, registers: [register] });
}

function gauge(config: ConstructorParameters<typeof Gauge>[0]) {
  return (register.getSingleMetric(config.name) as Gauge<string>) ??
    new Gauge({ ...config, registers: [register] });
}

// License
export const licenseIssued = counter({
  name: 'license_issued_total',
  help: 'Total number of licenses issued successfully',
  labelNames: ['kid'],
});

export const licenseFailed = counter({
  name: 'license_failed_total',
  help: 'Total number of failed license grants',
  labelNames: ['reason', 'error_type'],
});

export const licenseProcessingDuration = histogram({
  name: 'license_processing_duration_seconds',
  help: 'Time taken to process license request',
  labelNames: ['kid'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

// Auth - Extended
export const authLoginTotal = counter({
  name: 'auth_login_total',
  help: 'Total login attempts',
  labelNames: ['status'],
});

export const authRegisterTotal = counter({
  name: 'auth_register_total',
  help: 'Total registration attempts',
  labelNames: ['status'],
});

export const authRefreshTotal = counter({
  name: 'auth_refresh_total',
  help: 'Total token refresh attempts',
  labelNames: ['status'],
});

// Upload
export const uploadTotal = counter({
  name: 'upload_total',
  help: 'Total upload attempts',
  labelNames: ['status'],
});

export const uploadFileSize = histogram({
  name: 'upload_file_size_bytes',
  help: 'Size of uploaded files in bytes',
  buckets: [1024 * 1024, 5 * 1024 * 1024, 10 * 1024 * 1024, 50 * 1024 * 1024, 100 * 1024 * 1024],
});

export const uploadProcessingDuration = histogram({
  name: 'upload_processing_duration_seconds',
  help: 'Time taken to process uploaded file',
  buckets: [1, 5, 10, 30, 60, 120, 300],
});

// User Management
export const userCreatedTotal = counter({
  name: 'user_created_total',
  help: 'Total users created',
});

export const userDeletedTotal = counter({
  name: 'user_deleted_total',
  help: 'Total users deleted',
});

export const adminRoleGrantedTotal = counter({
  name: 'admin_role_granted_total',
  help: 'Total times admin role granted',
});

export const adminRoleRevokedTotal = counter({
  name: 'admin_role_revoked_total',
  help: 'Total times admin role revoked',
});

// Track Management
export const trackDeletedTotal = counter({
  name: 'track_deleted_total',
  help: 'Total tracks deleted',
});

export const manifestGenerationDuration = histogram({
  name: 'manifest_generation_duration_seconds',
  help: 'Time taken to generate DASH manifest',
  buckets: [1, 5, 10, 30, 60],
});

// Auth
export const authAttempts = counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['status'],
});

export const authDuration = histogram({
  name: 'auth_duration_seconds',
  help: 'Time taken to process authentication',
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
});

// Database
export const dbQueryDuration = histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query execution time',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
});

export const dbErrors = counter({
  name: 'db_errors_total',
  help: 'Total database errors',
  labelNames: ['operation', 'error_type'],
});

export const dbConnectionPoolSize = gauge({
  name: 'db_connection_pool_size',
  help: 'Current database connection pool size',
});

// KMS
export const kmsDecryptionDuration = histogram({
  name: 'kms_decryption_duration_seconds',
  help: 'Time taken to decrypt key from KMS',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const kmsErrors = counter({
  name: 'kms_errors_total',
  help: 'Total KMS errors',
  labelNames: ['operation', 'error_type'],
});

// R2/Storage
export const r2RequestDuration = histogram({
  name: 'r2_request_duration_seconds',
  help: 'Time taken for R2 operations',
  labelNames: ['operation'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
});

export const r2Errors = counter({
  name: 'r2_errors_total',
  help: 'Total R2 errors',
  labelNames: ['operation', 'error_type'],
});

// HTTP
export const httpRequestDuration = histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const httpErrors = counter({
  name: 'http_errors_total',
  help: 'Total HTTP errors',
  labelNames: ['method', 'route', 'status'],
});

// Content/Media
export const tracksInSystem = gauge({
  name: 'tracks_in_system_total',
  help: 'Total number of tracks in the system',
});

export const activeSessions = gauge({
  name: 'active_sessions_total',
  help: 'Total number of active sessions',
});

export function getMetrics() {
  return register.metrics();
}