import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Default metrics - CPU, memory, etc.
collectDefaultMetrics();

/**
 * License-related metrics
 */
export const licenseIssued = new Counter({
  name: 'license_issued_total',
  help: 'Total number of licenses issued successfully',
  labelNames: ['kid'],
});

export const licenseFailed = new Counter({
  name: 'license_failed_total',
  help: 'Total number of failed license grants',
  labelNames: ['reason', 'error_type'],
});

export const licenseProcessingDuration = new Histogram({
  name: 'license_processing_duration_seconds',
  help: 'Time taken to process license request',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

/**
 * Authentication metrics
 */
export const authAttempts = new Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['status'],
});

export const authDuration = new Histogram({
  name: 'auth_duration_seconds',
  help: 'Time taken to process authentication',
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
});

/**
 * Database metrics
 */
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query execution time',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
});

export const dbErrors = new Counter({
  name: 'db_errors_total',
  help: 'Total database errors',
  labelNames: ['operation', 'error_type'],
});

export const dbConnectionPoolSize = new Gauge({
  name: 'db_connection_pool_size',
  help: 'Current database connection pool size',
});

/**
 * KMS metrics
 */
export const kmsDecryptionDuration = new Histogram({
  name: 'kms_decryption_duration_seconds',
  help: 'Time taken to decrypt key from KMS',
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const kmsErrors = new Counter({
  name: 'kms_errors_total',
  help: 'Total KMS errors',
  labelNames: ['operation', 'error_type'],
});

/**
 * R2/Storage metrics
 */
export const r2RequestDuration = new Histogram({
  name: 'r2_request_duration_seconds',
  help: 'Time taken for R2 operations',
  labelNames: ['operation'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5],
});

export const r2Errors = new Counter({
  name: 'r2_errors_total',
  help: 'Total R2 errors',
  labelNames: ['operation', 'error_type'],
});

/**
 * HTTP request metrics
 */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const httpErrors = new Counter({
  name: 'http_errors_total',
  help: 'Total HTTP errors',
  labelNames: ['method', 'route', 'status'],
});

/**
 * Content/Media metrics
 */
export const tracksInSystem = new Gauge({
  name: 'tracks_in_system_total',
  help: 'Total number of tracks in the system',
});

export const activeSessions = new Gauge({
  name: 'active_sessions_total',
  help: 'Total number of active sessions',
});

/**
 * Get metrics registry
 */
export function getMetrics() {
  return register.metrics();
}

