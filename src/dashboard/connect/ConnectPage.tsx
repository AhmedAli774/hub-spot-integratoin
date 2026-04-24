import React, { type FC, useEffect, useState } from 'react';
import { httpClient } from '@wix/essentials';
import {
  Badge,
  Box,
  Button,
  Card,
  Loader,
  Text,
} from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { apiUrl } from '../lib/api';

interface StatusResponse {
  connected: boolean;
  expiresAt: number | null;
}

const ConnectPage: FC = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await httpClient.fetchWithAuth(apiUrl('/api/auth/status'));
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setStatus((await res.json()) as StatusResponse);
    } catch {
      setStatus({ connected: false, expiresAt: null });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchStatus(); }, []);

  const handleConnect = async () => {
    setActionLoading(true);
    try {
      const res = await httpClient.fetchWithAuth(apiUrl('/api/auth/connect'));
      const { url } = (await res.json()) as { url: string };
      const popup = window.open(url, 'hubspot-oauth', 'width=600,height=700,left=200,top=100');

      const interval = setInterval(async () => {
        try {
          const check = await httpClient.fetchWithAuth(apiUrl('/api/auth/status'));
          const data = (await check.json()) as StatusResponse;
          if (data.connected) {
            clearInterval(interval);
            popup?.close();
            setStatus(data);
            setActionLoading(false);
            dashboard.showToast({ message: 'HubSpot connected!', type: 'success' });
          }
        } catch { /* poll quietly */ }
      }, 2500);

      // Give up after 2 minutes
      setTimeout(() => {
        clearInterval(interval);
        setActionLoading(false);
      }, 120_000);
    } catch {
      setActionLoading(false);
      dashboard.showToast({ message: 'Failed to start connection. Check the server is running.', type: 'error' });
    }
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    try {
      await httpClient.fetchWithAuth(apiUrl('/api/auth/disconnect'), { method: 'POST' });
      setStatus({ connected: false, expiresAt: null });
      dashboard.showToast({ message: 'HubSpot disconnected', type: 'success' });
    } catch {
      dashboard.showToast({ message: 'Failed to disconnect', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Box align="center" padding="SP8">
        <Loader size="medium" />
      </Box>
    );
  }

  return (
    <Card>
      <Card.Header title="HubSpot Connection" />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP4">
          <Box align="center" gap="SP2">
            <Text>Status:</Text>
            <Badge skin={status?.connected ? 'success' : 'danger'}>
              {status?.connected ? 'Connected' : 'Not Connected'}
            </Badge>
          </Box>

          {status?.connected && status.expiresAt !== null && (
            <Text secondary size="small">
              Token expires: {new Date(status.expiresAt!).toLocaleString()}
            </Text>
          )}

          {!status?.connected && (
            <Text secondary size="small">
              Click <strong>Connect HubSpot</strong> to begin OAuth authorisation.
              Make sure <strong>scripts/start-dev.ps1</strong> is running so ngrok
              is active on port 4321.
            </Text>
          )}

          <Box gap="SP3">
            {status?.connected ? (
              <Button
                skin="destructive"
                priority="secondary"
                onClick={handleDisconnect}
                disabled={actionLoading}
              >
                Disconnect HubSpot
              </Button>
            ) : (
              <Button onClick={handleConnect} disabled={actionLoading}>
                {actionLoading ? 'Waiting for authorization…' : 'Connect HubSpot'}
              </Button>
            )}
          </Box>
        </Box>
      </Card.Content>
    </Card>
  );
};

export default ConnectPage;
