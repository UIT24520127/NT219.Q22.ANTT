# Prometheus Monitoring Setup - DRM System

## Overview

This document describes the Prometheus monitoring setup for the DRM system, with special focus on tracking failed license grants and system health.

## Components

### 1. **Prometheus** (Port 9090)
- Metrics collection and time-series database
- Scrapes metrics from the application every 10 seconds
- Stores data for 7 days
- Evaluates alert rules every 30 seconds

### 2. **Grafana** (Port 3001)
- Visualization and dashboard platform
- Default credentials: admin/admin
- Pre-configured with Prometheus datasource
- Includes a comprehensive DRM License Monitoring dashboard

### 3. **Application Metrics** (/api/metrics)
- Exposes Prometheus-formatted metrics
- Uses `prom-client` library
- Tracks all key operations

## Key Metrics

### License Metrics

1. **license_issued_total** - Counter for successful license grants
   - Labels: `kid` (Key ID)
   - Incremented when a license is successfully issued

2. **license_failed_total** - Counter for failed license grants
   - Labels: `reason`, `error_type`
   - Failure reasons:
     - `empty_challenge` - Empty Widevine challenge
     - `missing_kid` - No KID provided
     - `missing_client_key` - Missing ECDH client public key
     - `cek_not_found` - Content Encryption Key not found in database
     - `invalid_cek_format` - Invalid CEK format after decryption
     - `processing_error` - Internal processing errors

3. **license_processing_duration_seconds** - Histogram of license processing time
   - Percentiles: p50, p95, p99

### Error Types

- `validation` - Input validation errors
- `ecdh_handshake` - ECDH handshake issues
- `database` - Database operation errors
- `internal` - Internal processing errors

### Other Metrics

**Authentication:**
- `auth_attempts_total` - Total authentication attempts
- `auth_duration_seconds` - Authentication processing time

**Database:**
- `db_query_duration_seconds` - Query execution time
- `db_errors_total` - Database errors
- `db_connection_pool_size` - Current connection pool size

**KMS:**
- `kms_decryption_duration_seconds` - Key decryption time
- `kms_errors_total` - KMS operation errors

**Storage (R2):**
- `r2_request_duration_seconds` - R2 operation duration
- `r2_errors_total` - R2 operation errors

**HTTP:**
- `http_request_duration_seconds` - HTTP request duration
- `http_errors_total` - HTTP errors

**Sessions:**
- `active_sessions_total` - Currently active sessions
- `tracks_in_system_total` - Total tracks in system

## Alert Rules

### Critical Alerts

1. **HighLicenseFailureRate** (Warning)
   - Triggers when license failure rate > 0.5 failures/sec for 5 minutes
   - Indicates systemic issues with license granting

2. **LicenseECDHHandshakeFails** (Warning)
   - Triggers when ECDH handshake failures > 5 in 5 minutes
   - May indicate client issues or network problems

3. **LicenseCEKNotFound** (Critical)
   - Triggers when CEK lookup failures > 10 in 5 minutes
   - Indicates database synchronization issues

4. **LicenseProcessingErrors** (Warning)
   - Triggers when processing errors > 3 in 5 minutes
   - Generic internal errors

5. **HighLicenseProcessingTime** (Warning)
   - Triggers when p95 license processing time > 2 seconds
   - Performance degradation

6. **DatabaseQueryErrors** (Critical)
   - Triggers when DB errors > 5 in 5 minutes

7. **KMSDecryptionErrors** (Critical)
   - Triggers when KMS errors > 3 in 5 minutes

## Quick Start

### 1. Start the monitoring stack:

```bash
docker-compose up -d prometheus grafana
```

### 2. Verify services are running:

```bash
# Check Prometheus
curl http://localhost:9090/-/healthy

# Check Grafana
curl http://localhost:3001/api/health
```

### 3. Access dashboards:

- **Prometheus**: http://localhost:9090
  - Graph interface for querying metrics
  - Alert status at http://localhost:9090/alerts
  
- **Grafana**: http://localhost:3001
  - Login with admin/admin
  - Navigate to "Dashboards" → "DRM System - License Monitoring"

