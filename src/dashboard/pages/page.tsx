import React, { type FC, useEffect, useState } from 'react';
import { dashboard } from '@wix/dashboard';
import { Page, Tabs, WixDesignSystemProvider } from '@wix/design-system';
import '@wix/design-system/styles.global.css';
import ConnectPage from '../connect/ConnectPage';
import FieldMappingTable from '../mapping/FieldMappingTable';
import SyncStatus from '../status/SyncStatus';
import LeadCaptureForm from '../form/LeadCaptureForm';

import LeadList from '../leads/LeadList';

type TabId = 'connect' | 'mapping' | 'status' | 'capture' | 'leads';

const TABS: Array<{ id: TabId; title: string }> = [
  { id: 'connect', title: 'Connect' },
  { id: 'mapping', title: 'Field Mapping' },
  { id: 'status', title: 'Sync Status' },
  { id: 'capture', title: 'Lead Capture' },
  { id: 'leads', title: 'Leads' },
];

const DashboardPage: FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('connect');

  useEffect(() => {
    dashboard.setPageTitle('HubSpot Integration');
  }, []);

  return (
    <WixDesignSystemProvider features={{ newColorsBranding: true }}>
      <Page>
        <Page.Header
          title="HubSpot Integration"
          subtitle="Sync your Wix contacts with HubSpot CRM"
        />
        <Page.Content>
          <Tabs
            activeId={activeTab}
            items={TABS}
            onClick={(tab) => setActiveTab(tab.id as TabId)}
          />
          <div style={{ marginTop: 24 }}>
            {activeTab === 'connect' && <ConnectPage />}
            {activeTab === 'mapping' && <FieldMappingTable />}
            {activeTab === 'status' && <SyncStatus />}
            {activeTab === 'capture' && <LeadCaptureForm />}
            {activeTab === 'leads' && <LeadList />}
          </div>
        </Page.Content>
      </Page>
    </WixDesignSystemProvider>
  );
};

export default DashboardPage;
