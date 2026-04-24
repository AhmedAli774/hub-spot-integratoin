import React, { type FC, useEffect, useState } from 'react';
import { httpClient } from '@wix/essentials';
import {
  Box,
  Button,
  Card,
  Divider,
  FormField,
  Input,
  Layout,
  Cell,
  Loader,
  Text,
  Badge,
} from '@wix/design-system';
import { dashboard } from '@wix/dashboard';
import { apiUrl } from '../lib/api';

interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

interface FormData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  message: string;
  pageUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
}

const DEFAULT_FORM: FormData = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  company: '',
  message: '',
  pageUrl: '',
  utmSource: '',
  utmMedium: '',
  utmCampaign: '',
  utmTerm: '',
  utmContent: '',
};

function parseUtmFromUrl(): UtmParams {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || undefined,
    utm_medium: params.get('utm_medium') || undefined,
    utm_campaign: params.get('utm_campaign') || undefined,
    utm_term: params.get('utm_term') || undefined,
    utm_content: params.get('utm_content') || undefined,
  };
}

const LeadCaptureForm: FC = () => {
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; hubspotId?: string; error?: string } | null>(null);
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const utm = parseUtmFromUrl();
    setForm((prev) => ({
      ...prev,
      pageUrl: window.location.href,
      utmSource: utm.utm_source || '',
      utmMedium: utm.utm_medium || '',
      utmCampaign: utm.utm_campaign || '',
      utmTerm: utm.utm_term || '',
      utmContent: utm.utm_content || '',
    }));
    setCurrentTime(new Date().toLocaleString());
  }, []);

  const handleChange = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.email.trim()) {
      dashboard.showToast({ message: 'Email is required', type: 'error' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      dashboard.showToast({ message: 'Please enter a valid email', type: 'error' });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const payload = {
        formFields: {
          email: form.email.trim(),
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          company: form.company.trim(),
          message: form.message.trim(),
        },
        utmParams: {
          ...(form.utmSource && { utm_source: form.utmSource }),
          ...(form.utmMedium && { utm_medium: form.utmMedium }),
          ...(form.utmCampaign && { utm_campaign: form.utmCampaign }),
          ...(form.utmTerm && { utm_term: form.utmTerm }),
          ...(form.utmContent && { utm_content: form.utmContent }),
        },
        pageUrl: form.pageUrl || window.location.href,
        referrer: document.referrer || '',
      };

      const res = await httpClient.fetchWithAuth(apiUrl('/api/forms/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { success: boolean; hubspotId?: string; error?: string };

      if (res.ok && data.success) {
        setResult({ success: true, hubspotId: data.hubspotId });
        dashboard.showToast({ message: 'Lead captured in HubSpot!', type: 'success' });
        setForm(DEFAULT_FORM);
        setCurrentTime(new Date().toLocaleString());
      } else {
        setResult({ success: false, error: data.error || `Server error (${res.status})` });
        dashboard.showToast({ message: data.error || 'Submission failed', type: 'error' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setResult({ success: false, error: msg });
      dashboard.showToast({ message: msg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const hasUtm = form.utmSource || form.utmMedium || form.utmCampaign || form.utmTerm || form.utmContent;

  return (
    <Card>
      <Card.Header
        title="Lead Capture Form"
        subtitle="Submit leads directly to HubSpot CRM"
      />
      <Card.Divider />
      <Card.Content>
        <Box direction="vertical" gap="20px">

          {/* Contact Info Section */}
          <Box direction="vertical" gap="12px">
            <Text weight="bold" size="medium">Contact Information</Text>
            <Layout gap="12px">
              <Cell span={6}>
                <FormField label="First Name">
                  <Input
                    value={form.firstName}
                    onChange={handleChange('firstName')}
                    placeholder="John"
                  />
                </FormField>
              </Cell>
              <Cell span={6}>
                <FormField label="Last Name">
                  <Input
                    value={form.lastName}
                    onChange={handleChange('lastName')}
                    placeholder="Doe"
                  />
                </FormField>
              </Cell>
              <Cell span={12}>
                <FormField label="Email *" required>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={handleChange('email')}
                    placeholder="lead@example.com"
                  />
                </FormField>
              </Cell>
              <Cell span={6}>
                <FormField label="Phone">
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={handleChange('phone')}
                    placeholder="+1 555 123 4567"
                  />
                </FormField>
              </Cell>
              <Cell span={6}>
                <FormField label="Company">
                  <Input
                    value={form.company}
                    onChange={handleChange('company')}
                    placeholder="Acme Inc."
                  />
                </FormField>
              </Cell>
            </Layout>
          </Box>

          <Divider />

          {/* Marketing / UTM Section */}
          <Box direction="vertical" gap="12px">
            <Box gap="SP2" align="center">
              <Text weight="bold" size="medium">UTM (Marketing Data)</Text>
              {hasUtm && <Badge size="tiny" skin="success">Auto-detected</Badge>}
            </Box>
            <Layout gap="12px">
              <Cell span={4}>
                <FormField label="UTM Source">
                  <Input
                    value={form.utmSource}
                    onChange={handleChange('utmSource')}
                    placeholder="google"
                  />
                </FormField>
              </Cell>
              <Cell span={4}>
                <FormField label="UTM Medium">
                  <Input
                    value={form.utmMedium}
                    onChange={handleChange('utmMedium')}
                    placeholder="cpc"
                  />
                </FormField>
              </Cell>
              <Cell span={4}>
                <FormField label="UTM Campaign">
                  <Input
                    value={form.utmCampaign}
                    onChange={handleChange('utmCampaign')}
                    placeholder="summer_sale"
                  />
                </FormField>
              </Cell>
              <Cell span={6}>
                <FormField label="UTM Term">
                  <Input
                    value={form.utmTerm}
                    onChange={handleChange('utmTerm')}
                    placeholder="keyword"
                  />
                </FormField>
              </Cell>
              <Cell span={6}>
                <FormField label="UTM Content">
                  <Input
                    value={form.utmContent}
                    onChange={handleChange('utmContent')}
                    placeholder="banner_ad_1"
                  />
                </FormField>
              </Cell>
            </Layout>
          </Box>

          <Divider />

          {/* Page & Time Section */}
          <Box direction="vertical" gap="12px">
            <Text weight="bold" size="medium">Page & Timestamp</Text>
            <Layout gap="12px">
              <Cell span={8}>
                <FormField label="Page URL">
                  <Input
                    value={form.pageUrl}
                    onChange={handleChange('pageUrl')}
                    placeholder="https://..."
                  />
                </FormField>
              </Cell>
              <Cell span={4}>
                <FormField label="Submission Time">
                  <Input value={currentTime} disabled />
                </FormField>
              </Cell>
            </Layout>
          </Box>

          <Divider />

          {/* Message */}
          <FormField label="Message">
            <Input
              value={form.message}
              onChange={handleChange('message')}
              placeholder="How can we help?"
            />
          </FormField>

          {/* Submit */}
          <Box gap="SP3" align="center">
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader size="tiny" /> : 'Submit to HubSpot'}
            </Button>
          </Box>

          {result?.success && (
            <Box
              padding="SP3"
              backgroundColor="D70"
              borderRadius="8px"
              direction="vertical"
              gap="SP2"
            >
              <Badge skin="success">Submitted successfully</Badge>
              <Text size="small">
                HubSpot Contact ID: <strong>{result.hubspotId}</strong>
              </Text>
            </Box>
          )}

          {result && !result.success && (
            <Box
              padding="SP3"
              backgroundColor="R40"
              borderRadius="8px"
              direction="vertical"
              gap="SP2"
            >
              <Badge skin="danger">Submission failed</Badge>
              <Text size="small" secondary>{result.error}</Text>
            </Box>
          )}
        </Box>
      </Card.Content>
    </Card>
  );
};

export default LeadCaptureForm;

