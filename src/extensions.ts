import { app } from '@wix/astro/builders';
import { dataExtension } from './extensions/data/extensions';
import { dashboardpageHubspot } from './extensions/dashboard/pages/hubspot/extensions';

export default app()
  .use(dataExtension)
  .use(dashboardpageHubspot);
