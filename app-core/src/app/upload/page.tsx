"use client";
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle, ArrowLeft, Loader2 } from 'lucide-react';

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

export default function UploadPage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedTrack, setUploadedTrack] = useState<UploadedTrack | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth guard
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login?returnTo=/upload');
      return;
    }
    setIsLoggedIn(true);
  }, [router]);

  const validateFile = (file: File): string | null => {
    // Check file extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Only .m4a, .aac, and .mp4 files are supported. Got: ${ext}`;
    }

    // Check file size (100MB limit)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return `File size must be less than 100MB. Your file is ${(file.size / (1024 * 1024)).toFixed(2)}MB`;
    }

    return null;
  };

  const handleFileSelect = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setSelectedFile(null);
      return;
    }
    setError(null);
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
    setError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('audio', selectedFile);

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
            } else {
              setError('Upload failed: ' + (response.message || 'Unknown error'));
            }
          } catch (e) {
            setError('Failed to parse response');
          }
        } else {
          try {
            const response = JSON.parse(xhr.responseText);
            setError(response.message || `Upload failed with status ${xhr.status}`);
          } catch {
            setError(`Upload failed with status ${xhr.status}`);
          }
        }
        setIsUploading(false);
      });

      // Handle error
      xhr.addEventListener('error', () => {
        setError('Network error during upload');
        setIsUploading(false);
      });

      // Handle abort
      xhr.addEventListener('abort', () => {
        setError('Upload cancelled');
        setIsUploading(false);
      });

      xhr.open('POST', '/api/ingest/upload');
      xhr.send(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsUploading(false);
    }
  };

  const handleUploadAnother = () => {
    setSelectedFile(null);
    setUploadedTrack(null);
    setUploadProgress(0);
    setError(null);
    fileInputRef.current?.click();
  };

  if (!isLoggedIn) {
    return (
      <div className="flex h-screen bg-black text-white items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto mb-4" size={40} />
          <p className="text-gray-400">Checking authentication...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-black p-6 hidden md:flex flex-col gap-8 border-r border-gray-950">
        <div className="text-2xl font-bold tracking-tighter flex items-center gap-2">
          <span className="text-emerald-500 text-3xl">♪</span> UITify
        </div>
        <div className="flex flex-col gap-5 text-gray-400 font-semibold text-sm">
          <span className="text-white cursor-pointer flex items-center gap-4">
            📤 Upload
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 bg-gradient-to-b from-gray-900 to-black overflow-y-auto rounded-lg m-2 relative">
        {/* Header */}
        <div className="flex items-center gap-4 p-6 sticky top-0 bg-black/40 backdrop-blur-md z-10 border-b border-gray-900/50">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
            Back
          </button>
          <h1 className="text-2xl font-bold">Upload Audio</h1>
        </div>

        {/* Content */}
        <div className="p-8 max-w-2xl mx-auto">
          {uploadedTrack ? (
            // Success state
            <div className="space-y-6">
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-8 text-center">
                <CheckCircle className="mx-auto mb-4 text-emerald-500" size={48} />
                <h2 className="text-2xl font-bold text-emerald-400 mb-2">Upload Successful!</h2>
                <p className="text-gray-400 mb-6">Your audio file has been processed and stored securely.</p>

                {/* Track details */}
                <div className="bg-black/50 rounded-lg p-6 text-left space-y-3 mb-6">
                  <div>
                    <p className="text-gray-500 text-sm">Filename</p>
                    <p className="text-white font-mono break-all">{uploadedTrack.filename}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-sm">Track ID</p>
                    <p className="text-white font-mono break-all text-sm">{uploadedTrack.trackId}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-sm">Duration</p>
                    <p className="text-white">{Math.round(uploadedTrack.duration)} seconds</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-sm">Bitrate</p>
                    <p className="text-white">{uploadedTrack.bitrate} kbps</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-sm">KID (Key ID)</p>
                    <p className="text-white font-mono break-all text-sm">{uploadedTrack.kid}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-sm">Created At</p>
                    <p className="text-white">{new Date(uploadedTrack.createdAt).toLocaleString()}</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleUploadAnother}
                    className="flex-1 bg-emerald-500 text-white px-6 py-3 rounded-full font-bold hover:bg-emerald-600 transition-all duration-200"
                  >
                    Upload Another
                  </button>
                  <button
                    onClick={() => router.push('/')}
                    className="flex-1 bg-gray-800 text-white px-6 py-3 rounded-full font-bold hover:bg-gray-700 transition-all duration-200"
                  >
                    Back to Home
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Upload form
            <div className="space-y-6">
              {/* Error message */}
              {error && (
                <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-4 flex gap-3 items-start">
                  <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
                  <div>
                    <p className="text-red-400 font-semibold">Error</p>
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                </div>
              )}

              {/* Drag and drop area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 ${
                  isDragging
                    ? 'border-emerald-500 bg-emerald-950/20'
                    : 'border-gray-700 bg-gray-900/30 hover:border-gray-600 hover:bg-gray-900/50'
                }`}
              >
                <Upload
                  size={48}
                  className={`mx-auto mb-4 transition-colors ${isDragging ? 'text-emerald-500' : 'text-gray-500'}`}
                />
                <h3 className="text-lg font-bold mb-2">
                  {isDragging ? 'Drop your file here' : 'Drag and drop your audio file'}
                </h3>
                <p className="text-gray-400 mb-4">or click to select from your computer</p>
                <p className="text-xs text-gray-600">Supported formats: .m4a, .aac, .mp4 (max 100MB)</p>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".m4a,.aac,.mp4,audio/mp4,audio/aac"
                onChange={handleFileInputChange}
                className="hidden"
              />

              {/* Selected file info */}
              {selectedFile && (
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h4 className="font-bold mb-1">Selected File</h4>
                      <p className="text-gray-400 text-sm break-all">{selectedFile.name}</p>
                    </div>
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                    <div>
                      <p className="text-gray-500">Size</p>
                      <p className="text-white font-semibold">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Type</p>
                      <p className="text-white font-semibold">{selectedFile.type || 'Unknown'}</p>
                    </div>
                  </div>

                  {/* Upload progress */}
                  {isUploading && (
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-gray-400">Uploading...</p>
                        <p className="text-sm font-mono text-emerald-400">{uploadProgress}%</p>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Upload button */}
                  <button
                    onClick={handleUpload}
                    disabled={isUploading}
                    className="w-full bg-emerald-500 text-white px-6 py-3 rounded-full font-bold hover:bg-emerald-600 transition-all duration-200 disabled:bg-gray-700 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload size={18} />
                        Upload File
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Info box */}
              <div className="bg-blue-950/20 border border-blue-500/30 rounded-xl p-4">
                <p className="text-blue-300 text-sm">
                  💡 <strong>Tip:</strong> Your audio file will be encrypted and securely stored. You can play it immediately after upload.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
