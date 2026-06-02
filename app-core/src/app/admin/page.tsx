'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken, isTokenExpired, decodeJWT } from '@/lib/auth/token';
import styles from './admin.module.css';

interface AdminPayload {
  preferred_username?: string;
  realm_access?: { roles?: string[] };
  exp?: number;
}

// DPoP keypair (persists during session)
let globalDPoPKeyPair: CryptoKeyPair | null = null;
let globalDPoPPublicJWK: JsonWebKey | null = null;

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function initializeDPoPKeypair() {
  if (globalDPoPKeyPair) return;
  
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  
  globalDPoPKeyPair = keyPair;
  globalDPoPPublicJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

async function createDPoPProof(htm: string, htu: string, accessToken: string): Promise<string> {
  if (!globalDPoPKeyPair || !globalDPoPPublicJWK) throw new Error('DPoP keypair not initialized');
  
  const ath = base64urlEncode(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
  );
  
  const header = { alg: 'ES256', typ: 'dpop+jwt', jwk: globalDPoPPublicJWK };
  const payload = {
    jti: crypto.randomUUID(),
    htm: htm.toUpperCase(),
    htu: htu.replace(/\/$/, ''),
    iat: Math.floor(Date.now() / 1000),
    ath,
  };
  
  const sigInput =
    `${base64urlEncode(new TextEncoder().encode(JSON.stringify(header)))}` +
    `.${base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))}`;
  
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    globalDPoPKeyPair.privateKey,
    new TextEncoder().encode(sigInput)
  );
  
  return `${sigInput}.${base64urlEncode(sig)}`;
}

interface UploadedTrack {
  trackId: string;
  kid: string;
  filename: string;
  duration: number;
  mpdPath: string;
  segmentDir: string;
  bitrate: number;
  createdAt: string;
}

const ALLOWED_EXTENSIONS = ['.m4a', '.aac', '.mp4'];

