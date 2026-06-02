'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getValidToken, getUserInfo, getStoredToken } from '@/lib/auth/token';

interface Track {
  trackId: string;
  filename: string;
  duration: number;
  kid: string;
  sourceFormat: string;
  createdAt: string;
}

interface UploadResponse {
  success: boolean;
  message: string;
  data: Track;
}

export default function UploadPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // Check authentication
    const checkAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        router.push('/login');
        return;
      }

      const userInfo = getUserInfo();
      if (userInfo) {
        setUser(userInfo);
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    // Fetch tracks
    if (isAuthenticated) {
      fetchTracks();
    }
  }, [isAuthenticated]);

  const fetchTracks = async () => {
    try {
      setLoadingTracks(true);
      const response = await fetch('/api/ingest/upload');
      if (!response.ok) throw new Error('Failed to fetch tracks');

      const data = await response.json();
      setTracks(data.success ? data.data : data);
    } catch (error: any) {
      console.error('Error fetching tracks:', error);
    } finally {
      setLoadingTracks(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Check file type
      if (!['audio/mp4', 'audio/aac', 'audio/x-m4a'].includes(selectedFile.type) && !selectedFile.name.endsWith('.m4a')) {
        setUploadError('Please select an M4A, AAC, or MP4 audio file');
        setFile(null);
        return;
      }
      setFile(selectedFile);
      setUploadError('');
      setUploadStatus('');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadError('Please select a file');
      return;
    }

    const token = await getValidToken();
    if (!token) {
      setUploadError('Authentication failed. Please login again.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadStatus('Uploading...');
    setUploadError('');

    try {
      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch('/api/ingest/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data: UploadResponse = await response.json();

      setUploadStatus('✅ Upload successful!');
      setFile(null);
      if (document.getElementById('fileInput') instanceof HTMLInputElement) {
        (document.getElementById('fileInput') as HTMLInputElement).value = '';
      }

      // Refresh tracks list
      await fetchTracks();
    } catch (error: any) {
      setUploadError(error.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Upload Music</h1>
          <p className="text-gray-600">
            Upload M4A audio files to the system. {user?.preferred_username && `Welcome, ${user.preferred_username}!`}
          </p>
        </div>

        {/* Upload Form */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <form onSubmit={handleUpload}>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Audio File
              </label>
              <input
                id="fileInput"
                type="file"
                accept=".m4a,.aac,.mp4,audio/mp4,audio/aac,audio/x-m4a"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  disabled:opacity-50"
              />
              <p className="text-xs text-gray-500 mt-2">
                Supported formats: M4A, AAC, MP4
              </p>
            </div>

            {file && (
              <div className="mb-4 p-3 bg-blue-50 rounded-md">
                <p className="text-sm text-gray-700">
                  <strong>Selected:</strong> {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              </div>
            )}

            {uploadStatus && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-700">{uploadStatus}</p>
              </div>
            )}

            {uploadError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-700">{uploadError}</p>
              </div>
            )}

            {uploading && (
              <div className="mb-4">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-600 mt-2">{uploadProgress}%</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!file || uploading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </form>
        </div>

        {/* Tracks List */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Recent Uploads</h2>

          {loadingTracks ? (
            <p className="text-gray-600">Loading tracks...</p>
          ) : tracks.length === 0 ? (
            <p className="text-gray-600">No tracks uploaded yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Filename</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Duration</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Format</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => (
                    <tr key={track.trackId} className="border-b hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{track.filename}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {track.duration ? `${Math.round(track.duration)}s` : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{track.sourceFormat}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(track.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
