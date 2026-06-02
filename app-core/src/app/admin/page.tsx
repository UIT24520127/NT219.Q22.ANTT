'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getValidToken, getUserInfo, getStoredToken, hasRole } from '@/lib/auth/token';

interface User {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  roles: string[];
}

interface Track {
  id: string;
  filename: string;
  duration: number;
  kid: string;
  source_format: string;
  created_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'tracks'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        router.push('/login');
        return;
      }

      const userInfo = getUserInfo();
      if (userInfo) {
        setUser(userInfo);
        const isAdminUser = hasRole('admin');
        if (!isAdminUser) {
          router.push('/upload');
          return;
        }
        setIsAdmin(true);
        setIsAuthenticated(true);
      }
      setIsLoading(false);
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'users') {
      fetchUsers();
    }
  }, [isAuthenticated, activeTab]);

  useEffect(() => {
    if (isAuthenticated && activeTab === 'tracks') {
      fetchTracks();
    }
  }, [isAuthenticated, activeTab]);

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (error: any) {
      setError(error.message || 'Failed to fetch users');
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchTracks = async () => {
    try {
      setLoadingTracks(true);
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/admin/tracks', {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to fetch tracks');
      const data = await response.json();
      setTracks(data.data || data);
    } catch (error: any) {
      setError(error.message || 'Failed to fetch tracks');
    } finally {
      setLoadingTracks(false);
    }
  };

  const handleGrantAdmin = async (userId: string) => {
    try {
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/users/${userId}/grant-admin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to grant admin role');
      setSuccess('Admin role granted successfully');
      setTimeout(() => fetchUsers(), 1000);
    } catch (error: any) {
      setError(error.message || 'Failed to grant admin role');
    }
  };

  const handleRevokeAdmin = async (userId: string) => {
    try {
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/users/${userId}/revoke-admin`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to revoke admin role');
      setSuccess('Admin role revoked successfully');
      setTimeout(() => fetchUsers(), 1000);
    } catch (error: any) {
      setError(error.message || 'Failed to revoke admin role');
    }
  };

  const handleToggleEnabled = async (userId: string, currentlyEnabled: boolean) => {
    try {
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/users/${userId}/toggle-enabled`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });

      if (!response.ok) throw new Error('Failed to update user');
      setSuccess('User status updated successfully');
      setTimeout(() => fetchUsers(), 1000);
    } catch (error: any) {
      setError(error.message || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to delete user');
      setSuccess('User deleted successfully');
      setTimeout(() => fetchUsers(), 1000);
    } catch (error: any) {
      setError(error.message || 'Failed to delete user');
    }
  };

  const handleDeleteTrack = async (trackId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete track "${filename}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const token = await getValidToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch(`/api/admin/tracks/${trackId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to delete track');
      setSuccess('Track deleted successfully');
      setTimeout(() => fetchTracks(), 1000);
    } catch (error: any) {
      setError(error.message || 'Failed to delete track');
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

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p>Access Denied</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Admin Dashboard</h1>
          <p className="text-gray-600">
            Manage users and music. {user?.preferred_username && `Logged in as ${user.preferred_username}`}
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700">{error}</p>
            <button
              onClick={() => setError('')}
              className="text-sm text-red-600 hover:text-red-800 mt-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-700">{success}</p>
            <button
              onClick={() => setSuccess('')}
              className="text-sm text-green-600 hover:text-green-800 mt-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('users')}
              className={`flex-1 py-4 px-6 text-center font-medium transition-colors ${
                activeTab === 'users'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Users Management
            </button>
            <button
              onClick={() => setActiveTab('tracks')}
              className={`flex-1 py-4 px-6 text-center font-medium transition-colors ${
                activeTab === 'tracks'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Music Management
            </button>
          </div>

          <div className="p-6">
            {/* Users Tab */}
            {activeTab === 'users' && (
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-4">Users</h2>

                {loadingUsers ? (
                  <p className="text-gray-600">Loading users...</p>
                ) : users.length === 0 ? (
                  <p className="text-gray-600">No users found</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Username</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Email</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Roles</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} className="border-b hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-medium text-gray-900">{u.username}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">{u.email || 'N/A'}</td>
                            <td className="px-6 py-4 text-sm">
                              <div className="flex gap-2">
                                {u.roles.map((role) => (
                                  <span
                                    key={role}
                                    className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                                  >
                                    {role}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm">
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  u.enabled
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {u.enabled ? 'Active' : 'Disabled'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm">
                              <div className="flex gap-2">
                                {u.roles.includes('admin') ? (
                                  <button
                                    onClick={() => handleRevokeAdmin(u.id)}
                                    className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded hover:bg-yellow-200"
                                  >
                                    Revoke Admin
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleGrantAdmin(u.id)}
                                    className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded hover:bg-blue-200"
                                  >
                                    Grant Admin
                                  </button>
                                )}
                                <button
                                  onClick={() => handleToggleEnabled(u.id, u.enabled)}
                                  className={`px-2 py-1 text-xs rounded ${
                                    u.enabled
                                      ? 'bg-red-100 text-red-800 hover:bg-red-200'
                                      : 'bg-green-100 text-green-800 hover:bg-green-200'
                                  }`}
                                >
                                  {u.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(u.id, u.username)}
                                  className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded hover:bg-red-200"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Tracks Tab */}
            {activeTab === 'tracks' && (
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-4">Music Library</h2>

                {loadingTracks ? (
                  <p className="text-gray-600">Loading tracks...</p>
                ) : tracks.length === 0 ? (
                  <p className="text-gray-600">No tracks found</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Filename</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Duration</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Format</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Created</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tracks.map((track) => (
                          <tr key={track.id} className="border-b hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm font-medium text-gray-900">{track.filename}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">
                              {track.duration ? `${Math.round(track.duration)}s` : 'N/A'}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-700">{track.source_format}</td>
                            <td className="px-6 py-4 text-sm text-gray-700">
                              {new Date(track.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 text-sm">
                              <button
                                onClick={() => handleDeleteTrack(track.id, track.filename)}
                                className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded hover:bg-red-200"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
