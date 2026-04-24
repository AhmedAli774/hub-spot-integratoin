import { extensions } from '@wix/astro/builders';

export const dashboardpageHubspot = extensions.dashboardPage({
  id: 'c001a042-08d5-4f82-8e8a-555fd7051a2d',
  title: 'HubSpot Integration',
  routePath: 'hubspot-integration',
  component: './dashboard/pages/page.tsx',
});
