import React, { type FC, useCallback, useEffect, useState } from 'react';
import { httpClient } from '@wix/essentials';
import {
  Badge,
  Box,
  Button,
  Card,
  Loader,
  Table,
  Text,
} from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { apiUrl } from '../lib/api';

interface SyncLog {
  ts: number;
  direction: string;
  status: string;
  contactId: string;
  detail: string;
}

function statusSkin(status: string): 'success' | 'danger' | 'neutral' | 'warning' {
  if (status === 'synced') return 'success';
  if (status === 'error') return 'danger';
  if (status === 'skipped') return 'warning';
  return 'neutral';
}

const SyncStatus: FC = () => {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await httpClient.fetchWithAuth(apiUrl('/api/sync/logs?limit=50'));
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as { logs: SyncLog[] };
      setLogs(data.logs);
    } catch {
      // Server not reachable yet — show empty state, don't throw
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  const handleTriggerSync = async () => {
    setTriggering(true);
    try {
      const res = await httpClient.fetchWithAuth(apiUrl('/api/sync/trigger'), { method: 'POST' });
      if (res.ok) {
        dashboard.showToast({ message: 'Sync triggered — logs update shortly', type: 'success' });
        setTimeout(() => { void fetchLogs(); }, 3000);
      } else {
        const body = (await res.json()) as { error?: string };
        dashboard.showToast({ message: body.error ?? 'Sync failed', type: 'error' });
      }
    } catch {
      dashboard.showToast({ message: 'Could not reach server. Is wix app dev running?', type: 'error' });
    } finally {
      setTriggering(false);
    }
  };

  const columns = [
    { title: 'Time', render: (row: SyncLog) => new Date(row.ts).toLocaleString() },
    { title: 'Direction', render: (row: SyncLog) => row.direction },
    { title: 'Contact ID', render: (row: SyncLog) => row.contactId },
    {
      title: 'Status',
      render: (row: SyncLog) => (
        <Badge skin={statusSkin(row.status)}>{row.status}</Badge>
      ),
    },
    { title: 'Detail', render: (row: SyncLog) => row.detail },
  ];

  if (loading) {
    return (
      <Box align="center" padding="SP8">
        <Loader size="medium" />
      </Box>
    );
  }

  return (
    <Card>
      <Card.Header
        title="Sync Status"
        subtitle="Recent contact sync events"
        suffix={
          <Box gap="SP2">
            <Button priority="secondary" onClick={() => { void fetchLogs(); }}>
              Refresh
            </Button>
            <Button onClick={() => { void handleTriggerSync(); }} disabled={triggering}>
              {triggering ? 'Triggering…' : 'Trigger Sync'}
            </Button>
          </Box>
        }
      />
      <Card.Divider />
      <Card.Content>
        {logs.length === 0 ? (
          <Box align="center" padding="SP6">
            <Text secondary>
              No sync events yet. Connect HubSpot and trigger a sync.
            </Text>
          </Box>
        ) : (
          <Table data={logs} columns={columns}>
            <Table.Content />
          </Table>
        )}
      </Card.Content>
    </Card>
  );
};

export default SyncStatus;
