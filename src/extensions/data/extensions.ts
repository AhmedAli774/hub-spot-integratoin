import { extensions } from '@wix/astro/builders';

export const dataExtension = extensions.genericExtension({
  compId: 'f3a7d2c1-9b4e-4f8a-b0c2-e6d1a5f07b3e',
  compName: 'data-extension',
  compType: 'DATA_COMPONENT',
  compData: {
    dataComponent: {
      collections: [
        {
          schemaUrl: 'https://www.wix.com/',
          idSuffix: 'hubspot-tokens',
          displayName: 'HubSpot Tokens',
          displayField: 'accessToken',
          fields: [
            { key: 'accessToken', displayName: 'Access Token', type: 'TEXT' },
            { key: 'refreshToken', displayName: 'Refresh Token', type: 'TEXT' },
            { key: 'expiresAt', displayName: 'Expires At (ms)', type: 'NUMBER' },
          ],
          dataPermissions: {
            itemRead: 'PRIVILEGED',
            itemInsert: 'PRIVILEGED',
            itemUpdate: 'PRIVILEGED',
            itemRemove: 'PRIVILEGED',
          },
        },
        {
          schemaUrl: 'https://www.wix.com/',
          idSuffix: 'contact-id-mapping',
          displayName: 'Contact ID Mapping',
          displayField: 'wixContactId',
          fields: [
            { key: 'wixContactId', displayName: 'Wix Contact ID', type: 'TEXT', unique: true },
            { key: 'hubspotContactId', displayName: 'HubSpot Contact ID', type: 'TEXT', unique: true },
            { key: 'lastSyncedAt', displayName: 'Last Synced At', type: 'DATETIME' },
          ],
          dataPermissions: {
            itemRead: 'PRIVILEGED',
            itemInsert: 'PRIVILEGED',
            itemUpdate: 'PRIVILEGED',
            itemRemove: 'PRIVILEGED',
          },
        },
        {
          schemaUrl: 'https://www.wix.com/',
          idSuffix: 'sync-log',
          displayName: 'Sync Log',
          displayField: 'contactId',
          fields: [
            { key: 'syncId', displayName: 'Sync ID', type: 'TEXT' },
            { key: 'source', displayName: 'Source', type: 'TEXT' },
            { key: 'action', displayName: 'Action', type: 'TEXT' },
            { key: 'status', displayName: 'Status', type: 'TEXT' },
            { key: 'contactId', displayName: 'Contact ID', type: 'TEXT' },
            { key: 'detail', displayName: 'Detail', type: 'TEXT' },
          ],
          dataPermissions: {
            itemRead: 'PRIVILEGED',
            itemInsert: 'PRIVILEGED',
            itemUpdate: 'PRIVILEGED',
            itemRemove: 'PRIVILEGED',
          },
        },
      ],
    },
  },
});