## Querying Metrics

### Prometheus Query Examples

**1. License failure rate (per second):**
```promql
rate(license_failed_total[5m])
```

**2. Total failed licenses in last hour:**
```promql
increase(license_failed_total[1h])
```

**3. Failures by reason:**
```promql
sum(rate(license_failed_total[5m])) by (reason)
```

**4. Failures by error type:**
```promql
sum(rate(license_failed_total[5m])) by (error_type)
```

**5. License processing time percentiles:**
```promql
# p50 (median)
histogram_quantile(0.5, rate(license_processing_duration_seconds_bucket[5m]))

# p95
histogram_quantile(0.95, rate(license_processing_duration_seconds_bucket[5m]))

# p99
histogram_quantile(0.99, rate(license_processing_duration_seconds_bucket[5m]))
```

**6. Success rate:**
```promql
rate(license_issued_total[5m]) / (rate(license_issued_total[5m]) + rate(license_failed_total[5m]))
```

**7. KMS decryption errors:**
```promql
increase(kms_errors_total[5m])
```

**8. Database connection pool:**
```promql
db_connection_pool_size
```

## Dashboard Visualization

The pre-configured Grafana dashboard includes:

1. **License Issuance Rate** - Real-time success vs. failure rates
2. **License Failures by Reason** - Breakdown of failure types
3. **Failed Licenses (Last Hour)** - Gauge showing total failures
4. **Successful Licenses (Last Hour)** - Gauge showing total successes
5. **License Processing Duration** - Percentile analysis (p50, p95, p99)
6. **License Failures by Error Type** - Categorized error visualization
7. **Active Sessions** - Current active user sessions

## Monitoring Best Practices

### 1. Set up notifications
Configure Grafana alert notifications to send to:
- Email
- Slack
- PagerDuty
- Custom webhooks

### 2. Regular dashboard review
- Check daily for trends
- Set up custom alerts for your thresholds
- Monitor during peak usage times

### 3. Metric retention
- Prometheus keeps data for 7 days (configurable)
- Consider long-term storage for compliance

### 4. Performance tuning
- Monitor Prometheus memory usage
- Adjust scrape intervals if needed
- Clean up unused metrics

## Troubleshooting

### Prometheus not scraping metrics

1. Check app container is healthy:
```bash
docker-compose ps
```

2. Check Prometheus targets:
- Navigate to http://localhost:9090/targets
- Look for "app-metrics" job
- Check "State" and error messages

3. Verify metrics endpoint:
```bash
curl http://localhost:3000/api/metrics
```

### No data in Grafana

1. Verify Prometheus datasource:
   - Go to Configuration → Data Sources
   - Click "Prometheus"
   - Click "Test"

2. Check dashboard queries:
   - Edit dashboard
   - Verify metric names are correct
   - Check time range

### High memory usage

1. Reduce retention period in Prometheus:
   - Edit `prometheus.yml`
   - Change `--storage.tsdb.retention.time`
   - Restart Prometheus

2. Disable unused metrics:
   - Configure more specific scrape configs
   - Use metric relabeling to drop unwanted metrics

## Integration with existing monitoring

If you have existing monitoring infrastructure:

1. **Add external Prometheus scrape job** - Add app-metrics scrape config
2. **Import dashboard** - Export Grafana dashboard and import to your instance
3. **Forward metrics** - Use Prometheus remote write to send metrics elsewhere

## Configuration Files

- **prometheus.yml** - Main Prometheus configuration
- **prometheus-rules.yml** - Alert rules
- **grafana/provisioning/datasources/prometheus.yml** - Grafana datasource config
- **grafana/provisioning/dashboards/drm-license-dashboard.json** - Grafana dashboard

## Next Steps

1. Deploy to your infrastructure
2. Configure Grafana alert notifications
3. Adjust alert thresholds based on your SLA
4. Set up log aggregation (e.g., ELK stack) for detailed debugging
5. Implement custom dashboards for your specific use cases

## Support

For issues with Prometheus/Grafana setup, consult:
- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/grafana/latest/)
- [prom-client Documentation](https://github.com/siimon/prom-client)
