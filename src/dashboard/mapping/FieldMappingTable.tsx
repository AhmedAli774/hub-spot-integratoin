import React, { type FC, useEffect, useState } from 'react';
import { httpClient } from '@wix/essentials';
import {
  Badge,
  Box,
  Button,
  Card,
  Dropdown,
  FormField,
  Input,
  Loader,
  Table,
  TableActionCell,
  Text,
} from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { apiUrl } from '../lib/api';

type Direction = 'wix-to-hubspot' | 'hubspot-to-wix' | 'bidirectional';

interface FieldMapping {
  id: string;
  wixField: string;
  hubspotProperty: string;
  direction: Direction;
  required?: boolean;
}

const DIRECTION_OPTIONS = [
  { id: 'bidirectional', value: 'Bi-directional' },
  { id: 'wix-to-hubspot', value: 'Wix → HubSpot' },
  { id: 'hubspot-to-wix', value: 'HubSpot → Wix' },
];

function directionSkin(dir: Direction): 'neutralLight' | 'neutralStandard' | 'neutralSuccess' {
  if (dir === 'wix-to-hubspot') return 'neutralStandard';
  if (dir === 'hubspot-to-wix') return 'neutralLight';
  return 'neutralSuccess';
}

function directionLabel(dir: Direction): string {
  return DIRECTION_OPTIONS.find((o) => o.id === dir)?.value ?? dir;
}

const FieldMappingTable: FC = () => {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [newWix, setNewWix] = useState('');
  const [newHs, setNewHs] = useState('');
  const [newDirection, setNewDirection] = useState<Direction>('bidirectional');
  const [saving, setSaving] = useState(false);

  const fetchMappings = async () => {
    try {
      const res = await httpClient.fetchWithAuth(apiUrl('/api/mappings'));
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = (await res.json()) as { mappings: FieldMapping[] };
      setMappings(data.mappings);
    } catch {
      dashboard.showToast({ message: 'Could not load mappings. Is the server running?', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchMappings(); }, []);

  const handleAdd = async () => {
    if (!newWix.trim() || !newHs.trim()) return;
    setSaving(true);
    try {
      const res = await httpClient.fetchWithAuth(apiUrl('/api/mappings'), {
        method: 'POST',
        body: JSON.stringify({ wixField: newWix.trim(), hubspotProperty: newHs.trim(), direction: newDirection }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        dashboard.showToast({ message: data.error ?? 'Failed to save mapping', type: 'error' });
        return;
      }
      setNewWix('');
      setNewHs('');
      setNewDirection('bidirectional');
      await fetchMappings();
      dashboard.showToast({ message: 'Mapping saved', type: 'success' });
    } catch {
      dashboard.showToast({ message: 'Failed to save mapping', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await httpClient.fetchWithAuth(apiUrl(`/api/mappings?id=${id}`), { method: 'DELETE' });
      await fetchMappings();
      dashboard.showToast({ message: 'Mapping deleted', type: 'success' });
    } catch {
      dashboard.showToast({ message: 'Failed to delete mapping', type: 'error' });
    }
  };

  const columns = [
    { title: 'Wix Field', render: (row: FieldMapping) => <Text size="small">{row.wixField}</Text> },
    { title: 'HubSpot Property', render: (row: FieldMapping) => <Text size="small">{row.hubspotProperty}</Text> },
    {
      title: 'Direction',
      render: (row: FieldMapping) => (
        <Badge skin={directionSkin(row.direction ?? 'bidirectional')} size="small">
          {directionLabel(row.direction ?? 'bidirectional')}
        </Badge>
      ),
    },
    {
      title: '',
      render: (row: FieldMapping) => (
        <TableActionCell
          primaryAction={{
            text: 'Delete',
            onClick: () => { void handleDelete(row.id); },
            disabled: row.required === true,
          }}
        />
      ),
    },
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
        title="Field Mappings"
        subtitle="Map Wix contact fields to HubSpot properties"
      />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="SP6">
          <Table data={mappings} columns={columns}>
            <Table.Content />
          </Table>

          <Card.Divider />

          <Text weight="bold">Add New Mapping</Text>
          <Box gap="SP3" verticalAlign="bottom">
            <FormField label="Wix Field">
              <Input
                value={newWix}
                onChange={(e) => setNewWix(e.target.value)}
                placeholder="e.g. name.first"
              />
            </FormField>
            <FormField label="HubSpot Property">
              <Input
                value={newHs}
                onChange={(e) => setNewHs(e.target.value)}
                placeholder="e.g. firstname"
              />
            </FormField>
            <FormField label="Direction">
              <Dropdown
                options={DIRECTION_OPTIONS}
                selectedId={newDirection}
                onSelect={(opt) => setNewDirection(opt.id as Direction)}
                placeholder="Select direction"
              />
            </FormField>
            <Button
              onClick={() => { void handleAdd(); }}
              disabled={saving || !newWix || !newHs}
            >
              Add
            </Button>
          </Box>
        </Box>
      </Card.Content>
    </Card>
  );
};

export default FieldMappingTable;