export default function AdminDashboard() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedTrack, setUploadedTrack] = useState<UploadedTrack | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Dashboard additions: Tracks & Security Audit Logs states
  const [tracks, setTracks] = useState<any[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const fetchTracks = async () => {
    setTracksLoading(true);
    try {
      const res = await fetch('/api/ingest/upload');
      if (res.ok) {
        const json = await res.json();
        // Extract tracks list correctly based on typical response formats
        const list = Array.isArray(json.data) 
          ? json.data 
          : Array.isArray(json.data?.tracks) 
          ? json.data.tracks 
          : [];
        setTracks(list);
      }
    } catch (e) {
      console.error('Error fetching tracks:', e);
    } finally {
      setTracksLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setLogsLoading(true);
    try {
      const token = getStoredToken();
      if (!token) return;
      const res = await fetch('/api/admin/audit-logs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setAuditLogs(json.data || []);
      }
    } catch (e) {
      console.error('Error fetching audit logs:', e);
    } finally {
      setLogsLoading(false);
    }
  };

  // ── Verify admin access on mount ──────────────────────────────────
  useEffect(() => {
    const verifyAdmin = async () => {
      await initializeDPoPKeypair();
      
      const token = getStoredToken();

      if (!token || isTokenExpired(token)) {
        console.warn('⚠️  [Admin] No valid token found');
        router.push('/login');
        return;
      }

      const payload = decodeJWT(token) as AdminPayload | null;
      if (!payload) {
        console.warn('⚠️  [Admin] Invalid token format');
        router.push('/login');
        return;
      }

      const roles = payload.realm_access?.roles || [];
      if (!roles.includes('admin')) {
        console.warn('⚠️  [Admin] User does not have admin role');
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      setAdminUsername(payload.preferred_username || 'Admin');
      setLoading(false);

      // Trigger parallel fetches for data panels
      fetchTracks();
      fetchAuditLogs();
    };

    verifyAdmin();
  }, [router]);

  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Only .m4a, .aac, and .mp4 files are supported. Got: ${ext}`;
    }

    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return `File size must be less than 100MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`;
    }

    return null;
  };

  const handleFileSelect = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setUploadError(validationError);
      setSelectedFile(null);
      return;
    }
    setUploadError('');
    setSelectedFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError('');
    setUploadStatus('Uploading...');
    setUploadProgress(0);

    try {
      const token = getStoredToken();
      if (!token) {
        throw new Error('No authentication token found');
      }

      const formData = new FormData();
      formData.append('audio', selectedFile);

      // Create DPoP proof (absolute URL)
      const uploadUrl = `${window.location.origin}/api/ingest/upload`;
      const dPoPProof = await createDPoPProof('POST', uploadUrl, token);

      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percentComplete);
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status === 201) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success && response.data) {
              setUploadedTrack(response.data);
              setSelectedFile(null);
              setUploadStatus(`✅ Upload successful! Track ID: ${response.data.trackId}`);
              // Automatically refresh dashboard lists immediately
              fetchTracks();
              fetchAuditLogs();
            } else {
              setUploadError('Upload failed: ' + (response.message || 'Unknown error'));
              setUploadStatus('');
            }
          } catch (e) {
            setUploadError('Failed to parse response');
            setUploadStatus('');
          }
        } else {
          try {
            const response = JSON.parse(xhr.responseText);
            setUploadError(response.error || response.message || `Upload failed with status ${xhr.status}`);
          } catch {
            setUploadError(`Upload failed with status ${xhr.status}`);
          }
          setUploadStatus('');
        }
        setIsUploading(false);
      });

      // Handle error
      xhr.addEventListener('error', () => {
        setUploadError('Network error during upload');
        setUploadStatus('');
        setIsUploading(false);
      });

      // Handle abort
      xhr.addEventListener('abort', () => {
        setUploadError('Upload cancelled');
        setUploadStatus('');
        setIsUploading(false);
      });

      xhr.open('POST', '/api/ingest/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('DPoP', dPoPProof);
      xhr.send(formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      setUploadError(`❌ ${message}`);
      setUploadStatus('');
      setIsUploading(false);
    }
  };

  const handleUploadAnother = () => {
    setSelectedFile(null);
    setUploadedTrack(null);
    setUploadProgress(0);
    setUploadError('');
    setUploadStatus('');
    fileInputRef.current?.click();
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading admin dashboard...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h1>Access Denied</h1>
          <p>You do not have admin privileges to access this dashboard.</p>
          <a href="/">Go back to home</a>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>🔐 Admin Dashboard</h1>
        <div className={styles.userInfo}>Logged in as: <strong>{adminUsername}</strong></div>
      </header>

      <div className={styles.grid}>
        {/* Upload Section */}
        <section className={styles.uploadSection}>
          <h2>📤 Upload Audio</h2>

          {!uploadedTrack ? (
            <div className={styles.uploadContainer}>
              <div
                className={`${styles.fileInputWrapper} ${isDragging ? styles.dragging : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".m4a,.aac,.mp4"
                  onChange={handleFileInputChange}
                  disabled={isUploading}
                  className={styles.fileInput}
                />
                <label className={styles.fileLabel}>
                  {selectedFile ? selectedFile.name : 'Drag audio file here or click to browse (M4A, AAC, MP4)'}
                </label>
              </div>

              <button
                onClick={handleUpload}
                disabled={isUploading || !selectedFile}
                className={styles.uploadBtn}
              >
                {isUploading ? `Uploading... ${uploadProgress}%` : 'Upload'}
              </button>

              {uploadStatus && <div className={styles.success}>{uploadStatus}</div>}
              {uploadError && <div className={styles.error}>{uploadError}</div>}
            </div>
          ) : (
            <div className={styles.successContainer}>
              <div className={styles.successIcon}>✅</div>
              <h3>Upload Successful!</h3>
              <div className={styles.trackDetails}>
                <p><strong>Filename:</strong> {uploadedTrack.filename}</p>
                <p><strong>Track ID:</strong> <code>{uploadedTrack.trackId}</code></p>
                <p><strong>Duration:</strong> {Math.round(uploadedTrack.duration)} seconds</p>
                <p><strong>Bitrate:</strong> {uploadedTrack.bitrate} kbps</p>
                <p><strong>KID:</strong> <code>{uploadedTrack.kid}</code></p>
              </div>
              <button onClick={handleUploadAnother} className={styles.uploadBtn}>
                Upload Another
              </button>
            </div>
          )}
        </section>

        {/* Metrics Section */}
        <section className={styles.metricsSection}>
          <h2>📊 Metrics</h2>
          <div className={styles.metricsContainer}>
            <iframe
              src="/grafana/d/drm-dashboard"
              width="100%"
              height="600"
              frameBorder="0"
              title="Grafana Dashboard"
              className={styles.grafanaEmbed}
            />
          </div>
        </section>

        {/* Prometheus Section */}
        <section className={styles.prometheusSection}>
          <h2>📈 Prometheus</h2>
          <div className={styles.prometheusContainer}>
            <p>Real-time system metrics and monitoring</p>
            <a
              href="/prometheus/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.externalLink}
            >
              Open Prometheus →
            </a>
          </div>
        </section>

        {/* Track List Section */}
        <section className={styles.listSection}>
          <h2>🎶 Uploaded Audio Tracks</h2>
          {tracksLoading ? (
            <div className={styles.emptyState}>Loading tracks list...</div>
          ) : tracks.length === 0 ? (
            <div className={styles.emptyState}>No tracks uploaded yet.</div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Track ID</th>
                    <th>KID</th>
                    <th>Duration</th>
                    <th>Source Format</th>
                    <th>Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => (
                    <tr key={track.id}>
                      <td><strong>{track.filename}</strong></td>
                      <td><code className={styles.codeCell}>{track.id}</code></td>
                      <td><code className={styles.codeCell}>{track.kid}</code></td>
                      <td>{track.duration ? `${Math.floor(track.duration / 60)}m ${Math.round(track.duration % 60)}s` : 'N/A'}</td>
                      <td><span style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>{track.sourceFormat || track.source_format || 'N/A'}</span></td>
                      <td>{track.createdAt ? new Date(track.createdAt).toLocaleString() : track.created_at ? new Date(track.created_at).toLocaleString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Audit Log Panel */}
        <section className={styles.listSection}>
          <h2>🛡️ Security Audit Logs (Keycloak & DRM Events)</h2>
          {logsLoading ? (
            <div className={styles.emptyState}>Loading security event logs...</div>
          ) : auditLogs.length === 0 ? (
            <div className={styles.emptyState}>No security events recorded.</div>
          ) : (
            <div className={styles.terminalPanel}>
              {auditLogs.map((log) => {
                let actionClass = styles.actionNeutral;
                if (log.action?.includes('ISSUED') || log.action?.includes('CREATED')) {
                  actionClass = styles.actionSuccess;
                } else if (log.action?.includes('FAILED') || log.action?.includes('ERROR')) {
                  actionClass = styles.actionFailed;
                }
                return (
                  <div key={log.id} className={styles.terminalLine}>
                    <span className={styles.terminalLineTime}>
                      [{new Date(log.created_at).toLocaleString()}]
                    </span>
                    <span className={`${styles.terminalLineAction} ${actionClass}`}>
                      {log.action}
                    </span>
                    <span style={{ color: '#94a3b8' }}>user:</span> <strong style={{ color: '#60a5fa' }}>{log.user_id}</strong>
                    {log.target_file && (
                      <> <span style={{ color: '#94a3b8' }}>file:</span> <code style={{ color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', padding: '2px 4px', borderRadius: '3px' }}>{log.target_file}</code></>
                    )}
                    {log.kid && (
                      <> <span style={{ color: '#94a3b8' }}>KID:</span> <code style={{ color: '#a78bfa', fontSize: '0.8rem' }}>{log.kid}</code></>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
