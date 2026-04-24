import React, { type FC, useEffect, useState } from 'react';
import {
  Box,
  Card,
  CustomModalLayout,
  EmptyState,
  FormField,
  Input,
  Layout,
  Cell,
  Loader,
  Modal,
  Table,
  TableActionCell,
  Text,
  TextButton,
} from '@wix/design-system';
import { EditSmall, ExternalLinkSmall } from '@wix/wix-ui-icons-common';

interface HubSpotLead {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    lastmodifieddate?: string;
  };
  createdAt: string;
  updatedAt: string;
}

const LeadList: FC = () => {
  const [leads, setLeads] = useState<HubSpotLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingLead, setEditingLead] = useState<HubSpotLead | null>(null);
  const [editForm, setEditForm] = useState({
    firstname: '',
    lastname: '',
    email: '',
    phone: '',
    company: '',
  });
  const [saving, setSaving] = useState(false);

  const baseUrl = (import.meta.env as Record<string, unknown>).PUBLIC_API_BASE as string || '';

  const fetchLeads = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${baseUrl}/api/leads`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const text = await res.text();
      if (!text) {
        setLeads([]);
        return;
      }
      const data = JSON.parse(text);
      setLeads(data.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const openEdit = (lead: HubSpotLead) => {
    setEditingLead(lead);
    setEditForm({
      firstname: lead.properties?.firstname ?? '',
      lastname: lead.properties?.lastname ?? '',
      email: lead.properties?.email ?? '',
      phone: lead.properties?.phone ?? '',
      company: lead.properties?.company ?? '',
    });
  };

  const closeEdit = () => {
    setEditingLead(null);
    setSaving(false);
  };

  const saveLead = async () => {
    if (!editingLead) return;
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/leads`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingLead.id,
          properties: {
            firstname: editForm.firstname,
            lastname: editForm.lastname,
            email: editForm.email,
            phone: editForm.phone,
            company: editForm.company,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      closeEdit();
      await fetchLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lead');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box align="center" padding={4}>
        <Loader size="medium" />
      </Box>
    );
  }

  if (error) {
    return (
      <Card>
        <Box padding={4}>
          <Text skin="error">{error}</Text>
          <Box marginTop={2}>
            <TextButton onClick={fetchLeads}>Retry</TextButton>
          </Box>
        </Box>
      </Card>
    );
  }

  if (leads.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No leads found"
          subtitle="No contacts found in your HubSpot CRM. Add some leads to see them here."
        />
      </Card>
    );
  }

  const columns = [
    {
      title: 'Name',
      render: (row: HubSpotLead) =>
        `${row.properties?.firstname ?? ''} ${row.properties?.lastname ?? ''}`.trim() || '—',
    },
    { title: 'Email', render: (row: HubSpotLead) => row.properties?.email || '—' },
    { title: 'Phone', render: (row: HubSpotLead) => row.properties?.phone || '—' },
    { title: 'Company', render: (row: HubSpotLead) => row.properties?.company || '—' },
    {
      title: 'Last Modified',
      render: (row: HubSpotLead) =>
        row.properties?.lastmodifieddate
          ? new Date(row.properties.lastmodifieddate).toLocaleString()
          : '—',
    },
    {
      title: 'Actions',
      render: (row: HubSpotLead) => (
        <TableActionCell
          secondaryActions={[
            {
              text: 'Edit',
              icon: <EditSmall />,
              onClick: () => openEdit(row),
            },
            {
              text: 'Open in HubSpot',
              icon: <ExternalLinkSmall />,
              onClick: () => {
                window.open(`https://app.hubspot.com/contacts/${row.id}`, '_blank');
              },
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <Card>
        <Card.Header
          title={`HubSpot Leads (${leads.length})`}
          subtitle="All contacts from your HubSpot CRM"
        />
        <Card.Content>
          <Table data={leads} columns={columns} showSelection={false} />
        </Card.Content>
      </Card>

      <Modal isOpen={!!editingLead} onRequestClose={closeEdit}>
        <CustomModalLayout
          primaryButtonText={saving ? 'Saving...' : 'Save'}
          primaryButtonOnClick={saveLead}
          secondaryButtonText="Cancel"
          secondaryButtonOnClick={closeEdit}
          onCloseButtonClick={closeEdit}
          title="Edit Lead"
          removeContentPadding
          content={
            <Box padding={4}>
              <Layout gap="12px">
                <Cell span={6}>
                  <FormField label="First Name" required>
                    <Input
                      value={editForm.firstname}
                      onChange={(e) => setEditForm({ ...editForm, firstname: e.target.value })}
                    />
                  </FormField>
                </Cell>
                <Cell span={6}>
                  <FormField label="Last Name" required>
                    <Input
                      value={editForm.lastname}
                      onChange={(e) => setEditForm({ ...editForm, lastname: e.target.value })}
                    />
                  </FormField>
                </Cell>
                <Cell span={12}>
                  <FormField label="Email" required>
                    <Input
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    />
                  </FormField>
                </Cell>
                <Cell span={6}>
                  <FormField label="Phone">
                    <Input
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    />
                  </FormField>
                </Cell>
                <Cell span={6}>
                  <FormField label="Company">
                    <Input
                      value={editForm.company}
                      onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                    />
                  </FormField>
                </Cell>
              </Layout>
            </Box>
          }
        />
      </Modal>
    </>
  );
};

export default LeadList;

